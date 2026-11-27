import type { MediaIdentity } from '@langai/contracts';

export const URPLAY_HOST_MATCHES = [
  '*://*.urplay.se/*',
  '*://urplay.se/*',
  '*://*.ur.se/*',
  '*://ur.se/*'
] as const;

const URPLAY_TITLE_SELECTORS = [
  '.c-hero-content__title',
  '.c-program-info__title',
  'h1[class*="title"]',
  '.jw-title'
] as const;

const URPLAY_TITLE_SUFFIX_RE =
  /\s*[|\-–—]\s*UR(?:\s*Play|\.se)?(?:\s*[|\-–—].*)?$/i;

/**
 * Normalizes a hostname by trimming whitespace, lowercasing, and removing trailing dots.
 */
function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/\.+$/, '');
}

/**
 * Returns true if the given hostname belongs to UR Play (`urplay.se` or `ur.se`).
 */
export function isUrPlayHost(hostname: string): boolean {
  const clean = normalizeHostname(hostname);
  if (!clean) return false;
  return (
    clean === 'urplay.se' ||
    clean.endsWith('.urplay.se') ||
    clean === 'ur.se' ||
    clean.endsWith('.ur.se')
  );
}

/**
 * Extracts the numeric program/series ID from a UR Play pathname if present.
 */
export function getUrPlayProgramId(pathname: string): string {
  const match = pathname.match(/\/(?:serie|program)\/(\d+)/);
  return match?.[1] ?? '';
}

/**
 * Resolves a stable video/program identifier from a UR Play URL.
 */
export function resolveUrPlayVideoId(url: URL): string {
  const programId = getUrPlayProgramId(url.pathname);
  if (programId) {
    return `urplay-${programId}`;
  }
  return `${normalizeHostname(url.hostname)}${url.pathname}`;
}

/**
 * Strips UR Play site suffixes (e.g. ` | UR Play`, ` - UR Play`, ` | UR`) from a title.
 */
export function cleanUrPlayTitle(rawTitle: string): string {
  if (!rawTitle) return '';
  return rawTitle.replace(URPLAY_TITLE_SUFFIX_RE, '').trim();
}

/**
 * Extracts the best available media title from the UR Play DOM or document title.
 */
export function extractUrPlayTitle(doc: Document): string {
  if (typeof doc.querySelector === 'function') {
    for (const selector of URPLAY_TITLE_SELECTORS) {
      const el = doc.querySelector(selector);
      const text = el?.textContent?.trim();
      if (text) {
        const cleaned = cleanUrPlayTitle(text);
        if (cleaned) return cleaned;
      }
    }
  }

  return cleanUrPlayTitle(doc.title ?? '');
}

/**
 * Resolves canonical `MediaIdentity` metadata for a UR Play page.
 */
export function resolveUrPlayMediaIdentity(url: URL, doc: Document): MediaIdentity | null {
  if (!isUrPlayHost(url.hostname)) {
    return null;
  }

  const title = extractUrPlayTitle(doc) || 'UR Play';
  const canonicalUrl = url.href.split('#')[0] || url.href;

  return {
    mediaId: resolveUrPlayVideoId(url),
    serviceId: 'urplay',
    badgeLabel: 'UR Play',
    title,
    canonicalUrl
  };
}
