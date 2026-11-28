import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LLMConfig } from '@langai/contracts';
import {
  ALL_TRANSLATION_PROVIDERS,
  cancelTranslationJob,
  clearProviderCooldowns,
  deeplProvider,
  fetchAvailableModels,
  getActiveTranslationJobCount,
  getProviderPausedUntil,
  googleDictProvider,
  googleGtxProvider,
  isLlmConfigured,
  isProviderPaused,
  myMemoryProvider,
  quickTranslateWord,
  requestAiExplanation,
  resolveChatCompletionsUrl,
  resolveModelsUrl,
  setProviderCooldown,
  testLlmConnection,
  translateCuesWindow,
  type TranslatorSettings
} from '../index';
import { resetCooldownHydrationForTest } from '../cooldown';

const baseSettings: TranslatorSettings = {
  translationProvider: 'googleDict',
  myMemoryEmail: '',
  deeplApiKey: ''
};

function mockJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function setMockSessionStorage(store: Record<string, unknown> | undefined): void {
  if (store === undefined) {
    Object.defineProperty(globalThis, 'chrome', {
      value: undefined,
      configurable: true,
      writable: true
    });
    return;
  }

  Object.defineProperty(globalThis, 'chrome', {
    value: {
      storage: {
        session: {
          async get(key: string) {
            return { [key]: store[key] };
          },
          async set(items: Record<string, unknown>) {
            Object.assign(store, items);
          },
          async remove(key: string) {
            delete store[key];
          }
        }
      }
    },
    configurable: true,
    writable: true
  });
}

beforeEach(async () => {
  setMockSessionStorage(undefined);
  resetCooldownHydrationForTest();
  await clearProviderCooldowns();
});

afterEach(() => {
  vi.restoreAllMocks();
  setMockSessionStorage(undefined);
  resetCooldownHydrationForTest();
});

describe('Translation Providers', () => {
  it('exports all four providers in ALL_TRANSLATION_PROVIDERS', () => {
    expect(ALL_TRANSLATION_PROVIDERS.map((p) => p.id)).toEqual([
      'googleDict',
      'google',
      'deepl',
      'mymemory'
    ]);
  });

  it('googleDictProvider translates single words and batches with missing-item retry', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(mockJsonResponse([['привіт', 'en']]))
      .mockResolvedValueOnce(mockJsonResponse([['перший'], null]))
      .mockResolvedValueOnce(mockJsonResponse([['другий']]));

    const single = await googleDictProvider.translateWord('hello', 'en', 'uk');
    expect(single?.translation).toBe('привіт');

    const batch = await googleDictProvider.translateBatch?.(['first', 'second'], 'en', 'uk');
    expect(batch).toEqual(['перший', 'другий']);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('googleGtxProvider parses dictionary alternatives and sets cooldown on HTML challenge', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        mockJsonResponse([
          [['привіт']],
          [['noun', ['вітання', 'салют']]],
          'en'
        ])
      )
      .mockResolvedValueOnce(new Response('<html>blocked</html>', { status: 200 }));

    const word = await googleGtxProvider.translateWord('hello', 'auto', 'uk');
    expect(word).toEqual({
      word: 'hello',
      translation: 'привіт',
      alternatives: ['вітання', 'салют'],
      detectedLang: 'en',
      partOfSpeech: 'noun',
      fromCache: false
    });

    await expect(googleGtxProvider.translateWord('world', 'auto', 'uk')).rejects.toThrow(
      'GTX challenge'
    );
    expect(await isProviderPaused('google')).toBe(true);
    expect(await googleGtxProvider.isAvailable()).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('deeplProvider selects free endpoint for :fx keys and checks availability', async () => {
    expect(await deeplProvider.isAvailable({ apiKey: '' })).toBe(false);
    expect(await deeplProvider.isAvailable({ apiKey: 'key:fx' })).toBe(true);

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      mockJsonResponse({ translations: [{ text: 'Привіт' }] })
    );

    const res = await deeplProvider.translateWord('Hello', 'en', 'uk', { apiKey: 'key:fx' });
    expect(res?.translation).toBe('Привіт');
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api-free.deepl.com/v2/translate');
  });

  it('myMemoryProvider splits oversized text and detects quota warnings', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        mockJsonResponse({
          responseStatus: 200,
          responseData: { translatedText: 'Тест' }
        })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          responseStatus: 200,
          quotaFinished: true,
          responseData: { translatedText: 'MYMEMORY WARNING: QUOTA EXCEEDED' }
        })
      );

    const ok = await myMemoryProvider.translateWord('Test', 'en', 'uk');
    expect(ok?.translation).toBe('Тест');

    await expect(myMemoryProvider.translateWord('More', 'en', 'uk')).rejects.toThrow(
      'MyMemory quota exceeded'
    );
    expect(await isProviderPaused('mymemory')).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('Cooldown persistence in chrome.storage.session', () => {
  it('persists cooldown across simulated service worker restart and falls back safely', async () => {
    const sessionStore: Record<string, unknown> = {};
    setMockSessionStorage(sessionStore);

    const until = await setProviderCooldown('googleDict', 30_000);
    expect(until).toBeGreaterThan(Date.now());
    expect(await isProviderPaused('googleDict')).toBe(true);

    // Simulate MV3 Service Worker termination and cold start
    resetCooldownHydrationForTest();

    expect(await isProviderPaused('googleDict')).toBe(true);
    expect(await getProviderPausedUntil('googleDict')).toBe(until);

    await clearProviderCooldowns('googleDict');
    expect(await isProviderPaused('googleDict')).toBe(false);
  });
});

