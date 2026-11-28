import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_KEYBINDINGS,
  POST_MESSAGE_SOURCE_ISOLATED,
  POST_MESSAGE_SOURCE_MAIN,
  type PlayerMainWorldContext,
  type ServicePlugin
} from '@langai/contracts';
import { resetMigrationStateForTesting, SETTINGS_KEY } from '@langai/storage';
import {
  MAIN_WORLD_LOG_EVENT,
  MAIN_WORLD_TRACKS_EVENT,
  runMainWorldInterceptor
} from '../content/mainWorldRunner';
import { VideoController, type VideoControllerCallbacks } from '../engine/VideoController';
import { sendRuntimeMessage } from '../messaging/runtimeClient';
import {
  collectServiceMatchPatterns,
  createModuleManager,
  getBundlePathsForService,
  isForbiddenGlobalPattern,
  normalizeMirrorToMatchPatterns
} from '../background/moduleManager';
import {
  handleFetchSubtitleText,
  isPrivateOrLoopbackHostname,
  validateSubtitleFetchUrl
} from '../background/service-worker';

function createEventTargetMock() {
  const listeners = new Map<string, Set<(event: unknown) => void>>();

  return {
    addEventListener(
      type: string,
      listener: (event: unknown) => void,
      options?: { signal?: AbortSignal }
    ) {
      if (options?.signal?.aborted) return;
      let set = listeners.get(type);
      if (!set) {
        set = new Set();
        listeners.set(type, set);
      }
      set.add(listener);
      options?.signal?.addEventListener(
        'abort',
        () => {
          set?.delete(listener);
        },
        { once: true }
      );
    },
    removeEventListener(type: string, listener: (event: unknown) => void) {
      listeners.get(type)?.delete(listener);
    },
    dispatch(type: string, event: unknown = {}) {
      const set = listeners.get(type);
      if (!set) return;
      for (const fn of Array.from(set)) {
        fn(event);
      }
    }
  };
}

