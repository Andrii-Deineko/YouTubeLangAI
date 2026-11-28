import {
  POST_MESSAGE_SOURCE_ISOLATED,
  POST_MESSAGE_SOURCE_MAIN,
  type IsolatedToMainMessage,
  type Json3Response,
  type MainToIsolatedMessage,
  type PlayerMainWorldContext,
  type TrackCapturedPayload
} from '@langai/contracts';
import { isJson3Response, parseTimedtextToJson3 } from '@langai/subtitle-kit';
import {
  getRateLimitBlockedUntil,
  RATE_LIMIT_COOLDOWN_MS,
  RATE_LIMIT_STORAGE_KEY
} from './captionCache';

const GLOBAL_GUARD = '__LANGAI_YT_INTERCEPTOR_INSTALLED__';

interface XhrMeta {
  url: string;
}

function extractVideoIdFromLocation(): string {
  if (typeof window === 'undefined') return '';
  try {
    const url = new URL(window.location.href);
    const v = url.searchParams.get('v');
    if (v) return v;
    const pathMatch = url.pathname.match(/\/(?:shorts|live|embed)\/([a-zA-Z0-9_-]+)/);
    return pathMatch?.[1] ?? '';
  } catch {
    return '';
  }
}

function parseTimedtextUrl(rawUrl: string): URL | null {
  if (!rawUrl || !rawUrl.includes('/api/timedtext') || typeof window === 'undefined') {
    return null;
  }
  try {
    const url = new URL(rawUrl, window.location.origin);
    return url.pathname.includes('/api/timedtext') ? url : null;
  } catch {
    return null;
  }
}

function getRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function buildCapturedPayload(urlObj: URL, data: Json3Response): TrackCapturedPayload {
  const videoId = urlObj.searchParams.get('v') ?? extractVideoIdFromLocation();
  const lang = urlObj.searchParams.get('lang') ?? 'unknown';
  const tlang = urlObj.searchParams.get('tlang') ?? undefined;
  const kind = urlObj.searchParams.get('kind') ?? undefined;
  return {
    videoId,
    lang,
    tlang,
    kind,
    url: urlObj.toString(),
    data
  };
}

/**
 * Installs the YouTube main-world network interceptor for `/api/timedtext` (fetch & XHR),
 * circuit breaker rate-limit handling, fallback subtitle button activation, and
 * `REQUEST_TRANSLATED_TRACK` / `NAVIGATED` bridge messages.
 */