describe('Orchestrator (translateCuesWindow, quickTranslateWord, cancelTranslationJob)', () => {
  it('translates a prioritized window around priorityTime and always cleans up activeJobs', async () => {
    const cues = Array.from({ length: 30 }, (_, i) => ({
      id: `cue-${i}`,
      text: `Line ${i}`,
      startTime: i * 5,
      endTime: i * 5 + 4
    }));

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new URL(typeof input === 'string' ? input : input.toString());
      const queries = url.searchParams.getAll('q');
      return mockJsonResponse(queries.map((q) => [`TR:${q}`]));
    });

    const result = await translateCuesWindow(
      {
        videoId: 'vid-1',
        cues,
        sourceLang: 'en',
        targetLang: 'uk',
        priorityTime: 50 // starts at cue-10 (endTime 54 >= 50)
      },
      baseSettings
    );

    expect(result.status).toEqual({ state: 'translating' });
    expect(result.translations).toHaveLength(16);
    expect(result.translations[0]).toEqual({ id: 'cue-10', text: 'TR:Line 10' });
    expect(getActiveTranslationJobCount()).toBe(0);
  });

  it('cleans up activeJobs in finally even when provider throws', async () => {
    await expect(
      translateCuesWindow(
        {
          videoId: 'vid-err',
          cues: [{ id: '1', text: 'Hello' }],
          sourceLang: 'en',
          targetLang: 'uk'
        },
        { ...baseSettings, translationProvider: 'deepl', deeplApiKey: '' }
      )
    ).rejects.toThrow('DeepL API key is not configured');

    expect(getActiveTranslationJobCount()).toBe(0);
  });

  it('supports cancelTranslationJob by videoId and targetLang', async () => {
    let abortObserved = false;
    let markFetchStarted!: () => void;
    const fetchStarted = new Promise<void>((resolve) => {
      markFetchStarted = resolve;
    });

    vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => {
      markFetchStarted();
      return new Promise((_resolve, reject) => {
        const rejectAbort = (): void => {
          abortObserved = true;
          const err = new Error('Aborted');
          err.name = 'AbortError';
          reject(err);
        };
        if (init?.signal?.aborted) {
          rejectAbort();
          return;
        }
        init?.signal?.addEventListener('abort', rejectAbort, { once: true });
      });
    });

    const jobPromise = translateCuesWindow(
      {
        videoId: 'vid-cancel',
        cues: [{ id: '1', text: 'Hello' }],
        sourceLang: 'en',
        targetLang: 'uk'
      },
      baseSettings
    );

    await fetchStarted;
    expect(getActiveTranslationJobCount()).toBe(1);

    cancelTranslationJob('vid-cancel', 'es');
    expect(getActiveTranslationJobCount()).toBe(1);

    cancelTranslationJob('vid-cancel', 'uk');
    expect(getActiveTranslationJobCount()).toBe(0);

    const res = await jobPromise;
    expect(abortObserved).toBe(true);
    expect(res.status).toEqual({ state: 'idle' });
  });

  it('quickTranslateWord translates via selected provider', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockJsonResponse([['слово', 'en']]));

    const result = await quickTranslateWord('word', 'en', 'uk', baseSettings);
    expect(result.translation).toBe('слово');
    expect(result.word).toBe('word');
  });
});

