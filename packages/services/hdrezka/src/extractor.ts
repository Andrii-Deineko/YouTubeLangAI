import type { AvailableTrackOption, PlayerMainWorldContext } from '@langai/contracts';
import {
  convertSubtitleLnsToPlayerJs,
  detectLanguageFromLabelAndCues,
  parsePlayerJsSubtitleString,
  parseSubtitles,
  unescapeString
} from '@langai/subtitle-kit';
import {
  HDREZKA_ALL_DOMAINS,
  isCurrentWindowAllowed
} from './domainUtils';

const PLAYER_CONTAINER_SELECTOR =
  '#oframecdnplayer, #cdnplayer, #player-placeholder, .jwplayer, .plyr, .video-js';

interface CandidateCaptionTrack {
  url: string;
  label?: string;
  language?: string;
}

function isSubtitleCandidateUrl(rawUrl: string): boolean {
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
    lowerUrl.includes('subtitles') ||
    lowerUrl.includes('caption')
  );
}

function isValidCueBody(rawText: string): boolean {
  if (!rawText) return false;
  const clean = rawText.replace(/^\uFEFF/, '').trimStart();
  return clean.includes('-->') || clean.startsWith('WEBVTT');
}

function extractSubtitleStringFromObject(obj: Record<string, unknown>): string {
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

function extractMediaTitle(): string {
  if (typeof document === 'undefined') return '';
  const el = document.querySelector('.b-post__title, .b-content__main .name, h1');
  if (el?.textContent?.trim()) {
    return el.textContent.trim();
  }
  if (document.title) {
    return document.title
      .replace(/(\s*[-|–—]\s*(HDRezka|Rezka|Watch Online|Смотреть онлайн).*)$/i, '')
      .trim();
  }
  return '';
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
    // Ignore XHR read errors
  }
  return '';
}

/**
 * Installs the MAIN-world subtitle & `/ajax/get_cdn_series/` extractor for HDRezka & PlayerJS frames.
 * Immediately returns a no-op teardown if the current host and `ancestorOrigins` are not allowed.
 */
