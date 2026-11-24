import {
  buildAIExplanationCacheKey,
  buildTranslationCacheKey,
  getCachedAIExplanation,
  getCachedTranslation,
  setCachedAIExplanation,
  setCachedTranslation
} from '../storage/db';
import { exportCardsToAnki, testAnkiConnection } from './export';
import { freeTranslateWord, translateCueBatch } from './freeTranslate';
import {
  fetchAvailableModels,
  requestAIExplanation,
  testLLMConnection
} from './llm';
import {
  disableCinemaModule,
  disableNetflixModule,
  hasCinemaPermissions,
  hasNetflixPermissions,
  isCinemaScriptRegistered,
  isNetflixScriptRegistered,
  registerCinemaScripts,
  registerNetflixScripts,
  syncCinemaModuleState,
  syncNetflixModuleState
} from './moduleManager';
import { getSettings } from '../storage/storage';
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

async function handleQuickTranslate(
  text: string,
  sourceLang: string | undefined,
  nativeLang: string
): Promise<QuickTranslationResult> {
  const cleanText = text.trim();
  const sl = sourceLang && sourceLang !== 'unknown' ? sourceLang : 'auto';
  const settings = await getSettings();
  const cacheKey = buildTranslationCacheKey(
    `${settings.translationProvider}:${sl}`,
    nativeLang,
    cleanText
  );

  const cached = await getCachedTranslation(cacheKey);
  if (cached) {
    return { ...cached, fromCache: true };
  }

  const existingPromise = inFlightTranslations.get(cacheKey);
  if (existingPromise) {
    return existingPromise;
  }

  const promise = (async (): Promise<QuickTranslationResult> => {
    const translated = await freeTranslateWord({
      word: cleanText,
      sourceLang: sl,
      targetLang: nativeLang,
      provider: settings.translationProvider,
      myMemoryEmail: settings.myMemoryEmail,
      deeplApiKey: settings.deeplApiKey
    });
    const result: QuickTranslationResult = {
      word: cleanText,
      translation: translated.translation,
      alternatives: translated.alternatives,
      detectedLang: translated.detectedLang,
      partOfSpeech: translated.partOfSpeech,
      fromCache: false,
      translationUnavailable: translated.translationUnavailable,
      errorProvider: translated.errorProvider
    };
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
    const settings = await getSettings();
    const fallbackModel =
      payload.fallbackModel !== undefined
        ? payload.fallbackModel
        : settings.fallbackModel;

    const explanation = await requestAIExplanation({
      target: payload.target,
      prevSentence: payload.prevSentence,
      currentSentence: payload.currentSentence,
      nextSentence: payload.nextSentence,
      videoTitle: payload.videoTitle,
      nativeLang: payload.nativeLang,
      llmConfig: settings.llm,
      fallbackModel
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

async function handleFetchSubtitleText(url: string): Promise<string> {
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} fetching subtitle text: ${resp.statusText}`);
  }
  return await resp.text();
}

async function processMessage(
  message: RuntimeRequest,
  sender: chrome.runtime.MessageSender
): Promise<RuntimeResponse<unknown>> {
  try {
    switch (message.type) {
      case 'FREE_TRANSLATE_CUES': {
        const settings = await getSettings();
        const result = await translateCueBatch({
          videoId: message.payload.videoId,
          cues: message.payload.cues,
          sourceLang: message.payload.sourceLang,
          targetLang: message.payload.targetLang,
          provider: settings.translationProvider,
          myMemoryEmail: settings.myMemoryEmail,
          deeplApiKey: settings.deeplApiKey,
          priorityTime: message.payload.priorityTime,
          onBatchProgress: (batchTranslations) => {
            if (sender.tab?.id) {
              chrome.tabs
                .sendMessage(sender.tab.id, {
                  type: 'FREE_TRANSLATE_CUES_BATCH',
                  payload: {
                    videoId: message.payload.videoId,
                    batchTranslations
                  }
                })
                .catch(() => undefined);
            }
          }
        });
        return { ok: true, data: result };
      }
      case 'FREE_TRANSLATE_WORD': {
        const settings = await getSettings();
        const result = await freeTranslateWord({
          ...message.payload,
          provider: settings.translationProvider,
          myMemoryEmail: settings.myMemoryEmail,
          deeplApiKey: settings.deeplApiKey
        });
        return { ok: true, data: result };
      }
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
      case 'FETCH_SUBTITLE_TEXT': {
        const text = await handleFetchSubtitleText(message.payload.url);
        return { ok: true, data: { text } };
      }
      case 'CAPTURE_SCREENSHOT': {
        if (!chrome.tabs?.captureVisibleTab) {
          return { ok: false, error: 'tabs.captureVisibleTab not available' };
        }
        const windowId = sender.tab?.windowId ?? chrome.windows?.WINDOW_ID_CURRENT;
        const dataUrl = await new Promise<string>((resolve, reject) => {
          chrome.tabs.captureVisibleTab(windowId, { format: 'png' }, (res) => {
            if (chrome.runtime.lastError || !res) {
              reject(new Error(chrome.runtime.lastError?.message || 'Screenshot failed'));
            } else {
              resolve(res);
            }
          });
        });
        return { ok: true, data: { dataUrl } };
      }
      case 'OPEN_EXTENSION_POPUP': {
        if (chrome.action?.openPopup) {
          try {
            await chrome.action.openPopup();
            return { ok: true, data: true };
          } catch (openErr: unknown) {
            return {
              ok: false,
              error: openErr instanceof Error ? openErr.message : 'Failed to open popup'
            };
          }
        }
        return {
          ok: false,
          error: 'chrome.action.openPopup is not supported in this browser version'
        };
      }
      case 'INJECT_MAIN_INTERCEPTOR': {
        const tabId = sender.tab?.id;
        const frameId = typeof sender.frameId === 'number' ? sender.frameId : 0;
        if (typeof tabId !== 'number') {
          return { ok: false, error: 'No tab id in sender' };
        }
        if (chrome.scripting?.executeScript) {
          try {
            await chrome.scripting.executeScript({
              target: { tabId, frameIds: [frameId] },
              world: 'MAIN',
              files: ['assets/interceptor-cinema.js']
            });
            return { ok: true, data: true };
          } catch (execErr: unknown) {
            return {
              ok: false,
              error: execErr instanceof Error ? execErr.message : 'executeScript failed'
            };
          }
        }
        return { ok: false, error: 'chrome.scripting.executeScript not available' };
      }
      case 'ENABLE_CINEMA_MODULE': {
        const result = await registerCinemaScripts();
        if (result.success) {
          return { ok: true, data: result };
        }
        return { ok: false, error: result.error || 'Failed to register cinema scripts' };
      }
      case 'DISABLE_CINEMA_MODULE': {
        const result = await disableCinemaModule();
        return { ok: true, data: result };
      }
      case 'GET_CINEMA_MODULE_STATUS': {
        const settings = await getSettings();
        const hasPermission = await hasCinemaPermissions();
        const registered = await isCinemaScriptRegistered();
        return {
          ok: true,
          data: {
            enabled: settings.cinemaModuleEnabled,
            hasPermission,
            registered
          }
        };
      }
      case 'ENABLE_NETFLIX_MODULE': {
        const result = await registerNetflixScripts();
        return result.success
          ? { ok: true, data: result }
          : { ok: false, error: result.error || 'Failed to register Netflix script' };
      }
      case 'DISABLE_NETFLIX_MODULE': {
        const result = await disableNetflixModule();
        return { ok: true, data: result };
      }
      case 'GET_NETFLIX_MODULE_STATUS': {
        const settings = await getSettings();
        const hasPermission = await hasNetflixPermissions();
        const registered = await isNetflixScriptRegistered();
        return {
          ok: true,
          data: {
            enabled: settings.netflixModuleEnabled,
            hasPermission,
            registered
          }
        };
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

chrome.runtime.onInstalled.addListener(() => {
  void syncCinemaModuleState();
  void syncNetflixModuleState();
});

chrome.runtime.onStartup.addListener(() => {
  void syncCinemaModuleState();
  void syncNetflixModuleState();
});

if (chrome.permissions?.onRemoved) {
  chrome.permissions.onRemoved.addListener(() => {
    void syncCinemaModuleState();
    void syncNetflixModuleState();
  });
}

chrome.runtime.onMessage.addListener(
  (
    message: RuntimeRequest,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: RuntimeResponse<unknown>) => void
  ): boolean => {
    void processMessage(message, sender).then(sendResponse);
    return true;
  }
);
