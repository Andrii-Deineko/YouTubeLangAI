import type { SubtitleCue } from '@langai/contracts';
import { tokenizeCueText } from './tokenizer';

const CONJUNCTIONS = [
  ' and ', ' but ', ' or ', ' because ', ' which ', ' that ', ' with ',
  ' when ', ' where ', ' while ', ' if ', ' so ',
  ' och ', ' men ', ' eller ', ' eftersom ', ' som ', ' att ', ' när ', ' om ',
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
      for (const conj of CONJUNCTIONS) {
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

/**
 * Splits overly long subtitle text (> maxLen characters) into balanced, natural segments
 * at sentence ends, punctuation marks, conjunctions, or word boundaries.
 */
export function splitTextIntoBalancedSegments(text: string, maxLen = 85): string[] {
  const normalized = text.trim().replace(/\s+/g, ' ');
  if (normalized.length <= maxLen) return [normalized];

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
          const wCount = Math.max(
            1,
            Math.round(words.length * (textParts[pIdx].length / totalChars))
          );
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
      ...(trText ? { translation: trText } : {}),
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
      for (const part of parts) {
        result.push(part);
      }
    } else {
      result.push(cue);
    }
  }

  return result.map((cue, index) => ({
    ...cue,
    index
  }));
}
