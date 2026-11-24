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
  /** Set when the selected provider failed for this cue. */
  errorProvider?: string;
}

function providerLabel(provider?: string): string {
  if (provider === 'deepl') return 'DeepL';
  if (provider === 'google') return 'Google Translate';
  if (provider === 'googleDict') return 'Google Dict';
  return 'MyMemory';
}

interface CachedSubtitleTrack {
  savedAt: number;
  translations: Record<string, string>; // cueId -> translatedText
}

const WORD_CACHE_STORAGE_KEY = 'ytai_free_word_cache';
const SUBTITLE_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const CUE_BATCH_SIZE = 25;
const BATCH_DELIMITER = '\n|||\n';

// Google's unauthenticated `gtx` endpoint allows roughly one request per second.
// Two rapid requests get HTTP 429 with an HTML "Sorry..." page even though a
// single request from the address bar works fine.
const GOOGLE_MIN_INTERVAL_MS = 1200;
let googleLastRequestAt = 0;
let googleQueue: Promise<unknown> = Promise.resolve();

function fetchGoogleSpaced(url: string): Promise<Response> {
  const run = googleQueue.then(async () => {
    const waitMs = Math.max(0, GOOGLE_MIN_INTERVAL_MS - (Date.now() - googleLastRequestAt));
    if (waitMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
    }
    googleLastRequestAt = Date.now();
    return fetch(url);
  });
  googleQueue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

async function fetchGoogle(url: string): Promise<Response> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetchGoogleSpaced(url);
    if (response.status !== 429) return response;
  }
  return fetchGoogleSpaced(url);
}

/**
 * Free fallback endpoint used by Chrome's dictionary. No key, no daily quota,
 * and unlike the `gtx` endpoint it tolerates rapid sequential requests.
 * Multiple `q` parameters are translated in a single request.
 */
async function fetchGoogleDictTexts(
  texts: string[],
  sourceLang: string,
  targetLang: string
): Promise<string[]> {
  if (texts.length === 0) return [];
  const sl = !sourceLang || sourceLang === 'unknown' ? 'auto' : sourceLang;
  const params = new URLSearchParams({ client: 'dict-chrome-ex', sl, tl: targetLang });
  for (const text of texts) params.append('q', text);

  const response = await fetch(`https://clients5.google.com/translate_a/t?${params.toString()}`);
  if (!response.ok) throw new Error(`Google Dict request failed with HTTP ${response.status}`);
  const json: unknown = await response.json();
  if (!Array.isArray(json)) throw new Error('Invalid Google Dict response');

  const results = json.map((item) => {
    if (Array.isArray(item)) return typeof item[0] === 'string' ? item[0] : '';
    return typeof item === 'string' ? item : '';
  });
  if (results.length !== texts.length) throw new Error('Google Dict response length mismatch');
  return results.map((text, index) => text || texts[index]);
}

/**
 * Automatic fallback: if the selected provider fails, try the other free,
 * key-less endpoints in sequence. MyMemory has a daily quota, Google GTX is
 * rate-limited to roughly one request/second, and Google Dict is the most
 * tolerant of rapid requests.
 */
