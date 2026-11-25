import {
  getCachedCueTranslationsForVideo,
  saveCachedCueTranslations
} from '../storage/db';
import type { FreeTranslateWordResult, TranslationRuntimeStatus } from '../types/messages';
import {
  computeSourceTextHash,
  isQuotaOrRateLimitMessage,
  isValidTranslationText,
  normalizeSubtitleForHash,
  sanitizeTextForBatch,
  utf8ByteLength
} from '../utils/translationCache';

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

export interface TranslationProgressPayload {
  videoId: string;
  targetLang: string;
  batchTranslations: TranslatedCueItem[];
  status: TranslationRuntimeStatus;
}

interface LegacyCachedSubtitleTrack {
  savedAt?: number;
  translations?: Record<string, string>;
}

const WORD_CACHE_STORAGE_KEY = 'ytai_free_word_cache';
const GTX_BLOCKED_UNTIL_KEY = 'ytai_gtx_blocked_until';
const MYMEMORY_BLOCKED_UNTIL_KEY = 'ytai_mymemory_blocked_until';

const GTX_COOLDOWN_MS = 60_000;
const MYMEMORY_COOLDOWN_MS = 60_000;
const TRANSIENT_COOLDOWN_MS = 15_000;
const LEGACY_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const HOT_LOOKAHEAD_CUES = 15; // Current cue + 15 subsequent cues = up to 16 cues
const GTX_HOT_MAX_CUES = 16;
const GTX_BG_BATCH_CUES = 14; // 12-15 cues per background request
const GTX_MAX_BATCH_CHARS = 1800;
const GTX_MAX_ENCODED_QUERY_CHARS = 3600;

const MYMEMORY_MAX_BYTES = 450;
const BG_BATCH_DELAY_MS = 600; // 500-700ms throttle between background requests
const GTX_HIGH_PRIORITY_MIN_GAP_MS = 180;
const GTX_SINGLE_FALLBACK_DELAY_MS = 120;
const MYMEMORY_CHUNK_DELAY_MS = 300;
const BATCH_DELIMITER = '\n|||\n';

export class ProviderRateLimitError extends Error {
  public readonly provider: 'google' | 'mymemory';
  public readonly blockedUntil: number;

  constructor(provider: 'google' | 'mymemory', blockedUntil: number, message?: string) {
    super(message || `${provider} rate limited until ${blockedUntil}`);
    this.name = 'ProviderRateLimitError';
    this.provider = provider;
    this.blockedUntil = blockedUntil;
  }
}

let gtxBlockedUntil = 0;
let myMemoryBlockedUntil = 0;
let circuitStateLoaded = false;

async function loadCircuitBreakers(): Promise<void> {
  if (circuitStateLoaded) return;
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const res = await chrome.storage.local.get([
        GTX_BLOCKED_UNTIL_KEY,
        MYMEMORY_BLOCKED_UNTIL_KEY
      ]);
      const gtxVal = Number(res?.[GTX_BLOCKED_UNTIL_KEY]);
      const mmVal = Number(res?.[MYMEMORY_BLOCKED_UNTIL_KEY]);
      if (Number.isFinite(gtxVal) && gtxVal > gtxBlockedUntil) {
        gtxBlockedUntil = gtxVal;
      }
      if (Number.isFinite(mmVal) && mmVal > myMemoryBlockedUntil) {
        myMemoryBlockedUntil = mmVal;
      }
    }
  } catch {
    // Ignore storage read error
  } finally {
    circuitStateLoaded = true;
  }
}

async function isGtxBlocked(): Promise<boolean> {
  await loadCircuitBreakers();
  return Date.now() < gtxBlockedUntil;
}

async function isMyMemoryBlocked(): Promise<boolean> {
  await loadCircuitBreakers();
  return Date.now() < myMemoryBlockedUntil;
}

function triggerGtxCircuitBreaker(durationMs = GTX_COOLDOWN_MS): number {
  const until = Date.now() + durationMs;
  if (until > gtxBlockedUntil) {
    gtxBlockedUntil = until;
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      void chrome.storage.local.set({ [GTX_BLOCKED_UNTIL_KEY]: until });
    }
  }
  return gtxBlockedUntil;
}

function triggerMyMemoryCircuitBreaker(durationMs = MYMEMORY_COOLDOWN_MS): number {
  const until = Date.now() + durationMs;
  if (until > myMemoryBlockedUntil) {
    myMemoryBlockedUntil = until;
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      void chrome.storage.local.set({ [MYMEMORY_BLOCKED_UNTIL_KEY]: until });
    }
  }
  return myMemoryBlockedUntil;
}

export async function clearProviderCooldowns(): Promise<void> {
  gtxBlockedUntil = 0;
  myMemoryBlockedUntil = 0;
  circuitStateLoaded = true;
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    await chrome.storage.local
      .remove([GTX_BLOCKED_UNTIL_KEY, MYMEMORY_BLOCKED_UNTIL_KEY])
      .catch(() => undefined);
  }
}

async function getCooldownStatusSnapshot(): Promise<TranslationRuntimeStatus> {
  const gtxBlocked = await isGtxBlocked();
  const mmBlocked = await isMyMemoryBlocked();

  if (gtxBlocked && mmBlocked) {
    return {
      state: 'cooldown',
      provider: 'none',
      retryAt: Math.min(gtxBlockedUntil, myMemoryBlockedUntil)
    };
  }
  return { state: 'idle' };
}

// Two-lane sequential queue: 'high' priority (hot window / word popup) runs ahead of 'low' background work
interface QueuedNetworkTask<T> {
  priority: 'high' | 'low';
  task: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (err: unknown) => void;
}

const highPriorityNetworkQueue: Array<QueuedNetworkTask<unknown>> = [];
const lowPriorityNetworkQueue: Array<QueuedNetworkTask<unknown>> = [];
let networkQueueRunning = false;
let lastNetworkRequestAt = 0;

