import type { Json3Response } from '../types/subtitles';
import type { TrackCapturedPayload } from '../types/messages';

export const CAPTION_CACHE_INDEX_KEY = 'ytai_caption_cache_index';
export const CAPTION_CACHE_PREFIX = 'ytai_cap_';
export const CAPTION_CACHE_MAX_VIDEOS = 30;
export const CAPTION_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export const RATE_LIMIT_STORAGE_KEY = 'ytai_timedtext_blocked_until';
export const RATE_LIMIT_COOLDOWN_MS = 120_000; // 2 minutes

export interface CaptionCacheIndexItem {
  key: string;
  storageKey: string;
  videoId: string;
  lang: string;
  tlang?: string;
  kind?: string;
  savedAt: number;
  lastAccessedAt: number;
}

export interface CachedCaptionEntry {
  key: string;
  videoId: string;
  lang: string;
  tlang?: string;
  kind?: string;
  url: string;
  data: Json3Response;
  savedAt: number;
  lastAccessedAt: number;
}

export function buildCaptionCacheKey(videoId: string, lang: string, tlang?: string): string {
  return `${videoId}:${lang}:${tlang || 'none'}`;
}

function isStorageAvailable(): boolean {
  return typeof chrome !== 'undefined' && Boolean(chrome?.storage?.local);
}

export async function getCaptionCacheIndex(): Promise<CaptionCacheIndexItem[]> {
  if (!isStorageAvailable()) return [];
  try {
    const result = await chrome.storage.local.get(CAPTION_CACHE_INDEX_KEY);
    const raw = result[CAPTION_CACHE_INDEX_KEY];
    if (Array.isArray(raw)) {
      return raw as CaptionCacheIndexItem[];
    }
  } catch (err) {
    console.warn('[YT-Lang-AI] Error reading caption cache index:', err);
  }
  return [];
}

export async function getCachedCaptionTrack(
  videoId: string,
  lang?: string,
  tlang?: string
): Promise<TrackCapturedPayload | null> {
  if (!isStorageAvailable() || !videoId || videoId === 'unknown') return null;

  try {
    const now = Date.now();
    const index = await getCaptionCacheIndex();
    if (index.length === 0) return null;

    let match: CaptionCacheIndexItem | undefined;

    if (lang && tlang) {
      const exactKey = buildCaptionCacheKey(videoId, lang, tlang);
      match = index.find((item) => item.key === exactKey);
    } else if (tlang && tlang !== 'none') {
      match = index.find(
        (item) => item.videoId === videoId && item.tlang?.toLowerCase() === tlang.toLowerCase()
      );
    } else if (lang) {
      match = index.find(
        (item) =>
          item.videoId === videoId &&
          item.lang.toLowerCase() === lang.toLowerCase() &&
          (!item.tlang || item.tlang === 'none')
      );
    } else {
      match = index.find(
        (item) => item.videoId === videoId && (!item.tlang || item.tlang === 'none')
      );
    }

    if (!match) return null;

    // Check TTL
    if (now - match.savedAt > CAPTION_CACHE_TTL_MS) {
      await evictCacheEntries([match.storageKey]);
      void evictExpiredCaptionCache();
      return null;
    }

    const res = await chrome.storage.local.get(match.storageKey);
    const entry = res[match.storageKey] as CachedCaptionEntry | undefined;
    if (!entry || !entry.data || !Array.isArray(entry.data.events) || entry.data.events.length === 0) {
      return null;
    }

    match.lastAccessedAt = now;
    await chrome.storage.local.set({ [CAPTION_CACHE_INDEX_KEY]: index });

    return {
      videoId: entry.videoId,
      lang: entry.lang,
      tlang: entry.tlang && entry.tlang !== 'none' ? entry.tlang : undefined,
      kind: entry.kind,
      url: entry.url || '',
      data: entry.data
    };
  } catch (err) {
    console.warn('[YT-Lang-AI] Error getting cached track:', err);
    return null;
  }
}