export function initYoutubeMainWorldInterceptor(ctx?: PlayerMainWorldContext): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return () => {};
  }

  const winRecord = window as unknown as Record<string, unknown>;
  if (winRecord[GLOBAL_GUARD]) {
    return () => {};
  }
  winRecord[GLOBAL_GUARD] = true;

  const rawOriginalFetch = window.fetch;
  const originalFetch = rawOriginalFetch.bind(window);
  const hasXhr = typeof XMLHttpRequest !== 'undefined';
  const OriginalXHROpen = hasXhr ? XMLHttpRequest.prototype.open : null;
  const OriginalXHRSend = hasXhr ? XMLHttpRequest.prototype.send : null;
  const xhrMetaMap = new WeakMap<XMLHttpRequest, XhrMeta>();

  let disposed = false;
  let lastBaseTimedtextUrl: string | null = null;
  let lastCapturedVideoId: string | null = null;
  let fallbackTimerId: number | null = null;

  const postToIsolated = (message: MainToIsolatedMessage): void => {
    window.postMessage(message, '*');
  };

  const isCircuitBreakerActive = (): boolean => getRateLimitBlockedUntil() > Date.now();

  const cancelFallbackTimer = (): void => {
    if (fallbackTimerId !== null) {
      window.clearTimeout(fallbackTimerId);
      fallbackTimerId = null;
    }
  };

  const notifyRateLimited = (blockedUntil?: number): void => {
    const until = blockedUntil ?? getRateLimitBlockedUntil();
    const remainingMs = Math.max(0, until - Date.now());
    if (remainingMs > 0) {
      const warnMsg = `Circuit breaker active! Cooldown remaining: ${Math.round(remainingMs / 1000)} sec`;
      console.warn('[YT-Lang-AI]', warnMsg);
      ctx?.log('warn', warnMsg);
      postToIsolated({
        source: POST_MESSAGE_SOURCE_MAIN,
        type: 'CAPTION_RATE_LIMITED',
        payload: {
          remainingMs,
          blockedUntil: until
        }
      });
    }
  };

  const triggerRateLimitCircuitBreaker = (): void => {
    const blockedUntil = Date.now() + RATE_LIMIT_COOLDOWN_MS;
    try {
      window.localStorage.setItem(RATE_LIMIT_STORAGE_KEY, String(blockedUntil));
    } catch {
      // Ignore storage write failures
    }
    cancelFallbackTimer();
    notifyRateLimited(blockedUntil);
  };

  const recordOriginalTrackUrl = (urlObj: URL): void => {
    if (!urlObj.searchParams.get('tlang')) {
      lastBaseTimedtextUrl = urlObj.toString();
      lastCapturedVideoId = urlObj.searchParams.get('v') ?? extractVideoIdFromLocation();
    }
  };

  const scheduleFallbackActivation = (): void => {
    cancelFallbackTimer();
    if (disposed) return;
    if (isCircuitBreakerActive()) {
      notifyRateLimited();
      return;
    }

    const targetVideoId = extractVideoIdFromLocation();
    if (!targetVideoId) return;

    fallbackTimerId = window.setTimeout(() => {
      fallbackTimerId = null;
      if (disposed || isCircuitBreakerActive()) return;

      const currentVideoId = extractVideoIdFromLocation();
      if (!currentVideoId || currentVideoId !== targetVideoId) return;
      if (lastCapturedVideoId === currentVideoId && lastBaseTimedtextUrl) return;

      const subtitlesBtn = document.querySelector<HTMLButtonElement>('.ytp-subtitles-button');
      if (subtitlesBtn && subtitlesBtn.getAttribute('aria-pressed') === 'false') {
        subtitlesBtn.click();
      }
    }, 2000);
  };

  const emitParsedTrack = (urlObj: URL, data: Json3Response): void => {
    const isTranslated = Boolean(urlObj.searchParams.get('tlang'));
    const payload = buildCapturedPayload(urlObj, data);
    postToIsolated({
      source: POST_MESSAGE_SOURCE_MAIN,
      type: isTranslated ? 'TRANSLATED_TRACK_CAPTURED' : 'TRACK_CAPTURED',
      payload
    });
  };

  const handleCapturedText = (urlObj: URL, rawText: string): boolean => {
    if (disposed) return false;
    const reqVideoId = urlObj.searchParams.get('v');
    const locVideoId = extractVideoIdFromLocation();
    if (reqVideoId && locVideoId && reqVideoId !== locVideoId) {
      return false;
    }

    const parsed = parseTimedtextToJson3(rawText);
    if (!parsed) return false;

    emitParsedTrack(urlObj, parsed);
    return true;
  };

  if (isCircuitBreakerActive()) {
    notifyRateLimited();
  }

  const patchedFetch: typeof window.fetch = async function patchedFetch(
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> {
    const rawUrl = getRequestUrl(input);
    const timedtextUrl = parseTimedtextUrl(rawUrl);

    if (!timedtextUrl) {
      return originalFetch(input, init);
    }

    cancelFallbackTimer();
    recordOriginalTrackUrl(timedtextUrl);

    if (isCircuitBreakerActive()) {
      notifyRateLimited();
    }

    const response = await originalFetch(input, init);

    if (response.status === 429) {
      triggerRateLimitCircuitBreaker();
      return response;
    }

    if (response.ok) {
      const cloned = response.clone();
      void cloned
        .text()
        .then((text) => {
          handleCapturedText(timedtextUrl, text);
        })
        .catch(() => undefined);
    }

    return response;
  };

  window.fetch = patchedFetch;

  const patchedXhrOpen = function patchedOpen(
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    async?: boolean,
    username?: string | null,
    password?: string | null
  ): void {
    const urlStr = typeof url === 'string' ? url : url.toString();
    xhrMetaMap.set(this, { url: urlStr });
    OriginalXHROpen?.call(
      this,
      method,
      urlStr,
      async ?? true,
      username ?? null,
      password ?? null
    );
  };

  const patchedXhrSend = function patchedSend(
    this: XMLHttpRequest,
    body?: Document | XMLHttpRequestBodyInit | null
  ): void {
    const meta = xhrMetaMap.get(this);
    const timedtextUrl = meta ? parseTimedtextUrl(meta.url) : null;

    if (timedtextUrl) {
      cancelFallbackTimer();
      recordOriginalTrackUrl(timedtextUrl);

      if (isCircuitBreakerActive()) {
        notifyRateLimited();
      }

      this.addEventListener('load', () => {
        if (disposed) return;
        if (this.status === 429) {
          triggerRateLimitCircuitBreaker();
          return;
        }

        if (this.status < 200 || this.status >= 300) return;

        if (typeof this.responseText === 'string' && this.responseText.length > 0) {
          handleCapturedText(timedtextUrl, this.responseText);
        } else if (this.response && isJson3Response(this.response)) {
          const reqVideoId = timedtextUrl.searchParams.get('v');
          const locVideoId = extractVideoIdFromLocation();
          if (reqVideoId && locVideoId && reqVideoId !== locVideoId) {
            return;
          }
          emitParsedTrack(timedtextUrl, this.response);
        }
      });
    }

    OriginalXHRSend?.call(this, body ?? null);
  };

  if (hasXhr && OriginalXHROpen && OriginalXHRSend) {
    XMLHttpRequest.prototype.open = patchedXhrOpen as typeof XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.send = patchedXhrSend;
  }

  const handleMessage = (event: MessageEvent<unknown>): void => {
    if (disposed || event.source !== window) return;
    if (typeof event.data !== 'object' || event.data === null) return;

    const data = event.data as Partial<IsolatedToMainMessage>;
    if (data.source !== POST_MESSAGE_SOURCE_ISOLATED) return;

    if (data.type === 'NAVIGATED' && data.payload) {
      if (data.payload.videoId !== lastCapturedVideoId) {
        lastBaseTimedtextUrl = null;
        lastCapturedVideoId = null;
      }
      scheduleFallbackActivation();
      return;
    }

    if (data.type === 'REQUEST_TRANSLATED_TRACK' && data.payload) {
      if (isCircuitBreakerActive()) {
        notifyRateLimited();
        return;
      }

      const targetLang = data.payload.targetLang || data.payload.nativeLang;
      if (!targetLang) return;
      const { videoId } = data.payload;
      if (!lastBaseTimedtextUrl) {
        postToIsolated({
          source: POST_MESSAGE_SOURCE_MAIN,
          type: 'TRACK_ERROR',
          payload: { error: 'No base timedtext track captured yet for translation' }
        });
        return;
      }

      try {
        const baseUrl = new URL(lastBaseTimedtextUrl);
        if (videoId && baseUrl.searchParams.get('v') && baseUrl.searchParams.get('v') !== videoId) {
          return;
        }
        baseUrl.searchParams.set('tlang', targetLang);
        baseUrl.searchParams.set('fmt', 'json3');

        void (async () => {
          try {
            const resp = await originalFetch(baseUrl.toString(), { credentials: 'include' });
            if (disposed) return;
            if (resp.status === 429) {
              triggerRateLimitCircuitBreaker();
              return;
            }
            if (!resp.ok) {
              postToIsolated({
                source: POST_MESSAGE_SOURCE_MAIN,
                type: 'TRACK_ERROR',
                payload: {
                  error: `HTTP ${resp.status} requesting translated track`,
                  url: baseUrl.toString()
                }
              });
              return;
            }
            const text = await resp.text();
            if (!handleCapturedText(baseUrl, text)) {
              postToIsolated({
                source: POST_MESSAGE_SOURCE_MAIN,
                type: 'TRACK_ERROR',
                payload: {
                  error: 'Translated timedtext response was empty or invalid',
                  url: baseUrl.toString()
                }
              });
            }
          } catch (err: unknown) {
            if (disposed) return;
            postToIsolated({
              source: POST_MESSAGE_SOURCE_MAIN,
              type: 'TRACK_ERROR',
              payload: {
                error: err instanceof Error ? err.message : 'Failed to fetch translated timedtext',
                url: baseUrl.toString()
              }
            });
          }
        })();
      } catch (err: unknown) {
        postToIsolated({
          source: POST_MESSAGE_SOURCE_MAIN,
          type: 'TRACK_ERROR',
          payload: {
            error: err instanceof Error ? err.message : 'Invalid timedtext URL'
          }
        });
      }
    }
  };

  const handleNavigateStart = (): void => {
    cancelFallbackTimer();
    lastBaseTimedtextUrl = null;
    lastCapturedVideoId = null;
  };

  const handleNavigateFinish = (): void => {
    const currentVideoId = extractVideoIdFromLocation();
    if (!currentVideoId || currentVideoId !== lastCapturedVideoId) {
      lastBaseTimedtextUrl = null;
      lastCapturedVideoId = null;
    }
    scheduleFallbackActivation();
  };

  window.addEventListener('message', handleMessage);
  window.addEventListener('yt-navigate-start', handleNavigateStart);
  window.addEventListener('yt-navigate-finish', handleNavigateFinish);

  if (extractVideoIdFromLocation()) {
    scheduleFallbackActivation();
  }

  return () => {
    if (disposed) return;
    disposed = true;
    cancelFallbackTimer();
    window.removeEventListener('message', handleMessage);
    window.removeEventListener('yt-navigate-start', handleNavigateStart);
    window.removeEventListener('yt-navigate-finish', handleNavigateFinish);

    if (window.fetch === patchedFetch) {
      window.fetch = rawOriginalFetch;
    }
    if (hasXhr && OriginalXHROpen && OriginalXHRSend) {
      if (XMLHttpRequest.prototype.open === patchedXhrOpen) {
        XMLHttpRequest.prototype.open = OriginalXHROpen;
      }
      if (XMLHttpRequest.prototype.send === patchedXhrSend) {
        XMLHttpRequest.prototype.send = OriginalXHRSend;
      }
    }
    delete winRecord[GLOBAL_GUARD];
  };
}