async function fetchFallbackText(
  text: string,
  sourceLang: string,
  targetLang: string,
  config: TranslationProviderConfig
): Promise<SingleParseResult | undefined> {
  if (!text.trim()) return undefined;
  const provider = config.provider ?? 'mymemory';

  if (provider !== 'mymemory') {
    try {
      const result = await fetchMyMemoryText(text, sourceLang, targetLang, config.myMemoryEmail);
      return {
        translation: result.text,
        alternatives: [],
        detectedLang: result.detectedSourceLanguage?.toLowerCase()
      };
    } catch (err) {
      console.warn('[YT-Lang-AI] MyMemory fallback failed:', err);
    }
  }

  if (provider !== 'googleDict') {
    try {
      const [result] = await fetchGoogleDictTexts([text], sourceLang, targetLang);
      return { translation: result, alternatives: [] };
    } catch (err) {
      console.warn('[YT-Lang-AI] Google Dict fallback failed:', err);
    }
  }

  if (provider !== 'google') {
    try {
      const sl = sourceLang && sourceLang !== 'unknown' ? sourceLang : 'auto';
      const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(
        sl
      )}&tl=${encodeURIComponent(targetLang)}&dt=t&q=${encodeURIComponent(text)}`;
      const res = await fetchGoogle(url);
      if (!res.ok) throw new Error(`Google GTX request failed with HTTP ${res.status}`);
      return parseSingleResponse(await res.json(), text);
    } catch (err) {
      console.warn('[YT-Lang-AI] Google GTX fallback failed:', err);
    }
  }

  return undefined;
}

export interface TranslationProviderConfig {
  provider?: 'mymemory' | 'deepl' | 'google' | 'googleDict';
  myMemoryEmail?: string;
  deeplApiKey?: string;
}

async function fetchMyMemoryText(
  text: string,
  sourceLang: string,
  targetLang: string,
  email?: string
): Promise<{ text: string; detectedSourceLanguage?: string }> {
  const source =
    !sourceLang || sourceLang === 'auto' || sourceLang === 'unknown'
      ? 'autodetect'
      : sourceLang;
  const params = new URLSearchParams({
    q: text,
    langpair: `${source}|${targetLang}`
  });
  const cleanEmail = email?.trim();
  if (cleanEmail) params.set('de', cleanEmail);

  const response = await fetch(`https://api.mymemory.translated.net/get?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`MyMemory request failed with HTTP ${response.status}`);
  }
  const payload = (await response.json()) as {
    responseData?: { translatedText?: string; detectedLanguage?: string };
    responseStatus?: number | string;
    responseDetails?: string;
    quotaFinished?: boolean;
  };
  if (payload.quotaFinished) throw new Error('MyMemory daily quota is exhausted');
  if (Number(payload.responseStatus ?? 200) !== 200) {
    throw new Error(payload.responseDetails || 'MyMemory translation failed');
  }
  const translated = payload.responseData?.translatedText?.trim();
  if (!translated) throw new Error('MyMemory returned an empty translation');
  return {
    text: translated,
    detectedSourceLanguage: payload.responseData?.detectedLanguage
  };
}

function mapDeepLLanguage(language: string, target: boolean): string | undefined {
  const clean = language.trim().toLowerCase();
  if (!clean || clean === 'auto' || clean === 'unknown') return undefined;
  if (clean === 'zh-cn' || clean === 'zh-hans') return target ? 'ZH-HANS' : 'ZH';
  if (clean === 'zh-tw' || clean === 'zh-hant') return target ? 'ZH-HANT' : 'ZH';
  if (clean === 'en') return target ? 'EN-US' : 'EN';
  if (clean === 'pt') return target ? 'PT-BR' : 'PT';
  return clean.toUpperCase();
}

