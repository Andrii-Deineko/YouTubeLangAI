/**
 * Cinema Main World Interceptor
 * Intercepts subtitles (.vtt, .srt, PlayerJS, subtitle_lns) and media metadata across online cinemas.
 * Runs in MAIN world - MUST be self-contained IIFE without top-level imports when bundled.
 */

export function initCinemaInterceptor(): void {
  const GLOBAL_GUARD = '__CINELINGUA_INTERCEPTOR_ACTIVE__';
  const win = window as unknown as Record<string, unknown>;
  if (win[GLOBAL_GUARD]) {
    return;
  }
  win[GLOBAL_GUARD] = true;

  let isDisabled = false;

  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data) return;
    if (event.data.type === 'CINELINGUA_SET_DISABLED') {
      isDisabled = Boolean(event.data.disabled);
    }
  });

  function postSubtitles(payload: {
    source: 'fetch' | 'xhr' | 'playerjs';
    url?: string;
    rawText?: string;
    playerJsString?: string;
    resetPrevious?: boolean;
  }): void {
    if (isDisabled) return;
    window.postMessage(
      {
        source: 'CINELINGUA_MAIN',
        type: 'SUBTITLES_INTERCEPTED',
        payload
      },
      '*'
    );
  }

  function postMediaInfo(title: string): void {
    if (isDisabled) return;
    window.postMessage(
      {
        source: 'CINELINGUA_MAIN',
        type: 'MEDIA_INFO',
        payload: {
          title: title.trim(),
          url: window.location.href
        }
      },
      '*'
    );
  }

  function unescapeString(str: string): string {
    if (!str) return '';
    try {
      return str.replace(/\\(["'\\\/bfnrt]|u[0-9a-fA-F]{4})/g, (_match, code: string) => {
        if (code === '"') return '"';
        if (code === "'") return "'";
        if (code === '\\') return '\\';
        if (code === '/') return '/';
        if (code === 'b') return '\b';
        if (code === 'f') return '\f';
        if (code === 'n') return '\n';
        if (code === 'r') return '\r';
        if (code === 't') return '\t';
        if (code.startsWith('u')) {
          return String.fromCharCode(parseInt(code.slice(1), 16));
        }
        return code;
      });
    } catch {
      return str;
    }
  }

  function convertSubtitleLnsToPlayerJs(obj: Record<string, string>): string {
    if (!obj || typeof obj !== 'object') return '';
    const entries = Object.entries(obj);
    if (entries.length === 0) return '';
    return entries.map(([lang, url]) => `[${lang}]${url}`).join(',');
  }

  function extractSubtitleStringFromObject(obj: Record<string, unknown>): string {
    const parts: string[] = [];
    if (typeof obj.subtitle === 'string' && obj.subtitle.trim()) {
      parts.push(unescapeString(obj.subtitle.trim()));
    }
    if (obj.subtitle_lns && typeof obj.subtitle_lns === 'object') {
      const converted = convertSubtitleLnsToPlayerJs(obj.subtitle_lns as Record<string, string>);
      if (converted) {
        parts.push(converted);
      }
    }
    return parts.filter(Boolean).join(',');
  }

  function extractAndPostMediaInfo(): void {
    let title = '';

    const rezkaTitle = document.querySelector('.b-post__title, .b-content__main .name');
    if (rezkaTitle?.textContent) {
      title = rezkaTitle.textContent.trim();
    }

    if (!title) {
      const animeTitle = document.querySelector('.film-name, .anime-title, .entry-title, h1.title');
      if (animeTitle?.textContent) {
        title = animeTitle.textContent.trim();
      }
    }

    if (!title && document.title) {
      title = document.title
        .replace(/(\s*[-|–—]\s*(HDRezka|9anime|HiAnime|Watch Online|Смотреть онлайн).*)$/i, '')
        .trim();
    }

    if (title) {
      postMediaInfo(title);
    }
  }

  let lastCdnSubtitle = '';
  const scannedScripts = new WeakSet<HTMLScriptElement>();

  function scanInlineScripts(): void {
    try {
      const scripts = document.querySelectorAll<HTMLScriptElement>('script:not([src])');
      for (const script of Array.from(scripts)) {
        if (scannedScripts.has(script)) continue;
        scannedScripts.add(script);
        const content = script.textContent;
        if (!content) continue;

        if (content.includes('subtitle') || content.includes('initCDN')) {
          let foundSub = '';
          const subMatch = content.match(/["']subtitle["']\s*:\s*["']([^"']+)["']/);
          if (subMatch && subMatch[1]) {
            foundSub = unescapeString(subMatch[1]);
          }

          const lnsMatch = content.match(/["']subtitle_lns["']\s*:\s*(\{[^}]+\})/);
          if (lnsMatch && lnsMatch[1]) {
            try {
              const parsed = JSON.parse(unescapeString(lnsMatch[1])) as Record<string, string>;
              const converted = convertSubtitleLnsToPlayerJs(parsed);
              if (converted) {
                foundSub = foundSub ? `${foundSub},${converted}` : converted;
              }
            } catch {
              // ignore json parse error
            }
          }

          if (foundSub && foundSub !== lastCdnSubtitle) {
            lastCdnSubtitle = foundSub;
            postSubtitles({
              source: 'playerjs',
              playerJsString: foundSub,
              resetPrevious: false
            });
          }
        }
      }
    } catch {
      // ignore
    }
  }

  // Intercept fetch
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);

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
      const isSubtitleUrl =
        lowerUrl.includes('.vtt') ||
        lowerUrl.includes('.srt') ||
        lowerUrl.includes('subtitles') ||
        lowerUrl.includes('caption');

      const isRezkaCdnSeries = lowerUrl.includes('/ajax/get_cdn_series/');

      if (isSubtitleUrl) {
        const clone = response.clone();
        const contentType = clone.headers.get('content-type') || '';

        if (
          lowerUrl.includes('.vtt') ||
          lowerUrl.includes('.srt') ||
          contentType.includes('text/vtt') ||
          contentType.includes('application/x-subrip')
        ) {
          clone
            .text()
            .then((rawText) => {
              if (rawText && (rawText.includes('-->') || rawText.startsWith('WEBVTT'))) {
                postSubtitles({
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
              if (extracted) {
                postSubtitles({
                  source: 'playerjs',
                  playerJsString: extracted,
                  resetPrevious: true
                });
              } else {
                postSubtitles({
                  source: 'playerjs',
                  playerJsString: '',
                  resetPrevious: true
                });
              }
            }
          })
          .catch(() => {});
      }
    } catch {
      // ignore inspection errors
    }

    return response;
  };

  // Intercept XMLHttpRequest
  const originalXhrOpen = XMLHttpRequest.prototype.open;
  const originalXhrSend = XMLHttpRequest.prototype.send;

  type CustomXhr = XMLHttpRequest & { __cinelinguaUrl?: string };

  XMLHttpRequest.prototype.open = function (
    this: CustomXhr,
    method: string,
    url: string | URL,
    async?: boolean,
    username?: string | null,
    password?: string | null
  ) {
    this.__cinelinguaUrl = typeof url === 'string' ? url : url.href;
    return originalXhrOpen.call(
      this,
      method,
      url,
      async ?? true,
      username ?? null,
      password ?? null
    );
  };

  XMLHttpRequest.prototype.send = function (
    this: CustomXhr,
    body?: Document | XMLHttpRequestBodyInit | null
  ) {
    this.addEventListener('load', () => {
      try {
        const url = this.__cinelinguaUrl || '';
        const lowerUrl = url.toLowerCase();
        const isSubtitleUrl =
          lowerUrl.includes('.vtt') ||
          lowerUrl.includes('.srt') ||
          lowerUrl.includes('subtitles') ||
          lowerUrl.includes('caption');
        const isRezkaCdnSeries = lowerUrl.includes('/ajax/get_cdn_series/');

        if (isSubtitleUrl) {
          const rawText = this.responseText;
          if (rawText && (rawText.includes('-->') || rawText.startsWith('WEBVTT'))) {
            postSubtitles({
              source: 'xhr',
              url,
              rawText
            });
          }
        } else if (isRezkaCdnSeries) {
          try {
            const json = JSON.parse(this.responseText) as Record<string, unknown>;
            const extracted = extractSubtitleStringFromObject(json);
            if (extracted) {
              postSubtitles({
                source: 'playerjs',
                playerJsString: extracted,
                resetPrevious: true
              });
            } else {
              postSubtitles({
                source: 'playerjs',
                playerJsString: '',
                resetPrevious: true
              });
            }
          } catch {
            // not JSON
          }
        }
      } catch {
        // ignore inspection errors
      }
    });

    return originalXhrSend.call(this, body);
  };

  function checkCdnPlayerInfo(): void {
    type WindowWithCdn = Window & {
      CDNPlayerInfo?: Record<string, unknown>;
      playerjsSubtitle?: string;
    };
    const cdnWin = window as WindowWithCdn;

    let subtitleStr = '';
    if (cdnWin.CDNPlayerInfo && typeof cdnWin.CDNPlayerInfo === 'object') {
      subtitleStr = extractSubtitleStringFromObject(cdnWin.CDNPlayerInfo);
    }
    if (!subtitleStr && typeof cdnWin.playerjsSubtitle === 'string') {
      subtitleStr = unescapeString(cdnWin.playerjsSubtitle);
    }

    if (subtitleStr && subtitleStr !== lastCdnSubtitle) {
      lastCdnSubtitle = subtitleStr;
      postSubtitles({
        source: 'playerjs',
        playerJsString: subtitleStr,
        resetPrevious: true
      });
    }
  }

  // Initial and periodic checks
  extractAndPostMediaInfo();
  scanInlineScripts();
  checkCdnPlayerInfo();

  let attempts = 0;
  const pollInterval = window.setInterval(() => {
    attempts++;
    scanInlineScripts();
    checkCdnPlayerInfo();
    extractAndPostMediaInfo();
    if (attempts > 30) {
      window.clearInterval(pollInterval);
    }
  }, 1000);

  const observer = new MutationObserver(() => {
    extractAndPostMediaInfo();
    scanInlineScripts();
    checkCdnPlayerInfo();
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });
}
