import type { SubtitleCue, WordToken } from '../types/subtitles';

const WORD_REGEX = /([\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*)/gu;

const normalizedWordCache = new Map<string, string>();

export function normalizeWord(word: string): string {
  const cached = normalizedWordCache.get(word);
  if (cached !== undefined) return cached;
  const result = word
    .trim()
    .toLowerCase()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
  if (normalizedWordCache.size < 5000) {
    normalizedWordCache.set(word, result);
  }
  return result;
}

export function tokenizeCueText(
  cueId: string,
  text: string,
  cueStartSec: number,
  cueEndSec: number
): WordToken[] {
  const tokens: WordToken[] = [];
  const totalLen = Math.max(text.length, 1);
  const duration = Math.max(cueEndSec - cueStartSec, 0.1);

  let lastIndex = 0;
  let tokenIdx = 0;
  const regex = new RegExp(WORD_REGEX.source, WORD_REGEX.flags);

  let match: RegExpExecArray | null = regex.exec(text);
  while (match !== null) {
    if (match.index > lastIndex) {
      const nonWordText = text.slice(lastIndex, match.index);
      const fracStart = lastIndex / totalLen;
      const fracEnd = match.index / totalLen;
      tokens.push({
        id: `${cueId}-t${tokenIdx++}`,
        text: nonWordText,
        isWord: false,
        startTime: cueStartSec + fracStart * duration,
        endTime: cueStartSec + fracEnd * duration,
        normalized: ''
      });
    }

    const wordText = match[0];
    const wordStartIdx = match.index;
    const wordEndIdx = wordStartIdx + wordText.length;

    const startSec = cueStartSec + (wordStartIdx / totalLen) * duration;
    const endSec = cueStartSec + (wordEndIdx / totalLen) * duration;

    tokens.push({
      id: `${cueId}-t${tokenIdx++}`,
      text: wordText,
      isWord: true,
      startTime: startSec,
      endTime: endSec,
      normalized: normalizeWord(wordText)
    });

    lastIndex = wordEndIdx;
    match = regex.exec(text);
  }

  if (lastIndex < text.length) {
    const trailingText = text.slice(lastIndex);
    const fracStart = lastIndex / totalLen;
    tokens.push({
      id: `${cueId}-t${tokenIdx++}`,
      text: trailingText,
      isWord: false,
      startTime: cueStartSec + fracStart * duration,
      endTime: cueEndSec,
      normalized: ''
    });
  }

  return tokens;
}

const HTML_ENTITY_MAP: Record<string, string> = {
  '&amp;': '&',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&lt;': '<',
  '&gt;': '>',
  '&nbsp;': ' '
};

export function decodeHtmlEntities(str: string): string {
  let decoded = str;
  for (const [entity, replacement] of Object.entries(HTML_ENTITY_MAP)) {
    decoded = decoded.replaceAll(entity, replacement);
  }
  decoded = decoded.replace(/&#(\d+);/g, (_, dec: string) => {
    const code = Number.parseInt(dec, 10);
    return Number.isFinite(code) ? String.fromCharCode(code) : '';
  });
  decoded = decoded.replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => {
    const code = Number.parseInt(hex, 16);
    return Number.isFinite(code) ? String.fromCharCode(code) : '';
  });
  return decoded;
}

export function cleanSubtitleText(raw: string): string {
  if (!raw) return '';
  let cleaned = raw;
  cleaned = cleaned.replace(/<br\s*\/?>/gi, ' ');
  cleaned = cleaned.replace(/\{[^}]+\}/g, '');
  cleaned = cleaned.replace(/<[^>]+>/g, '');
  cleaned = decodeHtmlEntities(cleaned);
  cleaned = cleaned.replace(/[ \t]+/g, ' ').trim();
  return cleaned;
}

export function parseTimestampToSeconds(timestamp: string): number {
  const trimmed = timestamp.trim();
  const match = trimmed.match(/(?:(\d{1,2}):)?(\d{2}):(\d{2})[.,](\d{1,3})/);
  if (!match) return 0;

  const hours = match[1] ? Number.parseInt(match[1], 10) : 0;
  const minutes = Number.parseInt(match[2], 10);
  const seconds = Number.parseInt(match[3], 10);
  const millisStr = match[4].padEnd(3, '0').slice(0, 3);
  const millis = Number.parseInt(millisStr, 10);

  return hours * 3600 + minutes * 60 + seconds + millis / 1000;
}

