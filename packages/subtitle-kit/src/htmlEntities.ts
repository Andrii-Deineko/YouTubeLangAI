const HTML_ENTITY_MAP: Readonly<Record<string, string>> = {
  '&amp;': '&',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&lt;': '<',
  '&gt;': '>',
  '&nbsp;': ' '
};

/**
 * Decodes common named, decimal, and hexadecimal HTML entities without DOM dependencies.
 */
export function decodeHtmlEntities(str: string): string {
  if (!str) return '';
  let decoded = str;
  for (const [entity, replacement] of Object.entries(HTML_ENTITY_MAP)) {
    decoded = decoded.replaceAll(entity, replacement);
  }
  decoded = decoded.replace(/&#(\d+);/g, (_, dec: string) => {
    const code = Number.parseInt(dec, 10);
    return Number.isFinite(code) && code >= 0 && code <= 0x10ffff
      ? String.fromCodePoint(code)
      : '';
  });
  decoded = decoded.replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => {
    const code = Number.parseInt(hex, 16);
    return Number.isFinite(code) && code >= 0 && code <= 0x10ffff
      ? String.fromCodePoint(code)
      : '';
  });
  return decoded;
}

/**
 * Strips markup tags, ASS/SSA formatting blocks, decodes HTML entities,
 * and collapses whitespace into clean single-line subtitle text.
 */
export function cleanSubtitleText(raw: string): string {
  if (!raw) return '';
  let cleaned = raw;
  cleaned = cleaned.replace(/<br\s*\/?>/gi, ' ');
  cleaned = cleaned.replace(/\{[^}]+\}/g, '');
  cleaned = cleaned.replace(/<[^>]+>/g, '');
  cleaned = decodeHtmlEntities(cleaned);
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  return cleaned;
}

/**
 * Unescapes JSON/JS-escaped slashes, quotes, and `\uXXXX` sequences.
 */
export function unescapeString(raw: string): string {
  if (!raw) return '';
  const str = raw.replace(/\\\//g, '/').replace(/\\"/g, '"');
  return str.replace(/\\u([0-9a-fA-F]{4})/g, (match, hex: string) => {
    const code = Number.parseInt(hex, 16);
    return Number.isFinite(code) ? String.fromCharCode(code) : match;
  });
}
