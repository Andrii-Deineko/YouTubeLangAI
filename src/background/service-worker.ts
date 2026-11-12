import {
  buildAIExplanationCacheKey,
  buildTranslationCacheKey,
  getCachedAIExplanation,
  getCachedTranslation,
  setCachedAIExplanation,
  setCachedTranslation
} from '../shared/db';
import { exportCardsToAnki, testAnkiConnection } from '../shared/export';
import {
  fetchAvailableModels,
  requestAIExplanation,
  testLLMConnection
} from '../shared/llm';
import type { RuntimeRequest, RuntimeResponse } from '../types/messages';
import type { AIExplanation, QuickTranslationResult } from '../types/vocabulary';

class ConcurrencyQueue {
  private activeCount = 0;
  private readonly maxConcurrent: number;
  private readonly waitQueue: Array<() => void> = [];

  constructor(maxConcurrent: number) {
    this.maxConcurrent = maxConcurrent;
  }

  public async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.activeCount >= this.maxConcurrent) {
      await new Promise<void>((resolve) => this.waitQueue.push(resolve));
    }
    this.activeCount++;
    try {
      return await task();
    } finally {
      this.activeCount--;
      const next = this.waitQueue.shift();
      if (next) next();
    }
  }
}

const llmQueue = new ConcurrencyQueue(2);
const inFlightTranslations = new Map<string, Promise<QuickTranslationResult>>();
const inFlightAI = new Map<string, Promise<AIExplanation>>();

function parseGoogleTranslateResponse(
  raw: unknown,
  originalWord: string
): Omit<QuickTranslationResult, 'fromCache'> {
  if (!Array.isArray(raw)) {
    throw new Error('Unexpected translation response format');
  }

  const segments = Array.isArray(raw[0]) ? raw[0] : [];
  const translatedParts: string[] = [];
  for (const seg of segments) {
    if (Array.isArray(seg) && typeof seg[0] === 'string') {
      translatedParts.push(seg[0]);
    }
  }

  const primaryTranslation = translatedParts.join('').trim() || originalWord;
  const detectedLang = typeof raw[2] === 'string' ? raw[2] : 'auto';

  const alternatives: string[] = [];
  let partOfSpeech: string | undefined;

  if (Array.isArray(raw[1])) {
    for (const dictEntry of raw[1]) {
      if (!Array.isArray(dictEntry)) continue;
      if (!partOfSpeech && typeof dictEntry[0] === 'string' && dictEntry[0].trim()) {
        partOfSpeech = dictEntry[0].trim();
      }
      if (Array.isArray(dictEntry[1])) {
        for (const candidate of dictEntry[1]) {
          if (
            typeof candidate === 'string' &&
            candidate.trim() &&
            candidate.trim().toLowerCase() !== primaryTranslation.toLowerCase() &&
            !alternatives.includes(candidate.trim())
          ) {
            alternatives.push(candidate.trim());
          }
        }
      }
    }
  }

  return {
    word: originalWord,
    translation: primaryTranslation,
    alternatives: alternatives.slice(0, 6),
    detectedLang,
    partOfSpeech
  };
}

async function handleQuickTranslate(
  text: string,
  sourceLang: string | undefined,
  nativeLang: string
): Promise<QuickTranslationResult> {
  const cleanText = text.trim();
  const sl = sourceLang && sourceLang !== 'unknown' ? sourceLang : 'auto';
  const cacheKey = buildTranslationCacheKey(sl, nativeLang, cleanText);

  const cached = await getCachedTranslation(cacheKey);
  if (cached) {
    return { ...cached, fromCache: true };
  }

  const existingPromise = inFlightTranslations.get(cacheKey);
  if (existingPromise) {
    return existingPromise;
  }

  const promise = (async (): Promise<QuickTranslationResult> => {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(
      sl
    )}&tl=${encodeURIComponent(nativeLang)}&dt=t&dt=bd&q=${encodeURIComponent(cleanText)}`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Translation failed with HTTP ${response.status}`);
    }

    const json: unknown = await response.json();
    const parsed = parseGoogleTranslateResponse(json, cleanText);
    const result: QuickTranslationResult = { ...parsed, fromCache: false };
    await setCachedTranslation(cacheKey, result);
    return result;
  })();

  inFlightTranslations.set(cacheKey, promise);
  try {
    return await promise;
  } finally {
    inFlightTranslations.delete(cacheKey);
  }
}

async function handleAIExplain(
  payload: Extract<RuntimeRequest, { type: 'AI_EXPLAIN' }>['payload']
): Promise<AIExplanation> {
  const cacheKey = buildAIExplanationCacheKey(
    payload.videoId,
    payload.cueId,
    payload.target,
    payload.nativeLang
  );

  const cached = await getCachedAIExplanation(cacheKey);
  if (cached) {
    return cached;
  }

  const existingPromise = inFlightAI.get(cacheKey);
  if (existingPromise) {
    return existingPromise;
  }

  const promise = llmQueue.run(async () => {
    const explanation = await requestAIExplanation({
      target: payload.target,
      prevSentence: payload.prevSentence,
      currentSentence: payload.currentSentence,
      nextSentence: payload.nextSentence,
      videoTitle: payload.videoTitle,
      nativeLang: payload.nativeLang,
      llmConfig: payload.llmConfig
    });
    await setCachedAIExplanation(cacheKey, explanation);
    return explanation;
  });

  inFlightAI.set(cacheKey, promise);
  try {
    return await promise;
  } finally {
    inFlightAI.delete(cacheKey);
  }
}

async function processMessage(message: RuntimeRequest): Promise<RuntimeResponse<unknown>> {
  try {
    switch (message.type) {
      case 'QUICK_TRANSLATE': {
        const result = await handleQuickTranslate(
          message.payload.text,
          message.payload.sourceLang,
          message.payload.nativeLang
        );
        return { ok: true, data: result };
      }
      case 'AI_EXPLAIN': {
        const result = await handleAIExplain(message.payload);
        return { ok: true, data: result };
      }
      case 'ANKI_TEST': {
        const result = await testAnkiConnection(message.payload.url);
        return { ok: true, data: result };
      }
      case 'ANKI_EXPORT_CARDS': {
        const result = await exportCardsToAnki(
          message.payload.url,
          message.payload.deckName,
          message.payload.cards
        );
        return { ok: true, data: result };
      }
      case 'LLM_TEST': {
        const result = await testLLMConnection(message.payload.llmConfig);
        return { ok: true, data: result };
      }
      case 'FETCH_AVAILABLE_MODELS': {
        const models = await fetchAvailableModels(
          message.payload.baseUrl,
          message.payload.apiKey
        );
        return { ok: true, data: models };
      }
      default:
        return { ok: false, error: 'Unsupported message type' };
    }
  } catch (err: unknown) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Unexpected service worker error'
    };
  }
}

chrome.runtime.onMessage.addListener(
  (
    message: RuntimeRequest,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: RuntimeResponse<unknown>) => void
  ): boolean => {
    void processMessage(message).then(sendResponse);
    return true;
  }
);
