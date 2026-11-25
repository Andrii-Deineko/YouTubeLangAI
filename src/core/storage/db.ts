import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { AIExplanation, QuickTranslationResult } from '../types/vocabulary';
import { isValidTranslationText } from '../utils/translationCache';

interface CachedTranslationEntry {
  key: string;
  result: QuickTranslationResult;
  updatedAt: number;
}

interface CachedAIEntry {
  key: string;
  explanation: AIExplanation;
  updatedAt: number;
}

export interface CachedCueTranslationEntry {
  key: string;
  videoLangKey: string;
  videoId: string;
  targetLang: string;
  sourceTextHash: string;
  translatedText: string;
  updatedAt: number;
}

interface YTLangAIDBSchema extends DBSchema {
  subtitles: {
    key: string;
    value: unknown;
  };
  translations: {
    key: string;
    value: CachedTranslationEntry;
  };
  ai_explanations: {
    key: string;
    value: CachedAIEntry;
  };
  cue_translations: {
    key: string;
    value: CachedCueTranslationEntry;
    indexes: {
      by_video_lang: string;
      by_updated_at: number;
    };
  };
}

const DB_NAME = 'yt-lang-ai-cache';
const DB_VERSION = 2;

export const TRANSLATION_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
export const TRANSLATION_CACHE_MAX_ENTRIES = 500;
export const CUE_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const CUE_CACHE_MAX_ENTRIES = 25_000;

let dbPromise: Promise<IDBPDatabase<YTLangAIDBSchema>> | null = null;

