import { openDB, type DBSchema, type IDBPDatabase, type IDBPObjectStore } from 'idb';
import {
  isValidTranslationText,
  type AIExplanation,
  type QuickTranslationResult,
  type VocabularyCard
} from '@langai/contracts';

export interface CardMediaEntry {
  key: string;
  blob: Blob;
  updatedAt: number;
}

export interface CachedSubtitleEntry {
  key: string;
  translations: Record<string, string>;
  updatedAt: number;
}

export interface CachedTranslationEntry {
  key: string;
  result: QuickTranslationResult;
  updatedAt: number;
}

export interface CachedAIEntry {
  key: string;
  explanation: AIExplanation;
  updatedAt: number;
}

interface LangAIDBSchema extends DBSchema {
  vocabulary_cards: {
    key: string;
    value: VocabularyCard;
    indexes: {
      due: string;
      source: string;
      mediaId: string;
    };
  };
  card_media: {
    key: string;
    value: CardMediaEntry;
  };
  subtitles: {
    key: string;
    value: CachedSubtitleEntry;
    indexes: {
      updatedAt: number;
    };
  };
  translations: {
    key: string;
    value: CachedTranslationEntry;
    indexes: {
      updatedAt: number;
    };
  };
  ai_explanations: {
    key: string;
    value: CachedAIEntry;
    indexes: {
      updatedAt: number;
    };
  };
}

export const DB_NAME = 'yt-lang-ai-cache';
export const DB_VERSION = 2;

export const TRANSLATION_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
export const TRANSLATION_CACHE_MAX_ENTRIES = 500;

export const SUBTITLE_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const SUBTITLE_CACHE_MAX_ENTRIES = 200;

export const AI_EXPLANATION_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const AI_EXPLANATION_CACHE_MAX_ENTRIES = 500;

let dbPromise: Promise<IDBPDatabase<LangAIDBSchema>> | null = null;

type CacheStoreName = 'subtitles' | 'translations' | 'ai_explanations';

export function getDB(): Promise<IDBPDatabase<LangAIDBSchema>> {
  if (!dbPromise) {
    dbPromise = openDB<LangAIDBSchema>(DB_NAME, DB_VERSION, {
      upgrade(db, _oldVersion, _newVersion, tx) {
        if (!db.objectStoreNames.contains('vocabulary_cards')) {
          const vocabStore = db.createObjectStore('vocabulary_cards', { keyPath: 'id' });
          vocabStore.createIndex('due', 'fsrsState.due');
          vocabStore.createIndex('source', 'source');
          vocabStore.createIndex('mediaId', 'videoId');
        } else {
          const vocabStore = tx.objectStore('vocabulary_cards');
          if (!vocabStore.indexNames.contains('due')) {
            vocabStore.createIndex('due', 'fsrsState.due');
          }
          if (!vocabStore.indexNames.contains('source')) {
            vocabStore.createIndex('source', 'source');
          }
          if (!vocabStore.indexNames.contains('mediaId')) {
            vocabStore.createIndex('mediaId', 'videoId');
          }
        }

        if (!db.objectStoreNames.contains('card_media')) {
          db.createObjectStore('card_media', { keyPath: 'key' });
        }

        const cacheStores: CacheStoreName[] = ['subtitles', 'translations', 'ai_explanations'];
        for (const storeName of cacheStores) {
          if (!db.objectStoreNames.contains(storeName)) {
            const store = db.createObjectStore(storeName, { keyPath: 'key' });
            store.createIndex('updatedAt', 'updatedAt');
          } else {
            const store = tx.objectStore(storeName);
            if (!store.indexNames.contains('updatedAt')) {
              store.createIndex('updatedAt', 'updatedAt');
            }
          }
        }
      }
    });
  }
  return dbPromise;
}

export function resetDBInstanceForTesting(): void {
  dbPromise = null;
}

