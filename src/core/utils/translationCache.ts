const INVALID_TRANSLATION_PATTERNS: readonly RegExp[] = [
  /^\s*ошибка перевода/i,
  /MYMEMORY WARNING/i,
  /QUOTA EXCEEDED/i,
  /YOU USED ALL AVAILABLE FREE TRANSLATIONS/i,
  /QUERY LENGTH LIMIT EXCEEDED/i,
  /PLEASE SELECT TWO DISTINCT LANGUAGES/i,
  /INVALID LANGUAGE PAIR/i,
  /TOO MANY REQUESTS/i,
  /<!doctype html/i,
  /<html\b/i
];

const QUOTA_LIMIT_PATTERNS: readonly RegExp[] = [
  /MYMEMORY WARNING/i,
  /QUOTA EXCEEDED/i,
  /YOU USED ALL AVAILABLE FREE TRANSLATIONS/i,
  /TOO MANY REQUESTS/i
];

/**
 * Checks whether a translated string represents a valid translation rather than
 * an empty string, HTML error page, or provider error/warning message.
 */
export function isValidTranslationText(text: unknown): text is string {
  if (typeof text !== 'string') return false;
  const trimmed = text.trim();
  if (!trimmed) return false;
  return !INVALID_TRANSLATION_PATTERNS.some((pattern) => pattern.test(trimmed));
}

/**
 * Detects quota / rate-limit error text returned by free translation APIs.
 */
export function isQuotaOrRateLimitMessage(text: unknown): boolean {
  if (typeof text !== 'string' || !text.trim()) return false;
  return QUOTA_LIMIT_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Normalizes cue text so whitespace / line-break variations still map to the same cache key.
 */
export function normalizeSubtitleForHash(text: string): string {
  return text.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Sanitizes text before joining into a batch delimiter request.
 */
export function sanitizeTextForBatch(raw: string): string {
  return normalizeSubtitleForHash(raw).replace(/\|\|\|/g, '|').trim();
}

/**
 * Computes a fast deterministic 64-bit hash + length token for a normalized subtitle cue.
 */
export function computeSourceTextHash(text: string): string {
  const norm = normalizeSubtitleForHash(text);
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < norm.length; i++) {
    const code = norm.charCodeAt(i);
    h1 ^= code;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= code + i;
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  return `${(h1 >>> 0).toString(36)}_${(h2 >>> 0).toString(36)}_${norm.length}`;
}

const utf8Encoder = new TextEncoder();

/**
 * Returns exact UTF-8 byte length of a string (used to stay strictly under MyMemory's 450-byte limit).
 */
export function utf8ByteLength(text: string): number {
  return utf8Encoder.encode(text).length;
}
