import type { FreeTranslateWordResult } from '../types/messages';

export interface CueItem {
  id: string;
  text: string;
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
const WORD_CACHE_MAX_SIZE = 500;
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

  // 3. Dictionary / Synonyms / Alternatives from raw[1] (dt=bd)
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
  const dtParam = includeDictionary ? 'dt=t&dt=bd' : 'dt=t';
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(
    sl
  )}&tl=${encodeURIComponent(targetLang)}&${dtParam}&q=${encodeURIComponent(cleanText)}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Google Translate error ${response.status}`);
    }

    const json: unknown = await response.json();
    return parseSingleResponse(json, cleanText);
  } catch (err) {
    console.warn(`[YT-Lang-AI] Translation fetch error for "${cleanText}":`, err);
    return {
      translation: cleanText,
      alternatives: []
    };
  }
}

/**
 * Translates word and context sentence in parallel, with in-memory + local storage LRU caching.
 */
export async function translateWordAndContext(params: {
  word: string;
  sentence?: string;
  sourceLang?: string;
  targetLang: string;
}): Promise<FreeTranslateWordResult> {
  await loadWordCacheFromStorage();

  const sl = params.sourceLang && params.sourceLang !== 'unknown' ? params.sourceLang : 'auto';
  const tl = params.targetLang || 'en';
  const cacheKey = buildWordCacheKey(sl, tl, params.word, params.sentence);

  // 1. Check LRU Cache
  const cached = wordMemoryCache.get(cacheKey);
  if (cached) {
    // Re-insert to refresh LRU order
    wordMemoryCache.delete(cacheKey);
    wordMemoryCache.set(cacheKey, cached);
    return { ...cached, fromCache: true };
  }

  // 2. Check in-flight requests
  const inFlight = inFlightWordRequests.get(cacheKey);
  if (inFlight) {
    return inFlight;
  }

  // 3. Perform dual translation (word with dictionary + sentence without dictionary)
  const task = (async (): Promise<FreeTranslateWordResult> => {
    const cleanWord = params.word.trim();
    const cleanSentence = params.sentence?.trim() || '';

    try {
      const [wordResult, sentenceResult] = await Promise.all([
        fetchSingleText(cleanWord, sl, tl, true),
        cleanSentence && cleanSentence.toLowerCase() !== cleanWord.toLowerCase()
          ? fetchSingleText(cleanSentence, sl, tl, false)
          : Promise.resolve(null)
      ]);

      const result: FreeTranslateWordResult = {
        word: cleanWord,
        translation: wordResult.translation || cleanWord,
        sentenceTranslation: sentenceResult?.translation || '',
        alternatives: wordResult.alternatives,
        partOfSpeech: wordResult.partOfSpeech,
        detectedLang: wordResult.detectedLang,
        fromCache: false
      };

      // Store in LRU cache (enforce max size)
      if (wordMemoryCache.size >= WORD_CACHE_MAX_SIZE) {
        const oldestKey = wordMemoryCache.keys().next().value;
        if (oldestKey) {
          wordMemoryCache.delete(oldestKey);
        }
      }
      wordMemoryCache.set(cacheKey, result);
      void persistWordCacheToStorage();

      return result;
    } catch (err) {
      console.warn('[YT-Lang-AI] Word translation task error:', err);
      return {
        word: cleanWord,
        translation: cleanWord,
        sentenceTranslation: '',
        alternatives: [],
        fromCache: false
      };
    }
  })();

  inFlightWordRequests.set(cacheKey, task);
  try {
    return await task;
  } finally {
    inFlightWordRequests.delete(cacheKey);
  }
}

/**
 * Translates a batch of cues using delimiter packing, with line-by-line fallback and 24h cache.
 */
export async function translateCueBatch(params: {
  videoId: string;
  cues: CueItem[];
  sourceLang?: string;
  targetLang: string;
  onBatchProgress?: (batchTranslations: TranslatedCueItem[]) => void;
}): Promise<TranslatedCueItem[]> {
  const { videoId, cues, targetLang } = params;
  if (!cues || cues.length === 0) return [];

  const sl = params.sourceLang && params.sourceLang !== 'unknown' ? params.sourceLang : 'auto';
  const tl = targetLang || 'en';
  const cacheKey = `free_sub_tr:${videoId}:${tl}`;

  // 1. Check persistent subtitle cache
  let cachedTrack: CachedSubtitleTrack | null = null;
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

  // Deduplicate in-flight cue batch requests for the same video & language
  const inFlightKey = `${videoId}:${sl}:${tl}`;
  const existingInFlight = inFlightCueRequests.get(inFlightKey);
  if (existingInFlight) {
    return existingInFlight;
  }

  const task = (async (): Promise<TranslatedCueItem[]> => {
    const translationMap: Record<string, string> = {
      ...(cachedTrack?.translations || {})
    };

    // Filter cues that still need translation
    const missingCues = cues.filter((c) => !translationMap[c.id]);

    // If some cues are already in cache, send them as the initial progress batch
    const alreadyCachedItems = cues
      .filter((c) => translationMap[c.id])
      .map((c) => ({ id: c.id, text: translationMap[c.id] }));
    if (alreadyCachedItems.length > 0) {
      params.onBatchProgress?.(alreadyCachedItems);
    }

    // Process missing cues in batches of CUE_BATCH_SIZE (25)
    for (let i = 0; i < missingCues.length; i += CUE_BATCH_SIZE) {
      const batch = missingCues.slice(i, i + CUE_BATCH_SIZE);
      const batchResult = await translateSingleCueBatch(batch, sl, tl);

      for (const item of batchResult) {
        translationMap[item.id] = item.text;
      }

      // Stream progressive progress
      params.onBatchProgress?.(batchResult);

      // Persist progress to storage
      if (typeof chrome !== 'undefined' && chrome.storage?.local && videoId && videoId !== 'unknown') {
        const toSave: CachedSubtitleTrack = {
          savedAt: Date.now(),
          translations: translationMap
        };
        void chrome.storage.local.set({ [cacheKey]: toSave });
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

async function translateSingleCueBatch(
  batch: CueItem[],
  sourceLang: string,
  targetLang: string
): Promise<TranslatedCueItem[]> {
  if (batch.length === 0) return [];

  // If batch has only 1 item, translate directly
  if (batch.length === 1) {
    try {
      const res = await fetchSingleText(batch[0].text, sourceLang, targetLang, false);
      return [{ id: batch[0].id, text: res.translation || batch[0].text }];
    } catch {
      return [{ id: batch[0].id, text: batch[0].text }];
    }
  }

  // Join batch with delimiter
  const joinedText = batch.map((c) => c.text.replace(/\r?\n/g, ' ')).join(BATCH_DELIMITER);

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

    // If split parts count matches batch count exactly, return mapped items
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
