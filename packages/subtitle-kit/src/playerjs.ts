import { unescapeString } from './htmlEntities';
import { detectLanguageFromLabel, extractLangCodeFromUrl } from './languages';

export interface PlayerJsTrackInfo {
  label: string;
  language: string;
  url: string;
}

function isSupportedSubtitleUrl(url: string): boolean {
  return /^https?:\/\//i.test(url) || url.startsWith('/');
}

function resolveSubtitleUrl(rawUrl: string, baseUrl?: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) return '';
  if (baseUrl) {
    try {
      return new URL(trimmed, baseUrl).href;
    } catch {
      return trimmed;
    }
  }
  return trimmed;
}

/**
 * Converts a PlayerJS `subtitle_lns` object or JSON string into `[Label]URL,...` format.
 */
export function convertSubtitleLnsToPlayerJs(subtitleLns: unknown): string {
  if (!subtitleLns) return '';
  let obj: Record<string, unknown> | null = null;

  if (typeof subtitleLns === 'string') {
    const unescaped = unescapeString(subtitleLns);
    try {
      obj = JSON.parse(unescaped) as Record<string, unknown>;
    } catch {
      const entries: string[] = [];
      const regex = /["']([^"']+)["']\s*:\s*["']((?:https?:\/\/|\/)[^"']+)["']/g;
      let match: RegExpExecArray | null = regex.exec(unescaped);
      while (match !== null) {
        entries.push(`[${match[1]}]${match[2]}`);
        match = regex.exec(unescaped);
      }
      return entries.join(',');
    }
  } else if (typeof subtitleLns === 'object' && subtitleLns !== null) {
    obj = subtitleLns as Record<string, unknown>;
  }

  if (obj) {
    const entries: string[] = [];
    for (const [key, val] of Object.entries(obj)) {
      if (typeof val === 'string' && val.trim()) {
        const cleanKey = unescapeString(key).trim();
        const cleanVal = unescapeString(val).trim();
        if (isSupportedSubtitleUrl(cleanVal)) {
          entries.push(`[${cleanKey}]${cleanVal}`);
        }
      }
    }
    return entries.join(',');
  }

  return '';
}

/**
 * Parses PlayerJS subtitle strings (`[English]/subs/en.vtt,[Swedish]https://...`,
 * JSON `subtitle_lns` maps, or bare subtitle URLs) and resolves relative paths
 * starting with `/` against `baseUrl` when provided.
 */
export function parsePlayerJsSubtitleString(
  raw: string,
  baseUrl?: string
): PlayerJsTrackInfo[] {
  const tracks: PlayerJsTrackInfo[] = [];
  if (!raw) return tracks;

  const cleanInput = unescapeString(raw).trim();
  if (!cleanInput) return tracks;

  if (cleanInput.startsWith('{') && cleanInput.endsWith('}')) {
    const converted = convertSubtitleLnsToPlayerJs(cleanInput);
    if (converted) {
      return parsePlayerJsSubtitleString(converted, baseUrl);
    }
  }

  const regex = /\[([^\]]+)\]((?:https?:\/\/|\/)[^\s,]+)/g;
  const seenUrls = new Set<string>();
  let match: RegExpExecArray | null = regex.exec(cleanInput);

  while (match !== null) {
    const label = match[1].trim();
    const rawUrl = match[2].trim();
    const resolvedUrl = resolveSubtitleUrl(rawUrl, baseUrl);

    if (resolvedUrl && !seenUrls.has(resolvedUrl)) {
      seenUrls.add(resolvedUrl);
      tracks.push({
        label,
        language:
          detectLanguageFromLabel(label) ||
          detectLanguageFromLabel(rawUrl) ||
          extractLangCodeFromUrl(resolvedUrl) ||
          '',
        url: resolvedUrl
      });
    }
    match = regex.exec(cleanInput);
  }

  if (tracks.length === 0 && isSupportedSubtitleUrl(cleanInput)) {
    const resolvedUrl = resolveSubtitleUrl(cleanInput, baseUrl);
    tracks.push({
      label: 'Subtitles',
      language:
        detectLanguageFromLabel(cleanInput) ||
        extractLangCodeFromUrl(resolvedUrl) ||
        '',
      url: resolvedUrl
    });
  }

  return tracks;
}
