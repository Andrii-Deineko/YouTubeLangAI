import {
  POST_MESSAGE_SOURCE_ISOLATED,
  POST_MESSAGE_SOURCE_MAIN,
  type CapturedTrackPayload,
  type PlayerMainWorldContext
} from '@langai/contracts';
import { unescapeString } from '@langai/subtitle-kit';
import {
  extractUrPlayTitle,
  getUrPlayProgramId,
  isUrPlayHost,
  resolveUrPlayVideoId
} from './domain';
import {
  detectUrPlayTrackLanguage,
  extractTracksFromNextData,
  isUrPlayCaptionUrl,
  isValidSubtitleBody,
  parseUrPlaySubtitleText,
  pickBestUrPlayTrack,
  toUrPlayAvailableTrackOptions,
  type CandidateUrPlayTrack
} from './nextData';

const FULLSCREEN_CONTAINER_SELECTOR = '#player-placeholder, .jwplayer';
const MAX_CACHED_PROGRAMS = 40;

function resolveUrlSafely(rawUrl: string, baseHref: string): string {
  try {
    return new URL(rawUrl, baseHref).href;
  } catch {
    return rawUrl;
  }
}

function getRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  if (typeof Request !== 'undefined' && input instanceof Request) return input.url;
  return '';
}

/**
 * Main-world UR Play extractor handling `__NEXT_DATA__`, `/_next/data/*.json` navigation fetches,
 * `undertexter.ur.se` subtitle URLs, inline scripts, performance resource entries, and fullscreen HUD delegation.
 *
 * Immediately returns a no-op teardown without patching `fetch`/`XHR` or creating `MutationObserver`
 * when the current hostname is not `urplay.se` or `ur.se`.
 */