describe('VideoController rAF lifecycle and keybindings', () => {
  let nextRafId = 1;
  let rafQueue = new Map<number, FrameRequestCallback>();
  let windowMock: ReturnType<typeof createEventTargetMock> & {
    requestAnimationFrame: (cb: FrameRequestCallback) => number;
    cancelAnimationFrame: (id: number) => void;
    setInterval: typeof setInterval;
    clearInterval: typeof clearInterval;
    clearTimeout: typeof clearTimeout;
  };
  let documentMock: ReturnType<typeof createEventTargetMock> & {
    hidden: boolean;
    activeElement: null;
  };

  beforeEach(() => {
    nextRafId = 1;
    rafQueue = new Map();
    const winTarget = createEventTargetMock();
    windowMock = {
      ...winTarget,
      requestAnimationFrame: vi.fn((cb: FrameRequestCallback) => {
        const id = nextRafId++;
        rafQueue.set(id, cb);
        return id;
      }),
      cancelAnimationFrame: vi.fn((id: number) => {
        rafQueue.delete(id);
      }),
      setInterval,
      clearInterval,
      clearTimeout
    };
    const docTarget = createEventTargetMock();
    documentMock = {
      ...docTarget,
      hidden: false,
      activeElement: null
    };
    vi.stubGlobal('window', windowMock);
    vi.stubGlobal('document', documentMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function createVideoMock(initialPaused = true) {
    const target = createEventTargetMock();
    return {
      ...target,
      paused: initialPaused,
      ended: false,
      currentTime: 10,
      play: vi.fn(async function (this: { paused: boolean }) {
        this.paused = false;
        target.dispatch('play');
      }),
      pause: vi.fn(function (this: { paused: boolean }) {
        this.paused = true;
        target.dispatch('pause');
      })
    };
  }

  function createCallbacks(overrides: Partial<VideoControllerCallbacks> = {}): VideoControllerCallbacks {
    return {
      onTimeUpdate: vi.fn(),
      onSeeked: vi.fn(),
      onRepeatCue: vi.fn(),
      onPreviousCue: vi.fn(),
      onNextCue: vi.fn(),
      onSaveActiveWord: vi.fn(() => true),
      onClosePopup: vi.fn(),
      onAltKeyChange: vi.fn(),
      isPopupOpen: () => false,
      hasCues: () => true,
      isOverlayEnabled: () => true,
      isAdShowing: () => false,
      getKeybindings: () => ({ ...DEFAULT_KEYBINDINGS }),
      ...overrides
    };
  }

  it('does not start rAF while video is paused, and runs single sync tick on seeked/timeupdate', () => {
    const callbacks = createCallbacks();
    const controller = new VideoController(callbacks);
    const video = createVideoMock(true);

    controller.attach(video as unknown as HTMLVideoElement);
    expect(controller.isLoopRunning()).toBe(false);
    expect(windowMock.requestAnimationFrame).not.toHaveBeenCalled();
    expect(callbacks.onTimeUpdate).toHaveBeenCalledTimes(1);
    expect(callbacks.onTimeUpdate).toHaveBeenLastCalledWith(10);

    video.currentTime = 25;
    video.dispatch('seeked');
    expect(controller.isLoopRunning()).toBe(false);
    expect(callbacks.onTimeUpdate).toHaveBeenLastCalledWith(25);
    expect(callbacks.onSeeked).toHaveBeenCalledTimes(1);

    video.currentTime = 30;
    video.dispatch('timeupdate');
    expect(controller.isLoopRunning()).toBe(false);
    expect(callbacks.onTimeUpdate).toHaveBeenLastCalledWith(30);

    controller.destroy();
  });

  it('starts rAF on play and stops rAF on pause, ended, and visibilitychange hidden', () => {
    const callbacks = createCallbacks();
    const controller = new VideoController(callbacks);
    const video = createVideoMock(true);

    controller.attach(video as unknown as HTMLVideoElement);
    expect(controller.isLoopRunning()).toBe(false);

    // Start playing -> rAF starts
    video.paused = false;
    video.dispatch('play');
    expect(controller.isLoopRunning()).toBe(true);
    expect(rafQueue.size).toBe(1);

    // Run one rAF tick while playing -> schedules next frame
    const firstCb = Array.from(rafQueue.values())[0];
    rafQueue.clear();
    video.currentTime = 12.5;
    firstCb(16);
    expect(callbacks.onTimeUpdate).toHaveBeenLastCalledWith(12.5);
    expect(rafQueue.size).toBe(1);

    // Pause -> stops rAF immediately
    video.paused = true;
    video.dispatch('pause');
    expect(controller.isLoopRunning()).toBe(false);
    expect(rafQueue.size).toBe(0);

    // Play again then hide document -> stops rAF
    video.paused = false;
    video.dispatch('play');
    expect(controller.isLoopRunning()).toBe(true);
    documentMock.hidden = true;
    documentMock.dispatch('visibilitychange');
    expect(controller.isLoopRunning()).toBe(false);

    // Unhide while playing -> resumes rAF
    documentMock.hidden = false;
    documentMock.dispatch('visibilitychange');
    expect(controller.isLoopRunning()).toBe(true);

    // Ended -> stops rAF
    video.ended = true;
    video.dispatch('ended');
    expect(controller.isLoopRunning()).toBe(false);

    controller.destroy();
  });

  it('uses settings.keybindings.quickSaveCard instead of hardcoded KeyS', () => {
    const onSaveActiveWord = vi.fn(() => true);
    const callbacks = createCallbacks({
      onSaveActiveWord,
      getKeybindings: () => ({
        ...DEFAULT_KEYBINDINGS,
        quickSaveCard: { code: 'KeyQ', shift: true }
      })
    });
    const controller = new VideoController(callbacks);

    const makeKeyEvent = (code: string, shiftKey = false) => ({
      code,
      key: code,
      repeat: false,
      ctrlKey: false,
      altKey: false,
      shiftKey,
      target: null,
      preventDefault: vi.fn(),
      stopImmediatePropagation: vi.fn()
    });

    // Old hardcoded KeyS must NOT trigger when rebound to Shift+Q
    const keySEvent = makeKeyEvent('KeyS', false);
    windowMock.dispatch('keydown', keySEvent);
    expect(onSaveActiveWord).not.toHaveBeenCalled();

    // Custom keybind Shift+KeyQ triggers quick-save
    const keyQEvent = makeKeyEvent('KeyQ', true);
    windowMock.dispatch('keydown', keyQEvent);
    expect(onSaveActiveWord).toHaveBeenCalledTimes(1);
    expect(keyQEvent.preventDefault).toHaveBeenCalledTimes(1);

    controller.destroy();
  });
});

describe('Service Worker subtitle fetch security (SSRF, timeout, size limit)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('blocks non-http(s) protocols and private/loopback hosts', () => {
    expect(() => validateSubtitleFetchUrl('file:///etc/passwd')).toThrow();
    expect(() => validateSubtitleFetchUrl('javascript:alert(1)')).toThrow();
    expect(() => validateSubtitleFetchUrl('ftp://example.com/sub.vtt')).toThrow();

    const blockedHosts = [
      'localhost',
      'sub.localhost',
      '127.0.0.1',
      '127.10.20.30',
      '10.0.0.1',
      '172.16.0.1',
      '172.31.255.254',
      '192.168.1.10',
      '169.254.169.254',
      '0.0.0.0',
      '[::1]',
      '::1',
      '[fc00::1]',
      '[fd12:3456::1]',
      '[fe80::1]',
      '[::ffff:127.0.0.1]'
    ];

    for (const host of blockedHosts) {
      expect(isPrivateOrLoopbackHostname(host)).toBe(true);
      const urlHost = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
      expect(() => validateSubtitleFetchUrl(`https://${urlHost}/subs.vtt`)).toThrow();
    }

    expect(isPrivateOrLoopbackHostname('172.15.0.1')).toBe(false);
    expect(isPrivateOrLoopbackHostname('172.32.0.1')).toBe(false);
    expect(isPrivateOrLoopbackHostname('cdn.example.com')).toBe(false);
    expect(validateSubtitleFetchUrl('https://cdn.example.com/subs.vtt').hostname).toBe(
      'cdn.example.com'
    );
  });

  it('enforces 10s AbortSignal timeout and 5 MB response size limit', async () => {
    let capturedSignal: AbortSignal | undefined;
    const largeChunk = new Uint8Array(5 * 1024 * 1024 + 10);

    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        capturedSignal = init?.signal ?? undefined;
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(largeChunk);
            controller.close();
          }
        });
        return new Response(stream, { status: 200 });
      })
    );

    await expect(handleFetchSubtitleText('https://cdn.example.com/huge.vtt')).rejects.toThrow(
      /5 MB/i
    );
    expect(capturedSignal).toBeDefined();

    // Also verifies valid small subtitle response succeeds
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHello', { status: 200 }))
    );
    const text = await handleFetchSubtitleText('https://cdn.example.com/valid.vtt');
    expect(text).toContain('WEBVTT');
  });
});

