import type { AvailableTrackOption, SubtitleCue } from '@langai/contracts';
import {
  detectLanguageFromLabel,
  detectLanguageFromLabelAndCues,
  extractLangCodeFromUrl,
  parseSubtitles,
  parseVtt,
  unescapeString
} from '@langai/subtitle-kit';

export interface CandidateUrPlayTrack {
  url: string;
  label?: string;
  language?: string;
  kind?: string;
}

const BINARY_OR_ASSET_EXT_RE =
  /\.(m3u8|mpd|mp4|m4s|ts|aac|mp3|webm|jpg|jpeg|png|webp|svg|woff2?)(\?|$)/i;

const ACCESSIBILITY_KEYWORDS = [
  'syntolk',
  'teckenspr',
  'audio description',
  'descriptions'
] as const;

const SWEDISH_HINT_RE = /\b(sv|swe|sve)(?:[-_][a-z0-9]+)?\b/i;

/**
 * Returns true if a track represents an accessibility description or sign-language track
 * (such as `syntolk` / `syntolkning` or `teckenspr` / `teckenspråk`).
 */
export function isAccessibilityTrack(track: {
  url?: string;
  label?: string;
  language?: string;
  kind?: string;
}): boolean {
  const combined =
    `${track.label ?? ''} ${track.language ?? ''} ${track.kind ?? ''} ${track.url ?? ''}`.toLowerCase();
  return ACCESSIBILITY_KEYWORDS.some((keyword) => combined.includes(keyword));
}

/**
 * Returns true if a URL looks like a UR Play subtitle/caption resource rather than media/assets.
 */
