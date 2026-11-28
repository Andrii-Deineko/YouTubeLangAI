import type {
  ActiveCueSnapshot,
  AvailableTrackOption,
  PlayerMainWorldContext,
  PlayerPlugin
} from '@langai/contracts';
import {
  cleanSubtitleText,
  convertSubtitleLnsToPlayerJs,
  detectLanguageFromLabelAndCues,
  parsePlayerJsSubtitleString,
  parseSubtitles,
  unescapeString
} from '@langai/subtitle-kit';
import { createCssCaptionSuppressor } from '../shared/cssSuppression';
import { findBestVideo, isVideoVisible } from '../shared/dom';
import {
  extractSubtitleStringFromObject,
  getNativeFetch,
  isValidCueBody,
  subscribeNetworkSubtitles
} from '../probes/networkInterceptor';
import { subscribeSpaNavigation } from '../probes/spaNavigation';

const PLAYERJS_CONTAINER_SELECTORS = ['#oframecdnplayer', '#cdnplayer'] as const;

const PLAYERJS_SUPPRESSION_CSS = `
.pjs-subtitles,
.playerjs-subtitles,
video::cue {
  opacity: 0 !important;
  visibility: hidden !important;
  pointer-events: none !important;
}
`;

const playerJsSuppressor = createCssCaptionSuppressor(
  'langai-playerjs-captions-suppression',
  PLAYERJS_SUPPRESSION_CSS
);

const PLAYER_UI_NOISE_RE =
  /^(?:\d{1,2}:\d{2}(?::\d{2})?(?:\s*\/\s*\d{1,2}:\d{2}(?::\d{2})?)?|\d{1,4}[pPkK]?|\d+(?:\.\d+)?[xх%]|hd|full\s*hd|uhd|auto|авто|off|выкл|вкл|on|cc|sub|subs|субтитры|звук|качество|скорость)$/i;

const hiddenNativeNodes = new Set<HTMLElement>();
const knownSubtitleContainers = new Set<HTMLElement>();

interface SuppressionObserverState {
  observer: MutationObserver;
  rafId: number | null;
  latestActiveCue: ActiveCueSnapshot | undefined;
}

const activeObservers = new WeakMap<HTMLElement, SuppressionObserverState>();

/**
 * Restores visibility on all native PlayerJS elements previously hidden.
 */
export function restorePlayerJsNativeNodes(): void {
  hiddenNativeNodes.forEach((el) => {
    try {
      el.style.removeProperty('visibility');
      el.style.removeProperty('opacity');
    } catch {
      // Element might be disconnected
    }
  });
  hiddenNativeNodes.clear();
  knownSubtitleContainers.clear();
}