describe('ModuleManager declarative registration and pattern safety', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const sampleDynamicService: ServicePlugin = {
    id: 'sample-stream',
    name: 'Sample Stream',
    badgeLabel: 'Sample',
    hostMatches: ['https://*.sample.test/*', 'https://*/*'],
    playerIframeMatches: ['https://cdn.player.test/*', '<all_urls>'],
    capabilities: {
      cueSeeking: true,
      nativeTranslatedTrack: false,
      dynamicModule: true
    },
    needsMainWorldInterceptor: true,
    allFrames: true,
    players: [],
    matchesUrl: () => true,
    resolveMediaIdentity: () => null,
    initIsolatedSession: () => () => undefined
  };

  it('forbids global wildcard patterns and normalizes custom mirrors safely', () => {
    expect(isForbiddenGlobalPattern('*://*/*')).toBe(true);
    expect(isForbiddenGlobalPattern('<all_urls>')).toBe(true);
    expect(isForbiddenGlobalPattern('https://*/*')).toBe(true);
    expect(isForbiddenGlobalPattern('http://*/*')).toBe(true);
    expect(isForbiddenGlobalPattern('https://*.sample.test/*')).toBe(false);

    expect(normalizeMirrorToMatchPatterns('*://*/*')).toEqual([]);
    expect(normalizeMirrorToMatchPatterns('<all_urls>')).toEqual([]);
    expect(normalizeMirrorToMatchPatterns('mirror.example.com')).toEqual([
      '*://mirror.example.com/*',
      '*://*.mirror.example.com/*'
    ]);

    const collected = collectServiceMatchPatterns(sampleDynamicService, [
      'https://*/*',
      'mirror.example.com'
    ]);
    expect(collected).toEqual([
      'https://*.sample.test/*',
      'https://cdn.player.test/*',
      '*://mirror.example.com/*',
      '*://*.mirror.example.com/*'
    ]);
  });

  it('registers scripts only for specific hostMatches, iframeMatches, and customMirrors', async () => {
    resetMigrationStateForTesting();
    const registeredCalls: Array<
      Array<{
        id: string;
        js: string[];
        matches: string[];
        world: string;
      }>
    > = [];
    const registerMock = vi.fn(
      async (
        scripts: Array<{
          id: string;
          js: string[];
          matches: string[];
          world: string;
        }>
      ) => {
        registeredCalls.push(scripts);
      }
    );
    const unregisterMock = vi.fn(async () => undefined);
    const getRegisteredMock = vi.fn(async () => []);
    let storedSettings: Record<string, unknown> = {
      customMirrors: ['mirror.example.com', '<all_urls>'],
      enabledServices: {}
    };

    vi.stubGlobal('chrome', {
      runtime: { id: 'test-ext-id' },
      storage: {
        local: {
          get: vi.fn(async () => ({
            langai_migrated_v2: true,
            [SETTINGS_KEY]: storedSettings
          })),
          set: vi.fn(async (obj: Record<string, unknown>) => {
            if (obj[SETTINGS_KEY]) {
              storedSettings = obj[SETTINGS_KEY] as Record<string, unknown>;
            }
          })
        }
      },
      permissions: {
        contains: vi.fn(async () => true),
        request: vi.fn(async () => true)
      },
      scripting: {
        registerContentScripts: registerMock,
        unregisterContentScripts: unregisterMock,
        getRegisteredContentScripts: getRegisteredMock
      }
    });

    const mgr = createModuleManager([sampleDynamicService]);
    const bundles = getBundlePathsForService(sampleDynamicService);
    expect(bundles).toEqual({
      contentScriptPath: 'assets/content-sample-stream.js',
      mainWorldInterceptorPath: 'assets/interceptor-sample-stream.js'
    });

    const res = await mgr.enableService('sample-stream');
    expect(res.success).toBe(true);
    expect(registerMock).toHaveBeenCalledTimes(1);

    const registeredArg = registeredCalls[0];
    expect(registeredArg).toHaveLength(2);
    expect(registeredArg[0]).toMatchObject({
      id: 'interceptor-sample-stream',
      js: ['assets/interceptor-sample-stream.js'],
      world: 'MAIN'
    });
    expect(registeredArg[1]).toMatchObject({
      id: 'content-sample-stream',
      js: ['assets/content-sample-stream.js'],
      world: 'ISOLATED'
    });

    for (const script of registeredArg) {
      expect(script.matches).not.toContain('*://*/*');
      expect(script.matches).not.toContain('<all_urls>');
      expect(script.matches).not.toContain('https://*/*');
      expect(script.matches).toEqual([
        'https://*.sample.test/*',
        'https://cdn.player.test/*',
        '*://mirror.example.com/*',
        '*://*.mirror.example.com/*'
      ]);
    }
  });
});

