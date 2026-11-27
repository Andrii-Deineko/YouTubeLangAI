import type {
  QuickTranslationResult,
  TranslationProviderOptions,
  TranslationProviderPlugin
} from '@langai/contracts';
import { isValidTranslationText } from '@langai/contracts';
import {
  COOLDOWN_MS,
  DEEPL_QUOTA_COOLDOWN_MS,
  isProviderPaused,
  setProviderCooldown
} from '../cooldown';
import { isAbortError } from './shared';

const PROVIDER_ID = 'deepl' as const;

export function mapDeepLLanguage(language: string, target: boolean): string | undefined {
  const clean = language.trim().toLowerCase();
  if (!clean || clean === 'auto' || clean === 'unknown') return undefined;
  if (clean === 'zh-cn' || clean === 'zh-hans') return target ? 'ZH-HANS' : 'ZH';
  if (clean === 'zh-tw' || clean === 'zh-hant') return target ? 'ZH-HANT' : 'ZH';
  if (clean === 'en') return target ? 'EN-US' : 'EN';
  if (clean === 'pt') return target ? 'PT-BR' : 'PT';
  return clean.toUpperCase();
}

async function fetchDeepL(
  texts: string[],
  sl: string,
  tl: string,
  apiKey: string,
  signal?: AbortSignal
): Promise<Array<string | null>> {
  if (await isProviderPaused(PROVIDER_ID)) {
    throw new Error('DeepL cooldown');
  }
  const cleanKey = apiKey.trim();
  if (!cleanKey) {
    throw new Error('DeepL API key is not configured');
  }
  const target = mapDeepLLanguage(tl, true);
  if (!target) {
    throw new Error(`Invalid DeepL target language: ${tl}`);
  }
  const endpoint = cleanKey.endsWith(':fx')
    ? 'https://api-free.deepl.com/v2/translate'
    : 'https://api.deepl.com/v2/translate';
  const source = mapDeepLLanguage(sl, false);

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `DeepL-Auth-Key ${cleanKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      text: texts,
      target_lang: target,
      ...(source ? { source_lang: source } : {})
    }),
    signal
  });

  if (res.status === 429 || res.status === 456) {
    await setProviderCooldown(
      PROVIDER_ID,
      res.status === 456 ? DEEPL_QUOTA_COOLDOWN_MS : COOLDOWN_MS
    );
    throw new Error(`DeepL HTTP ${res.status}`);
  }
  if (!res.ok) {
    throw new Error(`DeepL HTTP ${res.status}`);
  }

  const raw = (await res.json()) as { translations?: Array<{ text?: string }> };
  if (!Array.isArray(raw.translations)) {
    throw new Error('Invalid DeepL response');
  }

  return texts.map((_, index) => {
    const translated = raw.translations?.[index]?.text?.trim() ?? '';
    return isValidTranslationText(translated) ? translated : null;
  });
}

export const deeplProvider: TranslationProviderPlugin = {
  id: PROVIDER_ID,
  name: 'DeepL',

  async isAvailable(options?: TranslationProviderOptions): Promise<boolean> {
    if (!options?.apiKey?.trim()) return false;
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
    const [translation] = await fetchDeepL([clean], sl, tl, options?.apiKey ?? '', options?.signal);
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
    const apiKey = options?.apiKey ?? '';
    if (!apiKey.trim()) {
      throw new Error('DeepL API key is not configured');
    }
    const sl = sourceLang && sourceLang !== 'unknown' ? sourceLang : 'auto';
    const tl = targetLang || 'ru';
    const signal = options?.signal;
    const map: Record<string, string> = {};
    let missing = [...texts];

    try {
      const translated = await fetchDeepL(texts, sl, tl, apiKey, signal);
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

    for (const text of missing) {
      if (signal?.aborted || (await isProviderPaused(PROVIDER_ID))) break;
      try {
        const [result] = await fetchDeepL([text], sl, tl, apiKey, signal);
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
