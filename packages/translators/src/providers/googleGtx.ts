import type {
  QuickTranslationResult,
  TranslationProviderOptions,
  TranslationProviderPlugin
} from '@langai/contracts';
import { isValidTranslationText } from '@langai/contracts';
import { COOLDOWN_MS, isProviderPaused, setProviderCooldown } from '../cooldown';
import { translateChunk } from './shared';

const PROVIDER_ID = 'google' as const;

interface GtxParseResult {
  translation: string;
  alternatives: string[];
  partOfSpeech?: string;
  detectedLang?: string;
}

function parseGtxJson(raw: unknown): GtxParseResult {
  if (!Array.isArray(raw) || !Array.isArray(raw[0])) {
    throw new Error('Invalid GTX response');
  }
  const translation = (raw[0] as Array<[string | null]>)
    .map((segment) => (Array.isArray(segment) && typeof segment[0] === 'string' ? segment[0] : ''))
    .join('')
    .trim();
  if (!isValidTranslationText(translation)) {
    throw new Error('Invalid GTX translation');
  }

  const alternatives: string[] = [];
  let partOfSpeech: string | undefined;
  if (Array.isArray(raw[1])) {
    for (const entry of raw[1]) {
      if (!Array.isArray(entry)) continue;
      if (!partOfSpeech && typeof entry[0] === 'string' && entry[0].trim()) {
        partOfSpeech = entry[0].trim();
      }
      const candidates = Array.isArray(entry[1]) ? entry[1] : [];
      for (const candidate of candidates) {
        if (
          typeof candidate === 'string' &&
          isValidTranslationText(candidate) &&
          !alternatives.includes(candidate.trim())
        ) {
          alternatives.push(candidate.trim());
        }
      }
    }
  }

  return {
    translation,
    alternatives: alternatives.slice(0, 6),
    partOfSpeech,
    detectedLang: typeof raw[2] === 'string' ? raw[2] : undefined
  };
}

async function fetchGtx(
  query: string,
  sl: string,
  tl: string,
  includeDict: boolean,
  signal?: AbortSignal
): Promise<GtxParseResult> {
  if (await isProviderPaused(PROVIDER_ID)) {
    throw new Error('GTX cooldown');
  }
  const dt = includeDict ? '&dt=t&dt=bd&dt=rm' : '&dt=t';
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(sl)}&tl=${encodeURIComponent(tl)}${dt}&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { signal });
  if (res.status === 429 || res.status === 403) {
    await setProviderCooldown(PROVIDER_ID, COOLDOWN_MS);
    throw new Error(`GTX HTTP ${res.status}`);
  }
  if (!res.ok) {
    throw new Error(`GTX HTTP ${res.status}`);
  }
  const body = await res.text();
  if (!body || /^\s*</.test(body)) {
    await setProviderCooldown(PROVIDER_ID, COOLDOWN_MS);
    throw new Error('GTX challenge');
  }
  return parseGtxJson(JSON.parse(body));
}

export const googleGtxProvider: TranslationProviderPlugin = {
  id: PROVIDER_ID,
  name: 'Google Translate (GTX)',

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
    const parsed = await fetchGtx(clean, sl, tl, true, options?.signal);
    return {
      word: clean,
      translation: parsed.translation,
      alternatives: parsed.alternatives,
      detectedLang: parsed.detectedLang ?? 'auto',
      partOfSpeech: parsed.partOfSpeech,
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
    const map = await translateChunk(
      texts,
      async (query) => (await fetchGtx(query, sl, tl, false, options?.signal)).translation,
      () => isProviderPaused(PROVIDER_ID),
      120,
      options?.signal
    );
    return texts.map((text) => {
      const value = map[text];
      return isValidTranslationText(value) ? value : null;
    });
  }
};