export function parseVtt(content: string): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

  let i = 0;
  while (i < lines.length && !lines[i].includes('-->')) {
    i++;
  }

  while (i < lines.length) {
    const line = lines[i].trim();

    if (line.includes('-->')) {
      const parts = line.split('-->');
      const startStr = parts[0].trim();
      const endPart = parts[1].trim().split(/\s+/)[0];

      const startTime = parseTimestampToSeconds(startStr);
      const endTime = parseTimestampToSeconds(endPart);

      i++;
      const textLines: string[] = [];
      while (i < lines.length && lines[i].trim() !== '') {
        if (lines[i].includes('-->')) {
          i--;
          break;
        }
        textLines.push(lines[i]);
        i++;
      }

      const text = cleanSubtitleText(textLines.join('\n'));
      if (text && endTime > startTime) {
        const id = `cue_${cues.length}_${startTime.toFixed(2)}`;
        cues.push({
          id,
          index: cues.length,
          startTime,
          endTime,
          text,
          tokens: tokenizeCueText(id, text, startTime, endTime)
        });
      }
    }
    i++;
  }

  return splitLongCues(cues);
}

export function parseSrt(content: string): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const blocks = normalized.split(/\n\s*\n/);

  for (let b = 0; b < blocks.length; b++) {
    const block = blocks[b].trim();
    if (!block) continue;

    const lines = block.split('\n');
    let timeLineIdx = -1;

    for (let l = 0; l < lines.length; l++) {
      if (lines[l].includes('-->')) {
        timeLineIdx = l;
        break;
      }
    }

    if (timeLineIdx === -1) continue;

    const timeLine = lines[timeLineIdx];
    const parts = timeLine.split('-->');
    if (parts.length !== 2) continue;

    const startTime = parseTimestampToSeconds(parts[0]);
    const endTime = parseTimestampToSeconds(parts[1]);

    const textLines = lines.slice(timeLineIdx + 1);
    const text = cleanSubtitleText(textLines.join('\n'));

    if (text && endTime > startTime) {
      const id = `cue_${cues.length}_${startTime.toFixed(2)}`;
      cues.push({
        id,
        index: cues.length,
        startTime,
        endTime,
        text,
        tokens: tokenizeCueText(id, text, startTime, endTime)
      });
    }
  }

  return splitLongCues(cues);
}

/**
 * Splits overly long subtitle text (> maxLen characters) into balanced, natural segments
 * at sentence ends, punctuation marks, conjunctions, or word boundaries.
 */
export function splitTextIntoBalancedSegments(text: string, maxLen = 85): string[] {
  const normalized = text.trim().replace(/\s+/g, ' ');
  if (normalized.length <= maxLen) return [normalized];

  const conjunctions = [
    ' and ', ' but ', ' or ', ' because ', ' which ', ' that ', ' with ',
    ' when ', ' where ', ' while ', ' if ', ' so ',
    ' и ', ' а ', ' но ', ' или ', ' чтобы ', ' что ',
    ' если ', ' когда ', ' где ', ' как ', ' та ', ' але ', ' щоб ', ' що ', ' якщо ', ' коли '
  ];

  function findSplit(str: string, ideal: number, max: number): number {
    let bestIdx = -1;
    let bestScore = -Infinity;
    const minIdx = Math.max(15, Math.floor(ideal * 0.45));
    const maxIdx = Math.min(str.length - 10, max);

    for (let i = minIdx; i <= maxIdx; i++) {
      const char = str[i];
      const prevChar = str[i - 1];
      if (char === ' ' && prevChar) {
        let bonus = 10;
        if (/[.!?]/.test(prevChar)) {
          bonus = 60;
        } else if (/[,;—–:-]/.test(prevChar)) {
          bonus = 45;
        }

        const rest = str.slice(i).toLowerCase();
        for (const conj of conjunctions) {
          if (rest.startsWith(conj.trimStart())) {
            bonus = Math.max(bonus, 35);
            break;
          }
        }

        const distPenalty = Math.abs(i - ideal);
        const score = bonus - distPenalty;
        if (score > bestScore) {
          bestScore = score;
          bestIdx = i;
        }
      }
    }

    if (bestIdx === -1) {
      const lastSpace = str.lastIndexOf(' ', max);
      if (lastSpace > 15) return lastSpace;
      return max;
    }
    return bestIdx;
  }

  const result: string[] = [];
  let remaining = normalized;
  while (remaining.length > maxLen) {
    const curTarget = Math.round(remaining.length / Math.ceil(remaining.length / 80));
    const splitAt = findSplit(remaining, curTarget, maxLen);
    const part = remaining.slice(0, splitAt).trim();
    if (part) result.push(part);
    remaining = remaining.slice(splitAt).trim();
  }
  if (remaining) result.push(remaining);
  return result;
}

