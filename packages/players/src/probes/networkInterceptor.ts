import { convertSubtitleLnsToPlayerJs, unescapeString } from '@langai/subtitle-kit';

export interface CandidateCaptionTrack {
  url: string;
  label?: string;
  language?: string;
  kind?: string;
}

export type NetworkSubtitleEvent =
  | {
      kind: 'subtitle-text';
      source: 'fetch' | 'xhr';
      url: string;
      rawText: string;
    }
  | {
      kind: 'cdn-series-json';
      url: string;
      playerJsString: string;
    };

type NetworkListener = (event: NetworkSubtitleEvent) => void;

const listeners = new Set<NetworkListener>();
let installedCleanup: (() => void) | null = null;
let capturedOriginalFetch: typeof window.fetch | null = null;

/**
 * Returns the original unpatched fetch function when available.
 */
export function getNativeFetch(): typeof window.fetch {
  if (capturedOriginalFetch) {
    return capturedOriginalFetch;
  }
  return window.fetch.bind(window);
}

/**
 * Checks whether a URL looks like a subtitle track request rather than media/assets.
 */
export function isSubtitleCandidateUrl(rawUrl: string): boolean {
  if (!rawUrl) return false;
  const lowerUrl = rawUrl.toLowerCase();
  if (/\.(m3u8|mpd|mp4|m4s|ts|aac|mp3|webm|jpg|jpeg|png|webp|svg|woff2?)(\?|$)/.test(lowerUrl)) {
    return false;
  }
  return (
    lowerUrl.includes('.vtt') ||
    lowerUrl.includes('.srt') ||
    lowerUrl.includes('format=vtt') ||
    lowerUrl.includes('format=webvtt') ||
    lowerUrl.includes('undertexter.ur.se') ||
    lowerUrl.includes('subtitles') ||
    lowerUrl.includes('caption')
  );
}

/**
 * Checks whether a fetched text payload contains WebVTT/SRT cue markers.
 */
export function isValidCueBody(rawText: string): boolean {
  if (!rawText) return false;
  const clean = rawText.replace(/^\uFEFF/, '').trimStart();
  return clean.includes('-->') || clean.startsWith('WEBVTT');
}

/**
 * Checks whether a caption track represents audio descriptions or sign language.
 */
export function isAccessibilityDescriptionTrack(track: CandidateCaptionTrack): boolean {
  const combined =
    `${track.label ?? ''} ${track.language ?? ''} ${track.kind ?? ''} ${track.url}`.toLowerCase();
  return (
    combined.includes('syntolk') ||
    combined.includes('teckenspr') ||
    combined.includes('audio description') ||
    combined.includes('descriptions')
  );
}

/**
 * Selects the best subtitle track from candidate caption entries.
 */
export function pickBestCaptionTrack(
  tracks: readonly CandidateCaptionTrack[]
): CandidateCaptionTrack | null {
  const valid = tracks.filter((t) => {
    if (!t.url || typeof t.url !== 'string') return false;
    const lbl = (t.label ?? '').trim().toLowerCase();
    if (lbl === 'off' || lbl === 'av' || lbl === 'none') return false;
    if (t.kind && !['captions', 'subtitles', 'text', ''].includes(t.kind.toLowerCase())) {
      const lowerKind = t.kind.toLowerCase();
      if (lowerKind === 'thumbnails' || lowerKind === 'chapters') {
        return false;
      }
    }
    return (
      t.url.includes('.vtt') ||
      t.url.includes('.srt') ||
      t.url.includes('undertexter') ||
      t.url.includes('subtitles')
    );
  });

  if (valid.length === 0) return null;

  const standardTracks = valid.filter((t) => !isAccessibilityDescriptionTrack(t));
  const pool = standardTracks.length > 0 ? standardTracks : valid;

  const isUrPlay =
    typeof window !== 'undefined' &&
    /(?:^|\.)ur(?:play)?\.se$/i.test(window.location.hostname);
  if (isUrPlay) {
    const svTrack = pool.find((t) => {
      const s = `${t.label ?? ''} ${t.language ?? ''}`.trim().toLowerCase();
      return s.includes('svensk') || /\b(sv|swe|sve)(?:[-_][a-z0-9]+)?\b/.test(s);
    });
    if (svTrack) return svTrack;
  }

  return pool[0] ?? null;
}

/**
 * Extracts a PlayerJS subtitle manifest string from `subtitle` and `subtitle_lns` fields.
 */
export function extractSubtitleStringFromObject(obj: Record<string, unknown>): string {
  const parts: string[] = [];
  if (typeof obj.subtitle === 'string' && obj.subtitle.trim()) {
    parts.push(unescapeString(obj.subtitle.trim()));
  }
  if (obj.subtitle_lns && typeof obj.subtitle_lns === 'object') {
    const converted = convertSubtitleLnsToPlayerJs(obj.subtitle_lns);
    if (converted) {
      parts.push(converted);
    }
  }
  return parts.filter(Boolean).join(',');
}

function notifyListeners(event: NetworkSubtitleEvent): void {
  listeners.forEach((listener) => {
    try {
      listener(event);
    } catch {
      // Ignore individual subscriber errors
    }
  });
}

function decodeXhrBody(xhr: XMLHttpRequest): Promise<string> | string {
  try {
    if (!xhr.responseType || xhr.responseType === 'text') {
      return xhr.responseText || '';
    }
    if (xhr.responseType === 'arraybuffer' && xhr.response instanceof ArrayBuffer) {
      return new TextDecoder('utf-8').decode(xhr.response);
    }
    if (xhr.responseType === 'blob' && xhr.response instanceof Blob) {
      return xhr.response.text();
    }
    if (typeof xhr.response === 'string') {
      return xhr.response;
    }
  } catch {
    // Ignore read errors
  }
  return '';
}

