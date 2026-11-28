import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  POST_MESSAGE_SOURCE_ISOLATED,
  POST_MESSAGE_SOURCE_MAIN,
  type CapturedTrackPayload
} from '@langai/contracts';
import {
  initYoutubeMainWorldInterceptor,
  youtubePlayerPlugin,
  youtubeService
} from '../index';

interface ListenerEntry {
  type: string;
  listener: EventListenerOrEventListenerObject;
}

function createFakeWindowEnv(initialHref = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ') {
  let currentUrl = new URL(initialHref);
  const listeners: ListenerEntry[] = [];
  const postedMessages: unknown[] = [];
  const storage = new Map<string, string>();
  const styleElements = new Map<string, { id: string; textContent: string; remove: () => void }>();

  const dispatchEvent = (event: { type: string; [key: string]: unknown }): void => {
    for (const entry of [...listeners]) {
      if (entry.type !== event.type) continue;
      if (typeof entry.listener === 'function') {
        entry.listener(event as unknown as Event);
      } else {
        entry.listener.handleEvent(event as unknown as Event);
      }
    }
  };

  const fakeWindow = {
    location: {
      get href() {
        return currentUrl.href;
      },
      set href(val: string) {
        currentUrl = new URL(val);
      },
      get origin() {
        return currentUrl.origin;
      },
      get pathname() {
        return currentUrl.pathname;
      },
      get search() {
        return currentUrl.search;
      }
    },
    localStorage: {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => {
        storage.set(k, v);
      },
      removeItem: (k: string) => {
        storage.delete(k);
      }
    },
    addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => {
      listeners.push({ type, listener });
    },
    removeEventListener: (type: string, listener: EventListenerOrEventListenerObject) => {
      const idx = listeners.findIndex((e) => e.type === type && e.listener === listener);
      if (idx !== -1) listeners.splice(idx, 1);
    },
    postMessage: (data: unknown) => {
      postedMessages.push(data);
      dispatchEvent({ type: 'message', source: fakeWindow, data });
    },
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    setInterval: globalThis.setInterval.bind(globalThis),
    clearInterval: globalThis.clearInterval.bind(globalThis),
    fetch: vi.fn<typeof fetch>()
  };

  const fakeDocument = {
    title: '(2) Test Video - YouTube',
    head: {
      appendChild: (el: { id: string; textContent: string; remove: () => void }) => {
        styleElements.set(el.id, el);
      }
    },
    documentElement: {},
    getElementById: (id: string) => styleElements.get(id) ?? null,
    createElement: (tag: string) => {
      const el = {
        tagName: tag.toUpperCase(),
        id: '',
        textContent: '',
        remove: () => {
          if (el.id) styleElements.delete(el.id);
        }
      };
      return el;
    },
    querySelector: () => null
  };

  class FakeMutationObserver {
    observe(): void {}
    disconnect(): void {}
  }

  vi.stubGlobal('window', fakeWindow);
  vi.stubGlobal('document', fakeDocument);
  vi.stubGlobal('MutationObserver', FakeMutationObserver);

  return {
    fakeWindow,
    fakeDocument,
    postedMessages,
    styleElements,
    dispatchEvent,
    setUrl: (href: string) => {
      currentUrl = new URL(href);
    }
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('@langai/service-youtube', () => {
  it('exposes the expected ServicePlugin metadata and capabilities', () => {
    expect(youtubeService.id).toBe('youtube');
    expect(youtubeService.name).toBe('YouTube');
    expect(youtubeService.badgeLabel).toBe('YouTube');
    expect(youtubeService.hostMatches).toEqual(['*://*.youtube.com/*', '*://youtube.com/*']);
    expect(youtubeService.capabilities).toEqual({
      cueSeeking: true,
      nativeTranslatedTrack: true,
      dynamicModule: false
    });
    expect(youtubeService.needsMainWorldInterceptor).toBe(true);
    expect(youtubeService.players[0]).toBe(youtubePlayerPlugin);
    expect(youtubeService.players[1].id).toBe('html5');
    expect(youtubePlayerPlugin.id).toBe('youtube-html5');
  });

  it('matches YouTube hosts accurately', () => {
    expect(youtubeService.matchesUrl(new URL('https://www.youtube.com/watch?v=abc'), [])).toBe(true);
    expect(youtubeService.matchesUrl(new URL('https://youtube.com/shorts/xyz'), [])).toBe(true);
    expect(youtubeService.matchesUrl(new URL('https://m.youtube.com/watch?v=abc'), [])).toBe(true);
    expect(youtubeService.matchesUrl(new URL('https://notyoutube.com/watch?v=abc'), [])).toBe(
      false
    );
  });

  it('resolves MediaIdentity for watch and shorts URLs and builds timestamp URLs', () => {
    const fakeDoc = {
      title: '(3) Learn TypeScript - YouTube',
      querySelector: () => null
    } as unknown as Document;

    const watchIdentity = youtubeService.resolveMediaIdentity(
      new URL('https://www.youtube.com/watch?v=abc123'),
      fakeDoc
    );
    expect(watchIdentity).not.toBeNull();
    expect(watchIdentity?.mediaId).toBe('abc123');
    expect(watchIdentity?.serviceId).toBe('youtube');
    expect(watchIdentity?.badgeLabel).toBe('YouTube');
    expect(watchIdentity?.title).toBe('Learn TypeScript');
    expect(watchIdentity?.canonicalUrl).toBe('https://www.youtube.com/watch?v=abc123');
    expect(watchIdentity?.buildTimestampUrl?.(65.9)).toBe(
      'https://www.youtube.com/watch?v=abc123&t=65s'
    );

    const shortsIdentity = youtubeService.resolveMediaIdentity(
      new URL('https://www.youtube.com/shorts/short99'),
      fakeDoc
    );
    expect(shortsIdentity?.mediaId).toBe('short99');

    const homeIdentity = youtubeService.resolveMediaIdentity(
      new URL('https://www.youtube.com/'),
      fakeDoc
    );
    expect(homeIdentity).toBeNull();
  });

  it('implements youtubePlayerPlugin container detection, autohide, bottom offset, and caption suppression', () => {
    const { styleElements } = createFakeWindowEnv();

    const makeClassList = (classes: string[]) => ({
      contains: (cls: string) => classes.includes(cls)
    });

    const chromeBottom = {
      offsetHeight: 52,
      getBoundingClientRect: () => ({ height: 52 })
    } as unknown as HTMLElement;

    const visibleContainer = {
      id: 'movie_player',
      classList: makeClassList(['html5-video-player']),
      querySelector: (sel: string) => (sel === '.ytp-chrome-bottom' ? chromeBottom : null)
    } as unknown as HTMLElement;

    const hiddenContainer = {
      id: 'movie_player',
      classList: makeClassList(['html5-video-player', 'ytp-autohide']),
      querySelector: () => chromeBottom
    } as unknown as HTMLElement;

    const root = {
      querySelector: (sel: string) => (sel === '#movie_player' ? visibleContainer : null)
    } as unknown as ParentNode;

    expect(youtubePlayerPlugin.detectContainer(root)).toBe(visibleContainer);
    expect(youtubePlayerPlugin.isControlsHidden(visibleContainer)).toBe(false);
    expect(youtubePlayerPlugin.isControlsHidden(hiddenContainer)).toBe(true);
    expect(youtubePlayerPlugin.getSubtitleBottomOffset(visibleContainer)).toBe(68);
    expect(youtubePlayerPlugin.getSubtitleBottomOffset(hiddenContainer)).toBe(28);

    const restore = youtubePlayerPlugin.suppressNativeCaptions?.(visibleContainer, true);
    expect(styleElements.size).toBe(1);
    const [injected] = Array.from(styleElements.values());
    expect(injected.textContent).toContain('.ytp-caption-window-container');
    restore?.();
    expect(styleElements.size).toBe(0);
  });

  it('propagates TRACK_CAPTURED, TRANSLATED_TRACK_CAPTURED, and TRACK_ERROR in isolated session', () => {
    const { fakeWindow, postedMessages } = createFakeWindowEnv(
      'https://www.youtube.com/watch?v=vid1'
    );

    const payloads: CapturedTrackPayload[] = [];
    const logs: Array<{ level: string; message: string }> = [];

    const teardown = youtubeService.initIsolatedSession({
      onTracksLoaded: (data) => payloads.push(data),
      onLog: (level, message) => logs.push({ level, message })
    });

    // Stale video track must be ignored
    fakeWindow.postMessage({
      source: POST_MESSAGE_SOURCE_MAIN,
      type: 'TRACK_CAPTURED',
      payload: {
        videoId: 'oldVid',
        lang: 'en',
        url: 'https://www.youtube.com/api/timedtext?v=oldVid&lang=en',
        data: { events: [{ tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: 'Old' }] }] }
      }
    });
    expect(payloads).toHaveLength(0);

    // Matching video track loads primaryCues
    fakeWindow.postMessage({
      source: POST_MESSAGE_SOURCE_MAIN,
      type: 'TRACK_CAPTURED',
      payload: {
        videoId: 'vid1',
        lang: 'en',
        url: 'https://www.youtube.com/api/timedtext?v=vid1&lang=en',
        data: { events: [{ tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: 'Hello world' }] }] }
      }
    });
    expect(payloads).toHaveLength(1);
    expect(payloads[0].primaryCues?.[0].text).toBe('Hello world');
    expect(payloads[0].primaryMeta?.videoId).toBe('vid1');

    // TRACK_ERROR propagates to both onTracksLoaded({ error }) and onLog('error', ...)
    fakeWindow.postMessage({
      source: POST_MESSAGE_SOURCE_MAIN,
      type: 'TRACK_ERROR',
      payload: {
        error: 'HTTP 500 requesting translated track',
        url: 'https://www.youtube.com/api/timedtext?v=vid1&tlang=uk'
      }
    });
    expect(payloads).toHaveLength(2);
    expect(payloads[1].error).toBe('HTTP 500 requesting translated track');
    expect(logs).toContainEqual({
      level: 'error',
      message:
        'HTTP 500 requesting translated track (https://www.youtube.com/api/timedtext?v=vid1&tlang=uk)'
    });

    // requestTranslatedTrack uses POST_MESSAGE_SOURCE_ISOLATED
    youtubeService.requestTranslatedTrack?.('uk');
    expect(postedMessages[postedMessages.length - 1]).toEqual({
      source: POST_MESSAGE_SOURCE_ISOLATED,
      type: 'REQUEST_TRANSLATED_TRACK',
      payload: { targetLang: 'uk', nativeLang: 'uk', videoId: 'vid1' }
    });

    teardown();
  });

  it('observes navigation via yt-navigate-finish and URL changes', () => {
    const { dispatchEvent, setUrl } = createFakeWindowEnv('https://www.youtube.com/watch?v=one');
    const onNavigate = vi.fn();

    const stop = youtubeService.observeNavigation?.(onNavigate);
    expect(stop).toBeDefined();

    dispatchEvent({ type: 'yt-navigate-finish' });
    expect(onNavigate).toHaveBeenCalledTimes(1);

    setUrl('https://www.youtube.com/watch?v=two');
    dispatchEvent({ type: 'popstate' });
    expect(onNavigate).toHaveBeenCalledTimes(2);

    stop?.();
  });

  it('intercepts timedtext fetch via @langai/subtitle-kit and emits LANGAI_MAIN messages', async () => {
    const { fakeWindow, postedMessages } = createFakeWindowEnv(
      'https://www.youtube.com/watch?v=vid42'
    );

    const vttBody = 'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nTom &amp; Jerry';
    const mockFetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(vttBody, { status: 200 })
    );
    fakeWindow.fetch = mockFetch;

    const teardown = initYoutubeMainWorldInterceptor();

    const res = await fakeWindow.fetch(
      'https://www.youtube.com/api/timedtext?v=vid42&lang=en&fmt=vtt'
    );
    expect(res.status).toBe(200);

    // Allow microtask queue to flush response.clone().text()
    await new Promise((resolve) => setTimeout(resolve, 10));

    const captured = postedMessages.find(
      (m): m is { source: string; type: string; payload: { data: { events?: Array<{ segs?: Array<{ utf8: string }> }> } } } =>
        typeof m === 'object' &&
        m !== null &&
        (m as { type?: string }).type === 'TRACK_CAPTURED'
    );

    expect(captured).toBeDefined();
    expect(captured?.source).toBe(POST_MESSAGE_SOURCE_MAIN);
    expect(captured?.payload.data.events?.[0]?.segs?.[0]?.utf8).toBe('Tom & Jerry');

    teardown();
    expect(fakeWindow.fetch).toBe(mockFetch);
  });

  it('handles REQUEST_TRANSLATED_TRACK errors and 429 circuit breaker in main-world interceptor', async () => {
    const { fakeWindow, postedMessages } = createFakeWindowEnv(
      'https://www.youtube.com/watch?v=vid99'
    );

    const mockFetch = vi.fn<typeof fetch>(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes('tlang=uk')) {
        return new Response('', { status: 429 });
      }
      return new Response('WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHello', { status: 200 });
    });
    fakeWindow.fetch = mockFetch;

    const teardown = initYoutubeMainWorldInterceptor();

    // Missing base track triggers TRACK_ERROR
    fakeWindow.postMessage({
      source: POST_MESSAGE_SOURCE_ISOLATED,
      type: 'REQUEST_TRANSLATED_TRACK',
      payload: { targetLang: 'uk', videoId: 'vid99' }
    });
    expect(postedMessages.some((m) => (m as { type?: string }).type === 'TRACK_ERROR')).toBe(true);

    // Capture base track first
    await fakeWindow.fetch('https://www.youtube.com/api/timedtext?v=vid99&lang=en');
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Translated track returning 429 triggers CAPTION_RATE_LIMITED
    fakeWindow.postMessage({
      source: POST_MESSAGE_SOURCE_ISOLATED,
      type: 'REQUEST_TRANSLATED_TRACK',
      payload: { targetLang: 'uk', videoId: 'vid99' }
    });
    await new Promise((resolve) => setTimeout(resolve, 10));

    const rateLimited = postedMessages.find(
      (m): m is { source: string; type: string; payload: { blockedUntil: number } } =>
        typeof m === 'object' && m !== null && (m as { type?: string }).type === 'CAPTION_RATE_LIMITED'
    );
    expect(rateLimited).toBeDefined();
    expect(rateLimited?.source).toBe(POST_MESSAGE_SOURCE_MAIN);
    expect(rateLimited?.payload.blockedUntil).toBeGreaterThan(Date.now());

    teardown();
  });
});