async function fetchDeepLTexts(
  texts: string[],
  sourceLang: string,
  targetLang: string,
  apiKey: string
): Promise<Array<{ text: string; detectedSourceLanguage?: string }>> {
  const cleanKey = apiKey.trim();
  if (!cleanKey) throw new Error('DeepL API key is not configured');
  const endpoint = cleanKey.endsWith(':fx')
    ? 'https://api-free.deepl.com/v2/translate'
    : 'https://api.deepl.com/v2/translate';
  const source = mapDeepLLanguage(sourceLang, false);
  const target = mapDeepLLanguage(targetLang, true);
  if (!target) throw new Error(`DeepL target language is invalid: ${targetLang}`);

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `DeepL-Auth-Key ${cleanKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      text: texts,
      target_lang: target,
      ...(source ? { source_lang: source } : {})
    })
  });
  if (!response.ok) {
    throw new Error(`DeepL request failed with HTTP ${response.status}`);
  }
  const payload = (await response.json()) as {
    translations?: Array<{ text?: string; detected_source_language?: string }>;
  };
  if (!Array.isArray(payload.translations) || payload.translations.length !== texts.length) {
    throw new Error('DeepL returned an invalid translation response');
  }
  return payload.translations.map((item, index) => ({
    text: item.text?.trim() || texts[index],
    detectedSourceLanguage: item.detected_source_language
  }));
}

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
  /** Selected provider failed — do not present the original text as a translation. */
  unavailable?: boolean;
  errorProvider?: string;
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
  includeDictionary: boolean,
  config: TranslationProviderConfig
): Promise<SingleParseResult> {
  const cleanText = text.trim();
  if (!cleanText) {
    return { translation: '', alternatives: [] };
  }

  if ((config.provider ?? 'mymemory') === 'mymemory') {
    const result = await fetchMyMemoryText(
      cleanText,
      sourceLang,
      targetLang,
      config.myMemoryEmail
    );
    return {
      translation: result.text,
      alternatives: [],
      detectedLang: result.detectedSourceLanguage?.toLowerCase()
    };
  }

  if (config.provider === 'deepl') {
    const [result] = await fetchDeepLTexts(
      [cleanText],
      sourceLang,
      targetLang,
      config.deeplApiKey ?? ''
    );
    return {
      translation: result.text,
      alternatives: [],
      detectedLang: result.detectedSourceLanguage?.toLowerCase()
    };
  }

  if (config.provider === 'googleDict') {
    const [result] = await fetchGoogleDictTexts([cleanText], sourceLang, targetLang);
    return { translation: result, alternatives: [] };
  }

  const sl = sourceLang && sourceLang !== 'unknown' ? sourceLang : 'auto';
  const dtParams = includeDictionary ? '&dt=t&dt=bd&dt=rm' : '&dt=t';
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(
    sl
  )}&tl=${encodeURIComponent(targetLang)}${dtParams}&q=${encodeURIComponent(cleanText)}`;

  const res = await fetchGoogle(url);
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
  provider?: 'mymemory' | 'deepl' | 'google' | 'googleDict';
  myMemoryEmail?: string;
  deeplApiKey?: string;
}): Promise<FreeTranslateWordResult> {
  await loadWordCacheFromStorage();

  const sl = params.sourceLang || 'auto';
  const tl = params.targetLang || 'ru';
  const provider = params.provider ?? 'mymemory';
  const config: TranslationProviderConfig = {
    provider,
    myMemoryEmail: params.myMemoryEmail,
    deeplApiKey: params.deeplApiKey
  };
  const cacheKey = `${provider}:${buildWordCacheKey(sl, tl, params.word, params.sentence)}`;

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
      wordRes = await fetchSingleText(params.word, sl, tl, true, config);
    } catch (err) {
      console.warn(`[YT-Lang-AI] ${providerLabel(provider)} translation failed:`, err);
      wordRes =
        (await fetchFallbackText(params.word, sl, tl, config)) ?? {
          translation: '',
          alternatives: [],
          unavailable: true,
          errorProvider: providerLabel(provider)
        };
    }

    let sentenceTranslation = '';
    if (params.sentence && params.sentence.trim()) {
      const sentenceText = params.sentence.trim();
      try {
        const sRes = await fetchSingleText(sentenceText, sl, tl, false, config);
        sentenceTranslation = sRes.translation;
      } catch (err) {
        console.warn(`[YT-Lang-AI] ${providerLabel(provider)} sentence translation failed:`, err);
        sentenceTranslation =
          (await fetchFallbackText(sentenceText, sl, tl, config))?.translation ?? '';
      }
    }

    const result: FreeTranslateWordResult = {
      word: params.word,
      translation: wordRes.translation,
      sentenceTranslation,
      alternatives: wordRes.alternatives,
      partOfSpeech: wordRes.partOfSpeech,
      detectedLang: wordRes.detectedLang,
      translationUnavailable: wordRes.unavailable,
      errorProvider: wordRes.errorProvider
    };

    // Never cache a failed translation: the original text would then be shown
    // as if it were a translation for the rest of the session ("en -> en").
    if (!wordRes.unavailable && wordRes.translation) {
      wordMemoryCache.set(cacheKey, result);
      void persistWordCacheToStorage();
    }

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
  provider?: 'mymemory' | 'deepl' | 'google' | 'googleDict';
  myMemoryEmail?: string;
  deeplApiKey?: string;
}): Promise<TranslatedCueItem[]> {
  const { videoId, cues, priorityTime } = params;
  if (!cues || cues.length === 0) return [];

  const sl = params.sourceLang && params.sourceLang !== 'unknown' ? params.sourceLang : 'auto';
  const tl = params.targetLang || 'ru';
  const provider = params.provider ?? 'mymemory';
  const cacheKey = `free_sub_tr:${provider}:${videoId}:${tl}`;

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

  // Deduplicate in-flight requests only for an identical cue set. On Netflix a new
  // cue is emitted while the previous batch is still being translated (MyMemory
  // translates cues one by one, which is slow). Keying only by video/language made
  // those later requests reuse the old promise, so the new cue never got a
  // translation and the overlay kept showing a stale line.
  let cueSignature = 0;
  for (const cue of cues) {
    for (let i = 0; i < cue.id.length; i++) {
      cueSignature = (cueSignature * 31 + cue.id.charCodeAt(i)) | 0;
    }
  }
  const inFlightKey = `${provider}:${videoId}:${sl}:${tl}:${cues.length}:${cueSignature}`;
  const existingInFlight = inFlightCueRequests.get(inFlightKey);
  if (existingInFlight) {
    return existingInFlight;
  }

  const task = (async (): Promise<TranslatedCueItem[]> => {
    const translationMap: Record<string, string> = {
      ...(cachedTrack?.translations || {})
    };
    const errorMap: Record<string, string> = {};

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
        const batchResult = await translateSingleCueBatch(batch, sl, tl, {
          provider,
          myMemoryEmail: params.myMemoryEmail,
          deeplApiKey: params.deeplApiKey
        });
        for (const item of batchResult) {
          translationMap[item.id] = item.text;
          if (item.errorProvider) errorMap[item.id] = item.errorProvider;
        }
        params.onBatchProgress?.(batchResult);
        saveProgress(videoId, cacheKey, translationMap);
      }
    } else {
      // Process in natural chronological order
      for (const batch of batches) {
        const batchResult = await translateSingleCueBatch(batch, sl, tl, {
          provider,
          myMemoryEmail: params.myMemoryEmail,
          deeplApiKey: params.deeplApiKey
        });
        for (const item of batchResult) {
          translationMap[item.id] = item.text;
          if (item.errorProvider) errorMap[item.id] = item.errorProvider;
        }
        params.onBatchProgress?.(batchResult);
        saveProgress(videoId, cacheKey, translationMap);
      }
    }

    return cues.map((c) => ({
      id: c.id,
      text: translationMap[c.id] ?? '',
      ...(errorMap[c.id] ? { errorProvider: errorMap[c.id] } : {})
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
  targetLang: string,
  config: TranslationProviderConfig
): Promise<TranslatedCueItem[]> {
  if (batch.length === 0) return [];

  if (batch.length === 1) {
    try {
      const res = await fetchSingleText(batch[0].text, sourceLang, targetLang, false, config);
      return [{ id: batch[0].id, text: res.translation }];
    } catch (err) {
      console.warn(`[YT-Lang-AI] ${providerLabel(config.provider)} cue translation failed:`, err);
      const fallback = await fetchFallbackText(batch[0].text, sourceLang, targetLang, config);
      return [
        {
          id: batch[0].id,
          text: fallback?.translation ?? '',
          ...(fallback ? {} : { errorProvider: providerLabel(config.provider) })
        }
      ];
    }
  }

  if ((config.provider ?? 'mymemory') === 'mymemory') {
    const translated: TranslatedCueItem[] = [];
    for (const cue of batch) {
      try {
        const result = await fetchMyMemoryText(
          cue.text.replace(/[\r\n]+/g, ' '),
          sourceLang,
          targetLang,
          config.myMemoryEmail
        );
        translated.push({ id: cue.id, text: result.text });
      } catch (err) {
        console.warn('[YT-Lang-AI] MyMemory cue translation failed:', err);
        const fallback = await fetchFallbackText(cue.text, sourceLang, targetLang, config);
        translated.push({
          id: cue.id,
          text: fallback?.translation ?? '',
          ...(fallback ? {} : { errorProvider: 'MyMemory' })
        });
      }
    }
    return translated;
  }

  if (config.provider === 'deepl') {
    try {
      const translations = await fetchDeepLTexts(
        batch.map((cue) => cue.text.replace(/[\r\n]+/g, ' ')),
        sourceLang,
        targetLang,
        config.deeplApiKey ?? ''
      );
      return batch.map((cue, index) => ({ id: cue.id, text: translations[index].text }));
    } catch (err) {
      console.warn('[YT-Lang-AI] DeepL batch translation failed:', err);
      return batch.map((cue) => ({ id: cue.id, text: '', errorProvider: 'DeepL' }));
    }
  }

  if (config.provider === 'googleDict') {
    try {
      const results = await fetchGoogleDictTexts(
        batch.map((cue) => cue.text.replace(/[\r\n]+/g, ' ')),
        sourceLang,
        targetLang
      );
      return batch.map((cue, index) => ({ id: cue.id, text: results[index] }));
    } catch (err) {
      console.warn('[YT-Lang-AI] Google Dict batch failed:', err);
      return batch.map((cue) => ({ id: cue.id, text: '', errorProvider: 'Google Dict' }));
    }
  }

  // Join batch with delimiter
  const joinedText = batch.map((c) => c.text.replace(/[\r\n]+/g, ' ')).join(BATCH_DELIMITER);

  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(
      sourceLang
    )}&tl=${encodeURIComponent(targetLang)}&dt=t&q=${encodeURIComponent(joinedText)}`;

    const response = await fetchGoogle(url);
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
        text: parts[idx].trim()
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
        const res = await fetchSingleText(cue.text, sourceLang, targetLang, false, config);
        return { id: cue.id, text: res.translation };
      } catch (err) {
        console.warn('[YT-Lang-AI] Google GTX cue translation failed:', err);
        const fallback = await fetchFallbackText(cue.text, sourceLang, targetLang, config);
        return {
          id: cue.id,
          text: fallback?.translation ?? '',
          ...(fallback ? {} : { errorProvider: 'Google Translate' })
        };
      }
    })
  );

  return fallbackResults;
}