// ---------------------------------------------------------------------------
// Media Blob conversion & storage
// ---------------------------------------------------------------------------

export function dataUrlToBlob(dataUrl: string): Blob {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match?.[2]) {
    throw new Error('Invalid base64 data URL');
  }
  const mimeType = match[1] || 'image/webp';
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

export async function blobToDataUrl(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  const mimeType = blob.type || 'image/webp';
  return `data:${mimeType};base64,${btoa(binary)}`;
}

export async function saveCardMedia(key: string, dataUrlOrBlob: string | Blob): Promise<void> {
  const db = await getDB();
  const blob = typeof dataUrlOrBlob === 'string' ? dataUrlToBlob(dataUrlOrBlob) : dataUrlOrBlob;
  await db.put('card_media', {
    key,
    blob,
    updatedAt: Date.now()
  });
}

export async function getCardMediaBlob(key: string): Promise<Blob | null> {
  if (!key) return null;
  const db = await getDB();
  const entry = await db.get('card_media', key);
  return entry?.blob ?? null;
}

export async function getCardMediaDataUrl(key: string): Promise<string | null> {
  const blob = await getCardMediaBlob(key);
  if (!blob) return null;
  return blobToDataUrl(blob);
}

export async function deleteCardMedia(key: string): Promise<void> {
  if (!key) return;
  const db = await getDB();
  await db.delete('card_media', key);
}

// ---------------------------------------------------------------------------
// Vocabulary IndexedDB CRUD (O(1) single-card updates)
// ---------------------------------------------------------------------------

export async function getAllVocabularyCardsFromDB(): Promise<VocabularyCard[]> {
  const db = await getDB();
  const cards = await db.getAll('vocabulary_cards');
  return cards.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

export async function getVocabularyCardFromDB(id: string): Promise<VocabularyCard | null> {
  const db = await getDB();
  return (await db.get('vocabulary_cards', id)) ?? null;
}

export async function getVocabularyCardsByMediaIdFromDB(
  videoId: string
): Promise<VocabularyCard[]> {
  const db = await getDB();
  return db.getAllFromIndex('vocabulary_cards', 'mediaId', videoId);
}

export async function getDueVocabularyCardsFromDB(
  now: Date = new Date()
): Promise<VocabularyCard[]> {
  const db = await getDB();
  return db.getAllFromIndex(
    'vocabulary_cards',
    'due',
    IDBKeyRange.upperBound(now.toISOString())
  );
}

export async function putVocabularyCardInDB(card: VocabularyCard): Promise<void> {
  const db = await getDB();
  await db.put('vocabulary_cards', card);
}

export async function deleteVocabularyCardFromDB(cardId: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['vocabulary_cards', 'card_media'], 'readwrite');
  const vocabStore = tx.objectStore('vocabulary_cards');
  const mediaStore = tx.objectStore('card_media');
  const existing = await vocabStore.get(cardId);
  await vocabStore.delete(cardId);
  if (existing?.mediaBlobKey) {
    await mediaStore.delete(existing.mediaBlobKey);
  }
  await tx.done;
}

// ---------------------------------------------------------------------------
// Cursor-based cache eviction (zero store.getAll())
// ---------------------------------------------------------------------------

async function evictCacheStore<S extends CacheStoreName>(
  db: IDBPDatabase<LangAIDBSchema>,
  storeName: S,
  ttlMs: number,
  maxEntries: number,
  now: number
): Promise<void> {
  try {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName) as unknown as IDBPObjectStore<
      LangAIDBSchema,
      [S],
      S,
      'readwrite'
    >;
    const updatedAtIndex = store.index('updatedAt');

    // 1. Delete expired entries using upperBound on updatedAt
    const cutoff = now - ttlMs;
    if (cutoff > 0) {
      let expiredCursor = await updatedAtIndex.openCursor(IDBKeyRange.upperBound(cutoff, true));
      while (expiredCursor) {
        await expiredCursor.delete();
        expiredCursor = await expiredCursor.continue();
      }
    }

    // 2. Enforce max entry cap using ascending updatedAt cursor (oldest first)
    const count = await store.count();
    let excess = count - maxEntries;
    if (excess > 0) {
      let oldestCursor = await updatedAtIndex.openCursor();
      while (oldestCursor && excess > 0) {
        await oldestCursor.delete();
        excess--;
        oldestCursor = await oldestCursor.continue();
      }
    }

    await tx.done;
  } catch {
    // Ignore eviction errors
  }
}

