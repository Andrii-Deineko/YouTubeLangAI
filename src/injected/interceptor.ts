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

  const RATE_LIMIT_STORAGE_KEY = 'ytai_timedtext_blocked_until';
  const RATE_LIMIT_COOLDOWN_MS = 120_000; // 2 minutes

  const capturedTracksMap = new Map<string, TrackCapturedPayload>();
  const capturedTranslatedMap = new Map<string, TrackCapturedPayload>();
  let lastCapturedTrack: TrackCapturedPayload | null = null;
  let lastCapturedTranslatedTrack: TrackCapturedPayload | null = null;

  const captionTracksCache = new Map<string, CaptionTrackItem[]>();
  const videosWithCachedTrack = new Set<string>();
  const requestedTranslations = new Set<string>();

  function postToIsolated(message: MainToIsolatedMessage): void {
    window.postMessage(message, '*');
  }

  function getRateLimitBlockedUntil(): number {
    try {
      const val = window.localStorage.getItem(RATE_LIMIT_STORAGE_KEY);
      if (val) {
        const num = Number(val);
        if (!Number.isNaN(num) && num > Date.now()) {
          return num;
        }
      }
    } catch {
      // Ignore
    }
    return 0;
  }

  function isCircuitBreakerActive(): boolean {
    return getRateLimitBlockedUntil() > Date.now();
  }

  function notifyRateLimited(blockedUntil?: number): void {
    const until = blockedUntil ?? getRateLimitBlockedUntil();
    const remainingMs = Math.max(0, until - Date.now());
    if (remainingMs > 0) {
      console.warn('[YT-Lang-AI] Circuit breaker active! Cooldown remaining:', Math.round(remainingMs / 1000), 'sec');
      postToIsolated({
        source: MAIN_MESSAGE_SOURCE,
        type: 'CAPTION_RATE_LIMITED',
        payload: {
          remainingMs,
          blockedUntil: until
        }
      });
    }
  }

  function triggerRateLimitCircuitBreaker(): void {
    const blockedUntil = Date.now() + RATE_LIMIT_COOLDOWN_MS;
    try {
      window.localStorage.setItem(RATE_LIMIT_STORAGE_KEY, String(blockedUntil));
    } catch {
      // Ignore
    }
    cancelFallbackTimer();
    notifyRateLimited(blockedUntil);
  }

  // Initial check on boot
  if (isCircuitBreakerActive()) {
    notifyRateLimited();
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

  function decodeHtmlEntities(str: string): string {
    return str
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)));
  }

  function parseTimestamp(hours: string | undefined, minutes: string, seconds: string, millis: string): number {
    const h = hours ? parseInt(hours, 10) : 0;
    const m = parseInt(minutes, 10);
    const s = parseInt(seconds, 10);
    const ms = parseInt(millis, 10);
    return (h * 3600 + m * 60 + s) * 1000 + ms;
  }

  function parseVttToEvents(vttText: string): Json3Response | null {
    const events: Array<{ tStartMs: number; dDurationMs?: number; segs?: Array<{ utf8: string }> }> = [];
    const cueRegex = /(?:(\d{2,}):)?(\d{2}):(\d{2})[.,](\d{3})\s*-->\s*(?:(\d{2,}):)?(\d{2}):(\d{2})[.,](\d{3})[^\r\n]*\r?\n([\s\S]*?)(?=\r?\n\r?\n|\r?\n?$|$)/g;
    let match: RegExpExecArray | null = null;
    while ((match = cueRegex.exec(vttText)) !== null) {
      const startMs = parseTimestamp(match[1], match[2], match[3], match[4]);
      const endMs = parseTimestamp(match[5], match[6], match[7], match[8]);
      const text = match[9].replace(/<[^>]+>/g, '').trim();
      if (text) {
        events.push({
          tStartMs: startMs,
          dDurationMs: Math.max(endMs - startMs, 100),
          segs: [{ utf8: text }]
        });
      }
    }
    return events.length > 0 ? { events } : null;
  }

  function parseTimedtextToEvents(rawText: string): Json3Response | null {
    const trimmed = rawText.trim();
    if (!trimmed) return null;

    // 1. Try JSON3
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        const data = JSON.parse(trimmed) as unknown;
        if (isJson3Data(data)) return data;
      } catch {
        // Fall through
      }
    }

    // 2. Try XML: SRV3 (<timedtext format="3">)
    if (trimmed.includes('<timedtext') && trimmed.includes('<p ')) {
      const events: Array<{ tStartMs: number; dDurationMs?: number; segs?: Array<{ utf8: string; tOffsetMs?: number }> }> = [];
      const pRegex = /<p\s+([^>]+)>(.*?)<\/p>/gs;
      let pMatch: RegExpExecArray | null = null;
      while ((pMatch = pRegex.exec(trimmed)) !== null) {
        const attrs = pMatch[1];
        const content = pMatch[2];
        const tMatch = attrs.match(/\bt="(\d+)"/);
        const dMatch = attrs.match(/\bd="(\d+)"/);
        const tStartMs = tMatch ? parseInt(tMatch[1], 10) : 0;
        const dDurationMs = dMatch ? parseInt(dMatch[1], 10) : 0;

        const segs: Array<{ utf8: string; tOffsetMs?: number }> = [];
        const sRegex = /<s([^>]*)>([^<]*)<\/s>/gs;
        let sMatch: RegExpExecArray | null = null;
        let hasSegs = false;
        while ((sMatch = sRegex.exec(content)) !== null) {
          hasSegs = true;
          const sAttrs = sMatch[1];
          const offsetMatch = sAttrs.match(/\bt="(\d+)"/);
          const offset = offsetMatch ? parseInt(offsetMatch[1], 10) : undefined;
          const text = decodeHtmlEntities(sMatch[2]);
          if (text) {
            segs.push({ utf8: text, ...(offset !== undefined ? { tOffsetMs: offset } : {}) });
          }
        }

        if (!hasSegs) {
          const cleanText = decodeHtmlEntities(content.replace(/<[^>]+>/g, ''));
          if (cleanText) segs.push({ utf8: cleanText });
        }

        if (segs.length > 0) {
          events.push({ tStartMs, dDurationMs, segs });
        }
      }
      if (events.length > 0) return { events };
    }

    // 3. Try XML: Legacy (<transcript>)
    if (trimmed.includes('<transcript') || (trimmed.includes('<text ') && trimmed.includes('start='))) {
      const events: Array<{ tStartMs: number; dDurationMs?: number; segs?: Array<{ utf8: string }> }> = [];
      const textRegex = /<text\s+([^>]+)>([^<]*)<\/text>/gs;
      let match: RegExpExecArray | null = null;
      while ((match = textRegex.exec(trimmed)) !== null) {
        const attrs = match[1];
        const rawSegText = decodeHtmlEntities(match[2]);
        const startMatch = attrs.match(/\bstart="([\d.]+)"/);
        const durMatch = attrs.match(/\bdur="([\d.]+)"/);
        const startSec = startMatch ? parseFloat(startMatch[1]) : 0;
        const durSec = durMatch ? parseFloat(durMatch[1]) : 2.0;

        events.push({
          tStartMs: Math.round(startSec * 1000),
          dDurationMs: Math.round(durSec * 1000),
          segs: [{ utf8: rawSegText }]
        });
      }
      if (events.length > 0) return { events };
    }

    // 4. Try WebVTT
    if (trimmed.startsWith('WEBVTT') || trimmed.includes('-->')) {
      const vttEvents = parseVttToEvents(trimmed);
      if (vttEvents) return vttEvents;
    }

    return null;
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
      if (!videoBaseTimedtextMap.has(videoId)) {
        const preferred = tracks.find((t) => t.kind !== 'asr') ?? tracks[0];
        if (preferred?.baseUrl) {
          videoBaseTimedtextMap.set(videoId, preferred.baseUrl);
          lastBaseTimedtextUrl = preferred.baseUrl;
        }
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
    if (isCircuitBreakerActive()) {
      notifyRateLimited();
      return;
    }

    const targetVideoId = extractVideoId();
    fallbackTimerId = window.setTimeout(() => {
      fallbackTimerId = null;
      if (isCircuitBreakerActive()) {
        notifyRateLimited();
        return;
      }

      const currentVideoId = extractVideoId();
      const effectiveVid = currentVideoId !== 'unknown' ? currentVideoId : targetVideoId;

      // If already captured or cached in ISOLATED for this video, nothing to do
      if (effectiveVid && effectiveVid !== 'unknown') {
        if (capturedTracksMap.has(effectiveVid) || videosWithCachedTrack.has(effectiveVid)) {
          return;
        }
      }

      console.log('[YT-Lang-AI] Fallback CC check for videoId:', effectiveVid);

      // Trigger native subtitles button or captions module so YouTube performs authenticated request
      const activePlayer =
        document.querySelector<HTMLElement>('#movie_player') ??
        document.querySelector<HTMLElement>('ytd-reel-video-renderer[is-active] #shorts-player') ??
        document.querySelector<HTMLElement>('ytd-reel-video-renderer[is-active] .html5-video-player') ??
        document.querySelector<HTMLElement>('.html5-video-player');

      if (activePlayer && !isCircuitBreakerActive()) {
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

  async function fetchAndDispatchTrack(urlObj: URL, isTranslated: boolean): Promise<boolean> {
    if (isCircuitBreakerActive()) {
      notifyRateLimited();
      return false;
    }

    try {
      const response = await originalFetch(urlObj.toString(), {
        credentials: 'include'
      });

      if (response.status === 429) {
        console.warn('[YT-Lang-AI] HTTP 429 detected during fetchAndDispatchTrack!');
        triggerRateLimitCircuitBreaker();
        return false;
      }

      if (!response.ok) {
        return false;
      }

      const text = await response.text();
      const parsed = parseTimedtextToEvents(text);
      if (!parsed || !parsed.events || parsed.events.length === 0) {
        return false;
      }

      const payload = buildPayload(urlObj, parsed);
      dispatchCapturedTrack(payload, isTranslated);
      return true;
    } catch (err: unknown) {
      console.warn('[YT-Lang-AI] Error fetching timedtext:', err);
      return false;
    }
  }

  function handleCapturedText(urlObj: URL, rawText: string): boolean {
    try {
      const parsed = parseTimedtextToEvents(rawText);
      if (!parsed || !parsed.events || parsed.events.length === 0) return false;

      const isTranslated = Boolean(urlObj.searchParams.get('tlang'));
      const payload = buildPayload(urlObj, parsed);
      dispatchCapturedTrack(payload, isTranslated);
      return true;
    } catch {
      return false;
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

    const response = await originalFetch(input, init);

    if (response.status === 429) {
      console.warn('[YT-Lang-AI] HTTP 429 detected on timedtext fetch!');
      triggerRateLimitCircuitBreaker();
      return response;
    }

    if (response.ok) {
      try {
        const cloned = response.clone();
        void cloned
          .text()
          .then((text) => {
            handleCapturedText(timedtextUrl, text);
          })
          .catch(() => undefined);
      } catch {
        // Clone error
      }
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
        if (this.status === 429) {
          console.warn('[YT-Lang-AI] HTTP 429 detected on timedtext XHR!');
          triggerRateLimitCircuitBreaker();
          return;
        }

        if (this.status < 200 || this.status >= 300) return;

        const isTranslated = Boolean(timedtextUrl.searchParams.get('tlang'));
        if (typeof this.responseText === 'string' && this.responseText.length > 0) {
          handleCapturedText(timedtextUrl, this.responseText);
        } else if (this.response && typeof this.response === 'object' && isJson3Data(this.response)) {
          dispatchCapturedTrack(buildPayload(timedtextUrl, this.response), isTranslated);
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

    if (data.type === 'HAVE_CACHED_TRACK' && data.payload?.videoId) {
      videosWithCachedTrack.add(data.payload.videoId);
      cancelFallbackTimer();
      return;
    }

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
      } else if (!videosWithCachedTrack.has(requestedVid)) {
        // If not yet captured and ISOLATED doesn't have it cached, schedule fallback check
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
      const vid = data.payload.videoId;
      if (vid && videosWithCachedTrack.has(vid)) {
        cancelFallbackTimer();
        return;
      }
      scheduleFallbackActivation();
      return;
    }

    if (data.type === 'REQUEST_TRANSLATED_TRACK' && data.payload) {
      if (isCircuitBreakerActive()) {
        notifyRateLimited();
        return;
      }

      const { nativeLang, videoId } = data.payload;
      const targetVid = videoId || extractVideoIdFromLocation();
      if (!targetVid) return;

      const transKey = `${targetVid}:${nativeLang.toLowerCase()}`;
      if (requestedTranslations.has(transKey)) {
        console.log('[YT-Lang-AI] Translation already requested for:', transKey);
        return;
      }

      let baseUrlStr =
        (targetVid && videoBaseTimedtextMap.get(targetVid)) ||
        lastBaseTimedtextUrl;

      if (!baseUrlStr && targetVid && captionTracksCache.has(targetVid)) {
        const cachedTracks = captionTracksCache.get(targetVid);
        const preferred = cachedTracks?.find((t) => t.kind !== 'asr') ?? cachedTracks?.[0];
        if (preferred?.baseUrl) {
          baseUrlStr = preferred.baseUrl;
        }
      }

      if (!baseUrlStr) {
        postToIsolated({
          source: MAIN_MESSAGE_SOURCE,
          type: 'TRACK_ERROR',
          payload: { error: 'No base timedtext track captured yet for translation' }
        });
        return;
      }

      requestedTranslations.add(transKey);

      try {
        const baseUrl = new URL(baseUrlStr);
        baseUrl.searchParams.set('tlang', nativeLang);
        baseUrl.searchParams.set('fmt', 'json3');
        void fetchAndDispatchTrack(baseUrl, true);
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
