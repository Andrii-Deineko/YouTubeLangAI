import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Database,
  Eye,
  EyeOff,
  Loader2,
  PlugZap,
  RefreshCw
} from 'lucide-react';
import { clearAllCaches } from '../../shared/db';
import { resolveChatCompletionsUrl } from '../../shared/llm';
import { getCachedModels, saveCachedModels } from '../../shared/storage';
import type {
  AnkiTestResponse,
  FetchModelsResponse,
  LLMTestResponse,
  RuntimeRequest
} from '../../types/messages';
import type { LLMConfig, UserSettings } from '../../types/settings';

interface SettingsPanelProps {
  settings: UserSettings;
  onUpdateSettings: (partial: Partial<UserSettings>) => Promise<void>;
}

const LANGUAGE_OPTIONS = [
  { code: 'ru', label: 'Russian (Русский)' },
  { code: 'uk', label: 'Ukrainian (Українська)' },
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Spanish (Español)' },
  { code: 'de', label: 'German (Deutsch)' },
  { code: 'fr', label: 'French (Français)' },
  { code: 'it', label: 'Italian (Italiano)' },
  { code: 'pt', label: 'Portuguese (Português)' },
  { code: 'pl', label: 'Polish (Polski)' },
  { code: 'tr', label: 'Turkish (Türkçe)' },
  { code: 'ja', label: 'Japanese (日本語)' },
  { code: 'ko', label: 'Korean (한국어)' },
  { code: 'zh-CN', label: 'Chinese (简体中文)' }
];

const LLM_PRESETS = [
  {
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini'
  },
  {
    label: 'Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-3.8-flash'
  },
  {
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'openai/gpt-4o-mini'
  },
  {
    label: 'Ollama',
    baseUrl: 'http://127.0.0.1:11434/v1',
    model: 'llama3.1'
  }
];

function sendAnkiTest(url: string): Promise<AnkiTestResponse> {
  return new Promise((resolve, reject) => {
    const request: RuntimeRequest = {
      type: 'ANKI_TEST',
      payload: { url }
    };
    chrome.runtime.sendMessage(request, (response: AnkiTestResponse | undefined) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!response) {
        reject(new Error('No response from service worker'));
        return;
      }
      resolve(response);
    });
  });
}

function sendLLMTest(llmConfig: LLMConfig): Promise<LLMTestResponse> {
  return new Promise((resolve, reject) => {
    const request: RuntimeRequest = {
      type: 'LLM_TEST',
      payload: { llmConfig }
    };
    chrome.runtime.sendMessage(request, (response: LLMTestResponse | undefined) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!response) {
        reject(new Error('No response from service worker'));
        return;
      }
      resolve(response);
    });
  });
}

function sendFetchAvailableModels(
  baseUrl: string,
  apiKey: string
): Promise<FetchModelsResponse> {
  return new Promise((resolve, reject) => {
    const request: RuntimeRequest = {
      type: 'FETCH_AVAILABLE_MODELS',
      payload: { baseUrl, apiKey }
    };
    chrome.runtime.sendMessage(request, (response: FetchModelsResponse | undefined) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!response) {
        reject(new Error('No response from service worker'));
        return;
      }
      resolve(response);
    });
  });
}

function isLocalBaseUrl(url: string): boolean {
  try {
    const parsed = new URL(url.trim());
    return (
      parsed.hostname === 'localhost' ||
      parsed.hostname === '127.0.0.1' ||
      parsed.hostname === '::1'
    );
  } catch {
    return false;
  }
}