function normalizeForSubMatch(text: string): string {
  return cleanSubtitleText(text)
    .toLowerCase()
    .replace(/[\u2018\u2019\u201A\u201B`]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F«»]/g, '"')
    .replace(/[\u2013\u2014\u2015]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripPunctuationForSubMatch(text: string): string {
  return normalizeForSubMatch(text)
    .replace(/[.,/#!$%^&*;:{}=\-_`~()?"'«»[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function collectActiveSubtitleLines(activeCue?: ActiveCueSnapshot): Set<string> {
  const activeLines = new Set<string>();

  const addString = (raw: string | undefined): void => {
    if (!raw) return;
    const full = normalizeForSubMatch(raw);
    if (full.length >= 2) {
      activeLines.add(full);
      const noDash = full.replace(/^[-–—•*]\s*/, '').trim();
      if (noDash.length >= 2) {
        activeLines.add(noDash);
      }
    }
    const lines = raw.split(/\r?\n|<br\s*\/?>/i);
    if (lines.length > 1) {
      for (const line of lines) {
        const norm = normalizeForSubMatch(line);
        if (norm.length >= 2) {
          activeLines.add(norm);
          const noDashLine = norm.replace(/^[-–—•*]\s*/, '').trim();
          if (noDashLine.length >= 2) {
            activeLines.add(noDashLine);
          }
        }
      }
    }
  };

  if (activeCue) {
    addString(activeCue.primaryText);
    addString(activeCue.secondaryText);
  }

  return activeLines;
}

function resolveSearchRoot(playerContainer: HTMLElement): HTMLElement {
  if (
    playerContainer.id === 'oframecdnplayer' ||
    playerContainer.id === 'cdnplayer' ||
    playerContainer.querySelector('pjsdiv')
  ) {
    return playerContainer;
  }
  if (typeof document !== 'undefined') {
    const oframe = document.querySelector<HTMLElement>('#oframecdnplayer, #cdnplayer');
    if (oframe) return oframe;
  }
  return playerContainer;
}

/**
 * Hides PlayerJS (`<pjsdiv>`) native subtitles with strict UI safety guards.
 * Uses an early return for already-matched containers and relies strictly on the
 * current `activeCue` snapshot (no fallback to `currentCues[0]` during cue pauses).
 */
export function syncPlayerJsSubtitles(
  playerContainer: HTMLElement,
  overlayEnabled: boolean,
  activeCue?: ActiveCueSnapshot
): void {
  if (!overlayEnabled) {
    restorePlayerJsNativeNodes();
    return;
  }

  if (typeof document === 'undefined') {
    return;
  }

  const searchRoot = resolveSearchRoot(playerContainer);
  const playerRect = searchRoot.getBoundingClientRect();
  if (playerRect.width === 0 || playerRect.height === 0) {
    return;
  }

  const activeLines = collectActiveSubtitleLines(activeCue);
  const cleanActiveLines: string[] = [];
  for (const line of activeLines) {
    const clean = stripPunctuationForSubMatch(line);
    if (clean.length >= 2) {
      cleanActiveLines.push(clean);
    }
  }
  const cleanActiveSet = new Set<string>(cleanActiveLines);

  const pjsNodes = searchRoot.querySelectorAll('pjsdiv');
  const matchedNodes = new Set<HTMLElement>();

  // Keep previously confirmed subtitle nodes hidden while overlay is enabled
  knownSubtitleContainers.forEach((el) => {
    if (!el.isConnected) {
      knownSubtitleContainers.delete(el);
    } else {
      matchedNodes.add(el);
    }
  });

  pjsNodes.forEach((node) => {
    const el = node as HTMLElement;
    if (matchedNodes.has(el)) return;

    // Guard 1: Must NOT contain video, iframe, canvas, button, input, svg, img, a
    if (el.querySelector('video, iframe, canvas, button, input, svg, img, a')) {
      return;
    }

    // Guard 2: Neither el nor any ancestor up to searchRoot/body can have
    // cursor: pointer (buttons/menu items) or overflow-y: auto / scroll (dropdown menus)
    const selfStyle =
      typeof window !== 'undefined' && typeof window.getComputedStyle === 'function'
        ? window.getComputedStyle(el)
        : el.style;
    if (selfStyle.cursor === 'pointer') {
      return;
    }

    let hasPointerEventsNone = selfStyle.pointerEvents === 'none';
    let curr: HTMLElement | null = el.parentElement;
    let isBlockedByAncestor = false;

    while (curr && curr !== searchRoot && curr !== document.body && curr !== document.documentElement) {
      const style =
        typeof window !== 'undefined' && typeof window.getComputedStyle === 'function'
          ? window.getComputedStyle(curr)
          : curr.style;
      if (
        style.cursor === 'pointer' ||
        style.overflowY === 'auto' ||
        style.overflowY === 'scroll' ||
        style.overflow === 'auto' ||
        style.overflow === 'scroll'
      ) {
        isBlockedByAncestor = true;
        break;
      }
      if (style.pointerEvents === 'none') {
        hasPointerEventsNone = true;
      }
      curr = curr.parentElement;
    }

    if (isBlockedByAncestor) {
      return;
    }

    // Guard 3: Bottom control bar and height checks
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      return;
    }

    if (rect.top >= playerRect.bottom - 46) {
      return;
    }

    if (rect.height >= playerRect.height * 0.4) {
      return;
    }

    // Condition 3: Normalized text analysis (using textContent only, NO innerHTML)
    const rawText = (el.textContent || '').trim();
    const normText = normalizeForSubMatch(rawText);
    if (normText.length < 2) {
      return;
    }

    const noDash = normText.replace(/^[-–—•*]\s*/, '').trim();
    const cleanNorm = stripPunctuationForSubMatch(normText);

    // 3a. Exact or split-cue containment match against active cue lines
    let isTextMatch =
      activeLines.has(normText) ||
      (noDash.length >= 2 && activeLines.has(noDash)) ||
      (cleanNorm.length >= 2 && cleanActiveSet.has(cleanNorm));

    if (!isTextMatch && cleanNorm.length >= 6 && cleanActiveLines.length > 0) {
      isTextMatch = cleanActiveLines.some(
        (active) =>
          active.length >= 6 &&
          (cleanNorm.includes(active) || active.includes(cleanNorm))
      );
    }

    if (isTextMatch) {
      matchedNodes.add(el);
      if (!el.querySelector('pjsdiv')) {
        knownSubtitleContainers.add(el);
      }
      return;
    }

    // 3b. Structural PlayerJS subtitle layer fallback (handles different track language)
    if (
      hasPointerEventsNone &&
      !PLAYER_UI_NOISE_RE.test(normText) &&
      /[a-zA-Z\u0400-\u04FF\u00C0-\u024F]{2,}/.test(normText)
    ) {
      const centerX = rect.left + rect.width / 2;
      const playerCenterX = playerRect.left + playerRect.width / 2;
      const isHorizontallyCentered = Math.abs(centerX - playerCenterX) <= playerRect.width * 0.22;
      const isInLowerHalf = rect.bottom >= playerRect.top + playerRect.height * 0.52;
      const isCenterAligned = selfStyle.textAlign === 'center' || isHorizontallyCentered;

      if (isCenterAligned && isInLowerHalf && !el.querySelector('pjsdiv')) {
        matchedNodes.add(el);
        knownSubtitleContainers.add(el);
      }
    }
  });

  // 1. Restore elements that no longer match
  hiddenNativeNodes.forEach((el) => {
    if (!matchedNodes.has(el)) {
      try {
        el.style.removeProperty('visibility');
        el.style.removeProperty('opacity');
      } catch {
        // disconnected
      }
      hiddenNativeNodes.delete(el);
    }
  });

  // 2. Hide matched elements
  matchedNodes.forEach((el) => {
    if (!hiddenNativeNodes.has(el)) {
      el.style.setProperty('visibility', 'hidden', 'important');
      el.style.setProperty('opacity', '0', 'important');
      hiddenNativeNodes.add(el);
    }
  });
}

function stopObserverForContainer(container: HTMLElement): void {
  const state = activeObservers.get(container);
  if (!state) return;
  if (state.rafId !== null && typeof window !== 'undefined') {
    window.cancelAnimationFrame(state.rafId);
  }
  state.observer.disconnect();
  activeObservers.delete(container);
}

function detectPlayerJsContainer(root?: ParentNode): HTMLElement | null {
  const searchRoot: ParentNode | null =
    root ?? (typeof document !== 'undefined' ? document : null);
  if (!searchRoot) return null;

  for (const selector of PLAYERJS_CONTAINER_SELECTORS) {
    const matches = Array.from(searchRoot.querySelectorAll<HTMLElement>(selector));
    const withVisibleVideo = matches.find((el) => {
      const v = el.querySelector<HTMLVideoElement>('video');
      return v ? isVideoVisible(v) : false;
    });
    if (withVisibleVideo) return withVisibleVideo;
    if (matches[0]) return matches[0];
  }

  const pjsNode = searchRoot.querySelector<HTMLElement>('pjsdiv');
  if (pjsNode && typeof pjsNode.closest === 'function') {
    const ancestor = pjsNode.closest<HTMLElement>('[id^="oframe"], #player-placeholder, #player, [data-player]');
    if (ancestor) return ancestor;
  }

  return null;
}

export const playerjsPlugin: PlayerPlugin = {
  id: 'playerjs',

  detectContainer(root?: ParentNode): HTMLElement | null {
    return detectPlayerJsContainer(root);
  },

  findVideo(container: HTMLElement | null, root?: ParentNode): HTMLVideoElement | null {
    const target = container ?? detectPlayerJsContainer(root);
    if (!target) return null;
    const direct = target.querySelector<HTMLVideoElement>('video');
    if (direct && direct.isConnected) return direct;
    return findBestVideo(target);
  },

  isControlsHidden(_container: HTMLElement): boolean {
    return false;
  },

  getSubtitleBottomOffset(_container: HTMLElement): number {
    return 48;
  },

  suppressNativeCaptions(
    container: HTMLElement,
    suppress: boolean,
    activeCue?: ActiveCueSnapshot
  ): () => void {
    playerJsSuppressor.setEnabled(suppress);

    if (!suppress) {
      stopObserverForContainer(container);
      restorePlayerJsNativeNodes();
      return () => {};
    }

    syncPlayerJsSubtitles(container, true, activeCue);

    const existing = activeObservers.get(container);
    if (existing) {
      existing.latestActiveCue = activeCue;
    } else if (typeof MutationObserver !== 'undefined') {
      const searchRoot = resolveSearchRoot(container);
      const state: SuppressionObserverState = {
        latestActiveCue: activeCue,
        rafId: null,
        observer: new MutationObserver(() => {
          if (state.rafId !== null || typeof window === 'undefined') return;
          state.rafId = window.requestAnimationFrame(() => {
            state.rafId = null;
            syncPlayerJsSubtitles(container, true, state.latestActiveCue);
          });
        })
      };
      state.observer.observe(searchRoot, {
        childList: true,
        subtree: true,
        characterData: true
      });
      activeObservers.set(container, state);
    }

    return () => {
      stopObserverForContainer(container);
      restorePlayerJsNativeNodes();
      playerJsSuppressor.setEnabled(false);
    };
  },

  initMainWorldProbe(ctx: PlayerMainWorldContext): () => void {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return () => {};
    }

    let disposed = false;
    let navGeneration = 0;
    let lastCdnSubtitle = '';
    let pollIntervalId: number | null = null;
    let mutationTimerId: number | null = null;
    const scannedScripts = new WeakSet<HTMLScriptElement>();
    const nativeFetch = getNativeFetch();

    const emitPlayerJsManifest = (playerJsString: string, resetPrevious: boolean): void => {
      if (disposed) return;
      const tracks = parsePlayerJsSubtitleString(playerJsString);
      if (tracks.length === 0) {
        if (resetPrevious) {
          ctx.emitTracks({ resetPrimaryCues: true, availableTracks: [] });
        }
        return;
      }

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
        nativeFetch(single.url)
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
                ctx.emitTracks({
                  primaryCues: cues,
                  resetPrimaryCues: resetPrevious,
                  primaryMeta: {
                    url: single.url,
                    label: single.label,
                    lang: detectedLang,
                    language: detectedLang,
                    source: 'playerjs',
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
                language: single.language || undefined,
                lang: single.language || undefined,
                source: 'playerjs',
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
                language: single.language || undefined,
                lang: single.language || undefined,
                source: 'playerjs',
                availableTracks
              },
              availableTracks
            });
          });
      } else {
        ctx.emitTracks({
          resetPrimaryCues: resetPrevious,
          primaryMeta: {
            source: 'playerjs',
            availableTracks
          },
          availableTracks
        });
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
      if (disposed) return;
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
                // Ignore JSON parse error
              }
            }

            if (foundSub && foundSub !== lastCdnSubtitle) {
              lastCdnSubtitle = foundSub;
              emitPlayerJsManifest(foundSub, false);
            }
          }
        }
      } catch {
        // Ignore inline script scan errors
      }
    };

    const unsubscribeNetwork = subscribeNetworkSubtitles((event) => {
      if (disposed) return;

      if (event.kind === 'cdn-series-json') {
        lastCdnSubtitle = event.playerJsString;
        emitPlayerJsManifest(event.playerJsString, true);
        return;
      }

      if (event.kind === 'subtitle-text') {
        const cues = parseSubtitles(event.rawText);
        if (cues.length === 0) return;
        const detectedLang = detectLanguageFromLabelAndCues(event.url, cues, 'en');
        ctx.emitTracks({
          primaryCues: cues,
          primaryMeta: {
            url: event.url,
            lang: detectedLang,
            language: detectedLang,
            source: event.source
          }
        });
      }
    });

    const handleSpaUrlChange = (): void => {
      if (disposed) return;
      navGeneration += 1;
      lastCdnSubtitle = '';
      checkCdnPlayerInfo();
      scanInlineScripts();
    };
    const unsubscribeSpa = subscribeSpaNavigation(handleSpaUrlChange);

    const handlePlay = (e: Event): void => {
      if (e.target instanceof HTMLVideoElement) {
        checkCdnPlayerInfo();
      }
    };
    document.addEventListener('play', handlePlay, true);

    const observer = new MutationObserver(() => {
      if (disposed) return;
      if (mutationTimerId !== null) return;
      mutationTimerId = window.setTimeout(() => {
        mutationTimerId = null;
        if (!disposed) {
          scanInlineScripts();
          checkCdnPlayerInfo();
        }
      }, 250);
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });

    let attempts = 0;
    pollIntervalId = window.setInterval(() => {
      attempts += 1;
      if (!disposed) {
        scanInlineScripts();
        checkCdnPlayerInfo();
      }
      if (attempts >= 30) {
        if (pollIntervalId !== null) {
          window.clearInterval(pollIntervalId);
          pollIntervalId = null;
        }
      }
    }, 1000);

    scanInlineScripts();
    checkCdnPlayerInfo();

    return () => {
      disposed = true;
      unsubscribeNetwork();
      unsubscribeSpa();
      document.removeEventListener('play', handlePlay, true);
      observer.disconnect();
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
};