// ---------------------------------------------------------------------------
// Translation, Subtitle Cue, and AI Explanation caches
// ---------------------------------------------------------------------------

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

  await evictCacheStore(
    db,
    'translations',
    TRANSLATION_CACHE_TTL_MS,
    TRANSLATION_CACHE_MAX_ENTRIES,
    now
  );
}

function buildSubtitleCueCacheKey(
  videoId: string,
  targetLang: string,
  provider = 'google',
  sourceLang?: string
): string {
  const normTarget = targetLang.trim().toLowerCase();
  const normSource = sourceLang?.trim().toLowerCase();
  if (normSource && normSource !== 'auto' && normSource !== 'unknown' && normSource !== 'und') {
    return `tr:${provider}:${videoId}:${normSource}:${normTarget}`;
  }
  return `tr:${provider}:${videoId}:${normTarget}`;
}

export async function getCachedCueTranslations(
  videoId: string,
  targetLang: string,
  provider = 'google',
  sourceLang?: string
): Promise<Record<string, string>> {
  if (!videoId || videoId === 'unknown' || !targetLang) return {};
  try {
    const db = await getDB();
    const key = buildSubtitleCueCacheKey(videoId, targetLang, provider, sourceLang);
    const entry = await db.get('subtitles', key);
    if (!entry?.translations) return {};
    if (Date.now() - entry.updatedAt > SUBTITLE_CACHE_TTL_MS) {
      void db.delete('subtitles', key);
      return {};
    }
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
  updates: Record<string, string>,
  provider = 'google',
  sourceLang?: string
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
    const now = Date.now();
    const key = buildSubtitleCueCacheKey(videoId, targetLang, provider, sourceLang);
    const existing = await db.get('subtitles', key);
    const merged: Record<string, string> = {};
    if (existing?.translations) {
      for (const [k, v] of Object.entries(existing.translations)) {
        if (isValidTranslationText(v)) merged[k] = v;
      }
    }
    await db.put('subtitles', {
      key,
      translations: { ...merged, ...clean },
      updatedAt: now
    });

    await evictCacheStore(
      db,
      'subtitles',
      SUBTITLE_CACHE_TTL_MS,
      SUBTITLE_CACHE_MAX_ENTRIES,
      now
    );
  } catch {
    // Ignore
  }
}

export async function getCachedAIExplanation(key: string): Promise<AIExplanation | null> {
  const db = await getDB();
  const entry = await db.get('ai_explanations', key);
  if (!entry) return null;
  if (Date.now() - entry.updatedAt > AI_EXPLANATION_CACHE_TTL_MS) {
    void db.delete('ai_explanations', key);
    return null;
  }
  return entry.explanation;
}

export async function setCachedAIExplanation(
  key: string,
  explanation: AIExplanation
): Promise<void> {
  const db = await getDB();
  const now = Date.now();
  await db.put('ai_explanations', {
    key,
    explanation,
    updatedAt: now
  });

  await evictCacheStore(
    db,
    'ai_explanations',
    AI_EXPLANATION_CACHE_TTL_MS,
    AI_EXPLANATION_CACHE_MAX_ENTRIES,
    now
  );
}

export async function clearAllCaches(): Promise<void> {
  const db = await getDB();
  await Promise.all([
    db.clear('subtitles'),
    db.clear('translations'),
    db.clear('ai_explanations')
  ]);
}