export function initUrPlayMainWorldExtractor(ctx: PlayerMainWorldContext): () => void {
  if (
    typeof window === 'undefined' ||
    typeof document === 'undefined' ||
    !isUrPlayHost(window.location.hostname)
  ) {
    return () => {};
  }

  let disposed = false;
  let isDisabled = false;
  let navGeneration = 0;
  let perfBaselineTime = 0;
  let lastPostedSubUrl = '';
  let lastPostedTitle = '';
  let lastScannedNextDataKey = '';
  let lastEmittedPayload: CapturedTrackPayload | null = null;
  let currentPathKey = `${window.location.pathname}${window.location.search}`;
  let pollIntervalId: number | null = null;
  let mutationTimerId: number | null = null;

  const scannedScripts = new WeakSet<HTMLScriptElement>();
  const nextDataTracksByProgramId = new Map<string, CandidateUrPlayTrack[]>();

  const cacheNextDataTracks = (
    programId: string,
    tracks: CandidateUrPlayTrack[]
  ): void => {
    if (!programId || tracks.length === 0) return;
    if (
      nextDataTracksByProgramId.size >= MAX_CACHED_PROGRAMS &&
      !nextDataTracksByProgramId.has(programId)
    ) {
      const oldest = nextDataTracksByProgramId.keys().next().value;
      if (oldest !== undefined) {
        nextDataTracksByProgramId.delete(oldest);
      }
    }
    nextDataTracksByProgramId.set(programId, tracks);
  };

  const emitPayload = (payload: CapturedTrackPayload): void => {
    if (disposed || isDisabled) return;
    if (payload.primaryMeta?.url) {
      lastPostedSubUrl = payload.primaryMeta.url;
    }
    lastEmittedPayload = payload;
    ctx.emitTracks(payload);
  };

  const emitMediaInfo = (): void => {
    if (disposed || isDisabled) return;
    const title = extractUrPlayTitle(document);
    if (!title || title === lastPostedTitle) return;
    lastPostedTitle = title;
    window.postMessage(
      {
        source: POST_MESSAGE_SOURCE_MAIN,
        type: 'MEDIA_INFO',
        payload: {
          title,
          url: window.location.href
        }
      },
      '*'
    );
  };

  const emitParsedSubtitleText = (
    rawText: string,
    trackUrl: string,
    sourceLabel: string,
    trackInfo?: CandidateUrPlayTrack,
    availableTracks?: ReturnType<typeof toUrPlayAvailableTrackOptions>
  ): void => {
    if (disposed || isDisabled) return;
    const cues = parseUrPlaySubtitleText(rawText);
    if (cues.length === 0) return;

    const currentUrl = new URL(window.location.href);
    const videoId = resolveUrPlayVideoId(currentUrl);
    const title = extractUrPlayTitle(document) || undefined;
    const detectedLang = detectUrPlayTrackLanguage(
      {
        label: trackInfo?.label,
        language: trackInfo?.language,
        url: trackUrl
      },
      cues
    );

    emitPayload({
      primaryCues: cues,
      primaryMeta: {
        id: `urplay-track-${Date.now()}`,
        videoId,
        lang: detectedLang,
        language: detectedLang,
        label: trackInfo?.label || 'Svenska',
        source: sourceLabel,
        url: trackUrl,
        title,
        ...(availableTracks && availableTracks.length > 0 ? { availableTracks } : {})
      },
      ...(availableTracks && availableTracks.length > 0 ? { availableTracks } : {})
    });
  };

  const nativeFetch =
    typeof window.fetch === 'function' ? window.fetch.bind(window) : null;

  const fetchAndEmitTrack = (
    track: CandidateUrPlayTrack,
    allCandidates: readonly CandidateUrPlayTrack[],
    sourceLabel: string
  ): void => {
    if (disposed || isDisabled) return;
    const resolvedUrl = resolveUrlSafely(track.url, window.location.href);
    if (!resolvedUrl || resolvedUrl === lastPostedSubUrl) return;
    lastPostedSubUrl = resolvedUrl;

    const availableTracks = toUrPlayAvailableTrackOptions(
      allCandidates.map((c) => ({
        ...c,
        url: resolveUrlSafely(c.url, window.location.href)
      })),
      resolvedUrl
    );
    const currentUrl = new URL(window.location.href);
    const videoId = resolveUrPlayVideoId(currentUrl);
    const title = extractUrPlayTitle(document) || undefined;
    const fallbackLang = detectUrPlayTrackLanguage({ ...track, url: resolvedUrl });

    const emitFallbackMeta = (): void => {
      emitPayload({
        primaryMeta: {
          videoId,
          url: resolvedUrl,
          label: track.label || 'Svenska',
          lang: fallbackLang,
          language: fallbackLang,
          source: sourceLabel,
          title,
          ...(availableTracks.length > 0 ? { availableTracks } : {})
        },
        ...(availableTracks.length > 0 ? { availableTracks } : {})
      });
    };

    if (!nativeFetch) {
      emitFallbackMeta();
      return;
    }

    const reqGen = navGeneration;
    nativeFetch(resolvedUrl)
      .then((res) => (res.ok ? res.text() : ''))
      .then((rawText) => {
        if (disposed || reqGen !== navGeneration) return;
        if (isValidSubtitleBody(rawText)) {
          emitParsedSubtitleText(
            rawText,
            resolvedUrl,
            sourceLabel,
            track,
            availableTracks
          );
        } else {
          emitFallbackMeta();
        }
      })
      .catch(() => {
        if (disposed || reqGen !== navGeneration) return;
        emitFallbackMeta();
      });
  };

  const scanCachedNextDataTracks = (): void => {
    if (disposed || lastPostedSubUrl) return;
    const programId = getUrPlayProgramId(window.location.pathname);
    if (!programId) return;
    const cached = nextDataTracksByProgramId.get(programId);
    if (!cached || cached.length === 0) return;
    const best = pickBestUrPlayTrack(cached);
    if (best) {
      fetchAndEmitTrack(best, cached, 'next-data-cache');
    }
  };

  const scanInlineScripts = (): void => {
    if (disposed) return;
    try {
      const scripts = document.querySelectorAll<HTMLScriptElement>('script:not([src])');
      const currentProgramId = getUrPlayProgramId(window.location.pathname);

      for (const script of Array.from(scripts)) {
        const content = script.textContent;
        if (!content || !content.trim()) continue;

        if (script.id === '__NEXT_DATA__') {
          const nextKey = `${currentProgramId}::${content.length}`;
          if (nextKey === lastScannedNextDataKey) continue;
          try {
            const parsedNext = JSON.parse(content) as unknown;
            lastScannedNextDataKey = nextKey;
            if (currentProgramId && !content.includes(currentProgramId)) {
              continue;
            }
            const candidates = extractTracksFromNextData(
              parsedNext,
              currentProgramId || undefined
            );
            if (currentProgramId && candidates.length > 0) {
              cacheNextDataTracks(currentProgramId, candidates);
            }
            if (!lastPostedSubUrl) {
              const best = pickBestUrPlayTrack(candidates);
              if (best) {
                fetchAndEmitTrack(best, candidates, 'next-data');
              }
            }
          } catch {
            // Incomplete streaming JSON; allow retry on next DOM mutation
          }
          continue;
        }

        if (scannedScripts.has(script)) continue;
        scannedScripts.add(script);

        if (
          !lastPostedSubUrl &&
          (content.includes('.vtt') || content.includes('undertexter.ur.se'))
        ) {
          const matches = Array.from(
            content.matchAll(
              /["'](https?(?::\\\/\\\/|:\/\/)[^"'\s]+(?:\.vtt|undertexter\.ur\.se)[^"'\s]*)["']/gi
            )
          );
          if (matches.length > 0) {
            const candidates: CandidateUrPlayTrack[] = matches.map((m) => ({
              url: unescapeString((m[1] ?? '').replace(/\\+$/, ''))
            }));
            const best = pickBestUrPlayTrack(candidates);
            if (best) {
              fetchAndEmitTrack(best, candidates, 'script');
            }
          }
        }
      }
    } catch {
      // Ignore inline script scan errors
    }
  };

  const scanPerformanceResources = (): void => {
    if (disposed || lastPostedSubUrl) return;
    try {
      if (
        typeof performance === 'undefined' ||
        typeof performance.getEntriesByType !== 'function'
      ) {
        return;
      }
      const entries = performance.getEntriesByType('resource');
      const candidates: CandidateUrPlayTrack[] = [];
      for (let i = entries.length - 1; i >= 0; i--) {
        const entry = entries[i];
        if (
          perfBaselineTime > 0 &&
          typeof entry?.startTime === 'number' &&
          entry.startTime < perfBaselineTime
        ) {
          continue;
        }
        const name = entry?.name;
        if (!name || typeof name !== 'string') continue;
        const lower = name.toLowerCase();
        if (
          lower.includes('.vtt') ||
          lower.includes('.srt') ||
          lower.includes('undertexter.ur.se')
        ) {
          candidates.push({ url: name });
        }
      }
      const best = pickBestUrPlayTrack(candidates);
      if (best) {
        fetchAndEmitTrack(best, candidates, 'performance');
      }
    } catch {
      // Ignore performance entry scan errors
    }
  };

  const runProbes = (): void => {
    if (disposed || isDisabled) return;
    emitMediaInfo();
    scanCachedNextDataTracks();
    scanInlineScripts();
    scanPerformanceResources();
  };

  const startProbePolling = (maxTicks = 20): void => {
    if (pollIntervalId !== null) {
      window.clearInterval(pollIntervalId);
      pollIntervalId = null;
    }
    let attempts = 0;
    pollIntervalId = window.setInterval(() => {
      attempts += 1;
      runProbes();
      if (disposed || attempts >= maxTicks || Boolean(lastPostedSubUrl)) {
        if (pollIntervalId !== null) {
          window.clearInterval(pollIntervalId);
          pollIntervalId = null;
        }
      }
    }, 1000);
  };

  const handleSpaNavigation = (): void => {
    if (disposed) return;
    const nextKey = `${window.location.pathname}${window.location.search}`;
    if (nextKey === currentPathKey) return;
    currentPathKey = nextKey;
    navGeneration += 1;
    perfBaselineTime = typeof performance !== 'undefined' ? performance.now() : 0;
    lastPostedSubUrl = '';
    lastPostedTitle = '';
    lastScannedNextDataKey = '';
    lastEmittedPayload = null;
    ctx.emitTracks({ primaryCues: [], resetPrimaryCues: true });
    runProbes();
    startProbePolling(20);
  };

  // Intercept window.fetch for Next.js /_next/data/*.json and direct UR Play subtitle fetches
  const originalFetch = window.fetch;
  let patchedFetch: typeof window.fetch | null = null;
  if (typeof originalFetch === 'function' && nativeFetch) {
    patchedFetch = async function (...args: Parameters<typeof fetch>): Promise<Response> {
      const response = await nativeFetch(...args);
      if (disposed || isDisabled) return response;

      try {
        const requestUrl = getRequestUrl(args[0]);
        const lowerUrl = requestUrl.toLowerCase();
        const isNextDataJson =
          lowerUrl.includes('/_next/data/') && lowerUrl.includes('.json');

        if (isNextDataJson) {
          const clone = response.clone();
          clone
            .json()
            .then((json: unknown) => {
              if (disposed || isDisabled) return;
              const reqProgramId = getUrPlayProgramId(requestUrl);
              const locProgramId = getUrPlayProgramId(window.location.pathname);
              const targetProgramId = reqProgramId || locProgramId;
              const candidates = extractTracksFromNextData(
                json,
                targetProgramId || undefined
              );
              if (reqProgramId && candidates.length > 0) {
                cacheNextDataTracks(reqProgramId, candidates);
              }
              if ((!reqProgramId || reqProgramId === locProgramId) && !lastPostedSubUrl) {
                const best = pickBestUrPlayTrack(candidates);
                if (best) {
                  fetchAndEmitTrack(best, candidates, 'next-data-fetch');
                }
              }
            })
            .catch(() => {});
        } else if (isUrPlayCaptionUrl(requestUrl) && !lastPostedSubUrl) {
          const clone = response.clone();
          const contentType = (clone.headers.get('content-type') || '').toLowerCase();
          const isBinaryMedia =
            contentType.includes('video/') ||
            contentType.includes('audio/') ||
            contentType.includes('image/') ||
            contentType.includes('mp2t');

          if (!isBinaryMedia) {
            const resolvedUrl = resolveUrlSafely(requestUrl, window.location.href);
            clone
              .text()
              .then((rawText) => {
                if (disposed || isDisabled || lastPostedSubUrl) return;
                if (isValidSubtitleBody(rawText)) {
                  const candidate: CandidateUrPlayTrack = { url: resolvedUrl };
                  if (pickBestUrPlayTrack([candidate])) {
                    emitParsedSubtitleText(rawText, resolvedUrl, 'fetch', candidate);
                  }
                }
              })
              .catch(() => {});
          }
        }
      } catch {
        // Ignore fetch inspection errors
      }

      return response;
    };

    window.fetch = patchedFetch;
  }

  // Redirect video.requestFullscreen to player container so Shadow DOM HUD stays visible
  let origRequestFullscreen: Element['requestFullscreen'] | null = null;
  let wrappedRequestFullscreen: Element['requestFullscreen'] | null = null;
  let origWebkitFullscreen: ((...args: unknown[]) => unknown) | null = null;
  let wrappedWebkitFullscreen: ((...args: unknown[]) => unknown) | null = null;

  if (typeof Element !== 'undefined') {
    const proto = Element.prototype;
    if (typeof proto.requestFullscreen === 'function') {
      origRequestFullscreen = proto.requestFullscreen;
      const origRef = origRequestFullscreen;
      wrappedRequestFullscreen = function (
        this: Element,
        options?: FullscreenOptions
      ): Promise<void> {
        if (typeof HTMLVideoElement !== 'undefined' && this instanceof HTMLVideoElement) {
          const container = this.closest<HTMLElement>(FULLSCREEN_CONTAINER_SELECTOR);
          if (
            container &&
            container !== this &&
            typeof container.requestFullscreen === 'function'
          ) {
            return container.requestFullscreen(options);
          }
        }
        return origRef.call(this, options);
      };
      proto.requestFullscreen = wrappedRequestFullscreen;
    }

    const protoRecord = proto as unknown as Record<string, unknown>;
    if (typeof protoRecord.webkitRequestFullscreen === 'function') {
      origWebkitFullscreen = protoRecord.webkitRequestFullscreen as (
        ...args: unknown[]
      ) => unknown;
      const origWebkitRef = origWebkitFullscreen;
      wrappedWebkitFullscreen = function (this: Element, ...args: unknown[]): unknown {
        if (typeof HTMLVideoElement !== 'undefined' && this instanceof HTMLVideoElement) {
          const container = this.closest<HTMLElement>(FULLSCREEN_CONTAINER_SELECTOR);
          const targetWebkit = container as unknown as {
            webkitRequestFullscreen?: (...a: unknown[]) => unknown;
          } | null;
          if (
            targetWebkit &&
            container !== this &&
            typeof targetWebkit.webkitRequestFullscreen === 'function'
          ) {
            return targetWebkit.webkitRequestFullscreen(...args);
          }
        }
        return origWebkitRef.apply(this, args);
      };
      protoRecord.webkitRequestFullscreen = wrappedWebkitFullscreen;
    }
  }

  // Hook history pushState/replaceState + popstate for Next.js SPA navigation
  let origPushState: History['pushState'] | null = null;
  let origReplaceState: History['replaceState'] | null = null;
  let wrappedPushState: History['pushState'] | null = null;
  let wrappedReplaceState: History['replaceState'] | null = null;

  if (typeof history !== 'undefined') {
    try {
      origPushState = history.pushState;
      origReplaceState = history.replaceState;
      const pushRef = origPushState;
      const replaceRef = origReplaceState;

      wrappedPushState = function (
        this: History,
        ...args: Parameters<History['pushState']>
      ): void {
        pushRef.apply(this, args);
        handleSpaNavigation();
      };
      wrappedReplaceState = function (
        this: History,
        ...args: Parameters<History['replaceState']>
      ): void {
        replaceRef.apply(this, args);
        handleSpaNavigation();
      };

      history.pushState = wrappedPushState;
      history.replaceState = wrappedReplaceState;
    } catch {
      // Ignore read-only history properties
    }
  }

  const messageListener = (event: MessageEvent): void => {
    if (event.source !== window || !event.data || typeof event.data !== 'object') return;
    const msg = event.data as {
      source?: unknown;
      type?: unknown;
      disabled?: unknown;
    };
    if (msg.source === POST_MESSAGE_SOURCE_ISOLATED && msg.type === 'LANGAI_SET_DISABLED') {
      isDisabled = Boolean(msg.disabled);
      return;
    }
    if (msg.source === POST_MESSAGE_SOURCE_ISOLATED && msg.type === 'LANGAI_REQUEST_STATE') {
      if (isDisabled) return;
      handleSpaNavigation();
      if (lastPostedTitle) {
        window.postMessage(
          {
            source: POST_MESSAGE_SOURCE_MAIN,
            type: 'MEDIA_INFO',
            payload: {
              title: lastPostedTitle,
              url: window.location.href
            }
          },
          '*'
        );
      }
      if (lastEmittedPayload) {
        ctx.emitTracks(lastEmittedPayload);
      } else {
        runProbes();
        startProbePolling(20);
      }
    }
  };

  const playListener = (event: Event): void => {
    if (
      typeof HTMLVideoElement !== 'undefined' &&
      event.target instanceof HTMLVideoElement
    ) {
      handleSpaNavigation();
      if (!lastPostedSubUrl) {
        runProbes();
      } else {
        emitMediaInfo();
      }
    }
  };

  window.addEventListener('message', messageListener);
  window.addEventListener('popstate', handleSpaNavigation);
  document.addEventListener('play', playListener, true);

  let observer: MutationObserver | null = null;
  if (typeof MutationObserver !== 'undefined' && document.documentElement) {
    observer = new MutationObserver(() => {
      if (disposed) return;
      handleSpaNavigation();
      if (mutationTimerId !== null) return;
      mutationTimerId = window.setTimeout(() => {
        mutationTimerId = null;
        if (!disposed) {
          runProbes();
        }
      }, 250);
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  }

  runProbes();
  startProbePolling(30);

  return () => {
    if (disposed) return;
    disposed = true;

    window.removeEventListener('message', messageListener);
    window.removeEventListener('popstate', handleSpaNavigation);
    document.removeEventListener('play', playListener, true);

    observer?.disconnect();
    observer = null;

    if (pollIntervalId !== null) {
      window.clearInterval(pollIntervalId);
      pollIntervalId = null;
    }
    if (mutationTimerId !== null) {
      window.clearTimeout(mutationTimerId);
      mutationTimerId = null;
    }

    if (patchedFetch && window.fetch === patchedFetch) {
      window.fetch = originalFetch;
    }

    if (typeof history !== 'undefined') {
      try {
        if (origPushState && wrappedPushState && history.pushState === wrappedPushState) {
          history.pushState = origPushState;
        }
        if (
          origReplaceState &&
          wrappedReplaceState &&
          history.replaceState === wrappedReplaceState
        ) {
          history.replaceState = origReplaceState;
        }
      } catch {
        // Ignore history restore errors
      }
    }

    if (typeof Element !== 'undefined') {
      const proto = Element.prototype;
      if (
        origRequestFullscreen &&
        wrappedRequestFullscreen &&
        proto.requestFullscreen === wrappedRequestFullscreen
      ) {
        proto.requestFullscreen = origRequestFullscreen;
      }
      const protoRecord = proto as unknown as Record<string, unknown>;
      if (
        origWebkitFullscreen &&
        wrappedWebkitFullscreen &&
        protoRecord.webkitRequestFullscreen === wrappedWebkitFullscreen
      ) {
        protoRecord.webkitRequestFullscreen = origWebkitFullscreen;
      }
    }
  };
}
