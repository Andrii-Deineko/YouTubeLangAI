import { cleanSubtitleText } from '../../core/engine/subtitleParser';
import type { SubtitleCue } from '../../core/types/subtitles';

const hiddenNativeNodes = new Set<HTMLElement>();

/**
 * Restores visibility on all native PlayerJS elements previously hidden.
 */
export function restoreNativeNodes(): void {
  hiddenNativeNodes.forEach((el) => {
    try {
      el.style.removeProperty('visibility');
      el.style.removeProperty('opacity');
    } catch {
      // Element might be disconnected
    }
  });
  hiddenNativeNodes.clear();
}

/**
 * Normalizes subtitle cue text for strict equality comparison:
 * Lowercases, strips tags, collapses multiple whitespaces/newlines and trims.
 */
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
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"'«»[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const SUPPRESSION_STYLE_ID = 'cinelingua-html5-captions-suppression';
const SUPPRESSION_CSS = `
.jw-captions,
.jw-captions-window,
.plyr__captions,
.art-subtitle,
.vjs-text-track-display,
video::cue {
  opacity: 0 !important;
  visibility: hidden !important;
  pointer-events: none !important;
}
`;

/**
 * Injects or removes exact CSS suppression style for standard HTML5 players into document.head.
 */
export function setHtml5CaptionsSuppression(enabled: boolean): void {
  if (typeof document === 'undefined') return;

  const existing = document.getElementById(SUPPRESSION_STYLE_ID);
  if (enabled) {
    if (!existing) {
      const styleEl = document.createElement('style');
      styleEl.id = SUPPRESSION_STYLE_ID;
      styleEl.textContent = SUPPRESSION_CSS;
      (document.head || document.documentElement).appendChild(styleEl);
    }
  } else if (existing) {
    existing.remove();
  }
}

/**
 * Collects normalized texts of active cues at currentTime or from provided cues.
 */
function collectActiveSubtitleLines(
  currentCue?: SubtitleCue | null,
  secondaryCue?: SubtitleCue | null
): Set<string> {
  const activeLines = new Set<string>();

  const addString = (raw: string | undefined | null) => {
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

  if (currentCue) {
    addString(currentCue.text);
    addString(currentCue.translation);
  }
  if (secondaryCue) {
    addString(secondaryCue.text);
    addString(secondaryCue.translation);
  }

  return activeLines;
}

/**
 * Hides PlayerJS (<pjsdiv>) native subtitles on HDRezka with strict safeguards.
 * Hides ONLY when ALL conditions are simultaneously met:
 * 1. overlayEnabled === true and activeLines.size > 0.
 * 2. Safety Guards:
 *    - Does NOT contain video, iframe, canvas, button, input, svg, img, a.
 *    - Neither el nor any ancestor has cursor: pointer or overflow-y: auto / scroll.
 *    - Element is NOT in bottom control bar.
 * 3. Exact Text Match on normalized text (never uses .innerHTML).
 */
export function syncPlayerJsSubtitles(
  playerContainer: HTMLElement,
  currentCue: SubtitleCue | null,
  secondaryCue: SubtitleCue | null,
  overlayEnabled: boolean
): void {
  if (!overlayEnabled) {
    restoreNativeNodes();
    return;
  }

  if (typeof document === 'undefined') {
    return;
  }

  const activeLines = collectActiveSubtitleLines(currentCue, secondaryCue);

  const oframe = (document.querySelector('#oframecdnplayer') ||
    document.querySelector('#cdnplayer')) as HTMLElement | null;
  const searchRoot = oframe || playerContainer;
  const playerRect = searchRoot.getBoundingClientRect();
  if (playerRect.width === 0 || playerRect.height === 0) {
    return;
  }

  if (activeLines.size === 0) {
    restoreNativeNodes();
    return;
  }

  const cleanActiveLines = new Set<string>();
  for (const line of activeLines) {
    const clean = stripPunctuationForSubMatch(line);
    if (clean.length >= 2) {
      cleanActiveLines.add(clean);
    }
  }

  const pjsNodes = searchRoot.querySelectorAll('pjsdiv');
  const matchedNodes = new Set<HTMLElement>();

  pjsNodes.forEach((node) => {
    const el = node as HTMLElement;

    // Guard 1: Must NOT contain video, iframe, canvas, button, input, svg, img, a
    if (el.querySelector('video, iframe, canvas, button, input, svg, img, a')) {
      return;
    }

    // Guard 2: Neither el nor any ancestor up to searchRoot/body can have
    // cursor: pointer (buttons/menu items) or overflow-y: auto / scroll (dropdown menus)
    const selfStyle = window.getComputedStyle ? window.getComputedStyle(el) : (el.style as CSSStyleDeclaration);
    if (selfStyle.cursor === 'pointer') {
      return;
    }

    let curr: HTMLElement | null = el.parentElement;
    let isBlockedByAncestor = false;

    while (curr && curr !== searchRoot && curr !== document.body && curr !== document.documentElement) {
      const style = window.getComputedStyle ? window.getComputedStyle(curr) : (curr.style as CSSStyleDeclaration);
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

    // Condition 3: Exact match on normalized text (using textContent only, NO innerHTML)
    const rawText = el.textContent || '';
    const normText = normalizeForSubMatch(rawText);
    if (normText.length < 2) {
      return;
    }

    const noDash = normText.replace(/^[-–—•*]\s*/, '').trim();
    const cleanNorm = stripPunctuationForSubMatch(normText);

    const isMatch =
      activeLines.has(normText) ||
      (noDash.length >= 2 && activeLines.has(noDash)) ||
      (cleanNorm.length >= 2 && cleanActiveLines.has(cleanNorm));

    if (!isMatch) {
      return;
    }

    matchedNodes.add(el);
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
