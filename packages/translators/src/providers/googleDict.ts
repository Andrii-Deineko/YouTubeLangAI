import type {
  QuickTranslationResult,
  TranslationProviderOptions,
  TranslationProviderPlugin
} from '@langai/contracts';
import { isValidTranslationText } from '@langai/contracts';
import { COOLDOWN_MS, isProviderPaused, setProviderCooldown } from '../cooldown';
import { isAbortError } from './shared';

const PROVIDER_ID = 'googleDict' as const;

async function fetchGoogleDict(
  texts: string[],
  sl: string,
  tl: string,
  signal?: AbortSignal
): Promise<Array<string | null>> {
  if (await isProviderPaused(PROVIDER_ID)) {
    throw new Error('Google Dict cooldown');
  }
  const params = new URLSearchParams({
    client: 'dict-chrome-ex',
    sl: sl && sl !== 'unknown' ? sl : 'auto',
    tl
  });
  for (const text of texts) {
    params.append('q', text);
  }

  const res = await fetch(`https://clients5.google.com/translate_a/t?${params}`, { signal });
  if (res.status === 429 || res.status === 403) {
    await setProviderCooldown(PROVIDER_ID, COOLDOWN_MS);
    throw new Error(`Google Dict HTTP ${res.status}`);
  }
  if (!res.ok) {
    throw new Error(`Google Dict HTTP ${res.status}`);
  }

  const raw: unknown = await res.json();
  if (!Array.isArray(raw)) {
    throw new Error('Invalid Google Dict response');
  }

  return texts.map((_, index) => {
    const item = raw[index];
    const translated =
      Array.isArray(item) && typeof item[0] === 'string'
        ? item[0].trim()
        : typeof item === 'string'
          ? item.trim()
          : '';
    return isValidTranslationText(translated) ? translated : null;
  });
}

export const googleDictProvider: TranslationProviderPlugin = {
  id: PROVIDER_ID,
  name: 'Google Dictionary',

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
    const [translation] = await fetchGoogleDict([clean], sl, tl, options?.signal);
    if (!translation) return null;
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
    let missing = [...texts];

    try {
      const translated = await fetchGoogleDict(texts, sl, tl, signal);
      texts.forEach((text, index) => {
        const result = translated[index];
        if (isValidTranslationText(result)) {
          map[text] = result;
        }
      });
      missing = texts.filter((text) => !map[text]);
    } catch (error: unknown) {
      if (isAbortError(error) || (await isProviderPaused(PROVIDER_ID))) {
        return texts.map((text) => map[text] ?? null);
      }
    }

    // Keep valid batch results and retry only the missing entries. A single
    // untranslatable sound marker must not discard the rest of the batch.
    for (const text of missing) {
      if (signal?.aborted || (await isProviderPaused(PROVIDER_ID))) break;
      try {
        const [result] = await fetchGoogleDict([text], sl, tl, signal);
        if (isValidTranslationText(result)) {
          map[text] = result;
        }
      } catch (error: unknown) {
        if (isAbortError(error) || (await isProviderPaused(PROVIDER_ID))) break;
      }
    }

    return texts.map((text) => map[text] ?? null);
  }
};
