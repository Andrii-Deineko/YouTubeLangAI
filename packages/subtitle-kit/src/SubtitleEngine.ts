import { isValidTranslationText, type Json3Response, type SubtitleCue } from '@langai/contracts';
import { detectAsrTrack, parseAsrEvents, parseStandardJson3Events } from './parsers';
import { splitLongCues } from './splitter';
import { tokenizeCueText } from './tokenizer';

export type BatchTranslationInput =
  | ReadonlyMap<string, string>
  | Readonly<Record<string, string>>
  | ReadonlyArray<{ id: string; text: string }>;

/**
 * Stateful timeline engine for subtitle cues, binary-search lookups with `subtitleOffsetSec`,
 * cue navigation, and direct in-cue batch translation storage.
 */
export class SubtitleEngine {
  private cues: SubtitleCue[] = [];
  private isAsrTrack = false;

  public loadJson3(data: Json3Response, kind?: string): SubtitleCue[] {
    const events = data.events ?? [];
    this.isAsrTrack = detectAsrTrack(events, kind);

    if (this.isAsrTrack) {
      this.cues = splitLongCues(parseAsrEvents(events));
    } else {
      this.cues = splitLongCues(parseStandardJson3Events(events));
    }

    return this.cues;
  }

  public loadCues(cues: SubtitleCue[], splitLong = true): SubtitleCue[] {
    this.isAsrTrack = false;
    const sorted = cues
      .filter((c) => c && typeof c.startTime === 'number' && typeof c.endTime === 'number' && c.text)
      .sort((a, b) => a.startTime - b.startTime);
    const prepared = splitLong ? splitLongCues(sorted) : sorted;
    this.cues = prepared.map((c, idx) => ({
      ...c,
      index: idx,
      tokens:
        c.tokens && c.tokens.length > 0
          ? c.tokens
          : tokenizeCueText(c.id, c.text, c.startTime, c.endTime)
    }));
    return this.cues;
  }

  public upsertCues(cues: SubtitleCue[], splitLong = true): SubtitleCue[] {
    if (!cues.length) return this.cues;
    if (!splitLong) {
      this.isAsrTrack = false;
      for (const cue of cues) {
        if (!cue?.text || typeof cue.startTime !== 'number' || typeof cue.endTime !== 'number') {
          continue;
        }
        const lastIndex = this.cues.length - 1;
        let index = lastIndex >= 0 && this.cues[lastIndex].id === cue.id ? lastIndex : -1;
        if (index < 0 && lastIndex >= 0 && cue.startTime < this.cues[lastIndex].startTime) {
          index = this.cues.findIndex((existing) => existing.id === cue.id);
        }
        const existing = index >= 0 ? this.cues[index] : undefined;
        const prepared: SubtitleCue = {
          ...cue,
          index: index >= 0 ? index : this.cues.length,
          ...(existing?.translation && !cue.translation
            ? { translation: existing.translation }
            : {}),
          tokens:
            cue.tokens && cue.tokens.length > 0
              ? cue.tokens
              : tokenizeCueText(cue.id, cue.text, cue.startTime, cue.endTime)
        };
        if (index >= 0) this.cues[index] = prepared;
        else this.cues.push(prepared);
      }
      return this.cues;
    }

    const cueMap = new Map(this.cues.map((cue) => [cue.id, cue]));
    for (const cue of cues) {
      if (!cue?.text || typeof cue.startTime !== 'number' || typeof cue.endTime !== 'number') {
        continue;
      }
      const existing = cueMap.get(cue.id);
      cueMap.set(cue.id, {
        ...cue,
        ...(existing?.translation && !cue.translation
          ? { translation: existing.translation }
          : {})
      });
    }
    return this.loadCues(Array.from(cueMap.values()), splitLong);
  }

  public clear(): void {
    this.cues = [];
    this.isAsrTrack = false;
  }

  public clearTranslations(): void {
    this.cues = this.cues.map((cue) => {
      if (cue.translation) {
        const { translation: _, ...rest } = cue;
        return rest;
      }
      return cue;
    });
  }

  public getCues(): SubtitleCue[] {
    return this.cues;
  }

  public getIsAsr(): boolean {
    return this.isAsrTrack;
  }

