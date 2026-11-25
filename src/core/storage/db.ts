import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { isValidTranslationText } from '../types/subtitles';
import type { AIExplanation, QuickTranslationResult } from '../types/vocabulary';

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
    value: { key: string; translations: Record<string, string>; updatedAt: number };
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

export const TRANSLATION_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
export const TRANSLATION_CACHE_MAX_ENTRIES = 500;

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
  if (!isValidTranslationText(result?.translation)) return;
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

export async function getCachedCueTranslations(
  videoId: string,
  targetLang: string
): Promise<Record<string, string>> {
  if (!videoId || videoId === 'unknown' || !targetLang) return {};
  try {
    const db = await getDB();
    const entry = await db.get('subtitles', `tr:${videoId}:${targetLang.toLowerCase()}`);
    if (!entry?.translations || Date.now() - entry.updatedAt > 30 * 24 * 60 * 60 * 1000) return {};
    return Object.fromEntries(
      Object.entries(entry.translations).filter(([, tr]) => isValidTranslationText(tr))
    );
  } catch {
    return {};
  }
}

export async function saveCachedCueTranslations(
  videoId: string,
  targetLang: string,
  updates: Record<string, string>
): Promise<void> {
  if (!videoId || videoId === 'unknown' || !targetLang) return;
  const clean = Object.fromEntries(
    Object.entries(updates)
      .filter(([text, tr]) => Boolean(text) && isValidTranslationText(tr))
      .map(([text, tr]) => [text, tr.trim()])
  );
  if (Object.keys(clean).length === 0) return;

  try {
    const db = await getDB();
    const key = `tr:${videoId}:${targetLang.toLowerCase()}`;
    const existing = await db.get('subtitles', key);
    const merged: Record<string, string> = {};
    if (existing?.translations) {
      for (const [k, v] of Object.entries(existing.translations)) {
        if (isValidTranslationText(v)) merged[k] = v;
      }
    }
    await db.put('subtitles', { key, translations: { ...merged, ...clean }, updatedAt: Date.now() });
  } catch {
    // Ignore
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
