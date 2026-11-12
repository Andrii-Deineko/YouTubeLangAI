import type { Json3Response } from '../types/subtitles';
import {
  ISOLATED_MESSAGE_SOURCE,
  MAIN_MESSAGE_SOURCE,
  type IsolatedToMainMessage,
  type MainToIsolatedMessage,
  type TrackCapturedPayload
} from '../types/messages';

(() => {
  const GLOBAL_GUARD = '__YT_LANG_AI_INTERCEPTOR_INSTALLED__';
  const winRecord = window as unknown as Record<string, unknown>;
  if (winRecord[GLOBAL_GUARD]) {
    return;
  }
  winRecord[GLOBAL_GUARD] = true;

  const originalFetch = window.fetch.bind(window);
  const OriginalXHROpen = XMLHttpRequest.prototype.open;
  const OriginalXHRSend = XMLHttpRequest.prototype.send;

  interface XHRMeta {
    url: string;
  }
  const xhrMetaMap = new WeakMap<XMLHttpRequest, XHRMeta>();

  let lastBaseTimedtextUrl: string | null = null;
  let lastCapturedVideoId: string | null = null;
  let fallbackTimerId: number | null = null;

  function postToIsolated(message: MainToIsolatedMessage): void {
    window.postMessage(message, '*');
  }

  function extractVideoIdFromLocation(): string {
    try {
      const url = new URL(window.location.href);
      const v = url.searchParams.get('v');
      if (v) return v;
      const shortsMatch = url.pathname.match(/\/shorts\/([a-zA-Z0-9_-]+)/);
      if (shortsMatch?.[1]) return shortsMatch[1];
    } catch {
      // Ignore malformed URLs
    }
    return '';
  }

  function parseTimedtextUrl(rawUrl: string): URL | null {
    try {
      const url = new URL(rawUrl, window.location.origin);
      if (url.pathname.includes('/api/timedtext')) {
        return url;
      }
      return null;
    } catch {
      return null;
    }
  }

  function isJson3Data(value: unknown): value is Json3Response {
    if (typeof value !== 'object' || value === null) return false;
    const candidate = value as { events?: unknown };
    return Array.isArray(candidate.events);
  }

  function buildPayload(urlObj: URL, data: Json3Response): TrackCapturedPayload {
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

  function recordOriginalTrackUrl(urlObj: URL): void {
    if (!urlObj.searchParams.get('tlang')) {
      lastBaseTimedtextUrl = urlObj.toString();
      lastCapturedVideoId = urlObj.searchParams.get('v') ?? extractVideoIdFromLocation();
    }
  }

  function cancelFallbackTimer(): void {
    if (fallbackTimerId !== null) {
      window.clearTimeout(fallbackTimerId);
      fallbackTimerId = null;
    }
  }

  function scheduleFallbackActivation(): void {
    cancelFallbackTimer();
    const targetVideoId = extractVideoIdFromLocation();
    if (!targetVideoId) return;

    fallbackTimerId = window.setTimeout(() => {
      fallbackTimerId = null;
      const currentVideoId = extractVideoIdFromLocation();
      if (!currentVideoId || currentVideoId !== targetVideoId) return;
      if (lastCapturedVideoId === currentVideoId && lastBaseTimedtextUrl) return;

      const subtitlesBtn = document.querySelector<HTMLButtonElement>('.ytp-subtitles-button');
      if (subtitlesBtn && subtitlesBtn.getAttribute('aria-pressed') === 'false') {
        subtitlesBtn.click();
      }
    }, 2000);
  }

  async function fetchJson3AndDispatch(urlObj: URL, isTranslated: boolean): Promise<void> {
    const fetchUrl = new URL(urlObj.toString());
    fetchUrl.searchParams.set('fmt', 'json3');

    try {
      const response = await originalFetch(fetchUrl.toString(), {
        credentials: 'include'
      });
      if (!response.ok) {
        postToIsolated({
          source: MAIN_MESSAGE_SOURCE,
          type: 'TRACK_ERROR',
          payload: {
            error: `HTTP ${response.status} fetching json3 timedtext`,
            url: fetchUrl.toString()
          }
        });
        return;
      }

      const parsed: unknown = await response.json();
      if (!isJson3Data(parsed)) return;

      const payload = buildPayload(fetchUrl, parsed);
      postToIsolated({
        source: MAIN_MESSAGE_SOURCE,
        type: isTranslated ? 'TRANSLATED_TRACK_CAPTURED' : 'TRACK_CAPTURED',
        payload
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to fetch json3 timedtext';
      postToIsolated({
        source: MAIN_MESSAGE_SOURCE,
        type: 'TRACK_ERROR',
        payload: {
          error: message,
          url: fetchUrl.toString()
        }
      });
    }
  }

  function handleCapturedText(urlObj: URL, rawText: string): void {
    try {
      const parsed: unknown = JSON.parse(rawText);
      if (!isJson3Data(parsed)) return;

      const isTranslated = Boolean(urlObj.searchParams.get('tlang'));
      const payload = buildPayload(urlObj, parsed);
      postToIsolated({
        source: MAIN_MESSAGE_SOURCE,
        type: isTranslated ? 'TRANSLATED_TRACK_CAPTURED' : 'TRACK_CAPTURED',
        payload
      });
    } catch {
      // Non-JSON payload even though fmt=json3 was requested
    }
  }

  function getRequestUrl(input: RequestInfo | URL): string {
    if (typeof input === 'string') return input;
    if (input instanceof URL) return input.toString();
    return input.url;
  }

  window.fetch = async function patchedFetch(
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

    const fmt = timedtextUrl.searchParams.get('fmt');
    const isTranslated = Boolean(timedtextUrl.searchParams.get('tlang'));
    const response = await originalFetch(input, init);

    if (fmt === 'json3') {
      const cloned = response.clone();
      void cloned
        .text()
        .then((text) => handleCapturedText(timedtextUrl, text))
        .catch(() => undefined);
    } else if (response.ok) {
      void fetchJson3AndDispatch(timedtextUrl, isTranslated);
    }

    return response;
  };

  XMLHttpRequest.prototype.open = function patchedOpen(
    method: string,
    url: string | URL,
    async?: boolean,
    username?: string | null,
    password?: string | null
  ): void {
    const urlStr = typeof url === 'string' ? url : url.toString();
    xhrMetaMap.set(this, { url: urlStr });
    OriginalXHROpen.call(
      this,
      method,
      urlStr,
      async ?? true,
      username ?? null,
      password ?? null
    );
  };

  XMLHttpRequest.prototype.send = function patchedSend(
    body?: Document | XMLHttpRequestBodyInit | null
  ): void {
    const meta = xhrMetaMap.get(this);
    const timedtextUrl = meta ? parseTimedtextUrl(meta.url) : null;

    if (timedtextUrl) {
      cancelFallbackTimer();
      recordOriginalTrackUrl(timedtextUrl);

      this.addEventListener('load', () => {
        if (this.status < 200 || this.status >= 300) return;

        const fmt = timedtextUrl.searchParams.get('fmt');
        const isTranslated = Boolean(timedtextUrl.searchParams.get('tlang'));

        if (fmt === 'json3') {
          if (typeof this.responseText === 'string' && this.responseText.length > 0) {
            handleCapturedText(timedtextUrl, this.responseText);
          } else if (this.response && typeof this.response === 'object' && isJson3Data(this.response)) {
            postToIsolated({
              source: MAIN_MESSAGE_SOURCE,
              type: isTranslated ? 'TRANSLATED_TRACK_CAPTURED' : 'TRACK_CAPTURED',
              payload: buildPayload(timedtextUrl, this.response)
            });
          }
        } else {
          void fetchJson3AndDispatch(timedtextUrl, isTranslated);
        }
      });
    }

    OriginalXHRSend.call(this, body ?? null);
  };

  window.addEventListener('message', (event: MessageEvent<unknown>) => {
    if (event.source !== window) return;
    if (typeof event.data !== 'object' || event.data === null) return;

    const data = event.data as Partial<IsolatedToMainMessage>;
    if (data.source !== ISOLATED_MESSAGE_SOURCE) return;

    if (data.type === 'NAVIGATED' && data.payload) {
      if (data.payload.videoId !== lastCapturedVideoId) {
        lastBaseTimedtextUrl = null;
        lastCapturedVideoId = null;
      }
      scheduleFallbackActivation();
      return;
    }

    if (data.type === 'REQUEST_TRANSLATED_TRACK' && data.payload) {
      const { nativeLang, videoId } = data.payload;
      if (!lastBaseTimedtextUrl) {
        postToIsolated({
          source: MAIN_MESSAGE_SOURCE,
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
        baseUrl.searchParams.set('tlang', nativeLang);
        baseUrl.searchParams.set('fmt', 'json3');
        void fetchJson3AndDispatch(baseUrl, true);
      } catch (err: unknown) {
        postToIsolated({
          source: MAIN_MESSAGE_SOURCE,
          type: 'TRACK_ERROR',
          payload: {
            error: err instanceof Error ? err.message : 'Invalid timedtext URL'
          }
        });
      }
    }
  });

  window.addEventListener('yt-navigate-finish', () => {
    const currentVideoId = extractVideoIdFromLocation();
    if (currentVideoId && currentVideoId !== lastCapturedVideoId) {
      lastBaseTimedtextUrl = null;
      lastCapturedVideoId = null;
    }
    scheduleFallbackActivation();
  });

  if (extractVideoIdFromLocation()) {
    scheduleFallbackActivation();
  }
})();