/**
 * Splits a single long subtitle cue into balanced segments with proportionally scaled start and end times.
 */
export function splitLongCue(cue: SubtitleCue, maxLen = 85): SubtitleCue[] {
  if (!cue || !cue.text) return cue ? [cue] : [];
  if (cue.text.trim().length <= maxLen) return [cue];

  const textParts = splitTextIntoBalancedSegments(cue.text, maxLen);
  if (textParts.length <= 1) return [cue];

  const totalChars = textParts.reduce((acc, p) => acc + p.length, 0);
  const totalDuration = Math.max(0.2, cue.endTime - cue.startTime);

  let translationParts: string[] = [];
  if (cue.translation) {
    translationParts = splitTextIntoBalancedSegments(cue.translation, maxLen);
    if (translationParts.length !== textParts.length) {
      const words = cue.translation.trim().split(/\s+/);
      translationParts = [];
      let wIdx = 0;
      for (let pIdx = 0; pIdx < textParts.length; pIdx++) {
        if (pIdx === textParts.length - 1) {
          translationParts.push(words.slice(wIdx).join(' '));
        } else {
          const wCount = Math.max(1, Math.round(words.length * (textParts[pIdx].length / totalChars)));
          translationParts.push(words.slice(wIdx, wIdx + wCount).join(' '));
          wIdx += wCount;
        }
      }
    }
  }

  let currentStart = cue.startTime;
  const result: SubtitleCue[] = [];

  for (let i = 0; i < textParts.length; i++) {
    const partText = textParts[i];
    const isLast = i === textParts.length - 1;
    const partRatio = totalChars > 0 ? partText.length / totalChars : 1 / textParts.length;
    const partDuration = totalDuration * partRatio;
    const partStart = currentStart;
    const partEnd = isLast ? cue.endTime : Number((currentStart + partDuration).toFixed(3));
    currentStart = partEnd;

    const subId = `${cue.id}_${i}`;
    const trText = translationParts[i] || undefined;

    result.push({
      id: subId,
      index: cue.index !== undefined ? cue.index * 100 + i : undefined,
      startTime: partStart,
      endTime: partEnd,
      text: partText,
      translation: trText,
      tokens: tokenizeCueText(subId, partText, partStart, partEnd)
    });
  }

  return result;
}

/**
 * Splits all cues in an array that exceed maxLen characters into balanced, proportionally timed cues.
 */
export function splitLongCues(cues: SubtitleCue[], maxLen = 85): SubtitleCue[] {
  if (!cues || cues.length === 0) return [];
  const result: SubtitleCue[] = [];
  for (const cue of cues) {
    if (cue.text && cue.text.trim().length > maxLen) {
      const parts = splitLongCue(cue, maxLen);
      for (const p of parts) {
        result.push(p);
      }
    } else {
      result.push(cue);
    }
  }

  for (let i = 0; i < result.length; i++) {
    result[i].index = i;
  }

  return result;
}

export function parseSubtitles(content: string): SubtitleCue[] {
  if (content.startsWith('WEBVTT') || (content.includes('-->') && content.includes('.'))) {
    const vtt = parseVtt(content);
    if (vtt.length > 0) return vtt;
  }
  return parseSrt(content);
}

export interface PlayerJsTrackInfo {
  label: string;
  language: string;
  url: string;
}

