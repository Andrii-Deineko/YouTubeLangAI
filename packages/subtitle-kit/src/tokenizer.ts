import type { SubtitleCue, WordToken } from '@langai/contracts';

const WORD_REGEX = /([\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*)/gu;

const normalizedWordCache = new Map<string, string>();

export interface TokenizeTextOptions {
  cueId?: string;
  startTime?: number;
  endTime?: number;
}

/**
 * Normalizes a word token for dictionary lookups and vocabulary deduplication.
 */
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

/**
 * Tokenizes cue text into timed word and non-word tokens proportional to character positions.
 */
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

/**
 * Tokenizes plain text into word and punctuation/whitespace tokens.
 */
export function tokenizeText(text: string, options?: TokenizeTextOptions): WordToken[] {
  return tokenizeCueText(
    options?.cueId ?? 'cue',
    text,
    options?.startTime ?? 0,
    options?.endTime ?? 1
  );
}

/**
 * Tokenizes a subtitle cue using its id, text, and start/end timings.
 */
export function tokenizeCue(
  cue: Pick<SubtitleCue, 'id' | 'text' | 'startTime' | 'endTime'>
): WordToken[] {
  return tokenizeCueText(cue.id, cue.text, cue.startTime, cue.endTime);
}
