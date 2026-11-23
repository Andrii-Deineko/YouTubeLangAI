import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Json3Response } from '../types/subtitles';
import type { AIExplanation, QuickTranslationResult } from '../types/vocabulary';

interface CachedSubtitleEntry {
  key: string;
  videoId: string;
  lang: string;
  tlang?: string;
  data: Json3Response;
  updatedAt: number;
}

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

interface YTLangAIDBSchema extends DBSchema {
  subtitles: {
    key: string;
    value: CachedSubtitleEntry;
  };
  translations: {
    key: string;
    value: CachedTranslationEntry;
  };
  ai_explanations: {
    key: string;
    value: CachedAIEntry;
  };
}

const DB_NAME = 'yt-lang-ai-cache';
const DB_VERSION = 1;

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
      }
    });
  }
  return dbPromise;
}

export function buildSubtitleCacheKey(videoId: string, lang: string, tlang?: string): string {
  return `${videoId}:${lang}:${tlang ?? 'orig'}`;
}

export function buildTranslationCacheKey(
  sourceLang: string,
  nativeLang: string,
  text: string
): string {
  return `${sourceLang.toLowerCase()}:${nativeLang.toLowerCase()}:${text.trim().toLowerCase()}`;
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

export async function setCachedSubtitles(
  videoId: string,
  lang: string,
  data: Json3Response,
  tlang?: string
): Promise<void> {
  const db = await getDB();
  const key = buildSubtitleCacheKey(videoId, lang, tlang);
  await db.put('subtitles', {
    key,
    videoId,
    lang,
    tlang,
    data,
    updatedAt: Date.now()
  });
}

export const TRANSLATION_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
export const TRANSLATION_CACHE_MAX_ENTRIES = 500;

export async function getCachedTranslation(
  key: string
): Promise<QuickTranslationResult | null> {
  const db = await getDB();
  const entry = await db.get('translations', key);
  if (!entry) return null;
  if (Date.now() - entry.updatedAt > TRANSLATION_CACHE_TTL_MS) {
    void db.delete('translations', key);
    return null;
  }
  return entry.result;
}

export async function setCachedTranslation(
  key: string,
  result: QuickTranslationResult
): Promise<void> {
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
      if (now - item.updatedAt > TRANSLATION_CACHE_TTL_MS) {
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
    db.clear('ai_explanations')
  ]);
}