export function detectLanguageFromLabel(label: string): string {
  const l = label.toLowerCase().trim();
  if (l.includes('eng') || l.includes('англ') || l.includes('orig') || l.includes('ориг')) return 'en';
  if (l.includes('rus') || l.includes('рус')) return 'ru';
  if (l.includes('ukr') || l.includes('укр')) return 'uk';
  if (l.includes('jap') || l.includes('япон') || l.includes('nihon') || l.includes('jpn')) return 'ja';
  if (l.includes('kor') || l.includes('корей') || l.includes('hangul')) return 'ko';
  if (l.includes('spa') || l.includes('испан') || l.includes('esp')) return 'es';
  if (l.includes('ger') || l.includes('deu') || l.includes('немец') || l.includes('deutsch')) return 'de';
  if (l.includes('fra') || l.includes('fre') || l.includes('франц')) return 'fr';
  if (l.includes('swe') || l.includes('швед') || l.includes('sve')) return 'sv';
  return l.slice(0, 2);
}

export function detectLanguageFromCues(
  cues: SubtitleCue[],
  defaultLang = 'en'
): string {
  const sample = cues
    .slice(0, 15)
    .map((c) => c.text)
    .join(' ');
  if (!sample.trim()) return defaultLang;

  // Japanese
  if (/[\u3040-\u309F\u30A0-\u30FF]/.test(sample)) {
    return 'ja';
  }
  // Korean
  if (/[\uAC00-\uD7AF\u1100-\u11FF]/.test(sample)) {
    return 'ko';
  }
  // Cyrillic
  if (/[\u0400-\u04FF]/.test(sample)) {
    if (/[іїєґІЇЄҐ]/.test(sample)) {
      return 'uk';
    }
    return 'ru';
  }

  return defaultLang;
}

export function detectLanguageFromLabelAndCues(
  label: string,
  cues: SubtitleCue[],
  defaultLang = 'en'
): string {
  const fromLabel = detectLanguageFromLabel(label);
  if (fromLabel && fromLabel !== 'auto' && fromLabel !== 'und') {
    return fromLabel;
  }
  return detectLanguageFromCues(cues, defaultLang);
}

export function unescapeString(raw: string): string {
  if (!raw) return '';
  let str = raw.replace(/\\\//g, '/').replace(/\\"/g, '"');
  str = str.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) => {
    try {
      return String.fromCharCode(Number.parseInt(hex, 16));
    } catch {
      return _;
    }
  });
  return str;
}

export function convertSubtitleLnsToPlayerJs(subtitleLns: unknown): string {
  if (!subtitleLns) return '';
  let obj: Record<string, unknown> | null = null;
  if (typeof subtitleLns === 'string') {
    const unescaped = unescapeString(subtitleLns);
    try {
      obj = JSON.parse(unescaped) as Record<string, unknown>;
    } catch {
      const entries: string[] = [];
      const regex = /["']([^"']+)["']\s*:\s*["'](https?:[^"']+)["']/g;
      let m: RegExpExecArray | null = regex.exec(unescaped);
      while (m !== null) {
        entries.push(`[${m[1]}]${m[2]}`);
        m = regex.exec(unescaped);
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
        if (cleanVal.startsWith('http://') || cleanVal.startsWith('https://')) {
          entries.push(`[${cleanKey}]${cleanVal}`);
        }
      }
    }
    return entries.join(',');
  }

  return '';
}

export function parsePlayerJsSubtitleString(input: string): PlayerJsTrackInfo[] {
  const tracks: PlayerJsTrackInfo[] = [];
  if (!input) return tracks;

  const cleanInput = unescapeString(input).trim();

  if (cleanInput.startsWith('{') && cleanInput.endsWith('}')) {
    const converted = convertSubtitleLnsToPlayerJs(cleanInput);
    if (converted) {
      return parsePlayerJsSubtitleString(converted);
    }
  }

  const regex = /\[([^\]]+)\](https?:\/\/[^\s,]+)/g;
  let match: RegExpExecArray | null = regex.exec(cleanInput);

  while (match !== null) {
    const label = match[1].trim();
    const url = match[2].trim();
    tracks.push({
      label,
      language: detectLanguageFromLabel(label),
      url
    });
    match = regex.exec(cleanInput);
  }

  if (tracks.length === 0 && (cleanInput.startsWith('http://') || cleanInput.startsWith('https://'))) {
    tracks.push({
      label: 'Subtitles',
      language: 'en',
      url: cleanInput
    });
  }

  return tracks;
}
