import type { FreeTranslateWordResult } from '../types/messages';

export interface CueItem {
  id: string;
  text: string;
  startTime?: number;
  endTime?: number;
}

export interface TranslatedCueItem {
  id: string;
  text: string;
}

interface CachedSubtitleTrack {
  savedAt: number;
  translations: Record<string, string>; // cueId -> translatedText
}

const WORD_CACHE_STORAGE_KEY = 'ytai_free_word_cache';
const SUBTITLE_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const CUE_BATCH_SIZE = 25;
const BATCH_DELIMITER = '\n|||\n';

// In-memory LRU cache for word translations
const wordMemoryCache = new Map<string, FreeTranslateWordResult>();
let isStorageWordCacheLoaded = false;
let isStorageWordCacheSaving = false;
let pendingSaveStorageWordCache = false;

// In-flight request deduplication
const inFlightWordRequests = new Map<string, Promise<FreeTranslateWordResult>>();
const inFlightCueRequests = new Map<string, Promise<TranslatedCueItem[]>>();

async function loadWordCacheFromStorage(): Promise<void> {
  if (isStorageWordCacheLoaded) return;
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const res = await chrome.storage.local.get(WORD_CACHE_STORAGE_KEY);
      const raw = res[WORD_CACHE_STORAGE_KEY];
      if (Array.isArray(raw)) {
        for (const item of raw) {
          if (item && typeof item === 'object' && item.key && item.data) {
            wordMemoryCache.set(item.key, item.data);
          }
        }
      }
    }
  } catch (err) {
    console.warn('[YT-Lang-AI] Error loading word cache from storage:', err);
  } finally {
    isStorageWordCacheLoaded = true;
  }
}

async function persistWordCacheToStorage(): Promise<void> {
  if (isStorageWordCacheSaving) {
    pendingSaveStorageWordCache = true;
    return;
  }
  isStorageWordCacheSaving = true;

  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const entries = Array.from(wordMemoryCache.entries()).map(([key, data]) => ({
        key,
        data
      }));
      await chrome.storage.local.set({ [WORD_CACHE_STORAGE_KEY]: entries });
    }
  } catch (err) {
    console.warn('[YT-Lang-AI] Error saving word cache to storage:', err);
  } finally {
    isStorageWordCacheSaving = false;
    if (pendingSaveStorageWordCache) {
      pendingSaveStorageWordCache = false;
      void persistWordCacheToStorage();
    }
  }
}

function buildWordCacheKey(
  sourceLang: string,
  targetLang: string,
  word: string,
  sentence?: string
): string {
  const cleanWord = word.trim().toLowerCase();
  const cleanSentence = sentence ? sentence.trim().slice(0, 100) : '';
  return `${sourceLang || 'auto'}:${targetLang}:${cleanWord}:${cleanSentence}`;
}

interface SingleParseResult {
  translation: string;
  alternatives: string[];
  partOfSpeech?: string;
  detectedLang?: string;
}

function parseSingleResponse(raw: unknown, originalText: string): SingleParseResult {
  if (!Array.isArray(raw)) {
    return {
      translation: originalText,
      alternatives: []
    };
  }

  // 1. Primary text translation from raw[0]
  const segments = Array.isArray(raw[0]) ? raw[0] : [];
  const parts: string[] = [];
  for (const seg of segments) {
    if (Array.isArray(seg) && typeof seg[0] === 'string') {
      parts.push(seg[0]);
    }
  }
  const translation = parts.join('').trim() || originalText;

  // 2. Detected language from raw[2]
  const detectedLang = typeof raw[2] === 'string' ? raw[2] : undefined;

  // 3. Dictionary / Synonyms / Alternatives from raw[1]
  const alternatives: string[] = [];
  let partOfSpeech: string | undefined;

  if (Array.isArray(raw[1])) {
    for (const dictEntry of raw[1]) {
      if (!Array.isArray(dictEntry)) continue;
      if (!partOfSpeech && typeof dictEntry[0] === 'string' && dictEntry[0].trim()) {
        partOfSpeech = dictEntry[0].trim();
      }
      if (Array.isArray(dictEntry[1])) {
        for (const candidate of dictEntry[1]) {
          if (
            typeof candidate === 'string' &&
            candidate.trim() &&
            candidate.trim().toLowerCase() !== translation.toLowerCase() &&
            !alternatives.includes(candidate.trim())
          ) {
            alternatives.push(candidate.trim());
          }
        }
      }
    }
  }

  return {
    translation,
    alternatives: alternatives.slice(0, 6),
    partOfSpeech,
    detectedLang
  };
}