export function SettingsPanel({
  settings,
  onUpdateSettings
}: SettingsPanelProps): ReactElement {
  const [showKey, setShowKey] = useState(false);
  const [testingAnki, setTestingAnki] = useState(false);
  const [ankiStatus, setAnkiStatus] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);
  const [testingLLM, setTestingLLM] = useState(false);
  const [llmStatus, setLlmStatus] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [manualModelMode, setManualModelMode] = useState(false);
  const [cacheHydrated, setCacheHydrated] = useState(false);
  const [cacheCleared, setCacheCleared] = useState(false);

  const lastFetchedSignatureRef = useRef<string>('');
  const latestFetchRequestIdRef = useRef(0);

  const loadAvailableModels = useCallback(
    async (baseUrl: string, apiKey: string): Promise<void> => {
      const cleanBaseUrl = baseUrl.trim();
      const cleanKey = apiKey.trim();
      if (!cleanBaseUrl || (!cleanKey && !isLocalBaseUrl(cleanBaseUrl))) {
        return;
      }

      const requestId = ++latestFetchRequestIdRef.current;
      setModelsLoading(true);
      setModelsError(null);

      try {
        const res = await sendFetchAvailableModels(cleanBaseUrl, cleanKey);
        if (latestFetchRequestIdRef.current !== requestId) return;

        if (res.ok) {
          setAvailableModels(res.data);
          lastFetchedSignatureRef.current = `${cleanBaseUrl}::${cleanKey}`;
          await saveCachedModels({
            baseUrl: cleanBaseUrl,
            models: res.data,
            updatedAt: new Date().toISOString()
          });
        } else {
          setModelsError(res.error);
        }
      } catch (err: unknown) {
        if (latestFetchRequestIdRef.current !== requestId) return;
        setModelsError(
          err instanceof Error ? err.message : 'Failed to load available models'
        );
      } finally {
        if (latestFetchRequestIdRef.current === requestId) {
          setModelsLoading(false);
        }
      }
    },
    []
  );

  // Hydrate cached models from chrome.storage.local on mount without network request
  useEffect(() => {
    let active = true;
    void getCachedModels().then((cached) => {
      if (!active) return;
      const currentBase = settings.llm.baseUrl.trim();
      const currentKey = settings.llm.apiKey.trim();
      if (cached && cached.baseUrl === currentBase && cached.models.length > 0) {
        setAvailableModels(cached.models);
        lastFetchedSignatureRef.current = `${currentBase}::${currentKey}`;
      }
      setCacheHydrated(true);
    });
    return () => {
      active = false;
    };
    // Run only once on initial mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced auto-fetch (600ms) when baseUrl and apiKey are present and changed
  useEffect(() => {
    if (!cacheHydrated) return;

    const cleanBaseUrl = settings.llm.baseUrl.trim();
    const cleanKey = settings.llm.apiKey.trim();
    if (!cleanBaseUrl || (!cleanKey && !isLocalBaseUrl(cleanBaseUrl))) {
      return;
    }

    const signature = `${cleanBaseUrl}::${cleanKey}`;
    if (signature === lastFetchedSignatureRef.current) {
      return;
    }

    const timerId = window.setTimeout(() => {
      void loadAvailableModels(cleanBaseUrl, cleanKey);
    }, 600);

    return () => window.clearTimeout(timerId);
  }, [cacheHydrated, loadAvailableModels, settings.llm.apiKey, settings.llm.baseUrl]);

  const handleTestLLM = async (): Promise<void> => {
    if (testingLLM) return;
    setTestingLLM(true);
    setLlmStatus(null);
    try {
      const res = await sendLLMTest(settings.llm);
      if (res.ok) {
        setLlmStatus({
          ok: true,
          message: `HTTP ${res.data.status} (${res.data.resolvedUrl}, model=${res.data.model}): ${res.data.replyPreview}`
        });
      } else {
        setLlmStatus({
          ok: false,
          message: res.error
        });
      }
    } catch (err: unknown) {
      setLlmStatus({
        ok: false,
        message: err instanceof Error ? err.message : 'LLM connection failed'
      });
    } finally {
      setTestingLLM(false);
    }
  };

  const handleTestAnki = async (): Promise<void> => {
    if (testingAnki) return;
    setTestingAnki(true);
    setAnkiStatus(null);
    try {
      if (chrome.permissions?.request) {
        const granted = await chrome.permissions.request({
          origins: ['http://127.0.0.1/*']
        });
        if (!granted) {
          setAnkiStatus({
            ok: false,
            message: 'Host permission for http://127.0.0.1/* was denied.'
          });
          return;
        }
      }

      const res = await sendAnkiTest(settings.ankiConnectUrl);
      if (res.ok) {
        setAnkiStatus({
          ok: true,
          message: `Connected · AnkiConnect v${res.data.version}`
        });
      } else {
        setAnkiStatus({
          ok: false,
          message: res.error
        });
      }
    } catch (err: unknown) {
      setAnkiStatus({
        ok: false,
        message: err instanceof Error ? err.message : 'Connection failed'
      });
    } finally {
      setTestingAnki(false);
    }
  };

  const handleClearCache = async (): Promise<void> => {
    await clearAllCaches();
    setCacheCleared(true);
    window.setTimeout(() => setCacheCleared(false), 2000);
  };

  return (
    <div className="max-h-[450px] space-y-4 overflow-y-auto pr-1 text-xs">
      {/* Language & Player Behavior */}
      <section className="space-y-3 rounded-2xl border border-white/10 bg-slate-900/60 p-3.5">
        <h3 className="font-semibold text-white">Languages & Player</h3>

        <div>
          <label className="mb-1 block text-[11px] text-slate-400">
            Native / Translation Language
          </label>
          <select
            value={settings.nativeLang}
            onChange={(e) => void onUpdateSettings({ nativeLang: e.target.value })}
            className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none"
          >
            {LANGUAGE_OPTIONS.map((opt) => (
              <option key={opt.code} value={opt.code}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-1 gap-2 pt-1">
          {[
            {
              key: 'enabled' as const,
              label: 'Enable YouTube overlay'
            },
            {
              key: 'showDualSubtitles' as const,
              label: 'Show dual (translated) subtitles'
            },
            {
              key: 'activeListeningMode' as const,
              label: 'Active Listening (blur subtitles by default)'
            },
            {
              key: 'autoPauseAfterCue' as const,
              label: 'Auto-pause after each subtitle cue'
            },
            {
              key: 'autoPauseOnWordClick' as const,
              label: 'Auto-pause video when inspecting a word'
            }
          ].map((item) => (
            <label
              key={item.key}
              className="flex cursor-pointer items-center justify-between rounded-lg bg-slate-950/60 px-3 py-2"
            >
              <span className="text-slate-200">{item.label}</span>
              <input
                type="checkbox"
                checked={settings[item.key]}
                onChange={(e) =>
                  void onUpdateSettings({ [item.key]: e.target.checked })
                }
                className="h-4 w-4 accent-indigo-500"
              />
            </label>
          ))}
        </div>

        <div>
          <div className="mb-1 flex justify-between text-[11px] text-slate-400">
            <span>Subtitle Font Size</span>
            <span className="text-slate-200">{settings.subtitleFontSize}px</span>
          </div>
          <input
            type="range"
            min={14}
            max={32}
            value={settings.subtitleFontSize}
            onChange={(e) =>
              void onUpdateSettings({
                subtitleFontSize: Number.parseInt(e.target.value, 10)
              })
            }
            className="w-full accent-indigo-500"
          />
        </div>
      </section>

      {/* LLM BYOK Configuration */}
      <section className="space-y-3 rounded-2xl border border-white/10 bg-slate-900/60 p-3.5">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-white">AI Provider (BYOK)</h3>
          <div className="flex gap-1">
            {LLM_PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() =>
                  void onUpdateSettings({
                    llm: {
                      ...settings.llm,
                      baseUrl: preset.baseUrl,
                      model: preset.model
                    }
                  })
                }
                className="rounded-md bg-slate-800 px-2 py-0.5 text-[10px] font-medium text-slate-300 hover:bg-indigo-600 hover:text-white"
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="mb-1 block text-[11px] text-slate-400">
            OpenAI-Compatible Base URL
          </label>
          <input
            type="url"
            value={settings.llm.baseUrl}
            onChange={(e) =>
              void onUpdateSettings({
                llm: { ...settings.llm, baseUrl: e.target.value }
              })
            }
            placeholder="https://api.openai.com/v1"
            className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none"
          />
        </div>

        <div>
          <label className="mb-1 block text-[11px] text-slate-400">API Key</label>
          <div className="relative">
            <input
              type={showKey ? 'text' : 'password'}
              value={settings.llm.apiKey}
              onChange={(e) =>
                void onUpdateSettings({
                  llm: { ...settings.llm, apiKey: e.target.value }
                })
              }
              onBlur={() => {
                const cleanBase = settings.llm.baseUrl.trim();
                const cleanKey = settings.llm.apiKey.trim();
                const sig = `${cleanBase}::${cleanKey}`;
                if (
                  cleanBase &&
                  (cleanKey || isLocalBaseUrl(cleanBase)) &&
                  sig !== lastFetchedSignatureRef.current &&
                  !modelsLoading
                ) {
                  void loadAvailableModels(cleanBase, cleanKey);
                }
              }}
              placeholder="sk-... or AIza..."
              className="w-full rounded-xl border border-white/10 bg-slate-950 py-2 pl-3 pr-9 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => setShowKey((v) => !v)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
            >
              {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="text-[11px] text-slate-400">
              Model {availableModels.length > 0 ? `(${availableModels.length} loaded)` : ''}
            </label>
            {availableModels.length > 0 && (
              <button
                type="button"
                onClick={() => setManualModelMode((v) => !v)}
                className="text-[10px] font-medium text-indigo-400 hover:text-indigo-300"
              >
                {manualModelMode ? 'Выбрать из списка' : 'Ввести вручную'}
              </button>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            {!manualModelMode && availableModels.length > 0 ? (
              <select
                value={settings.llm.model}
                onChange={(e) =>
                  void onUpdateSettings({
                    llm: { ...settings.llm, model: e.target.value }
                  })
                }
                className="min-w-0 flex-1 rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none"
              >
                {!availableModels.includes(settings.llm.model.trim()) &&
                  settings.llm.model.trim() !== '' && (
                    <option value={settings.llm.model}>
                      {settings.llm.model} (не в списке)
                    </option>
                  )}
                {availableModels.map((modelId) => (
                  <option key={modelId} value={modelId}>
                    {modelId}
                  </option>
                ))}
              </select>
            ) : (
              <>
                <input
                  type="text"
                  list="yt-lang-ai-available-models"
                  value={settings.llm.model}
                  onChange={(e) =>
                    void onUpdateSettings({
                      llm: { ...settings.llm, model: e.target.value }
                    })
                  }
                  placeholder="gpt-4o-mini / gemini-3.8-flash"
                  className="min-w-0 flex-1 rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none"
                />
                <datalist id="yt-lang-ai-available-models">
                  {availableModels.map((modelId) => (
                    <option key={modelId} value={modelId} />
                  ))}
                </datalist>
              </>
            )}

            <button
              type="button"
              title="Обновить список моделей (GET /models)"
              disabled={modelsLoading}
              onClick={() =>
                void loadAvailableModels(settings.llm.baseUrl, settings.llm.apiKey)
              }
              className="shrink-0 rounded-xl border border-white/10 bg-slate-950 p-2 text-slate-300 transition hover:bg-slate-800 hover:text-white disabled:opacity-50"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${modelsLoading ? 'animate-spin text-indigo-400' : ''}`}
              />
            </button>
          </div>

          {availableModels.length > 0 &&
            settings.llm.model.trim() !== '' &&
            !availableModels.includes(settings.llm.model.trim()) && (
              <div className="mt-2 flex items-start justify-between gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-200">
                <div className="flex items-start gap-1.5">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
                  <span>
                    Модель <code className="font-mono">{settings.llm.model}</code> не
                    найдена у провайдера. Выберите актуальную из списка.
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const suggested =
                      availableModels.find((m) => /flash|mini|4o/i.test(m)) ??
                      availableModels[0];
                    if (suggested) {
                      void onUpdateSettings({
                        llm: { ...settings.llm, model: suggested }
                      });
                    }
                  }}
                  className="shrink-0 rounded-lg bg-amber-500/20 px-2 py-1 text-[10px] font-semibold text-amber-100 hover:bg-amber-500/30"
                >
                  Выбрать
                </button>
              </div>
            )}

          {modelsError && (
            <div className="mt-1.5 text-[11px] text-rose-400 break-all">
              Не удалось загрузить модели: {modelsError}
            </div>
          )}
        </div>

        <div className="text-[10px] text-slate-400 break-all">
          Resolved endpoint:{' '}
          <span className="font-mono text-slate-300">
            {resolveChatCompletionsUrl(settings.llm.baseUrl)}
          </span>
        </div>

        <button
          type="button"
          disabled={testingLLM}
          onClick={() => void handleTestLLM()}
          className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-2 font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-50"
        >
          {testingLLM ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <PlugZap className="h-3.5 w-3.5" />
          )}
          <span>Проверить подключение LLM</span>
        </button>

        {llmStatus && (
          <div
            className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-xs break-all ${
              llmStatus.ok
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                : 'border-rose-500/30 bg-rose-500/10 text-rose-300'
            }`}
          >
            {llmStatus.ok ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            ) : (
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            )}
            <span>{llmStatus.message}</span>
          </div>
        )}
      </section>

      {/* AnkiConnect & Cache */}
      <section className="space-y-3 rounded-2xl border border-white/10 bg-slate-900/60 p-3.5">
        <h3 className="font-semibold text-white">AnkiConnect & Cache</h3>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="mb-1 block text-[11px] text-slate-400">
              AnkiConnect URL
            </label>
            <input
              type="url"
              value={settings.ankiConnectUrl}
              onChange={(e) =>
                void onUpdateSettings({ ankiConnectUrl: e.target.value })
              }
              className="w-full rounded-xl border border-white/10 bg-slate-950 px-2.5 py-2 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] text-slate-400">Deck Name</label>
            <input
              type="text"
              value={settings.ankiDeckName}
              onChange={(e) =>
                void onUpdateSettings({ ankiDeckName: e.target.value })
              }
              className="w-full rounded-xl border border-white/10 bg-slate-950 px-2.5 py-2 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none"
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={testingAnki}
            onClick={() => void handleTestAnki()}
            className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-2 font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-50"
          >
            {testingAnki ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <PlugZap className="h-3.5 w-3.5" />
            )}
            <span>Test AnkiConnect</span>
          </button>

          <button
            type="button"
            onClick={() => void handleClearCache()}
            className="flex items-center gap-1.5 rounded-xl bg-slate-800 px-3 py-2 font-medium text-slate-300 transition hover:bg-slate-700"
          >
            <Database className="h-3.5 w-3.5" />
            <span>{cacheCleared ? 'Cache Cleared ✓' : 'Clear IDB Cache'}</span>
          </button>
        </div>

        {ankiStatus && (
          <div
            className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs ${
              ankiStatus.ok
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                : 'border-rose-500/30 bg-rose-500/10 text-rose-300'
            }`}
          >
            {ankiStatus.ok ? (
              <CheckCircle2 className="h-4 w-4 shrink-0" />
            ) : (
              <AlertCircle className="h-4 w-4 shrink-0" />
            )}
            <span>{ankiStatus.message}</span>
          </div>
        )}
      </section>
    </div>
  );
}
