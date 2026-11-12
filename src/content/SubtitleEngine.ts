import type { Json3Event, Json3Response, SubtitleCue, WordToken } from '../types/subtitles';

interface TimedPiece {
  text: string;
  startMs: number;
  endMs: number;
}

const WORD_REGEX = /([\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*)/gu;
const SENTENCE_END_REGEX = /[.!?]["'”’)\]]*$/;
const MAX_PAUSE_MS = 600;
const MAX_CUE_LENGTH = 110;

export function normalizeWord(word: string): string {
  return word
    .trim()
    .toLowerCase()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}

export function tokenizeCueText(
  cueId: string,
  text: string,
  cueStartSec: number,
  cueEndSec: number,
  pieceTimings?: TimedPiece[]
): WordToken[] {
  const tokens: WordToken[] = [];
  const totalLen = Math.max(text.length, 1);
  const duration = Math.max(cueEndSec - cueStartSec, 0.1);

  let lastIndex = 0;
  let tokenIdx = 0;
  WORD_REGEX.lastIndex = 0;

  let match: RegExpExecArray | null = WORD_REGEX.exec(text);
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

    let startSec = cueStartSec + (wordStartIdx / totalLen) * duration;
    let endSec = cueStartSec + (wordEndIdx / totalLen) * duration;

    if (pieceTimings && pieceTimings.length > 0) {
      const matchedPiece = findBestPieceForOffset(text, wordStartIdx, pieceTimings);
      if (matchedPiece) {
        startSec = matchedPiece.startMs / 1000;
        endSec = Math.max(matchedPiece.endMs / 1000, startSec + 0.05);
      }
    }

    tokens.push({
      id: `${cueId}-t${tokenIdx++}`,
      text: wordText,
      isWord: true,
      startTime: startSec,
      endTime: endSec,
      normalized: normalizeWord(wordText)
    });

    lastIndex = wordEndIdx;
    match = WORD_REGEX.exec(text);
  }

  if (lastIndex < text.length) {
    const tailText = text.slice(lastIndex);
    const fracStart = lastIndex / totalLen;
    tokens.push({
      id: `${cueId}-t${tokenIdx++}`,
      text: tailText,
      isWord: false,
      startTime: cueStartSec + fracStart * duration,
      endTime: cueEndSec,
      normalized: ''
    });
  }

  return tokens;
}

function findBestPieceForOffset(
  fullText: string,
  charIndex: number,
  pieces: TimedPiece[]
): TimedPiece | null {
  let cursor = 0;
  for (const piece of pieces) {
    const foundAt = fullText.indexOf(piece.text, cursor);
    if (foundAt === -1) continue;
    const pieceEnd = foundAt + piece.text.length;
    if (charIndex >= foundAt && charIndex < pieceEnd) {
      return piece;
    }
    cursor = pieceEnd;
  }
  return null;
}

export class SubtitleEngine {
  private cues: SubtitleCue[] = [];
  private isAsrTrack = false;

  public loadJson3(data: Json3Response, kind?: string): SubtitleCue[] {
    const events = data.events ?? [];
    this.isAsrTrack = this.detectAsr(events, kind);

    if (this.isAsrTrack) {
      this.cues = this.parseAsrEvents(events);
    } else {
      this.cues = this.parseStandardEvents(events);
    }

    return this.cues;
  }

  public clear(): void {
    this.cues = [];
    this.isAsrTrack = false;
  }

  public getCues(): SubtitleCue[] {
    return this.cues;
  }

  public getIsAsr(): boolean {
    return this.isAsrTrack;
  }

  /**
   * O(log n) binary search for the active cue at timeSec.
   */
  public findActiveCue(timeSec: number): SubtitleCue | null {
    const cues = this.cues;
    const len = cues.length;
    if (len === 0) return null;

    let low = 0;
    let high = len - 1;

    while (low <= high) {
      const mid = (low + high) >>> 1;
      const cue = cues[mid];
      if (timeSec < cue.startTime) {
        high = mid - 1;
      } else if (timeSec > cue.endTime) {
        low = mid + 1;
      } else {
        return cue;
      }
    }

    return null;
  }

  public findCueIndexAtOrBefore(timeSec: number): number {
    const cues = this.cues;
    const len = cues.length;
    if (len === 0) return -1;

    let low = 0;
    let high = len - 1;
    let candidate = -1;

    while (low <= high) {
      const mid = (low + high) >>> 1;
      if (cues[mid].startTime <= timeSec) {
        candidate = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    return candidate;
  }

  public getPreviousCue(timeSec: number): SubtitleCue | null {
    if (this.cues.length === 0) return null;
    const active = this.findActiveCue(timeSec);
    if (active) {
      if (timeSec - active.startTime > 1.0) {
        return active;
      }
      return active.index > 0 ? this.cues[active.index - 1] : active;
    }

    const beforeIdx = this.findCueIndexAtOrBefore(timeSec);
    if (beforeIdx >= 0) return this.cues[beforeIdx];
    return this.cues[0];
  }

  public getNextCue(timeSec: number): SubtitleCue | null {
    if (this.cues.length === 0) return null;
    const active = this.findActiveCue(timeSec);
    if (active) {
      return active.index + 1 < this.cues.length ? this.cues[active.index + 1] : null;
    }

    const beforeIdx = this.findCueIndexAtOrBefore(timeSec);
    const nextIdx = beforeIdx + 1;
    return nextIdx < this.cues.length ? this.cues[nextIdx] : null;
  }

  public getSurroundingContext(cueIndex: number): {
    prevSentence: string;
    currentSentence: string;
    nextSentence: string;
  } {
    const prev = cueIndex > 0 ? this.cues[cueIndex - 1]?.text ?? '' : '';
    const curr = this.cues[cueIndex]?.text ?? '';
    const next = cueIndex + 1 < this.cues.length ? this.cues[cueIndex + 1]?.text ?? '' : '';
    return {
      prevSentence: prev,
      currentSentence: curr,
      nextSentence: next
    };
  }

  private detectAsr(events: Json3Event[], kind?: string): boolean {
    if (kind === 'asr') return true;
    let wordOffsetSegCount = 0;
    let totalSegEvents = 0;
    for (const ev of events) {
      if (!ev.segs || ev.segs.length === 0) continue;
      totalSegEvents++;
      if (ev.wWinId !== undefined || ev.aAppend === 1) {
        return true;
      }
      if (ev.segs.some((s) => typeof s.tOffsetMs === 'number' && s.tOffsetMs > 0)) {
        wordOffsetSegCount++;
      }
    }
    return totalSegEvents > 0 && wordOffsetSegCount / totalSegEvents > 0.35;
  }

  private extractPieces(events: Json3Event[]): TimedPiece[] {
    const rawPieces: TimedPiece[] = [];
    const sorted = [...events].sort((a, b) => a.tStartMs - b.tStartMs);

    for (let i = 0; i < sorted.length; i++) {
      const ev = sorted[i];
      if (!ev.segs || ev.segs.length === 0) continue;

      const evStartMs = ev.tStartMs;
      const nextEvStartMs =
        i + 1 < sorted.length ? sorted[i + 1].tStartMs : evStartMs + (ev.dDurationMs ?? 3000);
      const evEndMs =
        typeof ev.dDurationMs === 'number' && ev.dDurationMs > 0
          ? evStartMs + ev.dDurationMs
          : Math.max(evStartMs + 500, nextEvStartMs);

      for (let s = 0; s < ev.segs.length; s++) {
        const seg = ev.segs[s];
        const cleaned = seg.utf8.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
        if (!cleaned) continue;

        const segStartMs = evStartMs + (seg.tOffsetMs ?? 0);
        let segEndMs = evEndMs;
        for (let k = s + 1; k < ev.segs.length; k++) {
          const nextOffset = ev.segs[k].tOffsetMs;
          if (typeof nextOffset === 'number') {
            segEndMs = evStartMs + nextOffset;
            break;
          }
        }
        if (segEndMs <= segStartMs) {
          segEndMs = segStartMs + 250;
        }

        rawPieces.push({
          text: cleaned,
          startMs: segStartMs,
          endMs: segEndMs
        });
      }
    }

    rawPieces.sort((a, b) => a.startMs - b.startMs);
    return this.deduplicateOverlaps(rawPieces);
  }

  private deduplicateOverlaps(pieces: TimedPiece[]): TimedPiece[] {
    const result: TimedPiece[] = [];
    for (const piece of pieces) {
      const last = result[result.length - 1];
      if (!last) {
        result.push(piece);
        continue;
      }

      const normCurr = piece.text.toLowerCase();
      const normLast = last.text.toLowerCase();

      // Exact overlapping duplicate from rolling ASR windows
      if (normCurr === normLast && Math.abs(piece.startMs - last.startMs) <= 350) {
        if (piece.endMs > last.endMs) {
          last.endMs = piece.endMs;
        }
        continue;
      }

      // Multi-word window where current chunk repeats trailing words of previous chunk
      if (piece.startMs - last.startMs <= 1200 && piece.text.includes(' ')) {
        const currWords = piece.text.split(' ');
        const tailWords = result
          .slice(-Math.min(currWords.length, 4))
          .map((p) => p.text.toLowerCase());
        let overlapCount = 0;
        for (let k = Math.min(currWords.length, tailWords.length); k >= 1; k--) {
          const tailSlice = tailWords.slice(-k).join(' ');
          const headSlice = currWords.slice(0, k).join(' ').toLowerCase();
          if (tailSlice === headSlice) {
            overlapCount = k;
            break;
          }
        }
        if (overlapCount > 0) {
          const remaining = currWords.slice(overlapCount).join(' ').trim();
          if (!remaining) continue;
          result.push({
            text: remaining,
            startMs: piece.startMs,
            endMs: piece.endMs
          });
          continue;
        }
      }

      result.push(piece);
    }
    return result;
  }

  private parseAsrEvents(events: Json3Event[]): SubtitleCue[] {
    const pieces = this.extractPieces(events);
    if (pieces.length === 0) return [];

    const cues: SubtitleCue[] = [];
    let bufferPieces: TimedPiece[] = [];
    let bufferText = '';

    const flushBuffer = (): void => {
      if (bufferPieces.length === 0) return;
      const text = bufferText.trim();
      if (!text) {
        bufferPieces = [];
        bufferText = '';
        return;
      }
      const startMs = bufferPieces[0].startMs;
      const lastPiece = bufferPieces[bufferPieces.length - 1];
      const endMs = Math.max(lastPiece.endMs, startMs + 400);
      const index = cues.length;
      const cueId = `cue-${index}-${startMs}`;
      const startTime = startMs / 1000;
      const endTime = endMs / 1000;

      cues.push({
        id: cueId,
        index,
        startTime,
        endTime,
        text,
        tokens: tokenizeCueText(cueId, text, startTime, endTime, bufferPieces)
      });

      bufferPieces = [];
      bufferText = '';
    };

    for (let i = 0; i < pieces.length; i++) {
      const piece = pieces[i];
      const prevPiece = bufferPieces[bufferPieces.length - 1];

      if (prevPiece) {
        const pauseMs = piece.startMs - prevPiece.endMs;
        const candidateLength = bufferText.length + 1 + piece.text.length;
        if (pauseMs > MAX_PAUSE_MS || candidateLength > MAX_CUE_LENGTH) {
          flushBuffer();
        }
      }

      bufferPieces.push(piece);
      bufferText = bufferText ? `${bufferText} ${piece.text}` : piece.text;

      if (SENTENCE_END_REGEX.test(piece.text)) {
        flushBuffer();
      }
    }

    flushBuffer();

    // Prevent cue overlap while preserving natural end times
    for (let i = 0; i < cues.length - 1; i++) {
      if (cues[i].endTime > cues[i + 1].startTime) {
        cues[i].endTime = Math.max(cues[i].startTime + 0.2, cues[i + 1].startTime - 0.02);
      }
    }

    return cues;
  }

  private parseStandardEvents(events: Json3Event[]): SubtitleCue[] {
    const cues: SubtitleCue[] = [];
    const sorted = [...events].sort((a, b) => a.tStartMs - b.tStartMs);

    for (let i = 0; i < sorted.length; i++) {
      const ev = sorted[i];
      if (!ev.segs || ev.segs.length === 0) continue;

      const rawText = ev.segs
        .map((s) => s.utf8)
        .join('')
        .replace(/[\r\n]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      if (!rawText) continue;

      const startMs = ev.tStartMs;
      const durationMs = typeof ev.dDurationMs === 'number' && ev.dDurationMs > 0 ? ev.dDurationMs : 2500;
      let endMs = startMs + durationMs;

      for (let j = i + 1; j < sorted.length; j++) {
        const nextEv = sorted[j];
        if (nextEv.segs && nextEv.segs.length > 0 && nextEv.tStartMs > startMs) {
          if (endMs > nextEv.tStartMs) {
            endMs = Math.max(startMs + 250, nextEv.tStartMs - 20);
          }
          break;
        }
      }

      const index = cues.length;
      const cueId = `cue-${index}-${startMs}`;
      const startTime = startMs / 1000;
      const endTime = endMs / 1000;

      cues.push({
        id: cueId,
        index,
        startTime,
        endTime,
        text: rawText,
        tokens: tokenizeCueText(cueId, rawText, startTime, endTime)
      });
    }

    return cues;
  }
}