export async function saveCachedCaptionTrack(track: TrackCapturedPayload): Promise<void> {
  if (!isStorageAvailable()) return;
  if (!track.videoId || track.videoId === 'unknown') return;
  if (!track.data?.events || track.data.events.length === 0) return;

  try {
    const now = Date.now();
    const key = buildCaptionCacheKey(track.videoId, track.lang, track.tlang);
    const storageKey = `${CAPTION_CACHE_PREFIX}${key}`;

    const entry: CachedCaptionEntry = {
      key,
      videoId: track.videoId,
      lang: track.lang,
      tlang: track.tlang || 'none',
      kind: track.kind,
      url: track.url || '',
      data: track.data,
      savedAt: now,
      lastAccessedAt: now
    };

    let index = await getCaptionCacheIndex();

    const expiredKeys: string[] = [];
    index = index.filter((item) => {
      if (now - item.savedAt > CAPTION_CACHE_TTL_MS) {
        expiredKeys.push(item.storageKey);
        return false;
      }
      return true;
    });

    index = index.filter((item) => item.key !== key);

    index.push({
      key,
      storageKey,
      videoId: track.videoId,
      lang: track.lang,
      tlang: track.tlang || 'none',
      kind: track.kind,
      savedAt: now,
      lastAccessedAt: now
    });

    const videoLastAccessedMap = new Map<string, number>();
    for (const item of index) {
      const prev = videoLastAccessedMap.get(item.videoId) ?? 0;
      if (item.lastAccessedAt > prev) {
        videoLastAccessedMap.set(item.videoId, item.lastAccessedAt);
      }
    }

    if (videoLastAccessedMap.size > CAPTION_CACHE_MAX_VIDEOS) {
      const sortedVideos = Array.from(videoLastAccessedMap.entries())
        .sort((a, b) => a[1] - b[1])
        .map(([vid]) => vid);

      const videosToRemove = new Set(
        sortedVideos.slice(0, videoLastAccessedMap.size - CAPTION_CACHE_MAX_VIDEOS)
      );

      const evictedKeys: string[] = [];
      index = index.filter((item) => {
        if (videosToRemove.has(item.videoId)) {
          evictedKeys.push(item.storageKey);
          return false;
        }
        return true;
      });

      if (evictedKeys.length > 0) {
        expiredKeys.push(...evictedKeys);
      }
    }

    const writes: Record<string, unknown> = {
      [storageKey]: entry,
      [CAPTION_CACHE_INDEX_KEY]: index
    };

    await chrome.storage.local.set(writes);

    if (expiredKeys.length > 0) {
      await chrome.storage.local.remove(expiredKeys);
    }
  } catch (err) {
    console.warn('[YT-Lang-AI] Error saving caption track to cache:', err);
  }
}

export async function evictExpiredCaptionCache(): Promise<void> {
  if (!isStorageAvailable()) return;
  try {
    const now = Date.now();
    const index = await getCaptionCacheIndex();
    const expiredKeys: string[] = [];
    const valid = index.filter((item) => {
      if (now - item.savedAt > CAPTION_CACHE_TTL_MS) {
        expiredKeys.push(item.storageKey);
        return false;
      }
      return true;
    });

    if (expiredKeys.length > 0) {
      await chrome.storage.local.set({ [CAPTION_CACHE_INDEX_KEY]: valid });
      await chrome.storage.local.remove(expiredKeys);
    }
  } catch (err) {
    console.warn('[YT-Lang-AI] Error evicting expired caption cache:', err);
  }
}

async function evictCacheEntries(storageKeys: string[]): Promise<void> {
  if (!isStorageAvailable() || storageKeys.length === 0) return;
  try {
    const index = await getCaptionCacheIndex();
    const keySet = new Set(storageKeys);
    const updatedIndex = index.filter((item) => !keySet.has(item.storageKey));
    await chrome.storage.local.set({ [CAPTION_CACHE_INDEX_KEY]: updatedIndex });
    await chrome.storage.local.remove(storageKeys);
  } catch (err) {
    console.warn('[YT-Lang-AI] Error evicting cache entries:', err);
  }
}

export function getRateLimitBlockedUntil(): number {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const val = window.localStorage.getItem(RATE_LIMIT_STORAGE_KEY);
      if (val) {
        const num = Number(val);
        if (!Number.isNaN(num) && num > Date.now()) {
          return num;
        }
      }
    }
  } catch {
    // Ignore
  }
  return 0;
}

export function isCircuitBreakerActive(): boolean {
  return getRateLimitBlockedUntil() > Date.now();
}