export function isUrPlayCaptionUrl(rawUrl: string): boolean {
  if (!rawUrl) return false;
  const lowerUrl = rawUrl.toLowerCase();
  if (BINARY_OR_ASSET_EXT_RE.test(lowerUrl)) {
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
 * Returns true if raw response text contains WebVTT/SRT cue markers.
 */
export function isValidSubtitleBody(rawText: string): boolean {
  if (!rawText) return false;
  const clean = rawText.replace(/^\uFEFF/, '').trimStart();
  return clean.includes('-->') || clean.startsWith('WEBVTT');
}

/**
 * Parses UR Play subtitle text using `@langai/subtitle-kit` (`parseVtt` / `parseSubtitles`).
 */
export function parseUrPlaySubtitleText(rawText: string): SubtitleCue[] {
  const clean = rawText.replace(/^\uFEFF/, '').trimStart();
  if (!clean) return [];
  if (/^WEBVTT/i.test(clean)) {
    const vttCues = parseVtt(clean);
    if (vttCues.length > 0) return vttCues;
  }
  return parseSubtitles(clean);
}

/**
 * Detects a normalized language code for a UR Play track, defaulting to Swedish (`'sv'`).
 */
export function detectUrPlayTrackLanguage(
  track: { label?: string; language?: string; url?: string },
  cues?: SubtitleCue[]
): string {
  const explicit = track.language ? detectLanguageFromLabel(track.language) : '';
  if (explicit && explicit !== 'auto' && explicit !== 'und') {
    return explicit;
  }

  const fromLabel = track.label ? detectLanguageFromLabel(track.label) : '';
  if (fromLabel && fromLabel !== 'auto' && fromLabel !== 'und') {
    return fromLabel;
  }

  const fromUrl = track.url ? extractLangCodeFromUrl(track.url) : '';
  if (fromUrl && fromUrl !== 'auto' && fromUrl !== 'und') {
    return fromUrl;
  }

  if (cues && cues.length > 0) {
    return detectLanguageFromLabelAndCues(
      `${track.label ?? ''} ${track.url ?? ''}`.trim(),
      cues,
      'sv'
    );
  }

  return 'sv';
}

function isValidCandidateTrack(track: CandidateUrPlayTrack): boolean {
  if (!track.url || typeof track.url !== 'string') return false;
  const lbl = (track.label ?? '').trim().toLowerCase();
  if (lbl === 'off' || lbl === 'av' || lbl === 'none') return false;
  if (track.kind) {
    const lowerKind = track.kind.toLowerCase();
    if (
      !['captions', 'subtitles', 'text', ''].includes(lowerKind) &&
      (lowerKind === 'thumbnails' || lowerKind === 'chapters')
    ) {
      return false;
    }
  }
  const lowerUrl = track.url.toLowerCase();
  return (
    lowerUrl.includes('.vtt') ||
    lowerUrl.includes('.srt') ||
    lowerUrl.includes('undertexter') ||
    lowerUrl.includes('subtitles')
  );
}

/**
 * Filters candidate tracks to valid non-accessibility subtitle tracks,
 * excluding `syntolk` / `teckenspr` / audio-description tracks.
 */
export function filterStandardUrPlayTracks(
  tracks: readonly CandidateUrPlayTrack[]
): CandidateUrPlayTrack[] {
  const seen = new Set<string>();
  const out: CandidateUrPlayTrack[] = [];

  for (const track of tracks) {
    if (!isValidCandidateTrack(track)) continue;
    if (isAccessibilityTrack(track)) continue;
    const trimmedUrl = track.url.trim();
    if (!trimmedUrl || seen.has(trimmedUrl)) continue;
    seen.add(trimmedUrl);
    out.push({ ...track, url: trimmedUrl });
  }

  return out;
}

/**
 * Selects the best standard subtitle track for UR Play, preferring Swedish (`sv`).
 * Filters out `syntolk` and `teckenspr` accessibility tracks.
 */
export function pickBestUrPlayTrack(
  tracks: readonly CandidateUrPlayTrack[]
): CandidateUrPlayTrack | null {
  const standardTracks = filterStandardUrPlayTracks(tracks);
  if (standardTracks.length === 0) return null;

  const swedishTrack = standardTracks.find((track) => {
    const hint = `${track.label ?? ''} ${track.language ?? ''}`.trim().toLowerCase();
    return hint.includes('svensk') || SWEDISH_HINT_RE.test(hint);
  });

  return swedishTrack ?? standardTracks[0] ?? null;
}

/**
 * Converts candidate UR Play tracks into `AvailableTrackOption[]`,
 * filtering out `syntolk` / `teckenspr` tracks when standard tracks are present.
 */
export function toUrPlayAvailableTrackOptions(
  tracks: readonly CandidateUrPlayTrack[],
  activeUrl?: string | null
): AvailableTrackOption[] {
  const standard = filterStandardUrPlayTracks(tracks);
  return standard.map((track) => {
    const lang = detectUrPlayTrackLanguage(track);
    return {
      label: track.label || track.language || 'Svenska',
      language: lang || 'sv',
      url: track.url,
      ...(activeUrl ? { active: track.url === activeUrl } : {})
    };
  });
}

/**
 * Filters an existing `AvailableTrackOption[]` list to exclude accessibility tracks
 * when standard tracks are available.
 */
export function filterAvailableTrackOptions(
  tracks: readonly AvailableTrackOption[] | undefined
): AvailableTrackOption[] | undefined {
  if (!tracks) return undefined;
  if (tracks.length === 0) return [];
  const standard = tracks.filter((t) => !isAccessibilityTrack(t));
  return standard.length > 0 ? standard : [];
}

function collectMatchingProgramSubtrees(
  node: unknown,
  programId: string,
  out: unknown[],
  depth = 0
): void {
  if (!node || typeof node !== 'object' || depth > 14) return;
  if (Array.isArray(node)) {
    for (const item of node) {
      collectMatchingProgramSubtrees(item, programId, out, depth + 1);
    }
    return;
  }

  const obj = node as Record<string, unknown>;
  if (String(obj.id ?? '') === programId) {
    out.push(obj);
  }
  for (const val of Object.values(obj)) {
    if (val && typeof val === 'object') {
      collectMatchingProgramSubtrees(val, programId, out, depth + 1);
    }
  }
}

function isNextDataCaptionUrl(val: string): boolean {
  const lower = val.toLowerCase();
  return (
    lower.includes('.vtt') ||
    lower.includes('.srt') ||
    lower.includes('undertexter.ur.se')
  );
}

function collectTracksFromJsonData(
  node: unknown,
  out: CandidateUrPlayTrack[],
  depth = 0
): void {
  if (!node || typeof node !== 'object' || depth > 14) return;
  if (Array.isArray(node)) {
    for (const item of node) {
      collectTracksFromJsonData(item, out, depth + 1);
    }
    return;
  }

  const obj = node as Record<string, unknown>;
  const fileCandidate =
    (typeof obj.file === 'string' && obj.file) ||
    (typeof obj.subtitleUrl === 'string' && obj.subtitleUrl) ||
    (typeof obj.vttUrl === 'string' && obj.vttUrl) ||
    (typeof obj.url === 'string' && obj.url) ||
    (typeof obj.src === 'string' && obj.src) ||
    '';

  const seenInObj = new Set<string>();

  if (fileCandidate && isNextDataCaptionUrl(fileCandidate)) {
    const cleaned = unescapeString(fileCandidate);
    seenInObj.add(cleaned);
    out.push({
      url: cleaned,
      label:
        typeof obj.label === 'string'
          ? obj.label
          : typeof obj.title === 'string'
            ? obj.title
            : typeof obj.language === 'string'
              ? obj.language
              : undefined,
      language:
        typeof obj.language === 'string'
          ? obj.language
          : typeof obj.srclang === 'string'
            ? obj.srclang
            : typeof obj.lang === 'string'
              ? obj.lang
              : undefined,
      kind:
        typeof obj.kind === 'string'
          ? obj.kind
          : typeof obj.type === 'string'
            ? obj.type
            : undefined
    });
  }

  for (const [key, val] of Object.entries(obj)) {
    if (typeof val === 'string' && isNextDataCaptionUrl(val)) {
      const cleaned = unescapeString(val);
      if (!seenInObj.has(cleaned) && /^https?:\/\/|^\//i.test(cleaned)) {
        seenInObj.add(cleaned);
        out.push({
          url: cleaned,
          label: key,
          language: /^[a-z]{2,3}(?:[-_][a-z0-9]+)?$/i.test(key) ? key : undefined
        });
      }
    } else if (val && typeof val === 'object') {
      collectTracksFromJsonData(val, out, depth + 1);
    }
  }
}

/**
 * Extracts subtitle track candidates from a UR Play Next.js `__NEXT_DATA__` or `/_next/data/*.json` payload,
 * scoping to `programId` subtrees when available.
 */
export function extractTracksFromNextData(
  data: unknown,
  programId?: string
): CandidateUrPlayTrack[] {
  if (programId) {
    const matchedNodes: unknown[] = [];
    collectMatchingProgramSubtrees(data, programId, matchedNodes);
    const scopedCandidates: CandidateUrPlayTrack[] = [];
    for (const subtree of matchedNodes) {
      collectTracksFromJsonData(subtree, scopedCandidates);
    }
    if (scopedCandidates.length > 0) {
      return scopedCandidates;
    }
  }

  const allCandidates: CandidateUrPlayTrack[] = [];
  collectTracksFromJsonData(data, allCandidates);
  return allCandidates;
}
