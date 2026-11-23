import type { Json3Response } from '../../core/types/subtitles';
import {
  ISOLATED_MESSAGE_SOURCE,
  MAIN_MESSAGE_SOURCE,
  type IsolatedToMainMessage,
  type MainToIsolatedMessage,
  type TrackCapturedPayload
} from '../../core/types/messages';

export function initYouTubeInterceptor(): void {
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

  const RATE_LIMIT_STORAGE_KEY = 'ytai_timedtext_blocked_until';
  const RATE_LIMIT_COOLDOWN_MS = 120_000; // 2 minutes

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
      console.warn(
        '[YT-Lang-AI] Circuit breaker active! Cooldown remaining:',
        Math.round(remainingMs / 1000),
        'sec'
      );
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

  // Initial check on load
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

  function parseTimestamp(
    hours: string | undefined,
    minutes: string,
    seconds: string,
    millis: string
  ): number {
    const h = hours ? parseInt(hours, 10) : 0;
    const m = parseInt(minutes, 10);
    const s = parseInt(seconds, 10);
    const ms = parseInt(millis, 10);
    return (h * 3600 + m * 60 + s) * 1000 + ms;
  }

  function parseVttToEvents(vttText: string): Json3Response | null {
    const events: Array<{
      tStartMs: number;
      dDurationMs?: number;
      segs?: Array<{ utf8: string }>;
    }> = [];
    const cueRegex =
      /(?:(\d{2,}):)?(\d{2}):(\d{2})[.,](\d{3})\s*-->\s*(?:(\d{2,}):)?(\d{2}):(\d{2})[.,](\d{3})[^\r\n]*\r?\n([\s\S]*?)(?=\r?\n\r?\n|\r?\n?$|$)/g;
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
      const events: Array<{
        tStartMs: number;
        dDurationMs?: number;
        segs?: Array<{ utf8: string; tOffsetMs?: number }>;
      }> = [];
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
    if (
      trimmed.includes('<transcript') ||
      (trimmed.includes('<text ') && trimmed.includes('start='))
    ) {
      const events: Array<{
        tStartMs: number;
        dDurationMs?: number;
        segs?: Array<{ utf8: string }>;
      }> = [];
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

    // 4. Try VTT (WEBVTT)
    if (trimmed.includes('WEBVTT') || trimmed.includes('-->')) {
      const vttEvents = parseVttToEvents(trimmed);
      if (vttEvents) return vttEvents;
    }

    return null;
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
    if (isCircuitBreakerActive()) {
      notifyRateLimited();
      return;
    }

    const targetVideoId = extractVideoIdFromLocation();
    if (!targetVideoId) return;

    fallbackTimerId = window.setTimeout(() => {
      fallbackTimerId = null;
      if (isCircuitBreakerActive()) return;

      const currentVideoId = extractVideoIdFromLocation();
      if (!currentVideoId || currentVideoId !== targetVideoId) return;
      if (lastCapturedVideoId === currentVideoId && lastBaseTimedtextUrl) return;

      const subtitlesBtn = document.querySelector<HTMLButtonElement>('.ytp-subtitles-button');
      if (subtitlesBtn && subtitlesBtn.getAttribute('aria-pressed') === 'false') {
        subtitlesBtn.click();
      }
    }, 2000);
  }

  function handleCapturedText(urlObj: URL, rawText: string): void {
    const parsed = parseTimedtextToEvents(rawText);
    if (!parsed) return;

    const isTranslated = Boolean(urlObj.searchParams.get('tlang'));
    const payload = buildPayload(urlObj, parsed);
    postToIsolated({
      source: MAIN_MESSAGE_SOURCE,
      type: isTranslated ? 'TRANSLATED_TRACK_CAPTURED' : 'TRACK_CAPTURED',
      payload
    });
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
        .then((text) => handleCapturedText(timedtextUrl, text))
        .catch(() => undefined);
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

      if (isCircuitBreakerActive()) {
        notifyRateLimited();
      }

      this.addEventListener('load', () => {
        if (this.status === 429) {
          triggerRateLimitCircuitBreaker();
          return;
        }

        if (this.status < 200 || this.status >= 300) return;

        if (typeof this.responseText === 'string' && this.responseText.length > 0) {
          handleCapturedText(timedtextUrl, this.responseText);
        } else if (
          this.response &&
          typeof this.response === 'object' &&
          isJson3Data(this.response)
        ) {
          const isTranslated = Boolean(timedtextUrl.searchParams.get('tlang'));
          postToIsolated({
            source: MAIN_MESSAGE_SOURCE,
            type: isTranslated ? 'TRANSLATED_TRACK_CAPTURED' : 'TRACK_CAPTURED',
            payload: buildPayload(timedtextUrl, this.response)
          });
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
      if (isCircuitBreakerActive()) {
        notifyRateLimited();
        return;
      }

      const targetLang = data.payload.targetLang || data.payload.nativeLang;
      if (!targetLang) return;
      const { videoId } = data.payload;
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
        baseUrl.searchParams.set('tlang', targetLang);
        baseUrl.searchParams.set('fmt', 'json3');

        void (async () => {
          try {
            const resp = await originalFetch(baseUrl.toString(), { credentials: 'include' });
            if (resp.status === 429) {
              triggerRateLimitCircuitBreaker();
              return;
            }
            if (!resp.ok) {
              postToIsolated({
                source: MAIN_MESSAGE_SOURCE,
                type: 'TRACK_ERROR',
                payload: {
                  error: `HTTP ${resp.status} requesting translated track`,
                  url: baseUrl.toString()
                }
              });
              return;
            }
            const text = await resp.text();
            handleCapturedText(baseUrl, text);
          } catch (err: unknown) {
            postToIsolated({
              source: MAIN_MESSAGE_SOURCE,
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
}