describe('LLM client & URL normalization', () => {
  it('normalizes OpenAI-compatible, Gemini, and local URLs', () => {
    expect(resolveChatCompletionsUrl('')).toBe('https://api.openai.com/v1/chat/completions');
    expect(
      resolveChatCompletionsUrl('https://generativelanguage.googleapis.com/v1beta/openai')
    ).toBe('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
    expect(
      resolveChatCompletionsUrl('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions')
    ).toBe('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
    expect(
      resolveChatCompletionsUrl('https://generativelanguage.googleapis.com/v1beta')
    ).toBe('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
    expect(resolveChatCompletionsUrl('http://localhost:11434')).toBe(
      'http://localhost:11434/v1/chat/completions'
    );
    expect(resolveModelsUrl('https://generativelanguage.googleapis.com/v1beta/openai')).toBe(
      'https://generativelanguage.googleapis.com/v1beta/openai/models'
    );
  });

  it('isLlmConfigured allows keyless localhost/127.0.0.1 and requires key for remote', () => {
    const remoteEmpty: LLMConfig = {
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      apiKey: '',
      model: 'gemini-2.0-flash'
    };
    const localOllama: LLMConfig = {
      baseUrl: 'http://127.0.0.1:11434/v1',
      apiKey: '',
      model: 'llama3'
    };
    const localHost: LLMConfig = {
      baseUrl: 'http://localhost:1234/v1',
      apiKey: '',
      model: 'qwen'
    };

    expect(isLlmConfigured(remoteEmpty)).toBe(false);
    expect(isLlmConfigured({ ...remoteEmpty, apiKey: 'secret' })).toBe(true);
    expect(isLlmConfigured(localOllama)).toBe(true);
    expect(isLlmConfigured(localHost)).toBe(true);
  });

  it('requestAiExplanation uses neutral video scene context prompt and parses response', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      mockJsonResponse({
        choices: [
          {
            message: {
              content: JSON.stringify({
                lemma: 'break down',
                partOfSpeech: 'phrasal verb',
                contextualTranslation: 'ламатися',
                literalTranslation: 'ламати вниз',
                grammarNote: 'Past simple tense',
                nuanceExplanation: 'Informal',
                examples: [{ source: 'My car broke down.', translation: 'Моя машина зламалася.' }]
              })
            }
          }
        ]
      })
    );

    const explanation = await requestAiExplanation({
      target: 'broke down',
      prevSentence: 'Yesterday was rough.',
      currentSentence: 'My car broke down on the highway.',
      nextSentence: 'I had to call a tow truck.',
      videoTitle: 'Road Trip',
      nativeLang: 'uk',
      llmConfig: {
        baseUrl: 'http://localhost:11434/v1',
        apiKey: '',
        model: 'llama3'
      }
    });

    expect(explanation.lemma).toBe('break down');
    expect(explanation.contextualTranslation).toBe('ламатися');

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(body.messages[0]?.content).toContain('video scene context');
    expect(body.messages[0]?.content).not.toMatch(/youtube/i);
  });

  it('testLlmConnection and fetchAvailableModels support keyless local endpoints', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        mockJsonResponse({ choices: [{ message: { content: 'OK' } }] })
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          data: [{ id: 'models/gemini-2.0-flash' }, { id: 'text-embedding-004' }]
        })
      );

    const testRes = await testLlmConnection({
      baseUrl: 'http://127.0.0.1:11434/v1',
      apiKey: '',
      model: 'llama3'
    });
    expect(testRes.replyPreview).toBe('OK');

    const models = await fetchAvailableModels('http://localhost:11434/v1', '');
    expect(models).toEqual(['gemini-2.0-flash']);
  });
});