async function fetchSingleText(
  text: string,
  sourceLang: string,
  targetLang: string,
  includeDictionary: boolean
): Promise<SingleParseResult> {
  const cleanText = text.trim();
  if (!cleanText) {
    return { translation: '', alternatives: [] };
  }

  const sl = sourceLang && sourceLang !== 'unknown' ? sourceLang : 'auto';
  const dtParams = includeDictionary ? '&dt=t&dt=bd&dt=rm' : '&dt=t';
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(
    sl
  )}&tl=${encodeURIComponent(targetLang)}${dtParams}&q=${encodeURIComponent(cleanText)}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Google GTX request failed with HTTP ${res.status}`);
  }

  const json: unknown = await res.json();
  return parseSingleResponse(json, cleanText);
}

export async function freeTranslateWord(params: {
  word: string;
  sentence?: string;
  sourceLang?: string;
  targetLang: string;
}): Promise<FreeTranslateWordResult> {
  await loadWordCacheFromStorage();

  const sl = params.sourceLang || 'auto';
  const tl = params.targetLang || 'ru';
  const cacheKey = buildWordCacheKey(sl, tl, params.word, params.sentence);

  const cached = wordMemoryCache.get(cacheKey);
  if (cached) {
    return { ...cached, fromCache: true };
  }

  const inFlight = inFlightWordRequests.get(cacheKey);
  if (inFlight) {
    return inFlight;
  }

  const task = (async (): Promise<FreeTranslateWordResult> => {
    let wordRes: SingleParseResult;
    try {
      wordRes = await fetchSingleText(params.word, sl, tl, true);
    } catch {
      wordRes = { translation: params.word, alternatives: [] };
    }

    let sentenceTranslation = '';
    if (params.sentence && params.sentence.trim()) {
      try {
        const sRes = await fetchSingleText(params.sentence, sl, tl, false);
        sentenceTranslation = sRes.translation;
      } catch {
        sentenceTranslation = '';
      }
    }

    const result: FreeTranslateWordResult = {
      word: params.word,
      translation: wordRes.translation || params.word,
      sentenceTranslation,
      alternatives: wordRes.alternatives,
      partOfSpeech: wordRes.partOfSpeech,
      detectedLang: wordRes.detectedLang
    };

    wordMemoryCache.set(cacheKey, result);
    void persistWordCacheToStorage();

    return result;
  })();

  inFlightWordRequests.set(cacheKey, task);
  try {
    return await task;
  } finally {
    inFlightWordRequests.delete(cacheKey);
  }
}

export async function translateCueBatch(params: {
  videoId: string;
  cues: CueItem[];
  sourceLang?: string;
  targetLang: string;
  priorityTime?: number;
  onBatchProgress?: (batch: TranslatedCueItem[]) => void;
}): Promise<TranslatedCueItem[]> {
  const { videoId, cues, priorityTime } = params;
  if (!cues || cues.length === 0) return [];

  const sl = params.sourceLang && params.sourceLang !== 'unknown' ? params.sourceLang : 'auto';
  const tl = params.targetLang || 'ru';
  const cacheKey = `free_sub_tr:${videoId}:${tl}`;

  let cachedTrack: CachedSubtitleTrack | undefined;
  if (typeof chrome !== 'undefined' && chrome.storage?.local && videoId && videoId !== 'unknown') {
    try {
      const res = await chrome.storage.local.get(cacheKey);
      const raw = res[cacheKey] as CachedSubtitleTrack | undefined;
      if (raw && raw.translations && Date.now() - raw.savedAt < SUBTITLE_CACHE_TTL_MS) {
        cachedTrack = raw;
      }
    } catch (err) {
      console.warn('[YT-Lang-AI] Error checking subtitle cache:', err);
    }
  }

  // If already completely cached, return directly
  if (cachedTrack) {
    const allFound = cues.every((c) => cachedTrack?.translations[c.id]);
    if (allFound) {
      const results = cues.map((c) => ({
        id: c.id,
        text: cachedTrack?.translations[c.id] || c.text
      }));
      params.onBatchProgress?.(results);
      return results;
    }
  }

  // Deduplicate in-flight requests for the same media & target language
  const inFlightKey = `${videoId}:${sl}:${tl}`;
  const existingInFlight = inFlightCueRequests.get(inFlightKey);
  if (existingInFlight) {
    return existingInFlight;
  }

  const task = (async (): Promise<TranslatedCueItem[]> => {
    const translationMap: Record<string, string> = {
      ...(cachedTrack?.translations || {})
    };

    // If some cues are already in cache, emit initial progress immediately
    const alreadyCachedItems = cues
      .filter((c) => translationMap[c.id])
      .map((c) => ({ id: c.id, text: translationMap[c.id] }));
    if (alreadyCachedItems.length > 0) {
      params.onBatchProgress?.(alreadyCachedItems);
    }

    // Build batches of missing cues
    const missingCues = cues.filter((c) => !translationMap[c.id]);
    if (missingCues.length === 0) {
      return cues.map((c) => ({ id: c.id, text: translationMap[c.id] || c.text }));
    }

    // Chunk missing cues into batches of CUE_BATCH_SIZE (25)
    const batches: CueItem[][] = [];
    for (let i = 0; i < missingCues.length; i += CUE_BATCH_SIZE) {
      batches.push(missingCues.slice(i, i + CUE_BATCH_SIZE));
    }

    // Prioritize batches around priorityTime
    if (typeof priorityTime === 'number' && priorityTime > 0 && batches.length > 1) {
      // Find the batch closest to priorityTime
      let closestBatchIdx = 0;
      let minDistance = Number.POSITIVE_INFINITY;

      for (let i = 0; i < batches.length; i++) {
        const firstCue = batches[i][0];
        const lastCue = batches[i][batches[i].length - 1];
        const cueStart = firstCue.startTime ?? 0;
        const cueEnd = lastCue.endTime ?? (cueStart + 5);

        if (priorityTime >= cueStart && priorityTime <= cueEnd) {
          closestBatchIdx = i;
          break;
        }

        const dist = Math.min(
          Math.abs(priorityTime - cueStart),
          Math.abs(priorityTime - cueEnd)
        );
        if (dist < minDistance) {
          minDistance = dist;
          closestBatchIdx = i;
        }
      }

      // Reorder batches: closest first, then +1, -1, +2, -2, etc.
      const prioritizedBatches: CueItem[][] = [];
      const usedIndices = new Set<number>();

      const addIdx = (idx: number) => {
        if (idx >= 0 && idx < batches.length && !usedIndices.has(idx)) {
          usedIndices.add(idx);
          prioritizedBatches.push(batches[idx]);
        }
      };

      addIdx(closestBatchIdx);
      for (let offset = 1; offset < batches.length; offset++) {
        addIdx(closestBatchIdx + offset);
        addIdx(closestBatchIdx - offset);
      }

      // Process in prioritized order
      for (const batch of prioritizedBatches) {
        const batchResult = await translateSingleCueBatch(batch, sl, tl);
        for (const item of batchResult) {
          translationMap[item.id] = item.text;
        }
        params.onBatchProgress?.(batchResult);
        saveProgress(videoId, cacheKey, translationMap);
      }
    } else {
      // Process in natural chronological order
      for (const batch of batches) {
        const batchResult = await translateSingleCueBatch(batch, sl, tl);
        for (const item of batchResult) {
          translationMap[item.id] = item.text;
        }
        params.onBatchProgress?.(batchResult);
        saveProgress(videoId, cacheKey, translationMap);
      }
    }

    return cues.map((c) => ({
      id: c.id,
      text: translationMap[c.id] || c.text
    }));
  })();

  inFlightCueRequests.set(inFlightKey, task);
  try {
    return await task;
  } finally {
    inFlightCueRequests.delete(inFlightKey);
  }
}

function saveProgress(videoId: string, cacheKey: string, translations: Record<string, string>): void {
  if (typeof chrome !== 'undefined' && chrome.storage?.local && videoId && videoId !== 'unknown') {
    const toSave: CachedSubtitleTrack = {
      savedAt: Date.now(),
      translations
    };
    void chrome.storage.local.set({ [cacheKey]: toSave });
  }
}

async function translateSingleCueBatch(
  batch: CueItem[],
  sourceLang: string,
  targetLang: string
): Promise<TranslatedCueItem[]> {
  if (batch.length === 0) return [];

  if (batch.length === 1) {
    try {
      const res = await fetchSingleText(batch[0].text, sourceLang, targetLang, false);
      return [{ id: batch[0].id, text: res.translation || batch[0].text }];
    } catch {
      return [{ id: batch[0].id, text: batch[0].text }];
    }
  }

  // Join batch with delimiter
  const joinedText = batch.map((c) => c.text.replace(/[\r\n]+/g, ' ')).join(BATCH_DELIMITER);

  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(
      sourceLang
    )}&tl=${encodeURIComponent(targetLang)}&dt=t&q=${encodeURIComponent(joinedText)}`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Batch request failed with HTTP ${response.status}`);
    }

    const raw: unknown = await response.json();
    if (!Array.isArray(raw) || !Array.isArray(raw[0])) {
      throw new Error('Invalid batch translation format');
    }

    const fullTranslated = (raw[0] as Array<[string | null]>)
      .map((seg) => (Array.isArray(seg) && typeof seg[0] === 'string' ? seg[0] : ''))
      .join('');

    const parts = fullTranslated.split(/\s*\|\|\|\s*/);

    if (parts.length === batch.length) {
      return batch.map((cue, idx) => ({
        id: cue.id,
        text: parts[idx].trim() || cue.text
      }));
    }

    console.warn(
      `[YT-Lang-AI] Batch delimiter mismatch: expected ${batch.length}, got ${parts.length}. Using fallback.`
    );
  } catch (err) {
    console.warn('[YT-Lang-AI] Batch translation failed, executing fallback:', err);
  }

  // Safe line-by-line fallback for this batch
  const fallbackResults = await Promise.all(
    batch.map(async (cue) => {
      try {
        const res = await fetchSingleText(cue.text, sourceLang, targetLang, false);
        return { id: cue.id, text: res.translation || cue.text };
      } catch {
        return { id: cue.id, text: cue.text };
      }
    })
  );

  return fallbackResults;
}