  /**
   * Stores translated strings directly on `cue.translation` by cue ID.
   * Accepts a Map, plain object dictionary, or array of `{ id, text }` items.
   */
  public applyBatchTranslations(translations: BatchTranslationInput): boolean {
    const map = new Map<string, string>();

    if (translations instanceof Map) {
      for (const [id, text] of translations.entries()) {
        if (id && isValidTranslationText(text)) {
          map.set(id, text.trim());
        }
      }
    } else if (Array.isArray(translations)) {
      for (const item of translations) {
        if (item && item.id && isValidTranslationText(item.text)) {
          map.set(item.id, item.text.trim());
        }
      }
    } else {
      for (const [id, text] of Object.entries(translations)) {
        if (id && isValidTranslationText(text)) {
          map.set(id, text.trim());
        }
      }
    }

    if (map.size === 0) return false;

    let changed = false;
    this.cues = this.cues.map((cue) => {
      const tr = map.get(cue.id);
      if (tr !== undefined && cue.translation !== tr) {
        changed = true;
        return {
          ...cue,
          translation: tr
        };
      }
      return cue;
    });
    return changed;
  }

  /**
   * Backwards-compatible alias for `applyBatchTranslations`.
   */
  public applyTranslations(batch: ReadonlyArray<{ id: string; text: string }>): boolean {
    return this.applyBatchTranslations(batch);
  }

  /**
   * O(log n) binary search for the active cue at `effectiveTime = timeSec - offsetSec`.
   */
  public getCueAt(timeSec: number, offsetSec = 0): SubtitleCue | null {
    const cues = this.cues;
    const len = cues.length;
    if (len === 0) return null;

    const effectiveTime = timeSec - offsetSec;
    let low = 0;
    let high = len - 1;

    while (low <= high) {
      const mid = (low + high) >>> 1;
      const cue = cues[mid];
      if (effectiveTime < cue.startTime) {
        high = mid - 1;
      } else if (effectiveTime > cue.endTime) {
        low = mid + 1;
      } else {
        return cue;
      }
    }

    return null;
  }

  /**
   * Alias for `getCueAt(timeSec, offsetSec)`.
   */
  public findActiveCue(timeSec: number, offsetSec = 0): SubtitleCue | null {
    return this.getCueAt(timeSec, offsetSec);
  }

  /**
   * Returns the index of the last cue starting at or before `effectiveTime = timeSec - offsetSec`,
   * or `-1` if all cues start after `effectiveTime`.
   */
  public findCueIndexAtOrBefore(timeSec: number, offsetSec = 0): number {
    const cues = this.cues;
    const len = cues.length;
    if (len === 0) return -1;

    const effectiveTime = timeSec - offsetSec;
    let low = 0;
    let high = len - 1;
    let candidate = -1;

    while (low <= high) {
      const mid = (low + high) >>> 1;
      if (cues[mid].startTime <= effectiveTime) {
        candidate = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    return candidate;
  }

  /**
   * Navigates to the previous cue (or restarts the current cue if >1s past its start),
   * accounting for `offsetSec` via `effectiveTime = timeSec - offsetSec`.
   */
  public getPreviousCue(timeSec: number, offsetSec = 0): SubtitleCue | null {
    if (this.cues.length === 0) return null;

    const effectiveTime = timeSec - offsetSec;
    const active = this.getCueAt(timeSec, offsetSec);
    if (active) {
      if (effectiveTime - active.startTime > 1.0) {
        return active;
      }
      const idx = active.index ?? this.cues.indexOf(active);
      return idx > 0 ? this.cues[idx - 1] : active;
    }

    const beforeIdx = this.findCueIndexAtOrBefore(timeSec, offsetSec);
    if (beforeIdx >= 0) return this.cues[beforeIdx];
    return this.cues[0];
  }

  /**
   * Navigates to the next cue after `effectiveTime = timeSec - offsetSec`.
   */
  public getNextCue(timeSec: number, offsetSec = 0): SubtitleCue | null {
    if (this.cues.length === 0) return null;

    const active = this.getCueAt(timeSec, offsetSec);
    if (active) {
      const idx = active.index ?? this.cues.indexOf(active);
      return idx + 1 < this.cues.length ? this.cues[idx + 1] : null;
    }

    const beforeIdx = this.findCueIndexAtOrBefore(timeSec, offsetSec);
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
}
