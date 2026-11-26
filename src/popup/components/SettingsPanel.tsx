import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Database,
  Eye,
  EyeOff,
  Film,
  Ghost,
  Globe,
  Keyboard,
  Layers,
  Loader2,
  Palette,
  Play,
  PlugZap,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Tv,
  X
} from 'lucide-react';
import { clearAllCaches } from '../../core/storage/db';
import { resolveChatCompletionsUrl } from '../../core/background/llm';
import { getCachedModels, saveCachedModels } from '../../core/storage/storage';
import { SUBTITLE_SCALES, THEMES } from '../../core/styles/themes';
import type {
  AnkiTestResponse,
  CinemaModuleStatus,
  CinemaModuleStatusResponse,
  FetchModelsResponse,
  LLMTestResponse,
  NetflixModuleStatus,
  NetflixModuleStatusResponse,
  RuntimeRequest
} from '../../core/types/messages';
import {
  DEFAULT_KEYBINDINGS,
  type KeybindAction,
  type KeybindingsMap,
  type KeybindValue,
  type LLMConfig,
  type UserSettings
} from '../../core/types/settings';
import {
  KEYBIND_ACTION_LABELS,
  findKeybindConflict,
  formatKeybind
} from '../../core/utils/keybinds';
import { ThemeDropdown } from './ThemeDropdown';

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
  const [showDeepLKey, setShowDeepLKey] = useState(false);
  const [deepLKeyDraft, setDeepLKeyDraft] = useState(settings.deeplApiKey);
  const [myMemoryEmailDraft, setMyMemoryEmailDraft] = useState(settings.myMemoryEmail);
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

  const [cinemaStatus, setCinemaStatus] = useState<CinemaModuleStatus | null>(null);
  const [netflixStatus, setNetflixStatus] = useState<NetflixModuleStatus | null>(null);
  const [currentSiteHostname, setCurrentSiteHostname] = useState<string>('');
  const [isCurrentSiteCinema, setIsCurrentSiteCinema] = useState(false);
  const [hasCurrentSitePermission, setHasCurrentSitePermission] = useState(false);

  const [recordingAction, setRecordingAction] = useState<KeybindAction | null>(null);
  const pendingModifierRef = useRef<string | null>(null);
  const currentKeybindings = settings.keybindings ?? DEFAULT_KEYBINDINGS;

  useEffect(() => {
    setDeepLKeyDraft(settings.deeplApiKey);
  }, [settings.deeplApiKey]);

  useEffect(() => {
    setMyMemoryEmailDraft(settings.myMemoryEmail);
  }, [settings.myMemoryEmail]);

  useEffect(() => {
    if (!recordingAction) return;

    const handleKeyDown = (e: KeyboardEvent): void => {
      e.preventDefault();
      e.stopPropagation();

      // Escape cancels recording
      if (e.code === 'Escape') {
        pendingModifierRef.current = null;
        setRecordingAction(null);
        return;
      }

      const isModifier =
        e.code === 'AltLeft' ||
        e.code === 'AltRight' ||
        e.code === 'ShiftLeft' ||
        e.code === 'ShiftRight' ||
        e.code === 'ControlLeft' ||
        e.code === 'ControlRight' ||
        e.code === 'MetaLeft' ||
        e.code === 'MetaRight';

      if (isModifier) {
        pendingModifierRef.current = e.code;
        return;
      }

      // Non-modifier key pressed (with or without modifier held)
      pendingModifierRef.current = null;
      const newBind: KeybindValue = {
        code: e.code,
        ...(e.ctrlKey ? { ctrl: true } : {}),
        ...(e.altKey ? { alt: true } : {}),
        ...(e.shiftKey ? { shift: true } : {})
      };

      const nextKeybindings: KeybindingsMap = {
        ...currentKeybindings,
        [recordingAction]: newBind
      };
      setRecordingAction(null);
      void onUpdateSettings({ keybindings: nextKeybindings });
    };

    const handleKeyUp = (e: KeyboardEvent): void => {
      e.preventDefault();
      e.stopPropagation();

      if (pendingModifierRef.current && e.code === pendingModifierRef.current) {
        const singleModifierCode = pendingModifierRef.current;
        pendingModifierRef.current = null;
        const newBind: KeybindValue = { code: singleModifierCode };
        const nextKeybindings: KeybindingsMap = {
          ...currentKeybindings,
          [recordingAction]: newBind
        };
        setRecordingAction(null);
        void onUpdateSettings({ keybindings: nextKeybindings });
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('keyup', handleKeyUp, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('keyup', handleKeyUp, true);
      pendingModifierRef.current = null;
    };
  }, [recordingAction, currentKeybindings, onUpdateSettings]);
  const [enablingCinema, setEnablingCinema] = useState(false);
  const [cinemaError, setCinemaError] = useState<string | null>(null);
  const [enablingNetflix, setEnablingNetflix] = useState(false);
  const [netflixError, setNetflixError] = useState<string | null>(null);

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

  // Inspect active tab & sync cinema module status
  useEffect(() => {
    let active = true;

    if (chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage(
        { type: 'GET_CINEMA_MODULE_STATUS' },
        (res: CinemaModuleStatusResponse | undefined) => {
          if (!active) return;
          if (res && res.ok) {
            setCinemaStatus(res.data);
          }
        }
      );
      chrome.runtime.sendMessage(
        { type: 'GET_NETFLIX_MODULE_STATUS' },
        (res: NetflixModuleStatusResponse | undefined) => {
          if (!active) return;
          if (res && res.ok) setNetflixStatus(res.data);
        }
      );
    }

    if (chrome.tabs?.query) {
      chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
        if (!active || !tabs[0]?.url) return;
        try {
          const urlObj = new URL(tabs[0].url);
          if (urlObj.protocol === 'http:' || urlObj.protocol === 'https:') {
            const host = urlObj.hostname;
            setCurrentSiteHostname(host);
            const isYt = host.includes('youtube.com');
            const isNetflix = host === 'netflix.com' || host.endsWith('.netflix.com');
            if (!isYt && !isNetflix) {
              setIsCurrentSiteCinema(true);
              if (chrome.permissions?.contains) {
                const cleanHost = host.replace(/^www\./, '');
                const perm = await chrome.permissions.contains({
                  origins: [`*://*.${cleanHost}/*`, `https://*/*`]
                });
                if (active) setHasCurrentSitePermission(perm);
              }
            }
          }
        } catch {
          // Ignore unsupported URL schemes
        }
      });
    }

    return () => {
      active = false;
    };
  }, []);

  const handleToggleCinema = async (checked: boolean): Promise<void> => {
    setEnablingCinema(true);
    setCinemaError(null);
    try {
      if (checked) {
        let granted = false;
        if (chrome.permissions?.request) {
          granted = await chrome.permissions.request({
            origins: ['https://*/*', 'http://*/*']
          });
        } else {
          granted = true;
        }

        if (!granted) {
          setCinemaError('Для работы кинотеатров требуется предоставить доступ к сайтам');
          setEnablingCinema(false);
          return;
        }

        await new Promise<void>((resolve, reject) => {
          chrome.runtime.sendMessage({ type: 'ENABLE_CINEMA_MODULE' }, (res) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else if (res && !res.ok) {
              reject(new Error(res.error || 'Failed to enable cinema module'));
            } else {
              resolve();
            }
          });
        });

        await onUpdateSettings({ cinemaModuleEnabled: true });
        setCinemaStatus({ enabled: true, hasPermission: true, registered: true });
      } else {
        await new Promise<void>((resolve, reject) => {
          chrome.runtime.sendMessage({ type: 'DISABLE_CINEMA_MODULE' }, () => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else {
              resolve();
            }
          });
        });

        await onUpdateSettings({ cinemaModuleEnabled: false });
        setCinemaStatus((prev) => (prev ? { ...prev, enabled: false, registered: false } : null));
      }
    } catch (err: unknown) {
      setCinemaError(err instanceof Error ? err.message : 'Ошибка переключения модуля кинотеатров');
    } finally {
      setEnablingCinema(false);
    }
  };

  const handleToggleNetflix = async (checked: boolean): Promise<void> => {
    setEnablingNetflix(true);
    setNetflixError(null);
    try {
      if (checked) {
        const origins = ['https://*.netflix.com/*', 'https://netflix.com/*'];
        const granted = chrome.permissions?.request
          ? await chrome.permissions.request({ origins })
          : true;
        if (!granted) {
          setNetflixError('Для работы Netflix требуется разрешение на netflix.com');
          return;
        }

        await new Promise<void>((resolve, reject) => {
          chrome.runtime.sendMessage({ type: 'ENABLE_NETFLIX_MODULE' }, (res) => {
            if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
            else if (res && !res.ok) reject(new Error(res.error || 'Не удалось включить Netflix'));
            else resolve();
          });
        });
        await onUpdateSettings({ netflixModuleEnabled: true });
        setNetflixStatus({ enabled: true, hasPermission: true, registered: true });

        if (chrome.tabs?.query && chrome.scripting?.executeScript) {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (tab?.id && tab.url) {
            const hostname = new URL(tab.url).hostname;
            if (hostname === 'netflix.com' || hostname.endsWith('.netflix.com')) {
              try {
                await chrome.scripting.executeScript({
                  target: { tabId: tab.id },
                  world: 'ISOLATED',
                  files: ['assets/content-netflix.js']
                });
              } catch (injectErr) {
                console.warn('[Popup] Netflix direct injection notice:', injectErr);
              }
            }
          }
        }
      } else {
        await new Promise<void>((resolve, reject) => {
          chrome.runtime.sendMessage({ type: 'DISABLE_NETFLIX_MODULE' }, () => {
            if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
            else resolve();
          });
        });
        await onUpdateSettings({ netflixModuleEnabled: false });
        setNetflixStatus((prev) => ({
          enabled: false,
          hasPermission: prev?.hasPermission ?? true,
          registered: false
        }));
      }
    } catch (err: unknown) {
      setNetflixError(err instanceof Error ? err.message : 'Ошибка переключения Netflix');
    } finally {
      setEnablingNetflix(false);
    }
  };

  const handleEnableCurrentSite = async (): Promise<void> => {
    if (!currentSiteHostname) return;
    setEnablingCinema(true);
    setCinemaError(null);
    try {
      const cleanHost = currentSiteHostname.replace(/^www\./, '');
      let granted = false;
      if (chrome.permissions?.request) {
        granted = await chrome.permissions.request({
          origins: [`*://*.${cleanHost}/*`, `*://${cleanHost}/*`]
        });
      } else {
        granted = true;
      }

      if (!granted) {
        setCinemaError(`Доступ к ${currentSiteHostname} был отклонён`);
        setEnablingCinema(false);
        return;
      }

      setHasCurrentSitePermission(true);

      // Register scripts in service worker
      await new Promise<void>((resolve, reject) => {
        chrome.runtime.sendMessage({ type: 'ENABLE_CINEMA_MODULE' }, () => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve();
          }
        });
      });

      await onUpdateSettings({ cinemaModuleEnabled: true });
      setCinemaStatus({ enabled: true, hasPermission: true, registered: true });

      // Direct injection for instant zero-reload support on current tab
      if (chrome.tabs?.query && chrome.scripting?.executeScript) {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.id) {
          try {
            await chrome.scripting.executeScript({
              target: { tabId: tab.id, allFrames: true },
              world: 'MAIN',
              files: ['assets/interceptor-cinema.js']
            });
            await chrome.scripting.executeScript({
              target: { tabId: tab.id, allFrames: true },
              world: 'ISOLATED',
              files: ['assets/content-cinema.js']
            });
          } catch (injectErr) {
            console.warn('[Popup] Direct script injection notice:', injectErr);
          }
        }
      }
    } catch (err: unknown) {
      setCinemaError(err instanceof Error ? err.message : 'Не удалось включить на текущем сайте');
    } finally {
      setEnablingCinema(false);
    }
  };

  return (
    <div className="max-h-[450px] space-y-4 overflow-y-auto pr-1 text-xs">
      {/* Platform Modules (Модули платформ) */}
      <section
        className="space-y-3 rounded-2xl border p-3.5 transition-colors"
        style={{
          backgroundColor: 'var(--ytai-surface)',
          borderColor: 'var(--ytai-border)'
        }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4" style={{ color: 'var(--ytai-accent)' }} />
            <h3 className="font-semibold text-white">Модули платформ</h3>
          </div>
          <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] text-slate-400">
            Модульная система
          </span>
        </div>

        {/* YouTube Module Card */}
        <div className="flex items-center justify-between rounded-xl border border-white/5 bg-slate-900/60 p-2.5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-red-600/20 text-red-400 border border-red-500/30">
              <Play className="h-4 w-4 fill-current" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-medium text-white">YouTube</span>
                <span className="inline-flex items-center gap-1 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-400 border border-emerald-500/30">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  Активен
                </span>
              </div>
              <p className="text-[10px] text-slate-400">
                Встроен по умолчанию (youtube.com)
              </p>
            </div>
          </div>
        </div>

        {/* Netflix Module Card */}
        <div className="space-y-2 rounded-xl border border-red-500/15 bg-slate-900/60 p-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-red-500/30 bg-red-600/20 text-lg font-black text-red-500">
                N
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-white">Netflix</span>
                  {settings.netflixModuleEnabled ? (
                    <span
                      title={netflixStatus?.registered ? 'Netflix-скрипт зарегистрирован' : undefined}
                      className="inline-flex items-center gap-1 rounded border border-emerald-500/30 bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-400"
                    >
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                      Активен
                    </span>
                  ) : (
                    <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">
                      Выключен
                    </span>
                  )}
                </div>
                <p className="text-[10px] text-slate-400">
                  Субтитры и перевод на netflix.com
                </p>
              </div>
            </div>
            <label className="relative inline-flex cursor-pointer items-center">
              <input
                type="checkbox"
                checked={settings.netflixModuleEnabled ?? false}
                disabled={enablingNetflix}
                onChange={(event) => void handleToggleNetflix(event.target.checked)}
                className="peer sr-only"
              />
              <div className="peer h-5 w-9 rounded-full bg-slate-700 after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-all after:content-[''] peer-checked:bg-red-600 peer-checked:after:translate-x-full peer-focus:outline-none" />
            </label>
          </div>
          {netflixError && (
            <div className="flex items-center gap-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 p-2 text-[10px] text-rose-300">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              <span>{netflixError}</span>
            </div>
          )}
        </div>

        {/* Cinema Module Card */}
        <div className="space-y-2 rounded-xl border border-white/5 bg-slate-900/60 p-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-600/20 text-amber-400 border border-amber-500/30">
                <Film className="h-4 w-4" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-white">Онлайн-кинотеатры</span>
                  {settings.cinemaModuleEnabled ? (
                    <span
                      title={cinemaStatus?.registered ? 'Скрипты зарегистрированы в браузере' : undefined}
                      className="inline-flex items-center gap-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300 border border-amber-500/30"
                    >
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
                      Активен
                    </span>
                  ) : (
                    <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">
                      Выключен
                    </span>
                  )}
                </div>
                <p className="text-[10px] text-slate-400">
                  Rezka, Filmix, Kinogo, AnimeGo и другие плееры
                </p>
              </div>
            </div>

            <label className="relative inline-flex cursor-pointer items-center">
              <input
                type="checkbox"
                checked={settings.cinemaModuleEnabled ?? false}
                disabled={enablingCinema}
                onChange={(e) => void handleToggleCinema(e.target.checked)}
                className="peer sr-only"
              />
              <div className="peer h-5 w-9 rounded-full bg-slate-700 after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-all after:content-[''] peer-checked:bg-amber-600 peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus:outline-none" />
            </label>
          </div>

          {/* Quick Enable on Current Site button */}
          {isCurrentSiteCinema && (
            <div className="mt-2 flex items-center justify-between rounded-lg bg-amber-500/10 border border-amber-500/25 p-2">
              <div className="min-w-0 pr-2">
                <div className="flex items-center gap-1.5 text-[11px] font-medium text-amber-200">
                  <Globe className="h-3 w-3 shrink-0" />
                  <span className="truncate">{currentSiteHostname}</span>
                </div>
                <div className="text-[9px] text-amber-300/80">
                  {hasCurrentSitePermission
                    ? 'Сайт разрешён расширению'
                    : 'Требуется разрешение для текущего сайта'}
                </div>
              </div>

              <button
                type="button"
                disabled={enablingCinema}
                onClick={() => void handleEnableCurrentSite()}
                className="shrink-0 flex items-center gap-1 rounded-md bg-amber-600 hover:bg-amber-500 px-2.5 py-1 text-[10px] font-semibold text-white shadow transition disabled:opacity-50"
              >
                {enablingCinema ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <ShieldCheck className="h-3 w-3" />
                )}
                <span>
                  {hasCurrentSitePermission ? 'Перезапустить скрипт' : 'Включить на этом сайте'}
                </span>
              </button>
            </div>
          )}

          {cinemaError && (
            <div className="flex items-center gap-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 p-2 text-[10px] text-rose-300">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              <span>{cinemaError}</span>
            </div>
          )}
        </div>
      </section>

      {/* Appearance & Subtitles (Оформление и субтитры) */}
      <section
        className="space-y-3.5 rounded-2xl border p-3.5 transition-colors"
        style={{
          backgroundColor: 'var(--ytai-surface)',
          borderColor: 'var(--ytai-border)'
        }}
      >
        <div className="flex items-center gap-2">
          <Palette className="h-4 w-4" style={{ color: 'var(--ytai-accent)' }} />
          <h3 className="font-semibold text-white">Appearance & Subtitles</h3>
        </div>

        {/* Compact Theme Dropdown & Live Preview Strip */}
        <div>
          <label className="mb-1.5 block text-[11px] text-slate-400">
            Цветовая тема
          </label>
          <ThemeDropdown
            currentThemeId={settings.theme || 'midnight-glass'}
            onSelectTheme={(themeId) => void onUpdateSettings({ theme: themeId })}
          />

          {/* Compact Live Preview Strip */}
          {(() => {
            const currentTheme = THEMES[settings.theme] || THEMES['midnight-glass'];
            return (
              <div
                className="mt-2.5 flex items-center justify-between rounded-xl border px-3 py-2 shadow-sm transition-all"
                style={{
                  backgroundColor: `rgba(${currentTheme.bgRgb}, ${settings.overlayOpacity ?? 0.85})`,
                  borderColor: currentTheme.border,
                  backdropFilter: `blur(${currentTheme.backdropBlur})`,
                  WebkitBackdropFilter: `blur(${currentTheme.backdropBlur})`
                }}
              >
                <div className="min-w-0 flex-1">
                  <div
                    className="truncate font-semibold leading-tight"
                    style={{
                      color: currentTheme.textPrimary,
                      textShadow: currentTheme.textShadow,
                      fontSize: `${Math.min(20, Math.max(12, Math.round(settings.subtitleFontSize * 0.7)))}px`
                    }}
                  >
                    {currentTheme.previewOriginal}
                  </div>
                  <div
                    className="mt-0.5 truncate leading-tight opacity-90"
                    style={{
                      color: currentTheme.textSecondary,
                      textShadow: currentTheme.textShadow,
                      fontSize: `${Math.min(15, Math.max(10, Math.round(settings.subtitleFontSize * 0.52)))}px`
                    }}
                  >
                    {currentTheme.previewTranslation}
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-1.5 pl-3">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: currentTheme.accent }}
                  />
                  <span
                    className="text-[10px] font-medium"
                    style={{ color: currentTheme.accent }}
                  >
                    {currentTheme.name}
                  </span>
                </div>
              </div>
            );
          })()}
        </div>

        {/* Subtitle Scale Segmented Control */}
        <div>
          <div className="mb-1.5 flex items-center justify-between text-[11px] text-slate-400">
            <span>Размер шрифта субтитров</span>
            <span className="font-semibold text-slate-200">
              {settings.subtitleFontSize}px {settings.subtitleFontSize >= 44 ? '(TV Mode)' : `(${settings.subtitleScale?.toUpperCase() ?? 'MD'})`}
            </span>
          </div>

          <div className="grid grid-cols-5 gap-1.5 rounded-xl border border-white/10 bg-slate-950/70 p-1">
            {SUBTITLE_SCALES.map((scale) => {
              const active = settings.subtitleFontSize === scale.primary;
              return (
                <button
                  key={scale.id}
                  type="button"
                  onClick={() =>
                    void onUpdateSettings({
                      subtitleScale: scale.id,
                      subtitleFontSize: scale.primary
                    })
                  }
                  className={`flex flex-col items-center justify-center rounded-lg py-1.5 transition ${
                    active
                      ? 'bg-white/15 font-semibold text-white shadow-sm'
                      : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
                  }`}
                  style={active ? { color: 'var(--ytai-accent)' } : undefined}
                >
                  <div className="flex items-center gap-0.5">
                    {scale.id === 'tv' && <Tv className="h-3 w-3" />}
                    <span className="text-xs font-bold">{scale.label}</span>
                  </div>
                  <span className="text-[9px] opacity-75">{scale.primary}px</span>
                </button>
              );
            })}
          </div>

          <div className="mt-2.5">
            <input
              type="range"
              min={14}
              max={56}
              step={2}
              value={settings.subtitleFontSize}
              onChange={(e) => {
                const val = Number.parseInt(e.target.value, 10);
                const closest = SUBTITLE_SCALES.slice().sort(
                  (a, b) => Math.abs(a.primary - val) - Math.abs(b.primary - val)
                )[0];
                void onUpdateSettings({
                  subtitleFontSize: val,
                  subtitleScale: closest ? closest.id : settings.subtitleScale
                });
              }}
              className="w-full accent-indigo-500"
              style={{ accentColor: 'var(--ytai-accent)' }}
            />
            <div className="mt-0.5 flex justify-between text-[9px] text-slate-500">
              <span>14px</span>
              <span>20px (Стандарт)</span>
              <span>36px</span>
              <span>48–56px (TV)</span>
            </div>
          </div>
        </div>

        {/* Overlay Opacity Slider */}
        <div>
          <div className="mb-1.5 flex items-center justify-between text-[11px] text-slate-400">
            <span>Прозрачность подложки субтитров</span>
            <span className="font-semibold text-slate-200">
              {Math.round(settings.overlayOpacity * 100)}%
            </span>
          </div>
          <input
            type="range"
            min={0.4}
            max={1.0}
            step={0.05}
            value={settings.overlayOpacity}
            onChange={(e) =>
              void onUpdateSettings({
                overlayOpacity: Number.parseFloat(e.target.value)
              })
            }
            className="w-full accent-indigo-500"
            style={{ accentColor: 'var(--ytai-accent)' }}
          />
          <div className="mt-1 flex justify-between text-[9px] text-slate-500">
            <span>40% (Прозрачный)</span>
            <span>70%</span>
            <span>85% (Стандарт)</span>
            <span>100% (Плотный)</span>
          </div>
        </div>

        {/* Active Listening Modes */}
        <div>
          <div className="mb-1.5 flex items-center justify-between text-[11px] text-slate-400">
            <span>Режим восприятия на слух (Active Listening)</span>
            <span className="font-semibold text-slate-200">
              {settings.activeListeningMode === 'off' && 'Обычный (Всегда видны)'}
              {settings.activeListeningMode === 'blur' && 'Размытие (Blur)'}
              {settings.activeListeningMode === 'hidden' && 'Скрыты до Alt (Stealth)'}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-1.5 rounded-xl border border-white/10 bg-slate-950/70 p-1">
            {[
              { id: 'off' as const, label: 'Обычный', desc: 'Всегда видны', icon: Eye },
              { id: 'blur' as const, label: 'Blur', desc: 'Hover или Alt', icon: EyeOff },
              { id: 'hidden' as const, label: 'Stealth', desc: 'Только клавиша Alt', icon: Ghost }
            ].map((mode) => {
              const active = settings.activeListeningMode === mode.id;
              const Icon = mode.icon;
              return (
                <button
                  key={mode.id}
                  type="button"
                  onClick={() => void onUpdateSettings({ activeListeningMode: mode.id })}
                  className={`flex flex-col items-center justify-center rounded-lg py-2 px-1 text-center transition ${
                    active
                      ? 'bg-white/15 font-semibold text-white shadow-sm'
                      : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
                  }`}
                  style={active ? { color: 'var(--ytai-accent)' } : undefined}
                >
                  <Icon className="mb-1 h-4 w-4" />
                  <span className="text-xs font-semibold">{mode.label}</span>
                  <span className="text-[10px] opacity-75">{mode.desc}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Controls Scale Segmented Control */}
        <div>
          <div className="mb-1.5 flex items-center justify-between text-[11px] text-slate-400">
            <span>Размер верхней панели (Player Controls)</span>
            <span className="font-semibold text-slate-200">
              {settings.controlsScale === 'sm' && 'Компактный (S · 85%)'}
              {(!settings.controlsScale || settings.controlsScale === 'md') &&
                'Стандартный (M · 100%)'}
              {settings.controlsScale === 'lg' && 'Крупный (L · 125%)'}
              {settings.controlsScale === 'xl' && 'Максимальный (XL · 150%)'}
            </span>
          </div>
          <div className="grid grid-cols-4 gap-1.5 rounded-xl border border-white/10 bg-slate-950/70 p-1">
            {[
              { id: 'sm' as const, label: 'S', desc: '85%' },
              { id: 'md' as const, label: 'M', desc: '100%' },
              { id: 'lg' as const, label: 'L', desc: '125%' },
              { id: 'xl' as const, label: 'XL', desc: '150%' }
            ].map((item) => {
              const active = (settings.controlsScale || 'md') === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => void onUpdateSettings({ controlsScale: item.id })}
                  className={`flex flex-col items-center justify-center rounded-lg py-1.5 transition ${
                    active
                      ? 'bg-white/15 font-semibold text-white shadow-sm'
                      : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
                  }`}
                  style={active ? { color: 'var(--ytai-accent)' } : undefined}
                >
                  <span className="text-xs font-semibold">{item.label}</span>
                  <span className="text-[10px] opacity-75">{item.desc}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Subtitle Position Reset */}
        <div className="flex items-center justify-between rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-xs">
          <div>
            <span className="text-slate-200 font-medium">Позиция субтитров</span>
            <p className="text-[11px] text-slate-400">
              {settings.subtitlePosition
                ? `Смещена (${Math.round(settings.subtitlePosition.xPercent)}%, ${Math.round(settings.subtitlePosition.yPercent)}%)`
                : 'По центру снизу (по умолчанию)'}
            </p>
          </div>
          {settings.subtitlePosition ? (
            <button
              type="button"
              onClick={() => void onUpdateSettings({ subtitlePosition: null })}
              className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/10 px-2.5 py-1 text-xs font-medium text-slate-200 transition hover:bg-white/20 hover:text-white"
            >
              <RotateCcw className="h-3 w-3" />
              <span>Сбросить</span>
            </button>
          ) : (
            <span className="text-[11px] text-slate-500">Тяните плашку мышью</span>
          )}
        </div>
      </section>

      {/* Language & Player Behavior */}
      <section
        className="space-y-3 rounded-2xl border p-3.5 transition-colors"
        style={{
          backgroundColor: 'var(--ytai-surface)',
          borderColor: 'var(--ytai-border)'
        }}
      >
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
              key: 'showTranslation' as const,
              label: 'Show dual (translated) subtitles'
            },
            {
              key: 'autoHideControls' as const,
              label: 'Auto-hide top control bar on inactivity'
            },
            {
              key: 'pauseOnAltHold' as const,
              label: 'Автопауза при удержании Alt (продолжение при отпускании)'
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
                style={{ accentColor: 'var(--ytai-accent)' }}
              />
            </label>
          ))}
        </div>

        {/* Pause Timer Selector */}
        <div className="pt-1">
          <div className="mb-1.5 flex items-center justify-between text-[11px] text-slate-400">
            <span>Таймер автопаузы / автопродолжения</span>
            <span className="font-semibold text-slate-200">
              {settings.pauseTimerSeconds > 0 ? `${settings.pauseTimerSeconds}с` : 'Выкл'}
            </span>
          </div>
          <div className="grid grid-cols-4 gap-1.5 rounded-xl border border-white/10 bg-slate-950/70 p-1">
            {[
              { label: 'Выкл', val: 0 },
              { label: '3 сек', val: 3 },
              { label: '5 сек', val: 5 },
              { label: '10 сек', val: 10 }
            ].map((opt) => {
              const active = (settings.pauseTimerSeconds ?? 0) === opt.val;
              return (
                <button
                  key={opt.val}
                  type="button"
                  onClick={() =>
                    void onUpdateSettings({
                      pauseTimerSeconds: opt.val,
                      ...(opt.val > 0 ? { autoPauseAfterCue: true } : {})
                    })
                  }
                  className={`flex items-center justify-center rounded-lg py-1.5 text-xs transition ${
                    active
                      ? 'bg-white/15 font-semibold text-white shadow-sm'
                      : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
                  }`}
                  style={active ? { color: 'var(--ytai-accent)' } : undefined}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* Hotkeys Configuration */}
      <section
        className="space-y-3.5 rounded-2xl border p-3.5 transition-colors"
        style={{
          backgroundColor: 'var(--ytai-surface)',
          borderColor: 'var(--ytai-border)'
        }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Keyboard className="h-4 w-4 text-white" style={{ color: 'var(--ytai-accent)' }} />
            <h3 className="font-semibold text-white">Горячие клавиши</h3>
          </div>
          <button
            type="button"
            onClick={() => void onUpdateSettings({ keybindings: DEFAULT_KEYBINDINGS })}
            title="Сбросить все горячие клавиши по умолчанию"
            className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-slate-400 transition hover:bg-white/10 hover:text-white cursor-pointer"
          >
            <RotateCcw className="h-3 w-3" />
            <span>Сбросить</span>
          </button>
        </div>

        <div className="space-y-1.5">
          {(Object.keys(DEFAULT_KEYBINDINGS) as KeybindAction[]).map((action) => {
            const meta = KEYBIND_ACTION_LABELS[action];
            const bind = currentKeybindings[action];
            const isRecording = recordingAction === action;
            const conflictAction = findKeybindConflict(action, bind, currentKeybindings);

            return (
              <div
                key={action}
                className="flex items-center justify-between gap-2 rounded-xl p-2 transition-colors hover:bg-white/5"
              >
                <div className="flex flex-col min-w-0 pr-2">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-xs font-medium text-white">{meta.title}</span>
                    {conflictAction && (
                      <span className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                        <AlertTriangle className="h-2.5 w-2.5" />
                        Конфликт клавиш
                      </span>
                    )}
                  </div>
                  <span className="text-[11px] text-slate-400 line-clamp-1">{meta.description}</span>
                </div>

                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      if (isRecording) {
                        setRecordingAction(null);
                      } else {
                        setRecordingAction(action);
                      }
                    }}
                    className={`min-w-[96px] px-2.5 py-1 text-xs font-mono font-medium rounded-lg border transition text-center cursor-pointer ${
                      isRecording
                        ? 'border-indigo-400 bg-indigo-500/20 text-indigo-300 animate-pulse shadow-[0_0_8px_rgba(99,102,241,0.5)]'
                        : bind
                          ? 'border-white/15 bg-white/10 text-white hover:border-white/30 hover:bg-white/15'
                          : 'border-dashed border-white/20 bg-transparent text-slate-400 hover:border-white/40 hover:text-slate-200'
                    }`}
                    style={
                      isRecording
                        ? { borderColor: 'var(--ytai-accent)', color: 'var(--ytai-accent)' }
                        : undefined
                    }
                  >
                    {isRecording ? 'Нажмите клавишу...' : formatKeybind(bind)}
                  </button>

                  {bind && (
                    <button
                      type="button"
                      onClick={() => {
                        const nextKeybindings: KeybindingsMap = {
                          ...currentKeybindings,
                          [action]: null
                        };
                        void onUpdateSettings({ keybindings: nextKeybindings });
                      }}
                      title="Очистить горячую клавишу"
                      className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-white/10 transition cursor-pointer"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Subtitle translation provider */}
      <section
        className="space-y-3 rounded-2xl border p-3.5 transition-colors"
        style={{
          backgroundColor: 'var(--ytai-surface)',
          borderColor: 'var(--ytai-border)'
        }}
      >
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-white">Перевод субтитров</h3>
            <p className="text-[10px] text-slate-400">Общий провайдер для YouTube и Netflix</p>
          </div>
          <div className="flex rounded-lg border border-white/10 bg-slate-950/60 p-0.5">
            {(['mymemory', 'googleDict', 'deepl', 'google'] as const).map((provider) => (
              <button
                key={provider}
                type="button"
                onClick={() => void onUpdateSettings({ translationProvider: provider })}
                className={`rounded-md px-2.5 py-1 text-[10px] font-semibold transition ${
                  settings.translationProvider === provider
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {provider === 'mymemory'
                  ? 'MyMemory'
                  : provider === 'googleDict'
                    ? 'Google Dict'
                    : provider === 'deepl'
                      ? 'DeepL'
                      : 'Google'}
              </button>
            ))}
          </div>
        </div>

        {settings.translationProvider === 'mymemory' && (
          <div>
            <label className="mb-1 block text-[11px] text-slate-400">
              Контактный email — необязательно
            </label>
            <input
              type="email"
              value={myMemoryEmailDraft}
              onChange={(event) => setMyMemoryEmailDraft(event.target.value)}
              onBlur={() => {
                if (myMemoryEmailDraft.trim() !== settings.myMemoryEmail) {
                  void onUpdateSettings({ myMemoryEmail: myMemoryEmailDraft.trim() });
                }
              }}
              placeholder="email для лимита 50 000 символов/день"
              className="w-full rounded-xl border border-white/10 bg-slate-950/80 px-3 py-2 text-xs text-white outline-none transition focus:border-indigo-500"
            />
          </div>
        )}

        {settings.translationProvider === 'deepl' && (
          <div>
            <label className="mb-1 block text-[11px] text-slate-400">DeepL API Key</label>
            <div className="relative">
              <input
                type={showDeepLKey ? 'text' : 'password'}
                value={deepLKeyDraft}
                onChange={(event) => setDeepLKeyDraft(event.target.value)}
                onBlur={() => {
                  if (deepLKeyDraft.trim() !== settings.deeplApiKey) {
                    void onUpdateSettings({ deeplApiKey: deepLKeyDraft.trim() });
                  }
                }}
                placeholder="Введите ключ DeepL API Free"
                className="w-full rounded-xl border border-white/10 bg-slate-950/80 px-3 py-2 pr-9 text-xs text-white outline-none transition focus:border-indigo-500"
              />
              <button
                type="button"
                onClick={() => setShowDeepLKey((value) => !value)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-white"
                title={showDeepLKey ? 'Скрыть ключ' : 'Показать ключ'}
              >
                {showDeepLKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>
        )}

      </section>

      {/* LLM BYOK Configuration */}
      <section
        className="space-y-3 rounded-2xl border p-3.5 transition-colors"
        style={{
          backgroundColor: 'var(--ytai-surface)',
          borderColor: 'var(--ytai-border)'
        }}
      >
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
                    },
                    fallbackModel: preset.fallbackModel ?? settings.fallbackModel
                  })
                }
                className="rounded-md bg-slate-800 px-2 py-0.5 text-[10px] font-medium text-slate-300 hover:bg-white/20 hover:text-white"
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
                style={{ color: 'var(--ytai-accent)' }}
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
                className={`h-3.5 w-3.5 ${modelsLoading ? 'animate-spin' : ''}`}
                style={modelsLoading ? { color: 'var(--ytai-accent)' } : undefined}
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

        {/* Fallback Model (при 503 / 429) */}
        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="text-[11px] text-slate-400">
              Резервная модель (при 503 / 429)
            </label>
            {settings.fallbackModel && (
              <button
                type="button"
                onClick={() => void onUpdateSettings({ fallbackModel: '' })}
                className="text-[10px] text-slate-400 hover:text-slate-200"
              >
                Не использовать
              </button>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            {!manualModelMode && availableModels.length > 0 ? (
              <select
                value={settings.fallbackModel || ''}
                onChange={(e) =>
                  void onUpdateSettings({ fallbackModel: e.target.value })
                }
                className="min-w-0 flex-1 rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none"
              >
                <option value="">(Не использовать)</option>
                {settings.fallbackModel &&
                  !availableModels.includes(settings.fallbackModel.trim()) &&
                  settings.fallbackModel.trim() !== '' && (
                    <option value={settings.fallbackModel}>
                      {settings.fallbackModel} (текущая)
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
                  onChange={(e) =>
                    void onUpdateSettings({ fallbackModel: e.target.value })
                  }
                  placeholder="Опционально (напр. gemini-3.8-flash-lite / gpt-4o)"
                  className="min-w-0 flex-1 rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none"
                />
                <datalist id="yt-lang-ai-fallback-models">
                  {availableModels.map((modelId) => (
                    <option key={`dl-fallback-${modelId}`} value={modelId} />
                  ))}
                </datalist>
              </>
            )}
          </div>
          <p className="mt-1 text-[10px] text-slate-400">
            Если основная модель перегружена (503/429), запрос автоматически перенаправится на эту модель.
          </p>
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
          style={{ backgroundColor: 'var(--ytai-accent)' }}
          className="flex items-center gap-1.5 rounded-xl px-3 py-2 font-semibold text-white shadow-sm transition hover:opacity-90 disabled:opacity-50"
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
      <section
        className="space-y-3 rounded-2xl border p-3.5 transition-colors"
        style={{
          backgroundColor: 'var(--ytai-surface)',
          borderColor: 'var(--ytai-border)'
        }}
      >
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
            style={{ backgroundColor: 'var(--ytai-accent)' }}
            className="flex items-center gap-1.5 rounded-xl px-3 py-2 font-semibold text-white shadow-sm transition hover:opacity-90 disabled:opacity-50"
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
