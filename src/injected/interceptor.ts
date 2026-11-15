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

  const videoBaseTimedtextMap = new Map<string, string>();
  let lastBaseTimedtextUrl: string | null = null;
  let fallbackTimerId: number | null = null;

  const capturedTracksMap = new Map<string, TrackCapturedPayload>();
  const capturedTranslatedMap = new Map<string, TrackCapturedPayload>();
  let lastCapturedTrack: TrackCapturedPayload | null = null;
  let lastCapturedTranslatedTrack: TrackCapturedPayload | null = null;

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

  function extractVideoId(urlObj?: URL): string {
    if (urlObj) {
      const v = urlObj.searchParams.get('v');
      if (v) return v;
    }
    const fromLoc = extractVideoIdFromLocation();
    if (fromLoc) return fromLoc;
    return 'unknown';
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
    const videoId = extractVideoId(urlObj);
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

  function dispatchCapturedTrack(payload: TrackCapturedPayload, isTranslated: boolean): void {
    const eventCount = payload.data.events?.length ?? 0;
    console.debug('[YT-Lang-AI] Timedtext intercepted in MAIN world:', {
      videoId: payload.videoId,
      isTranslated,
      lang: payload.lang,
      tlang: payload.tlang,
      eventCount,
      url: payload.url
    });

    if (isTranslated) {
      if (payload.videoId && payload.videoId !== 'unknown') {
        capturedTranslatedMap.set(payload.videoId, payload);
      }
      lastCapturedTranslatedTrack = payload;
      postToIsolated({
        source: MAIN_MESSAGE_SOURCE,
        type: 'TRANSLATED_TRACK_CAPTURED',
        payload
      });
    } else {
      if (payload.videoId && payload.videoId !== 'unknown') {
        capturedTracksMap.set(payload.videoId, payload);
      }
      lastCapturedTrack = payload;
      postToIsolated({
        source: MAIN_MESSAGE_SOURCE,
        type: 'TRACK_CAPTURED',
        payload
      });
    }
  }

  function recordOriginalTrackUrl(urlObj: URL): void {
    if (!urlObj.searchParams.get('tlang')) {
      const videoId = extractVideoId(urlObj);
      const rawUrl = urlObj.toString();
      lastBaseTimedtextUrl = rawUrl;
      if (videoId && videoId !== 'unknown') {
        videoBaseTimedtextMap.set(videoId, rawUrl);
      }
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
    const targetVideoId = extractVideoId();
    if (!targetVideoId || targetVideoId === 'unknown') return;

    fallbackTimerId = window.setTimeout(() => {
      fallbackTimerId = null;
      const currentVideoId = extractVideoId();
      if (!currentVideoId || currentVideoId !== targetVideoId) return;
      if (videoBaseTimedtextMap.has(currentVideoId)) return;

      const activePlayer =
        document.querySelector<HTMLElement>('#movie_player') ??
        document.querySelector<HTMLElement>('ytd-reel-video-renderer[is-active] #shorts-player') ??
        document.querySelector<HTMLElement>('ytd-reel-video-renderer[is-active] .html5-video-player') ??
        document.querySelector<HTMLElement>('.html5-video-player');

      if (activePlayer) {
        try {
          const playerApi = activePlayer as unknown as {
            loadModule?: (moduleName: string) => void;
            setOption?: (module: string, option: string, value: unknown) => void;
          };
          playerApi.loadModule?.('captions');
        } catch {
          // Ignore
        }

        const subtitlesBtn =
          activePlayer.querySelector<HTMLButtonElement>('.ytp-subtitles-button') ??
          document.querySelector<HTMLButtonElement>('.ytp-subtitles-button');
        if (subtitlesBtn && subtitlesBtn.getAttribute('aria-pressed') !== 'true') {
          subtitlesBtn.click();
        }
      }
    }, 1500);
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
      dispatchCapturedTrack(payload, isTranslated);
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
      dispatchCapturedTrack(payload, isTranslated);
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
            dispatchCapturedTrack(buildPayload(timedtextUrl, this.response), isTranslated);
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
    const isFromContent =
      data.source === ISOLATED_MESSAGE_SOURCE ||
      (data.source as string) === 'YT_LANG_AI_CONTENT';

    if (!isFromContent) return;

    if (data.type === 'GET_LATEST_TRACK') {
      const requestedVid =
        data.payload?.videoId ??
        data.videoId ??
        extractVideoId();

      console.debug('[YT-Lang-AI] MAIN received GET_LATEST_TRACK:', {
        requestedVid,
        hasCached: requestedVid && requestedVid !== 'unknown' ? capturedTracksMap.has(requestedVid) : false,
        hasLast: Boolean(lastCapturedTrack)
      });

      const track =
        (requestedVid && requestedVid !== 'unknown' && capturedTracksMap.get(requestedVid)) ||
        lastCapturedTrack;

      if (track) {
        console.debug('[YT-Lang-AI] Responding to GET_LATEST_TRACK with cached track:', {
          videoId: track.videoId,
          eventCount: track.data.events?.length ?? 0
        });
        postToIsolated({
          source: MAIN_MESSAGE_SOURCE,
          type: 'TRACK_CAPTURED',
          payload: track
        });
      }

      const transTrack =
        (requestedVid && requestedVid !== 'unknown' && capturedTranslatedMap.get(requestedVid)) ||
        lastCapturedTranslatedTrack;

      if (transTrack) {
        postToIsolated({
          source: MAIN_MESSAGE_SOURCE,
          type: 'TRANSLATED_TRACK_CAPTURED',
          payload: transTrack
        });
      }
      return;
    }

    if (data.type === 'NAVIGATED' && data.payload) {
      scheduleFallbackActivation();
      return;
    }

    if (data.type === 'REQUEST_TRANSLATED_TRACK' && data.payload) {
      const { nativeLang, videoId } = data.payload;
      const targetVid = videoId || extractVideoIdFromLocation();
      const baseUrlStr =
        (targetVid && videoBaseTimedtextMap.get(targetVid)) ||
        lastBaseTimedtextUrl;

      if (!baseUrlStr) {
        postToIsolated({
          source: MAIN_MESSAGE_SOURCE,
          type: 'TRACK_ERROR',
          payload: { error: 'No base timedtext track captured yet for translation' }
        });
        return;
      }

      try {
        const baseUrl = new URL(baseUrlStr);
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
    scheduleFallbackActivation();
  });

  if (extractVideoIdFromLocation()) {
    scheduleFallbackActivation();
  }
})();
