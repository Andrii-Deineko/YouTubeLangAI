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
  RefreshCw,
  Sparkles
} from 'lucide-react';
import type {
  AnkiTestResponse,
  FetchModelsResponse,
  LLMConfig,
  LLMTestResponse,
  RuntimeRequest,
  UserSettings
} from '@langai/contracts';
import { clearAllCaches, getCachedModels, saveCachedModels } from '@langai/storage';
import { getUiStrings } from '../../i18n/translations';
import { isLocalBaseUrl, resolveChatCompletionsUrl } from '../../utils/llm';
import { ensureHostPermissionForUrl, hasHostPermissionForUrl } from '../../utils/permissions';
import {
  accentBtnStyle,
  mutedTextStyle,
  primaryTextStyle,
  sectionCardStyle
} from './styles';

export interface IntegrationsTabProps {
  settings: UserSettings;
  onUpdateSettings: (partial: Partial<UserSettings>) => Promise<void>;
}

const LLM_PRESETS = [
  {
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    fallbackModel: 'gpt-4o'
  },
  {
    label: 'Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-3.8-flash',
    fallbackModel: 'gemini-3.8-flash-lite'
  },
  {
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'openai/gpt-4o-mini',
    fallbackModel: 'google/gemini-2.5-flash'
  },
  {
    label: 'Ollama',
    baseUrl: 'http://127.0.0.1:11434/v1',
    model: 'llama3.1',
    fallbackModel: ''
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

export function IntegrationsTab({
  settings,
  onUpdateSettings
}: IntegrationsTabProps): ReactElement {
  const t = getUiStrings(settings.uiLanguage);

  const [showKey, setShowKey] = useState(false);
  const [testingAnki, setTestingAnki] = useState(false);
  const [ankiStatus, setAnkiStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [testingLLM, setTestingLLM] = useState(false);
  const [llmStatus, setLlmStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [manualModelMode, setManualModelMode] = useState(false);
  const [cacheHydrated, setCacheHydrated] = useState(false);
  const [cacheCleared, setCacheCleared] = useState(false);

  const lastFetchedSignatureRef = useRef<string>('');
  const latestFetchRequestIdRef = useRef(0);

  const loadAvailableModels = useCallback(
    async (baseUrl: string, apiKey: string, requestPerm = false): Promise<void> => {
      const cleanBaseUrl = baseUrl.trim();
      const cleanKey = apiKey.trim();
      if (!cleanBaseUrl || (!cleanKey && !isLocalBaseUrl(cleanBaseUrl))) {
        return;
      }

      if (requestPerm) {
        const perm = await ensureHostPermissionForUrl(cleanBaseUrl);
        if (!perm.granted && perm.originPattern) {
          setModelsError(t.llmPermissionDenied(perm.originPattern));
          return;
        }
      } else {
        const permitted = await hasHostPermissionForUrl(cleanBaseUrl);
        if (!permitted) return;
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
        setModelsError(err instanceof Error ? err.message : 'Failed to load available models');
      } finally {
        if (latestFetchRequestIdRef.current === requestId) {
          setModelsLoading(false);
        }
      }
    },
    [t]
  );

  const initialLlmRef = useRef(settings.llm);

  useEffect(() => {
    let active = true;
    void getCachedModels().then((cached) => {
      if (!active) return;
      const currentBase = initialLlmRef.current.baseUrl.trim();
      const currentKey = initialLlmRef.current.apiKey.trim();
      if (cached && cached.baseUrl === currentBase && cached.models.length > 0) {
        setAvailableModels(cached.models);
        lastFetchedSignatureRef.current = `${currentBase}::${currentKey}`;
      }
      setCacheHydrated(true);
    });
    return () => {
      active = false;
    };
  }, []);

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
      void loadAvailableModels(cleanBaseUrl, cleanKey, false);
    }, 600);

    return () => window.clearTimeout(timerId);
  }, [cacheHydrated, loadAvailableModels, settings.llm.apiKey, settings.llm.baseUrl]);

  const handleSaveBaseUrlAndPermission = async (rawBaseUrl: string): Promise<void> => {
    const cleanBaseUrl = rawBaseUrl.trim();
    if (!cleanBaseUrl) return;
    await ensureHostPermissionForUrl(cleanBaseUrl);
    const cleanKey = settings.llm.apiKey.trim();
    const sig = `${cleanBaseUrl}::${cleanKey}`;
    if ((cleanKey || isLocalBaseUrl(cleanBaseUrl)) && sig !== lastFetchedSignatureRef.current) {
      void loadAvailableModels(cleanBaseUrl, cleanKey, false);
    }
  };

  const handleSelectPreset = async (preset: (typeof LLM_PRESETS)[number]): Promise<void> => {
    await ensureHostPermissionForUrl(preset.baseUrl);
    await onUpdateSettings({
      llm: {
        ...settings.llm,
        baseUrl: preset.baseUrl,
        model: preset.model
      },
      fallbackModel: preset.fallbackModel ?? settings.fallbackModel
    });
  };

  const handleTestLLM = async (): Promise<void> => {
    if (testingLLM) return;
    setTestingLLM(true);
    setLlmStatus(null);
    try {
      const perm = await ensureHostPermissionForUrl(settings.llm.baseUrl);
      if (!perm.granted && perm.originPattern) {
        setLlmStatus({
          ok: false,
          message: t.llmPermissionDenied(perm.originPattern)
        });
        return;
      }

      const res = await sendLLMTest(settings.llm);
      if (res.ok) {
        setLlmStatus({
          ok: true,
          message: `HTTP ${res.data.status} (${res.data.resolvedUrl}, model=${res.data.model}): ${res.data.replyPreview}`
        });
      } else {
        setLlmStatus({ ok: false, message: res.error });
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
      const perm = await ensureHostPermissionForUrl(
        settings.ankiConnectUrl,
        'http://127.0.0.1/*'
      );
      if (!perm.granted) {
        setAnkiStatus({
          ok: false,
          message: t.ankiPermissionDenied
        });
        return;
      }

      const res = await sendAnkiTest(settings.ankiConnectUrl);
      if (res.ok) {
        setAnkiStatus({
          ok: true,
          message: t.ankiConnected(res.data.version)
        });
      } else {
        setAnkiStatus({ ok: false, message: res.error });
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
    <>
      {/* AI Provider (BYOK) */}
      <section className="space-y-2.5 rounded-2xl border p-3" style={sectionCardStyle}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5" style={{ color: 'var(--ytai-accent)' }} />
            <span className="font-semibold" style={primaryTextStyle}>
              {t.aiProviderTitle}
            </span>
          </div>
          <div className="flex gap-1">
            {LLM_PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => void handleSelectPreset(preset)}
                style={{ borderColor: 'var(--ytai-border)' }}
                className="ytai-control-btn rounded-md border px-2 py-0.5 text-[0.625rem] font-medium transition cursor-pointer"
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="mb-1 block text-[0.6875rem]" style={mutedTextStyle}>
            {t.baseUrlLabel}
          </label>
          <input
            type="url"
            value={settings.llm.baseUrl}
            onChange={(e) =>
              void onUpdateSettings({
                llm: { ...settings.llm, baseUrl: e.target.value }
              })
            }
            onBlur={(e) => void handleSaveBaseUrlAndPermission(e.target.value)}
            placeholder="https://api.openai.com/v1"
            className="ytai-input w-full rounded-xl border px-3 py-1.5 text-xs"
          />
        </div>

        <div>
          <label className="mb-1 block text-[0.6875rem]" style={mutedTextStyle}>
            {t.apiKeyLabel}
          </label>
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
                  void loadAvailableModels(cleanBase, cleanKey, true);
                }
              }}
              placeholder="sk-... or AIza..."
              className="ytai-input w-full rounded-xl border py-1.5 pl-3 pr-9 text-xs"
            />
            <button
              type="button"
              onClick={() => setShowKey((v) => !v)}
              title={showKey ? t.hideKey : t.showKey}
              className="ytai-ghost-btn absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 cursor-pointer"
            >
              {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="text-[0.6875rem]" style={mutedTextStyle}>
              {t.modelLabel}{' '}
              {availableModels.length > 0 ? `(${availableModels.length} ${t.loadedSuffix})` : ''}
            </label>
            {availableModels.length > 0 && (
              <button
                type="button"
                onClick={() => setManualModelMode((v) => !v)}
                className="text-[0.625rem] font-medium transition hover:opacity-80 cursor-pointer"
                style={{ color: 'var(--ytai-accent)' }}
              >
                {manualModelMode ? t.pickFromList : t.enterManually}
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
                className="ytai-input min-w-0 flex-1 rounded-xl border px-3 py-1.5 text-xs"
              >
                {!availableModels.includes(settings.llm.model.trim()) &&
                  settings.llm.model.trim() !== '' && (
                    <option value={settings.llm.model}>
                      {settings.llm.model} ({t.notInList})
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
                  className="ytai-input min-w-0 flex-1 rounded-xl border px-3 py-1.5 text-xs"
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
              title={t.refreshModels}
              disabled={modelsLoading}
              onClick={() =>
                void loadAvailableModels(settings.llm.baseUrl, settings.llm.apiKey, true)
              }
              style={{ borderColor: 'var(--ytai-border)' }}
              className="ytai-control-btn shrink-0 rounded-xl border p-1.5 transition disabled:opacity-50 cursor-pointer"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${modelsLoading ? 'animate-spin' : ''}`}
                style={modelsLoading ? { color: 'var(--ytai-accent)' } : undefined}
              />
            </button>
          </div>

          {availableModels.length > 0 &&
            settings.llm.model.trim() !== '' &&
            !availableModels.includes(settings.llm.model.trim()) && (
              <div className="mt-2 flex items-start justify-between gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-[0.6875rem] text-amber-200">
                <div className="flex items-start gap-1.5">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
                  <span>
                    <code className="font-mono">{settings.llm.model}</code> ({t.notInList})
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const suggested =
                      availableModels.find((m) => /flash|mini|4o/i.test(m)) ?? availableModels[0];
                    if (suggested) {
                      void onUpdateSettings({
                        llm: { ...settings.llm, model: suggested }
                      });
                    }
                  }}
                  className="shrink-0 rounded-lg bg-amber-500/20 px-2 py-1 text-[0.625rem] font-semibold text-amber-100 hover:bg-amber-500/30 cursor-pointer"
                >
                  {t.chooseBtn}
                </button>
              </div>
            )}

          {modelsError && (
            <div className="mt-1.5 break-all text-[0.6875rem] text-rose-400">{modelsError}</div>
          )}
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="text-[0.6875rem]" style={mutedTextStyle}>
              {t.fallbackModelLabel}
            </label>
            {settings.fallbackModel && (
              <button
                type="button"
                onClick={() => void onUpdateSettings({ fallbackModel: '' })}
                className="ytai-ghost-btn rounded px-1 text-[0.625rem] cursor-pointer"
              >
                {t.doNotUse}
              </button>
            )}
          </div>

          {!manualModelMode && availableModels.length > 0 ? (
            <select
              value={settings.fallbackModel || ''}
              onChange={(e) => void onUpdateSettings({ fallbackModel: e.target.value })}
              className="ytai-input w-full rounded-xl border px-3 py-1.5 text-xs"
            >
              <option value="">({t.doNotUse})</option>
              {settings.fallbackModel &&
                !availableModels.includes(settings.fallbackModel.trim()) &&
                settings.fallbackModel.trim() !== '' && (
                  <option value={settings.fallbackModel}>
                    {settings.fallbackModel} ({t.currentTag})
                  </option>
                )}
              {availableModels.map((modelId) => (
                <option key={`fallback-${modelId}`} value={modelId}>
                  {modelId}
                </option>
              ))}
            </select>
          ) : (
            <>
              <input
                type="text"
                list="yt-lang-ai-fallback-models"
                value={settings.fallbackModel || ''}
                onChange={(e) => void onUpdateSettings({ fallbackModel: e.target.value })}
                placeholder={t.fallbackPlaceholder}
                className="ytai-input w-full rounded-xl border px-3 py-1.5 text-xs"
              />
              <datalist id="yt-lang-ai-fallback-models">
                {availableModels.map((modelId) => (
                  <option key={`dl-fallback-${modelId}`} value={modelId} />
                ))}
              </datalist>
            </>
          )}
          <p className="mt-1 text-[0.625rem]" style={mutedTextStyle}>
            {t.fallbackHint}
          </p>
        </div>

        <div className="break-all text-[0.625rem]" style={mutedTextStyle}>
          {t.resolvedEndpoint}{' '}
          <span className="font-mono" style={primaryTextStyle}>
            {resolveChatCompletionsUrl(settings.llm.baseUrl)}
          </span>
        </div>

        <button
          type="button"
          disabled={testingLLM}
          onClick={() => void handleTestLLM()}
          style={accentBtnStyle}
          className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 font-semibold shadow-sm transition hover:opacity-90 disabled:opacity-50 cursor-pointer"
        >
          {testingLLM ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <PlugZap className="h-3.5 w-3.5" />
          )}
          <span>{t.testLlmBtn}</span>
        </button>

        {llmStatus && (
          <div
            className={`flex items-start gap-2 break-all rounded-xl border px-3 py-2 text-xs ${
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
      <section className="space-y-2.5 rounded-2xl border p-3" style={sectionCardStyle}>
        <div className="flex items-center gap-1.5">
          <Database className="h-3.5 w-3.5" style={{ color: 'var(--ytai-accent)' }} />
          <span className="font-semibold" style={primaryTextStyle}>
            {t.ankiAndCache}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="mb-1 block text-[0.6875rem]" style={mutedTextStyle}>
              {t.ankiUrlLabel}
            </label>
            <input
              type="url"
              value={settings.ankiConnectUrl}
              onChange={(e) => void onUpdateSettings({ ankiConnectUrl: e.target.value })}
              className="ytai-input w-full rounded-xl border px-2.5 py-1.5 text-xs"
            />
          </div>
          <div>
            <label className="mb-1 block text-[0.6875rem]" style={mutedTextStyle}>
              {t.ankiDeckLabel}
            </label>
            <input
              type="text"
              value={settings.ankiDeckName}
              onChange={(e) => void onUpdateSettings({ ankiDeckName: e.target.value })}
              className="ytai-input w-full rounded-xl border px-2.5 py-1.5 text-xs"
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={testingAnki}
            onClick={() => void handleTestAnki()}
            style={accentBtnStyle}
            className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 font-semibold shadow-sm transition hover:opacity-90 disabled:opacity-50 cursor-pointer"
          >
            {testingAnki ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <PlugZap className="h-3.5 w-3.5" />
            )}
            <span>{t.testAnkiBtn}</span>
          </button>

          <button
            type="button"
            onClick={() => void handleClearCache()}
            style={{ borderColor: 'var(--ytai-border)' }}
            className="ytai-control-btn flex items-center gap-1.5 rounded-xl border px-3 py-1.5 font-medium transition cursor-pointer"
          >
            <Database className="h-3.5 w-3.5" />
            <span>{cacheCleared ? t.cacheCleared : t.clearCacheBtn}</span>
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
    </>
  );
}