function enqueueNetworkTask<T>(
  priority: 'high' | 'low',
  task: () => Promise<T>
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const entry: QueuedNetworkTask<T> = { priority, task, resolve, reject };
    if (priority === 'high') {
      highPriorityNetworkQueue.push(entry as QueuedNetworkTask<unknown>);
    } else {
      lowPriorityNetworkQueue.push(entry as QueuedNetworkTask<unknown>);
    }
    void drainNetworkQueue();
  });
}

async function drainNetworkQueue(): Promise<void> {
  if (networkQueueRunning) return;
  networkQueueRunning = true;

  try {
    while (highPriorityNetworkQueue.length > 0 || lowPriorityNetworkQueue.length > 0) {
      const next =
        highPriorityNetworkQueue.shift() ?? lowPriorityNetworkQueue.shift();
      if (!next) break;

      const elapsed = Date.now() - lastNetworkRequestAt;
      if (lastNetworkRequestAt > 0 && elapsed < GTX_HIGH_PRIORITY_MIN_GAP_MS) {
        await sleep(GTX_HIGH_PRIORITY_MIN_GAP_MS - elapsed);
      }

      try {
        const res = await next.task();
        next.resolve(res);
      } catch (err) {
        next.reject(err);
      } finally {
        lastNetworkRequestAt = Date.now();
      }
    }
  } finally {
    networkQueueRunning = false;
  }
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Word lookup LRU cache (chrome.storage.local + RAM)
const wordMemoryCache = new Map<string, FreeTranslateWordResult>();
let isStorageWordCacheLoaded = false;
let isStorageWordCacheSaving = false;
let pendingSaveStorageWordCache = false;
const inFlightWordRequests = new Map<string, Promise<FreeTranslateWordResult>>();

async function loadWordCacheFromStorage(): Promise<void> {
  if (isStorageWordCacheLoaded) return;
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const res = await chrome.storage.local.get(WORD_CACHE_STORAGE_KEY);
      const raw = res[WORD_CACHE_STORAGE_KEY];
      if (Array.isArray(raw)) {
        for (const item of raw) {
          if (
            item &&
            typeof item === 'object' &&
            item.key &&
            item.data &&
            isValidTranslationText(item.data.translation)
          ) {
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
      const entries = Array.from(wordMemoryCache.entries())
        .filter(([, data]) => isValidTranslationText(data.translation))
        .slice(-1000)
        .map(([key, data]) => ({ key, data }));
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

export interface SingleParseResult {
  translation: string;
  alternatives: string[];
  partOfSpeech?: string;
  detectedLang?: string;
}

function parseGtxResponse(raw: unknown): SingleParseResult {
  if (!Array.isArray(raw) || !Array.isArray(raw[0])) {
    throw new Error('Unexpected Google GTX response shape');
  }

  const parts: string[] = [];
  for (const seg of raw[0]) {
    if (Array.isArray(seg) && typeof seg[0] === 'string') {
      parts.push(seg[0]);
    }
  }

  const translation = parts.join('').trim();
  if (!isValidTranslationText(translation)) {
    throw new Error('Empty or invalid translation returned by Google GTX');
  }

  const detectedLang = typeof raw[2] === 'string' ? raw[2] : undefined;
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
            isValidTranslationText(candidate) &&
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

async function fetchGtxJson(url: string): Promise<unknown> {
  if (await isGtxBlocked()) {
    throw new ProviderRateLimitError('google', gtxBlockedUntil);
  }

  const res = await fetch(url);
  if (res.status === 429 || res.status === 403) {
    const until = triggerGtxCircuitBreaker(GTX_COOLDOWN_MS);
    throw new ProviderRateLimitError('google', until, `Google GTX HTTP ${res.status}`);
  }
  if (!res.ok) {
    throw new Error(`Google GTX request failed with HTTP ${res.status}`);
  }

  const text = await res.text();
  if (!text || /^\s*</.test(text)) {
    const until = triggerGtxCircuitBreaker(GTX_COOLDOWN_MS);
    throw new ProviderRateLimitError('google', until, 'Google GTX returned HTML challenge');
  }

  return JSON.parse(text) as unknown;
}

async function fetchGtxSingleText(
  text: string,
  sourceLang: string,
  targetLang: string,
  includeDictionary: boolean
): Promise<SingleParseResult> {
  const cleanText = text.trim();
  if (!cleanText) {
    throw new Error('Empty source text');
  }

  const sl = sourceLang && sourceLang !== 'unknown' ? sourceLang : 'auto';
  const dtParams = includeDictionary ? '&dt=t&dt=bd&dt=rm' : '&dt=t';
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(
    sl
  )}&tl=${encodeURIComponent(targetLang)}${dtParams}&q=${encodeURIComponent(cleanText)}`;

  const json = await fetchGtxJson(url);
  return parseGtxResponse(json);
}

function resolveMyMemorySourceLang(sourceLang: string, sampleText: string): string {
  const clean = (sourceLang || '').trim().toLowerCase();
  if (clean && clean !== 'auto' && clean !== 'unknown' && clean !== 'und') {
    return clean.split('-')[0];
  }

  if (/[а-яёіїєґ]/i.test(sampleText)) {
    return /[іїєґ]/i.test(sampleText) ? 'uk' : 'ru';
  }
  if (/[\u3040-\u30ff]/.test(sampleText)) return 'ja';
  if (/[\uac00-\ud7af]/.test(sampleText)) return 'ko';
  if (/[\u4e00-\u9fff]/.test(sampleText)) return 'zh';
  if (/[äöüß]/i.test(sampleText)) return 'de';
  if (/[ñ¿¡]/i.test(sampleText)) return 'es';
  if (/[àâçéèêëîïôûùüÿœ]/i.test(sampleText)) return 'fr';
  if (/\b(the|and|that|this|with|you|for|are|was|have)\b/i.test(sampleText)) return 'en';

  return 'en';
}

function splitTextToMaxUtf8Bytes(text: string, maxBytes: number): string[] {
  const clean = text.trim();
  if (!clean) return [];
  if (utf8ByteLength(clean) <= maxBytes) return [clean];

  const words = clean.split(/\s+/);
  const chunks: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (utf8ByteLength(candidate) <= maxBytes) {
      current = candidate;
      continue;
    }

    if (current) {
      chunks.push(current);
      current = '';
    }

    if (utf8ByteLength(word) <= maxBytes) {
      current = word;
    } else {
      // Split single oversized token safely by code points within byte limit
      let slice = '';
      for (const ch of word) {
        if (utf8ByteLength(slice + ch) > maxBytes) {
          if (slice) chunks.push(slice);
          slice = ch;
        } else {
          slice += ch;
        }
      }
      if (slice) current = slice;
    }
  }

  if (current) {
    chunks.push(current);
  }
  return chunks;
}

async function fetchMyMemoryChunkRaw(
  queryText: string,
  sourceLang: string,
  targetLang: string
): Promise<string> {
  if (await isMyMemoryBlocked()) {
    throw new ProviderRateLimitError('mymemory', myMemoryBlockedUntil);
  }

  const sl = resolveMyMemorySourceLang(sourceLang, queryText);
  const tl = targetLang.trim().toLowerCase().split('-')[0] || 'ru';
  if (sl === tl) {
    throw new Error('MyMemory source and target languages match');
  }

  const params = new URLSearchParams({
    q: queryText,
    langpair: `${sl}|${tl}`
  });

  const res = await fetch(`https://api.mymemory.translated.net/get?${params.toString()}`);
  if (res.status === 429 || res.status === 403) {
    const until = triggerMyMemoryCircuitBreaker(MYMEMORY_COOLDOWN_MS);
    throw new ProviderRateLimitError('mymemory', until, `MyMemory HTTP ${res.status}`);
  }
  if (!res.ok) {
    throw new Error(`MyMemory failed with HTTP ${res.status}`);
  }

  const payload = (await res.json()) as {
    responseData?: { translatedText?: string };
    responseStatus?: number | string;
    responseDetails?: string;
    quotaFinished?: boolean;
  };

  const details = typeof payload.responseDetails === 'string' ? payload.responseDetails : '';
  const rawText =
    typeof payload.responseData?.translatedText === 'string'
      ? payload.responseData.translatedText.trim()
      : '';

  if (
    payload.quotaFinished === true ||
    Number(payload.responseStatus) === 429 ||
    isQuotaOrRateLimitMessage(details) ||
    isQuotaOrRateLimitMessage(rawText)
  ) {
    const until = triggerMyMemoryCircuitBreaker(MYMEMORY_COOLDOWN_MS);
    throw new ProviderRateLimitError('mymemory', until, details || rawText || 'MyMemory quota exceeded');
  }

  if (Number(payload.responseStatus ?? 200) !== 200) {
    throw new Error(details || `MyMemory responseStatus ${payload.responseStatus}`);
  }

  if (!isValidTranslationText(rawText)) {
    throw new Error('MyMemory returned empty or invalid translation');
  }

  return rawText;
}

async function fetchMyMemoryTextSafe(
  text: string,
  sourceLang: string,
  targetLang: string
): Promise<string> {
  const subChunks = splitTextToMaxUtf8Bytes(text, MYMEMORY_MAX_BYTES);
  if (subChunks.length === 0) {
    throw new Error('Empty MyMemory input');
  }

  const translatedParts: string[] = [];
  for (let i = 0; i < subChunks.length; i++) {
    if (i > 0) {
      await sleep(MYMEMORY_CHUNK_DELAY_MS);
    }
    const part = await fetchMyMemoryChunkRaw(subChunks[i], sourceLang, targetLang);
    translatedParts.push(part);
  }
  return translatedParts.join(' ').trim();
}

export async function translateSingleTextWithCascade(params: {
  text: string;
  sourceLang?: string;
  targetLang: string;
  includeDictionary?: boolean;
}): Promise<SingleParseResult> {
  const sl = params.sourceLang && params.sourceLang !== 'unknown' ? params.sourceLang : 'auto';
  const tl = params.targetLang || 'ru';
  const clean = params.text.trim();
  if (!clean) {
    return { translation: '', alternatives: [] };
  }

  return enqueueNetworkTask('high', async () => {
    try {
      return await fetchGtxSingleText(clean, sl, tl, Boolean(params.includeDictionary));
    } catch {
      const mmTranslation = await fetchMyMemoryTextSafe(clean, sl, tl);
      return {
        translation: mmTranslation,
        alternatives: []
      };
    }
  });
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
  if (cached && isValidTranslationText(cached.translation)) {
    return { ...cached, fromCache: true };
  }

  const inFlight = inFlightWordRequests.get(cacheKey);
  if (inFlight) {
    return inFlight;
  }

  const task = (async (): Promise<FreeTranslateWordResult> => {
    let wordRes: SingleParseResult;
    let wordFetchOk = true;
    try {
      wordRes = await translateSingleTextWithCascade({
        text: params.word,
        sourceLang: sl,
        targetLang: tl,
        includeDictionary: true
      });
    } catch {
      wordFetchOk = false;
      wordRes = { translation: params.word, alternatives: [] };
    }

    let sentenceTranslation = '';
    if (wordFetchOk && params.sentence && params.sentence.trim()) {
      try {
        const sRes = await translateSingleTextWithCascade({
          text: params.sentence,
          sourceLang: sl,
          targetLang: tl,
          includeDictionary: false
        });
        if (isValidTranslationText(sRes.translation)) {
          sentenceTranslation = sRes.translation;
        }
      } catch {
        sentenceTranslation = '';
      }
    }

    const result: FreeTranslateWordResult = {
      word: params.word,
      translation: wordFetchOk ? wordRes.translation : params.word,
      sentenceTranslation,
      alternatives: wordRes.alternatives,
      partOfSpeech: wordRes.partOfSpeech,
      detectedLang: wordRes.detectedLang
    };

    if (wordFetchOk && isValidTranslationText(result.translation)) {
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

interface UniqueBatchGroup {
  hash: string;
  sanitizedText: string;
  rawText: string;
  cueIds: string[];
  firstIndex: number;
  startTime: number;
  endTime: number;
}

function splitBatchParts(fullTranslated: string, expectedCount: number): string[] | null {
  let parts = fullTranslated.split(/\s*\|\|\|\s*/);
  if (parts.length !== expectedCount) {
    parts = fullTranslated.split(/\s*\|\s*\|\s*\|\s*/);
  }
  if (parts.length !== expectedCount) {
    return null;
  }
  const cleaned = parts.map((p) => p.trim());
  if (cleaned.some((p) => !isValidTranslationText(p))) {
    return null;
  }
  return cleaned;
}

async function translateItemsViaGtxBatch(
  items: UniqueBatchGroup[],
  sourceLang: string,
  targetLang: string
): Promise<Map<string, string>> {
  const resultMap = new Map<string, string>();
  if (items.length === 0) return resultMap;

  if (await isGtxBlocked()) {
    throw new ProviderRateLimitError('google', gtxBlockedUntil);
  }

  if (items.length === 1) {
    const res = await fetchGtxSingleText(items[0].sanitizedText, sourceLang, targetLang, false);
    if (isValidTranslationText(res.translation)) {
      resultMap.set(items[0].hash, res.translation.trim());
    }
    return resultMap;
  }

  const joinedText = items.map((item) => item.sanitizedText).join(BATCH_DELIMITER);
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(
    sourceLang
  )}&tl=${encodeURIComponent(targetLang)}&dt=t&q=${encodeURIComponent(joinedText)}`;

  const raw = await fetchGtxJson(url);
  if (!Array.isArray(raw) || !Array.isArray(raw[0])) {
    throw new Error('Invalid Google GTX batch format');
  }

  const fullTranslated = (raw[0] as Array<[string | null]>)
    .map((seg) => (Array.isArray(seg) && typeof seg[0] === 'string' ? seg[0] : ''))
    .join('');

  const matchedParts = splitBatchParts(fullTranslated, items.length);
  if (matchedParts) {
    items.forEach((item, idx) => {
      resultMap.set(item.hash, matchedParts[idx]);
    });
    return resultMap;
  }

  // Delimiter mismatch -> safe line-by-line fallback for this chunk only (sequential, rate-limit safe)
  console.warn(
    `[YT-Lang-AI] GTX batch delimiter mismatch (expected ${items.length}). Falling back to per-item chunk translation.`
  );
  for (let i = 0; i < items.length; i++) {
    if (await isGtxBlocked()) break;
    if (i > 0) await sleep(GTX_SINGLE_FALLBACK_DELAY_MS);
    try {
      const single = await fetchGtxSingleText(items[i].sanitizedText, sourceLang, targetLang, false);
      if (isValidTranslationText(single.translation)) {
        resultMap.set(items[i].hash, single.translation.trim());
      }
    } catch (err) {
      if (err instanceof ProviderRateLimitError) {
        break;
      }
    }
  }

  return resultMap;
}

function packItemsForMyMemory(items: UniqueBatchGroup[]): UniqueBatchGroup[][] {
  const chunks: UniqueBatchGroup[][] = [];
  let currentChunk: UniqueBatchGroup[] = [];
  let currentBytes = 0;
  const delimBytes = utf8ByteLength(BATCH_DELIMITER);

  for (const item of items) {
    const itemBytes = utf8ByteLength(item.sanitizedText);
    if (itemBytes > MYMEMORY_MAX_BYTES) {
      if (currentChunk.length > 0) {
        chunks.push(currentChunk);
        currentChunk = [];
        currentBytes = 0;
      }
      chunks.push([item]);
      continue;
    }

    const nextBytes =
      currentChunk.length === 0 ? itemBytes : currentBytes + delimBytes + itemBytes;
    if (nextBytes > MYMEMORY_MAX_BYTES && currentChunk.length > 0) {
      chunks.push(currentChunk);
      currentChunk = [item];
      currentBytes = itemBytes;
    } else {
      currentChunk.push(item);
      currentBytes = nextBytes;
    }
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }
  return chunks;
}

async function translateItemsViaMyMemoryFallback(
  items: UniqueBatchGroup[],
  sourceLang: string,
  targetLang: string
): Promise<Map<string, string>> {
  const resultMap = new Map<string, string>();
  if (items.length === 0) return resultMap;
  if (await isMyMemoryBlocked()) return resultMap;

  const chunks = packItemsForMyMemory(items);

  for (let chunkIdx = 0; chunkIdx < chunks.length; chunkIdx++) {
    if (await isMyMemoryBlocked()) break;
    if (chunkIdx > 0) await sleep(MYMEMORY_CHUNK_DELAY_MS);

    const chunk = chunks[chunkIdx];
    if (chunk.length === 1) {
      try {
        const translated = await fetchMyMemoryTextSafe(
          chunk[0].sanitizedText,
          sourceLang,
          targetLang
        );
        if (isValidTranslationText(translated)) {
          resultMap.set(chunk[0].hash, translated);
        }
      } catch (err) {
        if (err instanceof ProviderRateLimitError) break;
      }
      continue;
    }

    const joined = chunk.map((c) => c.sanitizedText).join(BATCH_DELIMITER);
    // Double-check strict 450-byte guarantee
    if (utf8ByteLength(joined) <= MYMEMORY_MAX_BYTES) {
      try {
        const rawBatch = await fetchMyMemoryChunkRaw(joined, sourceLang, targetLang);
        const parts = splitBatchParts(rawBatch, chunk.length);
        if (parts) {
          chunk.forEach((item, idx) => resultMap.set(item.hash, parts[idx]));
          continue;
        }
      } catch (err) {
        if (err instanceof ProviderRateLimitError) break;
      }
    }

    // Per-item fallback within this small chunk (strictly <= 450 bytes each)
    for (let i = 0; i < chunk.length; i++) {
      if (await isMyMemoryBlocked()) break;
      if (i > 0) await sleep(MYMEMORY_CHUNK_DELAY_MS);
      try {
        const single = await fetchMyMemoryTextSafe(
          chunk[i].sanitizedText,
          sourceLang,
          targetLang
        );
        if (isValidTranslationText(single)) {
          resultMap.set(chunk[i].hash, single);
        }
      } catch (err) {
        if (err instanceof ProviderRateLimitError) break;
      }
    }
  }

  return resultMap;
}

async function translateBatchWithCascade(
  items: UniqueBatchGroup[],
  sourceLang: string,
  targetLang: string,
  priority: 'high' | 'low'
): Promise<{
  translations: Map<string, string>;
  status: TranslationRuntimeStatus;
}> {
  const resultMap = new Map<string, string>();
  if (items.length === 0) {
    return { translations: resultMap, status: { state: 'idle' } };
  }

  let gtxError: unknown = null;
  if (!(await isGtxBlocked())) {
    try {
      const gtxMap = await enqueueNetworkTask(priority, () =>
        translateItemsViaGtxBatch(items, sourceLang, targetLang)
      );
      for (const [hash, tr] of gtxMap.entries()) {
        if (isValidTranslationText(tr)) {
          resultMap.set(hash, tr);
        }
      }
    } catch (err) {
      gtxError = err;
    }
  }

  // Only invoke MyMemory for missing items when primary GTX was blocked, errored, or skipped items
  const remainingForFallback = items.filter((item) => !resultMap.has(item.hash));
  let mmError: unknown = null;

  if (remainingForFallback.length > 0 && !(await isMyMemoryBlocked())) {
    try {
      const mmMap = await enqueueNetworkTask(priority, () =>
        translateItemsViaMyMemoryFallback(remainingForFallback, sourceLang, targetLang)
      );
      for (const [hash, tr] of mmMap.entries()) {
        if (isValidTranslationText(tr)) {
          resultMap.set(hash, tr);
        }
      }
    } catch (err) {
      mmError = err;
    }
  }

  if (resultMap.size === items.length) {
    return { translations: resultMap, status: { state: 'idle' } };
  }

  const gtxBlocked = await isGtxBlocked();
  const mmBlocked = await isMyMemoryBlocked();

  if (resultMap.size === 0) {
    if (gtxBlocked && mmBlocked) {
      return {
        translations: resultMap,
        status: {
          state: 'cooldown',
          provider: 'none',
          retryAt: Math.min(gtxBlockedUntil, myMemoryBlockedUntil)
        }
      };
    }

    if (gtxError || mmError || gtxBlocked || mmBlocked) {
      const retryAt =
        gtxBlocked && mmBlocked
          ? Math.min(gtxBlockedUntil, myMemoryBlockedUntil)
          : gtxBlocked
            ? gtxBlockedUntil
            : mmBlocked
              ? myMemoryBlockedUntil
              : Date.now() + TRANSIENT_COOLDOWN_MS;
      return {
        translations: resultMap,
        status: {
          state: 'cooldown',
          provider: 'none',
          retryAt
        }
      };
    }
  }

  return {
    translations: resultMap,
    status: await getCooldownStatusSnapshot()
  };
}

interface TranslationJobState {
  jobKey: string;
  videoId: string;
  sourceLang: string;
  targetLang: string;
  cues: CueItem[];
  cueHashes: Map<string, string>;
  translatedByCueId: Map<string, string>;
  translatedByHash: Map<string, string>;
  inFlightHashes: Set<string>;
  inFlightPromises: Map<string, Promise<TranslationRuntimeStatus>>;
  hotPendingCount: number;
  priorityTime: number;
  generation: number;
  cancelled: boolean;
  backgroundPromise: Promise<void> | null;
  sleepWake: (() => void) | null;
  latestStatus: TranslationRuntimeStatus;
  progressListeners: Map<string | number, (payload: TranslationProgressPayload) => void>;
}

const activeJobs = new Map<string, TranslationJobState>();

function buildJobKey(videoId: string, sourceLang: string, targetLang: string): string {
  return `${videoId}:${sourceLang}:${targetLang}`;
}

function wakeJobSleep(job: TranslationJobState): void {
  const wake = job.sleepWake;
  job.sleepWake = null;
  wake?.();
}

function interruptibleJobSleep(job: TranslationJobState, ms: number): Promise<void> {
  if (ms <= 0 || job.cancelled) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      if (job.sleepWake === finish) {
        job.sleepWake = null;
      }
      resolve();
    }, ms);
    const finish = (): void => {
      clearTimeout(timer);
      resolve();
    };
    job.sleepWake = finish;
  });
}

function emitJobProgress(
  job: TranslationJobState,
  batchTranslations: TranslatedCueItem[],
  status: TranslationRuntimeStatus
): void {
  job.latestStatus = status;
  const payload: TranslationProgressPayload = {
    videoId: job.videoId,
    targetLang: job.targetLang,
    batchTranslations,
    status
  };
  for (const cb of job.progressListeners.values()) {
    try {
      cb(payload);
    } catch {
      // Ignore closed listener
    }
  }
}

function findAnchorCueIndex(cues: CueItem[], priorityTime: number): number {
  if (cues.length === 0) return 0;
  const targetTime = Math.max(0, priorityTime);

  for (let i = 0; i < cues.length; i++) {
    const start = cues[i].startTime ?? 0;
    const end = cues[i].endTime ?? start + 4;
    if (targetTime >= start && targetTime <= end) {
      return i;
    }
  }

  for (let i = 0; i < cues.length; i++) {
    const start = cues[i].startTime ?? 0;
    const end = cues[i].endTime ?? start + 4;
    if (end >= targetTime - 0.5) {
      return i;
    }
  }

  return Math.max(0, cues.length - 1);
}

function packWindowCues(
  orderedCues: CueItem[],
  cueHashes: Map<string, string>,
  translatedByCueId: Map<string, string>,
  inFlightHashes: Set<string>,
  allCueIdsByHash: Map<string, string[]>,
  maxCues: number
): UniqueBatchGroup[] {
  const batch: UniqueBatchGroup[] = [];
  const seenHashes = new Set<string>();
  let totalRawChars = 0;
  let joinedSample = '';

  for (let i = 0; i < orderedCues.length; i++) {
    const cue = orderedCues[i];
    if (translatedByCueId.has(cue.id)) continue;

    const hash = cueHashes.get(cue.id) ?? computeSourceTextHash(cue.text);
    if (seenHashes.has(hash) || inFlightHashes.has(hash)) continue;

    const sanitized = sanitizeTextForBatch(cue.text);
    if (!sanitized) continue;

    const nextChars =
      batch.length === 0
        ? sanitized.length
        : totalRawChars + BATCH_DELIMITER.length + sanitized.length;

    if (batch.length > 0 && (batch.length >= maxCues || nextChars > GTX_MAX_BATCH_CHARS)) {
      break;
    }

    const nextJoined = batch.length === 0 ? sanitized : `${joinedSample}${BATCH_DELIMITER}${sanitized}`;
    if (batch.length > 0 && encodeURIComponent(nextJoined).length > GTX_MAX_ENCODED_QUERY_CHARS) {
      break;
    }

    seenHashes.add(hash);
    totalRawChars = nextChars;
    joinedSample = nextJoined;

    batch.push({
      hash,
      sanitizedText: sanitized,
      rawText: normalizeSubtitleForHash(cue.text),
      cueIds: allCueIdsByHash.get(hash) ?? [cue.id],
      firstIndex: i,
      startTime: cue.startTime ?? 0,
      endTime: cue.endTime ?? (cue.startTime ?? 0) + 4
    });
  }

  return batch;
}

function pickNextPriorityBatch(job: TranslationJobState): {
  isHot: boolean;
  batch: UniqueBatchGroup[];
} {
  const cues = job.cues;
  if (cues.length === 0) return { isHot: false, batch: [] };

  // Build hash -> all untranslated cueIds mapping
  const allCueIdsByHash = new Map<string, string[]>();
  for (const cue of cues) {
    if (job.translatedByCueId.has(cue.id)) continue;
    const hash = job.cueHashes.get(cue.id) ?? computeSourceTextHash(cue.text);
    if (job.inFlightHashes.has(hash)) continue;
    const arr = allCueIdsByHash.get(hash);
    if (arr) {
      arr.push(cue.id);
    } else {
      allCueIdsByHash.set(hash, [cue.id]);
    }
  }

  if (allCueIdsByHash.size === 0) {
    return { isHot: false, batch: [] };
  }

  const anchorIdx = findAnchorCueIndex(cues, job.priorityTime);
  const hotEndIdx = Math.min(cues.length, anchorIdx + 1 + HOT_LOOKAHEAD_CUES);
  const hotSlice = cues.slice(anchorIdx, hotEndIdx);

  // 1. Check Hot Window: current cue + next 15 cues
  const hotBatch = packWindowCues(
    hotSlice,
    job.cueHashes,
    job.translatedByCueId,
    job.inFlightHashes,
    allCueIdsByHash,
    GTX_HOT_MAX_CUES
  );
  if (hotBatch.length > 0) {
    return { isHot: true, batch: hotBatch };
  }

  // 2. Background: forward cues starting right after hot window
  if (hotEndIdx < cues.length) {
    const forwardBatch = packWindowCues(
      cues.slice(hotEndIdx),
      job.cueHashes,
      job.translatedByCueId,
      job.inFlightHashes,
      allCueIdsByHash,
      GTX_BG_BATCH_CUES
    );
    if (forwardBatch.length > 0) {
      return { isHot: false, batch: forwardBatch };
    }
  }

  // 3. Background: earlier cues closest before anchorIdx (ordered chronologically within chunk)
  if (anchorIdx > 0) {
    const prevMissing: CueItem[] = [];
    for (let i = anchorIdx - 1; i >= 0; i--) {
      const cue = cues[i];
      if (!job.translatedByCueId.has(cue.id) && sanitizeTextForBatch(cue.text)) {
        const hash = job.cueHashes.get(cue.id) ?? computeSourceTextHash(cue.text);
        if (!job.inFlightHashes.has(hash)) {
          prevMissing.push(cue);
          if (prevMissing.length >= GTX_BG_BATCH_CUES * 2) break;
        }
      }
    }
    if (prevMissing.length > 0) {
      prevMissing.reverse();
      // Take tail slice up to GTX_BG_BATCH_CUES so lines closest before playback time come first
      const slice = prevMissing.slice(-GTX_BG_BATCH_CUES);
      const backBatch = packWindowCues(
        slice,
        job.cueHashes,
        job.translatedByCueId,
        job.inFlightHashes,
        allCueIdsByHash,
        GTX_BG_BATCH_CUES
      );
      if (backBatch.length > 0) {
        return { isHot: false, batch: backBatch };
      }
    }
  }

  return { isHot: false, batch: [] };
}

function applyResolvedTranslationsToJob(
  job: TranslationJobState,
  resolvedHashes: Map<string, string>
): {
  emitted: TranslatedCueItem[];
  dbEntries: Array<{
    videoId: string;
    targetLang: string;
    sourceTextHash: string;
    translatedText: string;
  }>;
} {
  const emitted: TranslatedCueItem[] = [];
  const dbEntries: Array<{
    videoId: string;
    targetLang: string;
    sourceTextHash: string;
    translatedText: string;
  }> = [];

  for (const [hash, translatedText] of resolvedHashes.entries()) {
    if (!isValidTranslationText(translatedText)) continue;
    const cleanTr = translatedText.trim();
    job.translatedByHash.set(hash, cleanTr);
    dbEntries.push({
      videoId: job.videoId,
      targetLang: job.targetLang,
      sourceTextHash: hash,
      translatedText: cleanTr
    });
  }

  for (const cue of job.cues) {
    if (job.translatedByCueId.has(cue.id)) continue;
    const hash = job.cueHashes.get(cue.id) ?? computeSourceTextHash(cue.text);
    const tr = job.translatedByHash.get(hash);
    if (tr && isValidTranslationText(tr)) {
      job.translatedByCueId.set(cue.id, tr);
      emitted.push({ id: cue.id, text: tr });
    }
  }

  return { emitted, dbEntries };
}

async function hydrateJobFromCaches(job: TranslationJobState): Promise<TranslatedCueItem[]> {
  const idbMap = await getCachedCueTranslationsForVideo(job.videoId, job.targetLang);
  for (const [hash, tr] of idbMap.entries()) {
    if (isValidTranslationText(tr)) {
      job.translatedByHash.set(hash, tr);
    }
  }

  // Migrate clean valid entries from legacy chrome.storage.local key if any exist (never migrate error strings)
  const legacyKey = `free_sub_tr:${job.videoId}:${job.targetLang}`;
  if (
    typeof chrome !== 'undefined' &&
    chrome.storage?.local &&
    job.videoId &&
    job.videoId !== 'unknown'
  ) {
    try {
      const res = await chrome.storage.local.get(legacyKey);
      const raw = res?.[legacyKey] as LegacyCachedSubtitleTrack | undefined;
      if (raw?.translations && (!raw.savedAt || Date.now() - raw.savedAt < LEGACY_CACHE_TTL_MS)) {
        const legacyToPersist: Array<{
          videoId: string;
          targetLang: string;
          sourceTextHash: string;
          translatedText: string;
        }> = [];
        let foundPoison = false;

        for (const cue of job.cues) {
          const legacyText = raw.translations[cue.id];
          if (!legacyText) continue;
          if (!isValidTranslationText(legacyText)) {
            foundPoison = true;
            continue;
          }
          const hash = job.cueHashes.get(cue.id) ?? computeSourceTextHash(cue.text);
          if (!job.translatedByHash.has(hash)) {
            job.translatedByHash.set(hash, legacyText.trim());
            legacyToPersist.push({
              videoId: job.videoId,
              targetLang: job.targetLang,
              sourceTextHash: hash,
              translatedText: legacyText.trim()
            });
          }
        }

        if (legacyToPersist.length > 0) {
          void saveCachedCueTranslations(legacyToPersist);
        }
        // Clean legacy blob after inspection/migration so poisoned keys cannot persist
        if (foundPoison || legacyToPersist.length > 0) {
          void chrome.storage.local.remove(legacyKey).catch(() => undefined);
        }
      }
    } catch {
      // Ignore legacy read error
    }
  }

  const hydrated: TranslatedCueItem[] = [];
  for (const cue of job.cues) {
    if (job.translatedByCueId.has(cue.id)) continue;
    const hash = job.cueHashes.get(cue.id) ?? computeSourceTextHash(cue.text);
    const tr = job.translatedByHash.get(hash);
    if (tr && isValidTranslationText(tr)) {
      job.translatedByCueId.set(cue.id, tr);
      hydrated.push({ id: cue.id, text: tr });
    }
  }

  return hydrated;
}

function runBatchItemsForJob(
  job: TranslationJobState,
  batch: UniqueBatchGroup[],
  priority: 'high' | 'low'
): Promise<TranslationRuntimeStatus> {
  const execPromise = (async (): Promise<TranslationRuntimeStatus> => {
    try {
      const { translations, status } = await translateBatchWithCascade(
        batch,
        job.sourceLang,
        job.targetLang,
        priority
      );

      if (job.cancelled) return { state: 'idle' };

      if (translations.size > 0) {
        const { emitted, dbEntries } = applyResolvedTranslationsToJob(job, translations);
        if (dbEntries.length > 0) {
          void saveCachedCueTranslations(dbEntries);
        }
        if (emitted.length > 0) {
          emitJobProgress(
            job,
            emitted,
            status.state === 'cooldown' ? status : { state: 'translating' }
          );
        }
      }

      if (status.state === 'cooldown' && translations.size === 0) {
        emitJobProgress(job, [], status);
      }

      return status;
    } finally {
      for (const item of batch) {
        job.inFlightHashes.delete(item.hash);
        job.inFlightPromises.delete(item.hash);
      }
    }
  })();

  for (const item of batch) {
    job.inFlightHashes.add(item.hash);
    job.inFlightPromises.set(item.hash, execPromise);
  }
  return execPromise;
}

async function runJobLoop(job: TranslationJobState): Promise<void> {
  try {
    while (!job.cancelled) {
      if (job.hotPendingCount > 0) {
        await interruptibleJobSleep(job, 40);
        continue;
      }

      const iterGen = job.generation;
      const plan = pickNextPriorityBatch(job);

      if (plan.batch.length === 0) {
        if (job.inFlightHashes.size > 0) {
          await sleep(100);
          continue;
        }
        emitJobProgress(job, [], { state: 'idle' });
        break;
      }

      if (!plan.isHot && lastNetworkRequestAt > 0) {
        const remainingDelay = BG_BATCH_DELAY_MS - (Date.now() - lastNetworkRequestAt);
        if (remainingDelay > 0) {
          await interruptibleJobSleep(job, remainingDelay);
          if (job.cancelled) break;
          // Re-evaluate immediately if playback seeked or hot window started during sleep
          if (iterGen !== job.generation || job.hotPendingCount > 0) {
            continue;
          }
        }
      }

      const priority = plan.isHot ? 'high' : 'low';
      const status = await runBatchItemsForJob(job, plan.batch, priority);

      if (job.cancelled) break;

      if (status.state === 'cooldown' && plan.batch.some((b) => !job.translatedByHash.has(b.hash))) {
        break;
      }
    }
  } finally {
    job.backgroundPromise = null;
    if (activeJobs.get(job.jobKey) === job && job.inFlightHashes.size === 0) {
      activeJobs.delete(job.jobKey);
    }
  }
}

export function cancelCueTranslation(filter?: {
  videoId?: string;
  targetLang?: string;
}): void {
  for (const [key, job] of activeJobs.entries()) {
    if (filter?.videoId && job.videoId !== filter.videoId) continue;
    if (filter?.targetLang && job.targetLang !== filter.targetLang) continue;
    job.cancelled = true;
    job.generation++;
    wakeJobSleep(job);
    activeJobs.delete(key);
  }
}

export function detachCueTranslationListener(listenerKey: string | number): void {
  for (const [key, job] of activeJobs.entries()) {
    if (job.progressListeners.delete(listenerKey) && job.progressListeners.size === 0) {
      job.cancelled = true;
      job.generation++;
      wakeJobSleep(job);
      activeJobs.delete(key);
    }
  }
}

export async function translateCueBatch(params: {
  videoId: string;
  cues: CueItem[];
  sourceLang?: string;
  targetLang: string;
  priorityTime?: number;
  awaitHotOnly?: boolean;
  forceRetry?: boolean;
  listenerKey?: string | number;
  onBatchProgress?: (payload: TranslationProgressPayload) => void;
}): Promise<{
  translations: TranslatedCueItem[];
  status: TranslationRuntimeStatus;
}> {
  const {
    videoId,
    cues,
    priorityTime = 0,
    awaitHotOnly = false,
    forceRetry = false,
    listenerKey = 'default'
  } = params;
  if (!cues || cues.length === 0) {
    return { translations: [], status: { state: 'idle' } };
  }

  const sl = params.sourceLang && params.sourceLang !== 'unknown' ? params.sourceLang : 'auto';
  const tl = params.targetLang || 'ru';
  const jobKey = buildJobKey(videoId, sl, tl);

  if (forceRetry) {
    await clearProviderCooldowns();
  }

  let job = activeJobs.get(jobKey);

  if (!job || job.cancelled) {
    const cueHashes = new Map<string, string>();
    for (const cue of cues) {
      cueHashes.set(cue.id, computeSourceTextHash(cue.text));
    }
    job = {
      jobKey,
      videoId,
      sourceLang: sl,
      targetLang: tl,
      cues,
      cueHashes,
      translatedByCueId: new Map(),
      translatedByHash: new Map(),
      inFlightHashes: new Set(),
      inFlightPromises: new Map(),
      hotPendingCount: 0,
      priorityTime,
      generation: 1,
      cancelled: false,
      backgroundPromise: null,
      sleepWake: null,
      latestStatus: { state: 'translating' },
      progressListeners: new Map()
    };
    activeJobs.set(jobKey, job);
  } else {
    // Reprioritize existing job (e.g., seeked to a new timestamp)
    job.priorityTime = priorityTime;
    job.generation++;
    // Update cue list if track grew / reloaded with different cue IDs while keeping known hashes
    if (cues.length !== job.cues.length || cues[0]?.id !== job.cues[0]?.id) {
      job.cues = cues;
      for (const cue of cues) {
        const hash = computeSourceTextHash(cue.text);
        job.cueHashes.set(cue.id, hash);
        const existingTr = job.translatedByHash.get(hash);
        if (existingTr && isValidTranslationText(existingTr)) {
          job.translatedByCueId.set(cue.id, existingTr);
        }
      }
    }
  }

  if (params.onBatchProgress) {
    job.progressListeners.set(listenerKey, params.onBatchProgress);
  }

  const allCurrentItems = (): TranslatedCueItem[] =>
    job!.cues
      .filter((c) => job!.translatedByCueId.has(c.id))
      .map((c) => ({ id: c.id, text: job!.translatedByCueId.get(c.id)! }));

  job.hotPendingCount++;
  try {
    // 1. Hydrate from IndexedDB immediately (zero network requests if already watched/cached)
    const hydratedItems = await hydrateJobFromCaches(job);

    // Check if everything is already translated
    const hasAnyMissing = job.cues.some(
      (c) => !job!.translatedByCueId.has(c.id) && sanitizeTextForBatch(c.text).length > 0
    );
    if (!hasAnyMissing) {
      const all = allCurrentItems();
      emitJobProgress(job, hydratedItems.length > 0 ? hydratedItems : [], { state: 'idle' });
      if (!job.backgroundPromise && job.inFlightHashes.size === 0) {
        activeJobs.delete(job.jobKey);
      }
      return { translations: all, status: { state: 'idle' } };
    }

    if (hydratedItems.length > 0) {
      emitJobProgress(job, hydratedItems, { state: 'translating' });
    }

    // Wait for any already in-flight hot window promises overlapping current anchor slice
    const anchorIdx = findAnchorCueIndex(job.cues, job.priorityTime);
    const hotSlice = job.cues.slice(anchorIdx, Math.min(job.cues.length, anchorIdx + 1 + HOT_LOOKAHEAD_CUES));
    const overlappingPromises = new Set<Promise<TranslationRuntimeStatus>>();
    for (const cue of hotSlice) {
      if (job.translatedByCueId.has(cue.id)) continue;
      const hash = job.cueHashes.get(cue.id) ?? computeSourceTextHash(cue.text);
      const existingInFlight = job.inFlightPromises.get(hash);
      if (existingInFlight) overlappingPromises.add(existingInFlight);
    }
    if (overlappingPromises.size > 0) {
      await Promise.all(overlappingPromises);
    }

    // 2. Immediately translate Hot Window (current cue + next 15 cues) ahead of background batches
    const hotPlan = pickNextPriorityBatch(job);
    if (hotPlan.isHot && hotPlan.batch.length > 0) {
      const gtxBlocked = await isGtxBlocked();
      const mmBlocked = await isMyMemoryBlocked();
      if (gtxBlocked && mmBlocked) {
        const status = await getCooldownStatusSnapshot();
        emitJobProgress(job, [], status);
        return { translations: allCurrentItems(), status };
      }

      const hotStatus = await runBatchItemsForJob(job, hotPlan.batch, 'high');
      if (
        hotStatus.state === 'cooldown' &&
        hotPlan.batch.some((b) => !job!.translatedByHash.has(b.hash))
      ) {
        return { translations: allCurrentItems(), status: hotStatus };
      }
    }
  } finally {
    job.hotPendingCount--;
    wakeJobSleep(job);
  }

  // 3. Ensure background loader continues remaining batches with 600ms pacing
  const stillMissing = job.cues.some(
    (c) => !job!.translatedByCueId.has(c.id) && sanitizeTextForBatch(c.text).length > 0
  );
  if (stillMissing && !job.backgroundPromise && !job.cancelled) {
    job.backgroundPromise = runJobLoop(job);
  } else if (!stillMissing) {
    emitJobProgress(job, [], { state: 'idle' });
    if (!job.backgroundPromise && job.inFlightHashes.size === 0) {
      activeJobs.delete(job.jobKey);
    }
  }

  if (awaitHotOnly) {
    const status = stillMissing
      ? job.latestStatus.state === 'cooldown'
        ? job.latestStatus
        : { state: 'translating' as const }
      : { state: 'idle' as const };
    return {
      translations: allCurrentItems(),
      status
    };
  }

  if (job.backgroundPromise) {
    await job.backgroundPromise;
  }

  return {
    translations: allCurrentItems(),
    status: job.latestStatus
  };
}