function getDB(): Promise<IDBPDatabase<YTLangAIDBSchema>> {
  if (!dbPromise) {
    dbPromise = openDB<YTLangAIDBSchema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('subtitles')) {
          db.createObjectStore('subtitles', { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains('translations')) {
          db.createObjectStore('translations', { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains('ai_explanations')) {
          db.createObjectStore('ai_explanations', { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains('cue_translations')) {
          const cueStore = db.createObjectStore('cue_translations', { keyPath: 'key' });
          cueStore.createIndex('by_video_lang', 'videoLangKey', { unique: false });
          cueStore.createIndex('by_updated_at', 'updatedAt', { unique: false });
        }
      }
    });
  }
  return dbPromise;
}

export function buildTranslationCacheKey(
  sourceLang: string,
  nativeLang: string,
  text: string
): string {
  return `${sourceLang.toLowerCase()}:${nativeLang.toLowerCase()}:${text.trim().toLowerCase()}`;
}

export function buildCueTranslationCacheKey(
  videoId: string,
  targetLang: string,
  sourceTextHash: string
): string {
  return `${videoId}:${targetLang.toLowerCase()}:${sourceTextHash}`;
}

export function buildAIExplanationCacheKey(
  videoId: string,
  cueId: string,
  target: string,
  nativeLang: string
): string {
  const normalizedTarget = target.trim().toLowerCase().replace(/\s+/g, ' ');
  return `${videoId}:${cueId}:${normalizedTarget}:${nativeLang.toLowerCase()}`;
}

export async function getCachedTranslation(
  key: string
): Promise<QuickTranslationResult | null> {
  const db = await getDB();
  const entry = await db.get('translations', key);
  if (!entry) return null;
  if (
    Date.now() - entry.updatedAt > TRANSLATION_CACHE_TTL_MS ||
    !isValidTranslationText(entry.result?.translation)
  ) {
    void db.delete('translations', key);
    return null;
  }
  return entry.result;
}

export async function setCachedTranslation(
  key: string,
  result: QuickTranslationResult
): Promise<void> {
  if (!isValidTranslationText(result?.translation)) {
    return;
  }
  const db = await getDB();
  const now = Date.now();
  await db.put('translations', {
    key,
    result,
    updatedAt: now
  });

  // Evict expired entries and enforce 500 entries LRU limit
  try {
    const tx = db.transaction('translations', 'readwrite');
    const store = tx.objectStore('translations');
    const all = await store.getAll();
    const expiredKeys: string[] = [];
    const validEntries: CachedTranslationEntry[] = [];

    for (const item of all) {
      if (
        now - item.updatedAt > TRANSLATION_CACHE_TTL_MS ||
        !isValidTranslationText(item.result?.translation)
      ) {
        expiredKeys.push(item.key);
      } else {
        validEntries.push(item);
      }
    }

    for (const expKey of expiredKeys) {
      void store.delete(expKey);
    }

    if (validEntries.length > TRANSLATION_CACHE_MAX_ENTRIES) {
      validEntries.sort((a, b) => a.updatedAt - b.updatedAt);
      const toEvict = validEntries.slice(0, validEntries.length - TRANSLATION_CACHE_MAX_ENTRIES);
      for (const item of toEvict) {
        void store.delete(item.key);
      }
    }
    await tx.done;
  } catch {
    // Ignore eviction errors
  }
}

export async function getCachedCueTranslationsForVideo(
  videoId: string,
  targetLang: string
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (!videoId || videoId === 'unknown' || !targetLang) return result;

  try {
    const db = await getDB();
    const videoLangKey = `${videoId}:${targetLang.toLowerCase()}`;
    const entries = await db.getAllFromIndex('cue_translations', 'by_video_lang', videoLangKey);
    const now = Date.now();
    const staleKeys: string[] = [];

    for (const entry of entries) {
      if (
        now - entry.updatedAt > CUE_CACHE_TTL_MS ||
        !isValidTranslationText(entry.translatedText)
      ) {
        staleKeys.push(entry.key);
        continue;
      }
      result.set(entry.sourceTextHash, entry.translatedText);
    }

    if (staleKeys.length > 0) {
      const tx = db.transaction('cue_translations', 'readwrite');
      const store = tx.objectStore('cue_translations');
      for (const key of staleKeys) {
        void store.delete(key);
      }
      await tx.done.catch(() => undefined);
    }
  } catch (err) {
    console.warn('[YT-Lang-AI] Error reading cue translations from IndexedDB:', err);
  }

  return result;
}

export async function saveCachedCueTranslations(
  entries: Array<{
    videoId: string;
    targetLang: string;
    sourceTextHash: string;
    translatedText: string;
  }>
): Promise<void> {
  if (!entries || entries.length === 0) return;

  const valid = entries.filter(
    (e) =>
      Boolean(e.videoId) &&
      e.videoId !== 'unknown' &&
      Boolean(e.targetLang) &&
      Boolean(e.sourceTextHash) &&
      isValidTranslationText(e.translatedText)
  );
  if (valid.length === 0) return;

  try {
    const db = await getDB();
    const now = Date.now();
    const tx = db.transaction('cue_translations', 'readwrite');
    const store = tx.objectStore('cue_translations');

    for (const item of valid) {
      const normLang = item.targetLang.toLowerCase();
      const videoLangKey = `${item.videoId}:${normLang}`;
      const key = buildCueTranslationCacheKey(item.videoId, normLang, item.sourceTextHash);
      void store.put({
        key,
        videoLangKey,
        videoId: item.videoId,
        targetLang: normLang,
        sourceTextHash: item.sourceTextHash,
        translatedText: item.translatedText.trim(),
        updatedAt: now
      });
    }

    await tx.done;

    const total = await db.count('cue_translations');
    if (total > CUE_CACHE_MAX_ENTRIES) {
      const evictCount = total - CUE_CACHE_MAX_ENTRIES;
      const evictTx = db.transaction('cue_translations', 'readwrite');
      const index = evictTx.objectStore('cue_translations').index('by_updated_at');
      let cursor = await index.openCursor();
      let deleted = 0;
      while (cursor && deleted < evictCount) {
        await cursor.delete();
        deleted++;
        cursor = await cursor.continue();
      }
      await evictTx.done;
    }
  } catch (err) {
    console.warn('[YT-Lang-AI] Error writing cue translations to IndexedDB:', err);
  }
}

export async function getCachedAIExplanation(key: string): Promise<AIExplanation | null> {
  const db = await getDB();
  const entry = await db.get('ai_explanations', key);
  return entry ? entry.explanation : null;
}

export async function setCachedAIExplanation(
  key: string,
  explanation: AIExplanation
): Promise<void> {
  const db = await getDB();
  await db.put('ai_explanations', {
    key,
    explanation,
    updatedAt: Date.now()
  });
}

export async function clearAllCaches(): Promise<void> {
  const db = await getDB();
  await Promise.all([
    db.clear('subtitles'),
    db.clear('translations'),
    db.clear('ai_explanations'),
    db.clear('cue_translations')
  ]);
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    await chrome.storage.local
      .remove(['ytai_free_word_cache', 'ytai_gtx_blocked_until', 'ytai_mymemory_blocked_until'])
      .catch(() => undefined);
  }
}
