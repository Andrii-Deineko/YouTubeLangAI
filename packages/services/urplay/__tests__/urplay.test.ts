import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  POST_MESSAGE_SOURCE_ISOLATED,
  POST_MESSAGE_SOURCE_MAIN,
  type CapturedTrackPayload,
  type PlayerMainWorldContext
} from '@langai/contracts';
import { html5PlayerPlugin, jwplayerPlugin } from '@langai/players';
import {
  cleanUrPlayTitle,
  extractTracksFromNextData,
  filterStandardUrPlayTracks,
  pickBestUrPlayTrack,
  urplayService
} from '../src/index';

function createEventTargetMock() {
  const listeners = new Map<string, Set<(event: unknown) => void>>();
  return {
    addEventListener: vi.fn((type: string, cb: (event: unknown) => void) => {
      let set = listeners.get(type);
      if (!set) {
        set = new Set();
        listeners.set(type, set);
      }
      set.add(cb);
    }),
    removeEventListener: vi.fn((type: string, cb: (event: unknown) => void) => {
      listeners.get(type)?.delete(cb);
    }),
    dispatch(type: string, event: unknown): void {
      listeners.get(type)?.forEach((cb) => cb(event));
    }
  };
}

describe('@langai/service-urplay', () => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalMutationObserver = globalThis.MutationObserver;
  const originalChrome = (globalThis as Record<string, unknown>).chrome;

  afterEach(() => {
    if (originalWindow === undefined) {
      delete (globalThis as Record<string, unknown>).window;
    } else {
      globalThis.window = originalWindow;
    }
    if (originalDocument === undefined) {
      delete (globalThis as Record<string, unknown>).document;
    } else {
      globalThis.document = originalDocument;
    }
    if (originalMutationObserver === undefined) {
      delete (globalThis as Record<string, unknown>).MutationObserver;
    } else {
      globalThis.MutationObserver = originalMutationObserver;
    }
    if (originalChrome === undefined) {
      delete (globalThis as Record<string, unknown>).chrome;
    } else {
      (globalThis as Record<string, unknown>).chrome = originalChrome;
    }
    vi.restoreAllMocks();
  });

  it('exposes the expected ServicePlugin metadata, capabilities, players, and production hostMatches', () => {
    expect(urplayService.id).toBe('urplay');
    expect(urplayService.badgeLabel).toBe('UR Play');
    expect(urplayService.defaultSourceLang).toBe('sv');
    expect(urplayService.needsMainWorldInterceptor).toBe(true);
    expect(urplayService.allFrames).toBe(false);
    expect(urplayService.capabilities).toEqual({
      cueSeeking: true,
      nativeTranslatedTrack: false,
      dynamicModule: true
    });
    expect(urplayService.players).toEqual([jwplayerPlugin, html5PlayerPlugin]);
    expect(urplayService.hostMatches).toEqual([
      '*://*.urplay.se/*',
      '*://urplay.se/*',
      '*://*.ur.se/*',
      '*://ur.se/*'
    ]);
    expect(
      urplayService.hostMatches.some(
        (m) => m.includes('localhost') || m.includes('127.0.0.1')
      )
    ).toBe(false);
  });

  it('matches only UR Play domains and rejects localhost/unrelated hosts', () => {
    expect(urplayService.matchesUrl(new URL('https://urplay.se/program/234567'), [])).toBe(true);
    expect(urplayService.matchesUrl(new URL('https://www.urplay.se/serie/123'), [])).toBe(true);
    expect(urplayService.matchesUrl(new URL('https://ur.se/program/999'), [])).toBe(true);
    expect(urplayService.matchesUrl(new URL('https://play.ur.se/watch'), [])).toBe(true);

    expect(urplayService.matchesUrl(new URL('http://localhost:3000/'), [])).toBe(false);
    expect(urplayService.matchesUrl(new URL('http://127.0.0.1:8080/'), [])).toBe(false);
    expect(urplayService.matchesUrl(new URL('https://fakeurplay.se/'), [])).toBe(false);
    expect(urplayService.matchesUrl(new URL('https://youtube.com/watch?v=1'), [])).toBe(false);
  });

  it('resolves MediaIdentity and cleans UR Play title suffixes', () => {
    expect(cleanUrPlayTitle('Lilla aktuellt | UR Play')).toBe('Lilla aktuellt');
    expect(cleanUrPlayTitle('Vetenskapens värld - UR Play')).toBe('Vetenskapens värld');
    expect(cleanUrPlayTitle('Språka – UR')).toBe('Språka');

    const mockDoc = {
      title: 'Lilla aktuellt | UR Play',
      querySelector: () => null
    } as unknown as Document;

    const identity = urplayService.resolveMediaIdentity(
      new URL('https://urplay.se/program/234567-lilla-aktuellt#t=10'),
      mockDoc
    );
    expect(identity).toEqual({
      mediaId: 'urplay-234567',
      serviceId: 'urplay',
      badgeLabel: 'UR Play',
      title: 'Lilla aktuellt',
      canonicalUrl: 'https://urplay.se/program/234567-lilla-aktuellt'
    });

    const dashDoc = {
      title: 'Kulturfrågan - UR Play',
      querySelector: () => null
    } as unknown as Document;
    expect(
      urplayService.resolveMediaIdentity(
        new URL('https://www.ur.se/serie/98765'),
        dashDoc
      )?.title
    ).toBe('Kulturfrågan');

    expect(
      urplayService.resolveMediaIdentity(new URL('https://example.com/program/1'), mockDoc)
    ).toBeNull();
  });

  it('extracts __NEXT_DATA__ tracks scoped by programId and filters out syntolk/teckenspr', () => {
    const nextData = {
      props: {
        pageProps: {
          otherProgram: {
            id: 111111,
            subtitles: [
              {
                url: 'https://undertexter.ur.se/111111/sv.vtt',
                label: 'Svenska',
                language: 'sv'
              }
            ]
          },
          currentProgram: {
            id: 234567,
            streamingInfo: {
              captions: [
                {
                  file: 'https://undertexter.ur.se/234567/syntolkning.vtt',
                  label: 'Syntolkning',
                  language: 'sv-syntolk'
                },
                {
                  file: 'https://undertexter.ur.se/234567/teckensprak.vtt',
                  label: 'Teckenspråk',
                  language: 'sv-teckenspr'
                },
                {
                  file: 'https://undertexter.ur.se/234567/en.vtt',
                  label: 'Engelska',
                  language: 'en'
                },
                {
                  file: 'https://undertexter.ur.se/234567/sv.vtt',
                  label: 'Svenska',
                  language: 'sv'
                }
              ]
            }
          }
        }
      }
    };

    const extracted = extractTracksFromNextData(nextData, '234567');
    expect(extracted.map((t) => t.url)).toEqual([
      'https://undertexter.ur.se/234567/syntolkning.vtt',
      'https://undertexter.ur.se/234567/teckensprak.vtt',
      'https://undertexter.ur.se/234567/en.vtt',
      'https://undertexter.ur.se/234567/sv.vtt'
    ]);

    const filtered = filterStandardUrPlayTracks(extracted);
    expect(filtered.map((t) => t.url)).toEqual([
      'https://undertexter.ur.se/234567/en.vtt',
      'https://undertexter.ur.se/234567/sv.vtt'
    ]);

    const best = pickBestUrPlayTrack(extracted);
    expect(best?.url).toBe('https://undertexter.ur.se/234567/sv.vtt');

    // Only accessibility tracks -> filtered out completely
    expect(
      pickBestUrPlayTrack([
        {
          url: 'https://undertexter.ur.se/234567/syntolk.vtt',
          label: 'Syntolkning'
        },
        {
          url: 'https://undertexter.ur.se/234567/teckenspr.vtt',
          label: 'Teckenspråk'
        }
      ])
    ).toBeNull();
  });

  it('initMainWorldExtractor immediately returns a no-op teardown off UR Play without patching fetch or creating MutationObserver', () => {
    const fetchSpy = vi.fn();
    const mutationSpy = vi.fn();
    const winMock = {
      ...createEventTargetMock(),
      location: new URL('https://example.com/watch'),
      fetch: fetchSpy
    };
    vi.stubGlobal('window', winMock);
    vi.stubGlobal('document', {
      documentElement: {},
      title: 'Example'
    });
    vi.stubGlobal('MutationObserver', mutationSpy);

    const ctx: PlayerMainWorldContext = {
      emitTracks: vi.fn(),
      log: vi.fn()
    };

    const teardown = urplayService.initMainWorldExtractor!(ctx);
    expect(winMock.fetch).toBe(fetchSpy);
    expect(mutationSpy).not.toHaveBeenCalled();
    expect(winMock.addEventListener).not.toHaveBeenCalled();
    teardown();
  });

  it('initMainWorldExtractor extracts __NEXT_DATA__ subtitles on UR Play and restores fetch on teardown', async () => {
    const vttBody = 'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nHej världen!\n';
    const baseFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('undertexter.ur.se')) {
        return new Response(vttBody, { status: 200 });
      }
      return new Response('{}', { status: 200 });
    });

    const winTarget = createEventTargetMock();
    const winMock = {
      ...winTarget,
      location: new URL('https://urplay.se/program/234567-test'),
      fetch: baseFetch,
      postMessage: vi.fn(),
      setInterval: vi.fn(() => 101),
      clearInterval: vi.fn(),
      setTimeout: vi.fn(() => 102),
      clearTimeout: vi.fn()
    };

    const nextDataScript = {
      id: '__NEXT_DATA__',
      textContent: JSON.stringify({
        props: {
          pageProps: {
            program: {
              id: '234567',
              subtitles: [
                {
                  url: 'https://undertexter.ur.se/234567/syntolk.vtt',
                  label: 'Syntolkning',
                  language: 'sv'
                },
                {
                  url: 'https://undertexter.ur.se/234567/sv.vtt',
                  label: 'Svenska',
                  language: 'sv'
                }
              ]
            }
          }
        }
      })
    };

    const docMock = {
      ...createEventTargetMock(),
      title: 'Testprogram | UR Play',
      documentElement: {},
      querySelector: vi.fn(() => null),
      querySelectorAll: vi.fn((sel: string) =>
        sel === 'script:not([src])' ? [nextDataScript] : []
      )
    };

    const observeMock = vi.fn();
    const disconnectMock = vi.fn();
    vi.stubGlobal(
      'MutationObserver',
      vi.fn(() => ({ observe: observeMock, disconnect: disconnectMock }))
    );
    vi.stubGlobal('window', winMock);
    vi.stubGlobal('document', docMock);

    const emitted: CapturedTrackPayload[] = [];
    const ctx: PlayerMainWorldContext = {
      emitTracks: (payload) => emitted.push(payload),
      log: vi.fn()
    };

    const teardown = urplayService.initMainWorldExtractor!(ctx);
    expect(winMock.fetch).not.toBe(baseFetch);
    expect(observeMock).toHaveBeenCalledTimes(1);

    await vi.waitFor(() => {
      expect(emitted.length).toBeGreaterThan(0);
    });

    const loaded = emitted.find((p) => (p.primaryCues?.length ?? 0) > 0);
    expect(loaded).toBeDefined();
    expect(loaded?.primaryCues?.[0]?.text).toBe('Hej världen!');
    expect(loaded?.primaryMeta?.lang).toBe('sv');
    expect(loaded?.primaryMeta?.url).toBe('https://undertexter.ur.se/234567/sv.vtt');
    expect(loaded?.availableTracks?.map((t) => t.url)).toEqual([
      'https://undertexter.ur.se/234567/sv.vtt'
    ]);

    teardown();
    expect(winMock.fetch).toBe(baseFetch);
    expect(disconnectMock).toHaveBeenCalledTimes(1);
  });

  it('initIsolatedSession handles POST_MESSAGE_SOURCE_MAIN payloads and SW FETCH_SUBTITLE_TEXT fallback', async () => {
    const winTarget = createEventTargetMock();
    const winMock = {
      ...winTarget,
      location: new URL('https://urplay.se/program/555111'),
      postMessage: vi.fn(),
      setInterval: vi.fn(() => 201),
      clearInterval: vi.fn(),
      requestAnimationFrame: vi.fn(() => 202),
      cancelAnimationFrame: vi.fn(),
      fetch: vi.fn(async () => {
        throw new Error('CORS blocked');
      })
    };

    const docMock = {
      title: 'Nyheter på lätt svenska - UR Play',
      body: null,
      documentElement: null,
      querySelector: vi.fn(() => null),
      querySelectorAll: vi.fn(() => [])
    };

    vi.stubGlobal('window', winMock);
    vi.stubGlobal('document', docMock);
    vi.stubGlobal('fetch', winMock.fetch);

    const vttText = 'WEBVTT\n\n00:00:00.500 --> 00:00:02.500\nGod morgon Sverige!\n';
    vi.stubGlobal('chrome', {
      runtime: {
        id: 'ext-1',
        lastError: undefined,
        sendMessage: vi.fn((req: { type?: string }, cb?: (res: unknown) => void) => {
          if (req.type === 'FETCH_SUBTITLE_TEXT') {
            cb?.({ ok: true, data: { text: vttText } });
            return;
          }
          cb?.({ ok: true, data: true });
        })
      }
    });

    const onTracksLoaded = vi.fn();
    const onLog = vi.fn();
    const teardown = urplayService.initIsolatedSession({
      onTracksLoaded,
      onLog
    });

    expect(winMock.postMessage).toHaveBeenCalledWith(
      {
        source: POST_MESSAGE_SOURCE_ISOLATED,
        type: 'LANGAI_REQUEST_STATE'
      },
      '*'
    );

    // Simulate metadata-only emission from jwplayerPlugin requiring SW fallback fetch
    winTarget.dispatch('message', {
      source: winMock,
      data: {
        source: POST_MESSAGE_SOURCE_MAIN,
        type: 'LANGAI_TRACKS_CAPTURED',
        serviceId: 'urplay',
        payload: {
          primaryMeta: {
            url: 'https://undertexter.ur.se/555111/sv.vtt',
            label: 'Svenska',
            language: 'sv',
            source: 'jwplayer'
          },
          availableTracks: [
            {
              label: 'Syntolkning',
              language: 'sv',
              url: 'https://undertexter.ur.se/555111/syntolk.vtt'
            },
            {
              label: 'Svenska',
              language: 'sv',
              url: 'https://undertexter.ur.se/555111/sv.vtt'
            }
          ]
        }
      }
    });

    await vi.waitFor(() => {
      expect(onTracksLoaded).toHaveBeenCalledTimes(1);
    });

    const arg = onTracksLoaded.mock.calls[0]?.[0] as CapturedTrackPayload;
    expect(arg.primaryCues?.[0]?.text).toBe('God morgon Sverige!');
    expect(arg.primaryMeta?.videoId).toBe('urplay-555111');
    expect(arg.primaryMeta?.title).toBe('Nyheter på lätt svenska');
    expect(arg.primaryMeta?.lang).toBe('sv');
    expect(arg.availableTracks?.map((t) => t.url)).toEqual([
      'https://undertexter.ur.se/555111/sv.vtt'
    ]);

    teardown();
  });
});
