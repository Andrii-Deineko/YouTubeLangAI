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

export async function getCachedSubtitles(key: string): Promise<Json3Response | null> {
  const db = await getDB();
  const entry = await db.get('subtitles', key);
  return entry ? entry.data : null;
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

export async function getCachedTranslation(
  key: string
): Promise<QuickTranslationResult | null> {
  const db = await getDB();
  const entry = await db.get('translations', key);
  return entry ? entry.result : null;
}

export async function setCachedTranslation(
  key: string,
  result: QuickTranslationResult
): Promise<void> {
  const db = await getDB();
  await db.put('translations', {
    key,
    result,
    updatedAt: Date.now()
  });
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