function installNetworkHooks(): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const originalFetch = window.fetch.bind(window);
  capturedOriginalFetch = originalFetch;

  const patchedFetch: typeof window.fetch = async function (...args) {
    const response = await originalFetch(...args);

    try {
      const requestUrl =
        typeof args[0] === 'string'
          ? args[0]
          : args[0] instanceof Request
            ? args[0].url
            : args[0] instanceof URL
              ? args[0].href
              : '';

      const lowerUrl = requestUrl.toLowerCase();
      const isSubtitleUrl = isSubtitleCandidateUrl(requestUrl);
      const isRezkaCdnSeries = lowerUrl.includes('/ajax/get_cdn_series/');

      if (isSubtitleUrl) {
        const clone = response.clone();
        const contentType = (clone.headers.get('content-type') || '').toLowerCase();
        const isBinaryMedia =
          contentType.includes('video/') ||
          contentType.includes('audio/') ||
          contentType.includes('image/') ||
          contentType.includes('mp2t');

        if (!isBinaryMedia) {
          clone
            .text()
            .then((rawText) => {
              if (isValidCueBody(rawText)) {
                notifyListeners({
                  kind: 'subtitle-text',
                  source: 'fetch',
                  url: requestUrl,
                  rawText
                });
              }
            })
            .catch(() => {});
        }
      } else if (isRezkaCdnSeries) {
        const clone = response.clone();
        clone
          .json()
          .then((json: unknown) => {
            if (json && typeof json === 'object') {
              const extracted = extractSubtitleStringFromObject(json as Record<string, unknown>);
              notifyListeners({
                kind: 'cdn-series-json',
                url: requestUrl,
                playerJsString: extracted || ''
              });
            }
          })
          .catch(() => {});
      }
    } catch {
      // Ignore fetch inspection errors
    }

    return response;
  };

  window.fetch = patchedFetch;

  const hasXhr = typeof XMLHttpRequest !== 'undefined';
  const originalXhrOpen = hasXhr ? XMLHttpRequest.prototype.open : null;
  const originalXhrSend = hasXhr ? XMLHttpRequest.prototype.send : null;
  const xhrUrls = new WeakMap<XMLHttpRequest, string>();

  const patchedXhrOpen = function (
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    async?: boolean,
    username?: string | null,
    password?: string | null
  ): void {
    xhrUrls.set(this, typeof url === 'string' ? url : url.href);
    originalXhrOpen?.call(
      this,
      method,
      url,
      async ?? true,
      username ?? null,
      password ?? null
    );
  };

  const patchedXhrSend = function (
    this: XMLHttpRequest,
    body?: Document | XMLHttpRequestBodyInit | null
  ): void {
    this.addEventListener('load', () => {
      try {
        if (this.status < 200 || this.status >= 300) return;
        const url = xhrUrls.get(this) || '';
        const lowerUrl = url.toLowerCase();
        const isSubtitleUrl = isSubtitleCandidateUrl(url);
        const isRezkaCdnSeries = lowerUrl.includes('/ajax/get_cdn_series/');

        if (isSubtitleUrl) {
          const decoded = decodeXhrBody(this);
          const handleRaw = (rawText: string): void => {
            if (isValidCueBody(rawText)) {
              notifyListeners({
                kind: 'subtitle-text',
                source: 'xhr',
                url,
                rawText
              });
            }
          };
          if (typeof decoded === 'string') {
            handleRaw(decoded);
          } else {
            void decoded.then(handleRaw).catch(() => {});
          }
        } else if (isRezkaCdnSeries) {
          const decoded = decodeXhrBody(this);
          if (typeof decoded === 'string' && decoded) {
            try {
              const json = JSON.parse(decoded) as Record<string, unknown>;
              const extracted = extractSubtitleStringFromObject(json);
              notifyListeners({
                kind: 'cdn-series-json',
                url,
                playerJsString: extracted || ''
              });
            } catch {
              // Ignore non-JSON payloads
            }
          }
        }
      } catch {
        // Ignore XHR inspection errors
      }
    });

    originalXhrSend?.call(this, body);
  };

  if (hasXhr && originalXhrOpen && originalXhrSend) {
    XMLHttpRequest.prototype.open = patchedXhrOpen as typeof XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.send = patchedXhrSend;
  }

  return () => {
    if (window.fetch === patchedFetch) {
      window.fetch = originalFetch;
    }
    capturedOriginalFetch = null;
    if (hasXhr && originalXhrOpen && originalXhrSend) {
      if (XMLHttpRequest.prototype.open === patchedXhrOpen) {
        XMLHttpRequest.prototype.open = originalXhrOpen;
      }
      if (XMLHttpRequest.prototype.send === patchedXhrSend) {
        XMLHttpRequest.prototype.send = originalXhrSend;
      }
    }
  };
}

/**
 * Subscribes a main-world probe to ref-counted fetch/XHR subtitle interceptions.
 */
export function subscribeNetworkSubtitles(listener: NetworkListener): () => void {
  listeners.add(listener);
  if (!installedCleanup) {
    installedCleanup = installNetworkHooks();
  }

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && installedCleanup) {
      installedCleanup();
      installedCleanup = null;
    }
  };
}