export function initHdrezkaMainWorldExtractor(ctx: PlayerMainWorldContext): () => void {
  if (!isCurrentWindowAllowed(HDREZKA_ALL_DOMAINS)) {
    return () => {};
  }

  let disposed = false;
  let navGeneration = 0;
  let lastCdnSubtitle = '';
  let lastPostedSubUrl = '';
  let perfBaselineTime = 0;
  let currentPathKey = `${window.location.pathname}${window.location.search}`;
  let pollIntervalId: number | null = null;
  let mutationTimerId: number | null = null;
  const scannedScripts = new WeakSet<HTMLScriptElement>();
  const scannedTrackSrcs = new Set<string>();

  const originalFetch = window.fetch.bind(window);

  // Redirect video.requestFullscreen to the player container so HUD stays visible in fullscreen
  let restoreFullscreen = (): void => {};
  if (typeof Element !== 'undefined') {
    const origRequestFullscreen = Element.prototype.requestFullscreen;
    const elemProto = Element.prototype as unknown as Record<string, unknown>;
    const origWebkitFullscreen = elemProto.webkitRequestFullscreen as
      | ((...args: unknown[]) => unknown)
      | undefined;

    let patchedRequestFullscreen: typeof Element.prototype.requestFullscreen | null = null;
    let patchedWebkitFullscreen: ((...args: unknown[]) => unknown) | null = null;

    if (typeof origRequestFullscreen === 'function') {
      patchedRequestFullscreen = function (
        this: Element,
        options?: FullscreenOptions
      ): Promise<void> {
        if (this instanceof HTMLVideoElement) {
          const container = this.closest<HTMLElement>(PLAYER_CONTAINER_SELECTOR);
          if (container && container !== this && typeof container.requestFullscreen === 'function') {
            return container.requestFullscreen(options);
          }
        }
        return origRequestFullscreen.call(this, options);
      };
      Element.prototype.requestFullscreen = patchedRequestFullscreen;
    }

    if (typeof origWebkitFullscreen === 'function') {
      patchedWebkitFullscreen = function (this: Element, ...args: unknown[]): unknown {
        if (this instanceof HTMLVideoElement) {
          const container = this.closest<HTMLElement>(PLAYER_CONTAINER_SELECTOR);
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
        return origWebkitFullscreen.apply(this, args);
      };
      elemProto.webkitRequestFullscreen = patchedWebkitFullscreen;
    }

    restoreFullscreen = (): void => {
      if (patchedRequestFullscreen && Element.prototype.requestFullscreen === patchedRequestFullscreen) {
        Element.prototype.requestFullscreen = origRequestFullscreen;
      }
      if (patchedWebkitFullscreen && elemProto.webkitRequestFullscreen === patchedWebkitFullscreen) {
        elemProto.webkitRequestFullscreen = origWebkitFullscreen;
      }
    };
  }

  const emitPlayerJsManifest = (playerJsString: string, resetPrevious: boolean): void => {
    if (disposed) return;
    const baseHref = window.location.href;
    const tracks = parsePlayerJsSubtitleString(playerJsString, baseHref);
    if (tracks.length === 0) {
      if (resetPrevious) {
        ctx.emitTracks({ resetPrimaryCues: true, availableTracks: [] });
      }
      return;
    }

    const title = extractMediaTitle() || undefined;
    const availableTracks: AvailableTrackOption[] = tracks.map((t, index) => ({
      label: t.label,
      language: t.language || 'auto',
      url: t.url,
      active: tracks.length === 1 && index === 0
    }));

    ctx.log(
      'info',
      `PlayerJS: found ${tracks.length} tracks (${tracks
        .map((t) => (t.language ? t.language.toUpperCase() : 'AUTO'))
        .join(', ')})`
    );

    if (tracks.length === 1 && tracks[0]) {
      const single = tracks[0];
      const reqGen = navGeneration;
      originalFetch(single.url)
        .then((res) => (res.ok ? res.text() : ''))
        .then((rawText) => {
          if (disposed || reqGen !== navGeneration) return;
          if (isValidCueBody(rawText)) {
            const cues = parseSubtitles(rawText);
            if (cues.length > 0) {
              const detectedLang = detectLanguageFromLabelAndCues(
                `${single.label} ${single.url}`,
                cues,
                'en'
              );
              lastPostedSubUrl = single.url;
              ctx.emitTracks({
                primaryCues: cues,
                resetPrimaryCues: resetPrevious,
                primaryMeta: {
                  url: single.url,
                  label: single.label,
                  lang: detectedLang,
                  language: detectedLang,
                  source: 'playerjs',
                  title,
                  availableTracks
                },
                availableTracks
              });
              return;
            }
          }
          ctx.emitTracks({
            resetPrimaryCues: resetPrevious,
            primaryMeta: {
              url: single.url,
              label: single.label,
              lang: single.language || undefined,
              language: single.language || undefined,
              source: 'playerjs',
              title,
              availableTracks
            },
            availableTracks
          });
        })
        .catch(() => {
          if (disposed || reqGen !== navGeneration) return;
          ctx.emitTracks({
            resetPrimaryCues: resetPrevious,
            primaryMeta: {
              url: single.url,
              label: single.label,
              lang: single.language || undefined,
              language: single.language || undefined,
              source: 'playerjs',
              title,
              availableTracks
            },
            availableTracks
          });
        });
      return;
    }

    ctx.emitTracks({
      resetPrimaryCues: resetPrevious,
      primaryMeta: {
        source: 'playerjs',
        title,
        availableTracks
      },
      availableTracks
    });
  };

  const emitRawSubtitleText = (
    rawText: string,
    url: string,
    source: 'fetch' | 'xhr' | 'script' | 'track',
    trackMeta?: CandidateCaptionTrack
  ): void => {
    if (disposed || !isValidCueBody(rawText)) return;
    const cues = parseSubtitles(rawText);
    if (cues.length === 0) return;

    const detectedLang = detectLanguageFromLabelAndCues(
      `${trackMeta?.language ?? ''} ${trackMeta?.label ?? ''} ${url}`,
      cues,
      'en'
    );
    lastPostedSubUrl = url;
    ctx.emitTracks({
      primaryCues: cues,
      primaryMeta: {
        url,
        label: trackMeta?.label,
        lang: detectedLang,
        language: detectedLang,
        source,
        title: extractMediaTitle() || undefined
      }
    });
  };

  const fetchAndPostTrack = (
    track: CandidateCaptionTrack,
    source: 'script' | 'track'
  ): void => {
    if (disposed) return;
    try {
      const resolvedUrl = new URL(track.url, window.location.href).href;
      if (resolvedUrl === lastPostedSubUrl) return;
      lastPostedSubUrl = resolvedUrl;
      const reqGen = navGeneration;

      originalFetch(resolvedUrl)
        .then((res) => (res.ok ? res.text() : ''))
        .then((rawText) => {
          if (disposed || reqGen !== navGeneration) return;
          if (isValidCueBody(rawText)) {
            emitRawSubtitleText(rawText, resolvedUrl, source, track);
          } else {
            ctx.emitTracks({
              primaryMeta: {
                url: resolvedUrl,
                label: track.label,
                lang: track.language,
                language: track.language,
                source,
                title: extractMediaTitle() || undefined
              }
            });
          }
        })
        .catch(() => {
          if (disposed || reqGen !== navGeneration) return;
          ctx.emitTracks({
            primaryMeta: {
              url: resolvedUrl,
              label: track.label,
              lang: track.language,
              language: track.language,
              source,
              title: extractMediaTitle() || undefined
            }
          });
        });
    } catch {
      // Ignore invalid URL
    }
  };

  const checkCdnPlayerInfo = (): void => {
    if (disposed) return;
    const cdnWin = window as Window & {
      CDNPlayerInfo?: Record<string, unknown>;
      playerjsSubtitle?: string;
    };

    let subtitleStr = '';
    if (cdnWin.CDNPlayerInfo && typeof cdnWin.CDNPlayerInfo === 'object') {
      subtitleStr = extractSubtitleStringFromObject(cdnWin.CDNPlayerInfo);
    }
    if (!subtitleStr && typeof cdnWin.playerjsSubtitle === 'string') {
      subtitleStr = unescapeString(cdnWin.playerjsSubtitle);
    }

    if (subtitleStr && subtitleStr !== lastCdnSubtitle) {
      lastCdnSubtitle = subtitleStr;
      emitPlayerJsManifest(subtitleStr, true);
    }
  };

  const scanInlineScripts = (): void => {
    if (disposed || typeof document === 'undefined') return;
    try {
      const scripts = document.querySelectorAll<HTMLScriptElement>('script:not([src])');
      for (const script of Array.from(scripts)) {
        if (scannedScripts.has(script)) continue;
        const content = script.textContent;
        if (!content || !content.trim()) continue;
        scannedScripts.add(script);

        if (content.includes('subtitle') || content.includes('initCDN')) {
          let foundSub = '';
          const subMatch = content.match(/["']subtitle["']\s*:\s*["']([^"']+)["']/);
          if (subMatch?.[1]) {
            foundSub = unescapeString(subMatch[1]);
          }

          const lnsMatch = content.match(/["']subtitle_lns["']\s*:\s*(\{[^}]+\})/);
          if (lnsMatch?.[1]) {
            try {
              const parsed = JSON.parse(unescapeString(lnsMatch[1])) as Record<string, string>;
              const converted = convertSubtitleLnsToPlayerJs(parsed);
              if (converted) {
                foundSub = foundSub ? `${foundSub},${converted}` : converted;
              }
            } catch {
              // Ignore malformed JSON
            }
          }

          if (foundSub && foundSub !== lastCdnSubtitle) {
            lastCdnSubtitle = foundSub;
            emitPlayerJsManifest(foundSub, false);
            continue;
          }
        }

        if (!lastPostedSubUrl && content.includes('.vtt')) {
          const vttMatches = Array.from(
            content.matchAll(/["'](https?(?::\\\/\\\/|:\/\/)[^"'\s]+\.vtt[^"'\s]*)["']/gi)
          );
          const firstMatch = vttMatches[0]?.[1];
          if (firstMatch) {
            fetchAndPostTrack({ url: unescapeString(firstMatch.replace(/\\+$/, '')) }, 'script');
          }
        }
      }
    } catch {
      // Ignore inline script scan errors
    }
  };

  const scanTrackElements = (): void => {
    if (disposed || typeof document === 'undefined') return;
    try {
      const trackEls = document.querySelectorAll<HTMLTrackElement>('video track, track');
      for (const tr of Array.from(trackEls)) {
        const src = tr.src || tr.getAttribute('src') || '';
        if (!src || scannedTrackSrcs.has(src)) continue;
        if (
          !src.includes('.vtt') &&
          !src.includes('.srt') &&
          !src.includes('subtitles')
        ) {
          continue;
        }
        scannedTrackSrcs.add(src);
        fetchAndPostTrack(
          {
            url: src,
            label: tr.label || undefined,
            language: tr.srclang || undefined
          },
          'track'
        );
        break;
      }
    } catch {
      // Ignore track scan errors
    }
  };

  const scanPerformanceResources = (): void => {
    if (disposed || lastPostedSubUrl) return;
    try {
      if (typeof performance === 'undefined' || typeof performance.getEntriesByType !== 'function') {
        return;
      }
      const entries = performance.getEntriesByType('resource');
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
        if (lower.includes('.vtt') || lower.includes('.srt')) {
          fetchAndPostTrack({ url: name }, 'script');
          break;
        }
      }
    } catch {
      // Ignore performance API errors
    }
  };

  const patchedFetch: typeof window.fetch = async function (...args) {
    const response = await originalFetch(...args);
    if (disposed) return response;

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
      const isRezkaCdnSeries = lowerUrl.includes('/ajax/get_cdn_series/');

      if (isRezkaCdnSeries) {
        const clone = response.clone();
        clone
          .json()
          .then((json: unknown) => {
            if (!disposed && json && typeof json === 'object') {
              const extracted = extractSubtitleStringFromObject(json as Record<string, unknown>);
              lastCdnSubtitle = extracted || '';
              emitPlayerJsManifest(extracted || '', true);
            }
          })
          .catch(() => {});
      } else if (isSubtitleCandidateUrl(requestUrl)) {
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
              if (!disposed) {
                emitRawSubtitleText(rawText, requestUrl, 'fetch');
              }
            })
            .catch(() => {});
        }
      }
    } catch {
      // Ignore inspection errors
    }

    return response;
  };

  window.fetch = patchedFetch;

  const hasXhr = typeof XMLHttpRequest !== 'undefined';
  const origXhrOpen = hasXhr ? XMLHttpRequest.prototype.open : null;
  const origXhrSend = hasXhr ? XMLHttpRequest.prototype.send : null;
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
    origXhrOpen?.call(
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
      if (disposed) return;
      try {
        if (this.status < 200 || this.status >= 300) return;
        const url = xhrUrls.get(this) || '';
        const lowerUrl = url.toLowerCase();
        const isRezkaCdnSeries = lowerUrl.includes('/ajax/get_cdn_series/');

        if (isRezkaCdnSeries) {
          const decoded = decodeXhrBody(this);
          const handleJson = (raw: string): void => {
            if (!raw || disposed) return;
            try {
              const json = JSON.parse(raw) as Record<string, unknown>;
              const extracted = extractSubtitleStringFromObject(json);
              lastCdnSubtitle = extracted || '';
              emitPlayerJsManifest(extracted || '', true);
            } catch {
              // Ignore non-JSON payloads
            }
          };
          if (typeof decoded === 'string') {
            handleJson(decoded);
          } else {
            void decoded.then(handleJson).catch(() => {});
          }
        } else if (isSubtitleCandidateUrl(url)) {
          const decoded = decodeXhrBody(this);
          if (typeof decoded === 'string') {
            emitRawSubtitleText(decoded, url, 'xhr');
          } else {
            void decoded
              .then((rawText) => emitRawSubtitleText(rawText, url, 'xhr'))
              .catch(() => {});
          }
        }
      } catch {
        // Ignore XHR inspection errors
      }
    });

    origXhrSend?.call(this, body);
  };

  if (hasXhr && origXhrOpen && origXhrSend) {
    XMLHttpRequest.prototype.open = patchedXhrOpen as typeof XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.send = patchedXhrSend;
  }

  const runAllProbes = (): void => {
    if (disposed) return;
    scanInlineScripts();
    scanTrackElements();
    checkCdnPlayerInfo();
    scanPerformanceResources();
  };

  const startProbePolling = (maxTicks = 30): void => {
    if (pollIntervalId !== null) {
      window.clearInterval(pollIntervalId);
    }
    let attempts = 0;
    pollIntervalId = window.setInterval(() => {
      attempts += 1;
      runAllProbes();
      if (attempts >= maxTicks && pollIntervalId !== null) {
        window.clearInterval(pollIntervalId);
        pollIntervalId = null;
      }
    }, 1000);
  };

  const handleSpaUrlChange = (): void => {
    if (disposed) return;
    const nextKey = `${window.location.pathname}${window.location.search}`;
    if (nextKey === currentPathKey) return;
    currentPathKey = nextKey;
    navGeneration += 1;
    perfBaselineTime = typeof performance !== 'undefined' ? performance.now() : 0;
    lastPostedSubUrl = '';
    lastCdnSubtitle = '';
    scannedTrackSrcs.clear();
    runAllProbes();
    startProbePolling(20);
  };

  let origPushState: History['pushState'] | null = null;
  let origReplaceState: History['replaceState'] | null = null;
  let wrappedPushState: History['pushState'] | null = null;
  let wrappedReplaceState: History['replaceState'] | null = null;

  if (typeof history !== 'undefined') {
    try {
      origPushState = history.pushState.bind(history);
      origReplaceState = history.replaceState.bind(history);
      const pushRef = origPushState;
      const replaceRef = origReplaceState;
      wrappedPushState = (...args: Parameters<History['pushState']>): void => {
        pushRef(...args);
        handleSpaUrlChange();
      };
      wrappedReplaceState = (...args: Parameters<History['replaceState']>): void => {
        replaceRef(...args);
        handleSpaUrlChange();
      };
      history.pushState = wrappedPushState;
      history.replaceState = wrappedReplaceState;
    } catch {
      // Ignore read-only history properties
    }
  }

  window.addEventListener('popstate', handleSpaUrlChange);

  const handlePlay = (e: Event): void => {
    if (disposed) return;
    if (e.target instanceof HTMLVideoElement) {
      handleSpaUrlChange();
      scanTrackElements();
      checkCdnPlayerInfo();
    }
  };
  if (typeof document !== 'undefined') {
    document.addEventListener('play', handlePlay, true);
  }

  let observer: MutationObserver | null = null;
  if (typeof MutationObserver !== 'undefined' && typeof document !== 'undefined' && document.documentElement) {
    observer = new MutationObserver(() => {
      if (disposed) return;
      handleSpaUrlChange();
      if (mutationTimerId !== null) return;
      mutationTimerId = window.setTimeout(() => {
        mutationTimerId = null;
        if (!disposed) {
          scanInlineScripts();
          scanTrackElements();
          checkCdnPlayerInfo();
          scanPerformanceResources();
        }
      }, 250);
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  }

  runAllProbes();
  startProbePolling(30);

  return () => {
    disposed = true;
    restoreFullscreen();
    if (window.fetch === patchedFetch) {
      window.fetch = originalFetch;
    }
    if (hasXhr && origXhrOpen && origXhrSend) {
      if (XMLHttpRequest.prototype.open === patchedXhrOpen) {
        XMLHttpRequest.prototype.open = origXhrOpen;
      }
      if (XMLHttpRequest.prototype.send === patchedXhrSend) {
        XMLHttpRequest.prototype.send = origXhrSend;
      }
    }
    window.removeEventListener('popstate', handleSpaUrlChange);
    try {
      if (origPushState && wrappedPushState && history.pushState === wrappedPushState) {
        history.pushState = origPushState;
      }
      if (origReplaceState && wrappedReplaceState && history.replaceState === wrappedReplaceState) {
        history.replaceState = origReplaceState;
      }
    } catch {
      // Ignore history restore errors
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('play', handlePlay, true);
    }
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
  };
}
