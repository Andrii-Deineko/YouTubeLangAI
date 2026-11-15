import type { Json3Response } from '../types/subtitles';
import type {
  IsolatedToMainMessage,
  MainToIsolatedMessage,
  TrackCapturedPayload
} from '../types/messages';

const MAIN_MESSAGE_SOURCE = 'YT_LANG_AI_MAIN';
const ISOLATED_MESSAGE_SOURCE = 'YT_LANG_AI_ISOLATED';

interface CaptionTrackItem {
  baseUrl: string;
  name?: { simpleText?: string; runs?: Array<{ text?: string }> };
  vssId?: string;
  languageCode: string;
  kind?: string;
  isTranslatable?: boolean;
}

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

  const captionTracksCache = new Map<string, CaptionTrackItem[]>();

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
    if (!rawUrl || !rawUrl.includes('/api/timedtext')) return null;
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
    console.log('[YT-Lang-AI] Timedtext intercepted in MAIN world:', {
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
        videoId: payload.videoId,
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
        videoId: payload.videoId,
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

  function extractCaptionTracksFromObject(obj: unknown): CaptionTrackItem[] | null {
    if (!obj || typeof obj !== 'object') return null;
    const record = obj as Record<string, unknown>;
    const captions = record.captions as Record<string, unknown> | undefined;
    const renderer = captions?.playerCaptionsTracklistRenderer as Record<string, unknown> | undefined;
    const tracks = renderer?.captionTracks;
    if (Array.isArray(tracks) && tracks.length > 0) {
      return tracks as CaptionTrackItem[];
    }
    return null;
  }

  function handlePlayerResponseData(data: unknown): void {
    if (!data || typeof data !== 'object') return;
    const record = data as Record<string, unknown>;
    const videoDetails = record.videoDetails as Record<string, unknown> | undefined;
    const videoId = typeof videoDetails?.videoId === 'string' ? videoDetails.videoId : extractVideoId();
    const tracks = extractCaptionTracksFromObject(data);
    if (tracks && tracks.length > 0 && videoId && videoId !== 'unknown') {
      console.log('[YT-Lang-AI] Cached captionTracks from player API for videoId:', videoId, tracks.length);
      captionTracksCache.set(videoId, tracks);
    }
  }

  function getCaptionTracksFromGlobals(): { videoId?: string; tracks: CaptionTrackItem[] } | null {
    const win = window as unknown as Record<string, unknown>;
    const candidates = [
      win.ytInitialPlayerResponse,
      (win.ytplayer as Record<string, unknown> | undefined)?.config as Record<string, unknown> | undefined
    ];

    for (const candidate of candidates) {
      let parsed = candidate;
      if (typeof candidate === 'string') {
        try {
          parsed = JSON.parse(candidate);
        } catch {
          parsed = null;
        }
      }
      if (parsed && typeof parsed === 'object') {
        const record = parsed as Record<string, unknown>;
        const rawResponse = (record.args as Record<string, unknown> | undefined)?.raw_player_response;
        const target = rawResponse && typeof rawResponse === 'object' ? rawResponse : record;
        const tracks = extractCaptionTracksFromObject(target);
        if (tracks && tracks.length > 0) {
          const vDetails = (target as Record<string, unknown>).videoDetails as Record<string, unknown> | undefined;
          const vid = typeof vDetails?.videoId === 'string' ? vDetails.videoId : undefined;
          return { videoId: vid, tracks };
        }
      }
    }
    return null;
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

    fallbackTimerId = window.setTimeout(async () => {
      fallbackTimerId = null;
      const currentVideoId = extractVideoId();
      const effectiveVid = currentVideoId !== 'unknown' ? currentVideoId : targetVideoId;

      // If already captured and dispatched for this video, nothing to do
      if (effectiveVid && effectiveVid !== 'unknown' && capturedTracksMap.has(effectiveVid)) {
        return;
      }

      console.log('[YT-Lang-AI] 1200ms fallback check for videoId:', effectiveVid);

      // 1. Check if we have captionTracks from player API or globals
      const globalData = getCaptionTracksFromGlobals();
      let tracks: CaptionTrackItem[] | null = null;
      if (effectiveVid && captionTracksCache.has(effectiveVid)) {
        tracks = captionTracksCache.get(effectiveVid) ?? null;
      } else if (globalData?.tracks && globalData.tracks.length > 0) {
        tracks = globalData.tracks;
        if (effectiveVid && effectiveVid !== 'unknown') {
          captionTracksCache.set(effectiveVid, tracks);
        }
      }

      if (tracks && tracks.length > 0) {
        console.log('[YT-Lang-AI] Found captionTracks via fallback:', tracks.length);
        // Prefer non-ASR track, otherwise first available
        const preferred = tracks.find((t) => t.kind !== 'asr') ?? tracks[0];
        if (preferred?.baseUrl) {
          try {
            const trackUrl = new URL(preferred.baseUrl, window.location.origin);
            trackUrl.searchParams.set('fmt', 'json3');
            if (effectiveVid && effectiveVid !== 'unknown' && !trackUrl.searchParams.get('v')) {
              trackUrl.searchParams.set('v', effectiveVid);
            }
            if (preferred.languageCode && !trackUrl.searchParams.get('lang')) {
              trackUrl.searchParams.set('lang', preferred.languageCode);
            }
            if (preferred.kind && !trackUrl.searchParams.get('kind')) {
              trackUrl.searchParams.set('kind', preferred.kind);
            }

            console.log('[YT-Lang-AI] Fetching fallback json3 track from baseUrl:', trackUrl.toString());
            await fetchJson3AndDispatch(trackUrl, false);
            return;
          } catch (err) {
            console.warn('[YT-Lang-AI] Error fetching fallback track:', err);
          }
        }
      }

      // 2. Secondary fallback: activate native subtitles button or captions module
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
          console.log('[YT-Lang-AI] Triggering native subtitles button click');
          subtitlesBtn.click();
        }
      }
    }, 1200);
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
    if (input instanceof URL) return input.href;
    if (input && typeof (input as Request).url === 'string') return (input as Request).url;
    return '';
  }

  window.fetch = async function patchedFetch(
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> {
    const rawUrl = getRequestUrl(input);

    // 1. Intercept /youtubei/v1/player to harvest captionTracks
    if (rawUrl.includes('/youtubei/v1/player')) {
      const response = await originalFetch(input, init);
      try {
        const cloned = response.clone();
        void cloned.json().then((playerData) => {
          handlePlayerResponseData(playerData);
        }).catch(() => undefined);
      } catch {
        // Ignore clone errors
      }
      return response;
    }

    // 2. Intercept /api/timedtext
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

      console.log('[YT-Lang-AI] MAIN received GET_LATEST_TRACK:', {
        requestedVid,
        hasCached: requestedVid && requestedVid !== 'unknown' ? capturedTracksMap.has(requestedVid) : false,
        hasLast: Boolean(lastCapturedTrack)
      });

      const track =
        (requestedVid && requestedVid !== 'unknown' && capturedTracksMap.get(requestedVid)) ||
        lastCapturedTrack;

      if (track) {
        console.log('[YT-Lang-AI] Responding to GET_LATEST_TRACK with cached track:', {
          videoId: track.videoId,
          eventCount: track.data.events?.length ?? 0
        });
        postToIsolated({
          source: MAIN_MESSAGE_SOURCE,
          type: 'TRACK_CAPTURED',
          videoId: track.videoId,
          payload: track
        });
      } else {
        // If not yet captured, trigger fallback check immediately
        scheduleFallbackActivation();
      }

      const transTrack =
        (requestedVid && requestedVid !== 'unknown' && capturedTranslatedMap.get(requestedVid)) ||
        lastCapturedTranslatedTrack;

      if (transTrack) {
        postToIsolated({
          source: MAIN_MESSAGE_SOURCE,
          type: 'TRANSLATED_TRACK_CAPTURED',
          videoId: transTrack.videoId,
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