describe('runMainWorldInterceptor and sendRuntimeMessage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('wires service.initMainWorldExtractor and player.initMainWorldProbe and emits POST_MESSAGE_SOURCE_MAIN', () => {
    const winTarget = createEventTargetMock();
    const posted: unknown[] = [];
    const windowMock = {
      ...winTarget,
      postMessage: vi.fn((msg: unknown) => posted.push(msg))
    };
    vi.stubGlobal('window', windowMock);

    const probeTeardown = vi.fn();
    const extractorTeardown = vi.fn();
    let capturedExtractorCtx: PlayerMainWorldContext | null = null;
    let capturedProbeCtx: PlayerMainWorldContext | null = null;

    const service: ServicePlugin = {
      id: 'demo-svc',
      name: 'Demo',
      badgeLabel: 'Demo',
      hostMatches: ['https://demo.test/*'],
      capabilities: {
        cueSeeking: true,
        nativeTranslatedTrack: false,
        dynamicModule: false
      },
      needsMainWorldInterceptor: true,
      players: [
        {
          id: 'demo-player',
          detectContainer: () => null,
          findVideo: () => null,
          isControlsHidden: () => false,
          getSubtitleBottomOffset: () => 48,
          initMainWorldProbe: (ctx) => {
            capturedProbeCtx = ctx;
            return probeTeardown;
          }
        }
      ],
      matchesUrl: () => true,
      resolveMediaIdentity: () => null,
      initMainWorldExtractor: (ctx) => {
        capturedExtractorCtx = ctx;
        return extractorTeardown;
      },
      initIsolatedSession: () => () => undefined
    };

    const teardown = runMainWorldInterceptor(service);
    expect(capturedExtractorCtx).not.toBeNull();
    expect(capturedProbeCtx).not.toBeNull();

    capturedExtractorCtx!.emitTracks({ skipTranslation: true });
    capturedProbeCtx!.log('info', 'Probe ready');

    expect(posted).toHaveLength(2);
    expect(posted[0]).toMatchObject({
      source: POST_MESSAGE_SOURCE_MAIN,
      type: MAIN_WORLD_TRACKS_EVENT,
      serviceId: 'demo-svc',
      payload: { skipTranslation: true }
    });
    expect(posted[1]).toMatchObject({
      source: POST_MESSAGE_SOURCE_MAIN,
      type: MAIN_WORLD_LOG_EVENT,
      serviceId: 'demo-svc',
      payload: { level: 'info', message: 'Probe ready' }
    });

    // Respects LANGAI_SET_DISABLED
    winTarget.dispatch('message', {
      source: windowMock,
      data: {
        source: POST_MESSAGE_SOURCE_ISOLATED,
        type: 'LANGAI_SET_DISABLED',
        disabled: true
      }
    });
    capturedExtractorCtx!.emitTracks({ skipTranslation: false });
    expect(posted).toHaveLength(2);

    teardown();
    expect(extractorTeardown).toHaveBeenCalledTimes(1);
    expect(probeTeardown).toHaveBeenCalledTimes(1);
  });

  it('sendRuntimeMessage resolves typed RuntimeResponse and rejects on lastError', async () => {
    vi.stubGlobal('chrome', {
      runtime: {
        id: 'ext-1',
        lastError: undefined,
        sendMessage: vi.fn((_req: unknown, cb: (res: unknown) => void) => {
          cb({ ok: true, data: { version: 6 } });
        })
      }
    });

    const okRes = await sendRuntimeMessage<{ version: number }>({
      type: 'ANKI_TEST',
      payload: { url: 'http://127.0.0.1:8765' }
    });
    expect(okRes).toEqual({ ok: true, data: { version: 6 } });

    vi.stubGlobal('chrome', {
      runtime: {
        id: 'ext-1',
        lastError: { message: 'Disconnected' },
        sendMessage: vi.fn((_req: unknown, cb: (res: unknown) => void) => {
          cb(undefined);
        })
      }
    });

    await expect(
      sendRuntimeMessage<{ version: number }>({
        type: 'ANKI_TEST',
        payload: { url: 'http://127.0.0.1:8765' }
      })
    ).rejects.toThrow('Disconnected');
  });
});
