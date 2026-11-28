import type {
  QuickTranslationResult,
  TranslationProviderOptions,
  TranslationProviderPlugin
} from '@langai/contracts';
import { isValidTranslationText } from '@langai/contracts';
import { COOLDOWN_MS, isProviderPaused, setProviderCooldown } from '../cooldown';
import {
  byteLen,
  DELIM,
  delay,
  MM_MAX_BYTES,
  splitToMaxBytes,
  translateChunk
} from './shared';

const PROVIDER_ID = 'mymemory' as const;

function resolveMyMemorySourceLang(sl: string, query: string): string {
  const rawSl = sl.trim();
  const cleanSl = /^zh/i.test(rawSl) ? 'zh-CN' : rawSl.toLowerCase().split('-')[0];
  if (cleanSl && cleanSl !== 'auto' && cleanSl !== 'unknown' && cleanSl !== 'und') {
    return cleanSl;
  }
  if (/[іїєґ]/i.test(query)) return 'uk';
  if (/[а-яё]/i.test(query)) return 'ru';
  if (/[\u3040-\u30FF]/.test(query)) return 'ja';
  if (/[\uAC00-\uD7AF]/.test(query)) return 'ko';
  if (/[\u4E00-\u9FFF]/.test(query)) return 'zh-CN';
  if (/[åäö]/i.test(query)) return 'sv';
  return 'en';
}

function resolveMyMemoryTargetLang(tl: string): string {
  const rawTl = tl.trim();
  return /^zh/i.test(rawTl) ? 'zh-CN' : rawTl.toLowerCase().split('-')[0] || 'ru';
}

async function fetchMyMemory(
  query: string,
  sl: string,
  tl: string,
  email?: string,
  signal?: AbortSignal
): Promise<string> {
  if (await isProviderPaused(PROVIDER_ID)) {
    throw new Error('MyMemory cooldown');
  }
  const src = resolveMyMemorySourceLang(sl, query);
  const dst = resolveMyMemoryTargetLang(tl);
  if (src === dst) {
    throw new Error('Same language');
  }

  const params = new URLSearchParams({ q: query, langpair: `${src}|${dst}` });
  if (email?.trim()) {
    params.set('de', email.trim());
  }

  const res = await fetch(`https://api.mymemory.translated.net/get?${params}`, { signal });
  if (res.status === 429 || res.status === 403) {
    await setProviderCooldown(PROVIDER_ID, COOLDOWN_MS);
    throw new Error(`MyMemory HTTP ${res.status}`);
  }
  if (!res.ok) {
    throw new Error(`MyMemory HTTP ${res.status}`);
  }

  const data = (await res.json()) as {
    responseData?: { translatedText?: string };
    responseStatus?: number | string;
    responseDetails?: string;
    quotaFinished?: boolean;
  };
  const tr = data.responseData?.translatedText?.trim() ?? '';
  if (
    data.quotaFinished ||
    Number(data.responseStatus) === 429 ||
    /MYMEMORY WARNING|QUOTA EXCEEDED|TOO MANY REQUESTS/i.test(
      `${data.responseDetails ?? ''} ${tr}`
    )
  ) {
    await setProviderCooldown(PROVIDER_ID, COOLDOWN_MS);
    throw new Error('MyMemory quota exceeded');
  }
  if (Number(data.responseStatus ?? 200) !== 200 || !isValidTranslationText(tr)) {
    throw new Error(data.responseDetails || 'Invalid MyMemory response');
  }
  return tr;
}

async function fetchMyMemoryChunked(
  text: string,
  sl: string,
  tl: string,
  email?: string,
  signal?: AbortSignal
): Promise<string> {
  const parts = splitToMaxBytes(text, MM_MAX_BYTES);
  const out: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    if (i > 0) await delay(250, signal);
    if (signal?.aborted) break;
    out.push(await fetchMyMemory(parts[i], sl, tl, email, signal));
  }
  return out.join(' ').trim();
}

export const myMemoryProvider: TranslationProviderPlugin = {
  id: PROVIDER_ID,
  name: 'MyMemory',

  async isAvailable(): Promise<boolean> {
    return !(await isProviderPaused(PROVIDER_ID));
  },

  async translateWord(
    text: string,
    sourceLang: string,
    targetLang: string,
    options?: TranslationProviderOptions
  ): Promise<QuickTranslationResult | null> {
    const clean = text.trim();
    if (!clean) return null;
    const sl = sourceLang && sourceLang !== 'unknown' ? sourceLang : 'auto';
    const tl = targetLang || 'ru';
    const translation = await fetchMyMemoryChunked(
      clean,
      sl,
      tl,
      options?.email,
      options?.signal
    );
    if (!isValidTranslationText(translation)) return null;
    return {
      word: clean,
      translation,
      alternatives: [],
      detectedLang: sl === 'auto' ? 'auto' : sl,
      fromCache: false
    };
  },

  async translateBatch(
    texts: string[],
    sourceLang: string,
    targetLang: string,
    options?: TranslationProviderOptions
  ): Promise<Array<string | null>> {
    if (!texts.length) return [];
    const sl = sourceLang && sourceLang !== 'unknown' ? sourceLang : 'auto';
    const tl = targetLang || 'ru';
    const signal = options?.signal;
    const map: Record<string, string> = {};

    if (!signal?.aborted && !(await isProviderPaused(PROVIDER_ID))) {
      const mmChunks: string[][] = [];
      let cur: string[] = [];
      let curBytes = 0;
      const delimBytes = byteLen(DELIM);

      for (const text of texts) {
        const bytes = byteLen(text);
        if (cur.length > 0 && curBytes + delimBytes + bytes > MM_MAX_BYTES) {
          mmChunks.push(cur);
          cur = [text];
          curBytes = bytes;
        } else {
          cur.push(text);
          curBytes = cur.length === 1 ? bytes : curBytes + delimBytes + bytes;
        }
      }
      if (cur.length > 0) mmChunks.push(cur);

      for (let i = 0; i < mmChunks.length; i++) {
        if (signal?.aborted || (await isProviderPaused(PROVIDER_ID))) break;
        if (i > 0) await delay(250, signal);
        const chunkMap = await translateChunk(
          mmChunks[i],
          (query) => fetchMyMemoryChunked(query, sl, tl, options?.email, signal),
          () => isProviderPaused(PROVIDER_ID),
          250,
          signal
        );
        Object.assign(map, chunkMap);
      }
    }

    return texts.map((text) => {
      const value = map[text];
      return isValidTranslationText(value) ? value : null;
    });
  }
};
