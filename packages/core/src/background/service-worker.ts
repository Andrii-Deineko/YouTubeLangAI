import {
  isValidTranslationText,
  type AIExplanation,
  type QuickTranslationResult,
  type RuntimeRequest,
  type RuntimeResponse,
  type ServicePlugin
} from '@langai/contracts';
import {
  buildAIExplanationCacheKey,
  buildTranslationCacheKey,
  exportCardsToAnki,
  getCachedAIExplanation,
  getCachedTranslation,
  getSettings,
  setCachedAIExplanation,
  setCachedTranslation,
  testAnkiConnection
} from '@langai/storage';
import {
  cancelTranslationJob,
  fetchAvailableModels,
  quickTranslateWord,
  requestAiExplanation,
  testLlmConnection,
  translateCuesWindow
} from '@langai/translators';
import {
  createModuleManager,
  getBundlePathsForService,
  type ModuleManager
} from './moduleManager';

const MAX_SUBTITLE_BYTES = 5 * 1024 * 1024;
const SUBTITLE_FETCH_TIMEOUT_MS = 10_000;

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

function isPrivateIpv4Octets(a: number, b: number, c: number, d: number): boolean {
  if (
    [a, b, c, d].some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return true;
  }
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  return false;
}

export function isPrivateOrLoopbackHostname(rawHostname: string): boolean {
  const host = rawHostname
    .trim()
    .replace(/^\[(.*)\]$/, '$1')
    .replace(/\.+$/, '')
    .toLowerCase();

  if (!host) return true;

  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '0.0.0.0' ||
    host === '::' ||
    host === '::1' ||
    host === '0:0:0:0:0:0:0:0' ||
    host === '0:0:0:0:0:0:0:1'
  ) {
    return true;
  }

  const ipv4Match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    return isPrivateIpv4Octets(
      Number.parseInt(ipv4Match[1], 10),
      Number.parseInt(ipv4Match[2], 10),
      Number.parseInt(ipv4Match[3], 10),
      Number.parseInt(ipv4Match[4], 10)
    );
  }

  if (host.includes(':')) {
    const mappedDottedMatch = host.match(/^(?:::ffff:|0:0:0:0:0:ffff:)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
    if (mappedDottedMatch?.[1]) {
      return isPrivateOrLoopbackHostname(mappedDottedMatch[1]);
    }

    const mappedHexMatch = host.match(/^(?:::ffff:|0:0:0:0:0:ffff:)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (mappedHexMatch) {
      const hi = Number.parseInt(mappedHexMatch[1], 16);
      const lo = Number.parseInt(mappedHexMatch[2], 16);
      return isPrivateIpv4Octets((hi >> 8) & 0xff, hi & 0xff, (lo >> 8) & 0xff, lo & 0xff);
    }

    const firstGroup = host.split(':')[0];
    if (firstGroup) {
      const firstVal = Number.parseInt(firstGroup, 16);
      if (!Number.isNaN(firstVal)) {
        if ((firstVal & 0xfe00) === 0xfc00) return true; // fc00::/7 ULA
        if ((firstVal & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
      }
    }
  }

  return false;
}

export function validateSubtitleFetchUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('Invalid subtitle URL');
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`Unsupported subtitle URL protocol: ${parsed.protocol}`);
  }

  if (isPrivateOrLoopbackHostname(parsed.hostname)) {
    throw new Error(`Blocked private or loopback subtitle host: ${parsed.hostname}`);
  }

  return parsed;
}

export async function handleFetchSubtitleText(url: string): Promise<string> {
  const parsed = validateSubtitleFetchUrl(url);
  const resp = await fetch(parsed.toString(), {
    signal: AbortSignal.timeout(SUBTITLE_FETCH_TIMEOUT_MS)
  });

  if (resp.url) {
    validateSubtitleFetchUrl(resp.url);
  }

  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} fetching subtitle text: ${resp.statusText}`);
  }

  const contentLengthHeader = resp.headers?.get?.('content-length');
  if (contentLengthHeader) {
    const declaredSize = Number.parseInt(contentLengthHeader, 10);
    if (!Number.isNaN(declaredSize) && declaredSize > MAX_SUBTITLE_BYTES) {
      try {
        await resp.body?.cancel();
      } catch {
        // Ignore cancel errors
      }
      throw new Error('Subtitle file exceeds 5 MB size limit');
    }
  }

  if (resp.body && typeof resp.body.getReader === 'function') {
    const reader = resp.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          totalBytes += value.byteLength;
          if (totalBytes > MAX_SUBTITLE_BYTES) {
            await reader.cancel();
            throw new Error('Subtitle file exceeds 5 MB size limit');
          }
          chunks.push(value);
        }
      }
    } finally {
      reader.releaseLock();
    }

    const merged = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder('utf-8').decode(merged);
  }

  const text = await resp.text();
  if (new TextEncoder().encode(text).byteLength > MAX_SUBTITLE_BYTES) {
    throw new Error('Subtitle file exceeds 5 MB size limit');
  }
  return text;
}

export interface ServiceWorkerController {
  moduleManager: ModuleManager;
  processMessage: (
    message: RuntimeRequest,
    sender: chrome.runtime.MessageSender
  ) => Promise<RuntimeResponse<unknown>>;
  destroy: () => void;
}

export function initServiceWorker(
  services: readonly ServicePlugin[]
): ServiceWorkerController {
  const moduleManager = createModuleManager(services);
  const serviceMap = new Map<string, ServicePlugin>(services.map((s) => [s.id, s]));

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
    if (cached && isValidTranslationText(cached.translation)) {
      return { ...cached, fromCache: true };
    }

    const existingPromise = inFlightTranslations.get(cacheKey);
    if (existingPromise) {
      return existingPromise;
    }

    const promise = (async (): Promise<QuickTranslationResult> => {
      const result = await quickTranslateWord(cleanText, sl, nativeLang, {
        translationProvider: settings.translationProvider,
        myMemoryEmail: settings.myMemoryEmail,
        deeplApiKey: settings.deeplApiKey
      });
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
        payload.fallbackModel !== undefined ? payload.fallbackModel : settings.fallbackModel;

      const explanation = await requestAiExplanation({
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

  function resolveServiceForInjection(
    serviceId: string | undefined,
    sender: chrome.runtime.MessageSender
  ): ServicePlugin | null {
    if (serviceId) {
      return serviceMap.get(serviceId) ?? null;
    }
    const candidateUrl = sender.url ?? sender.tab?.url;
    if (!candidateUrl) return null;
    try {
      const parsed = new URL(candidateUrl);
      const chain: string[] = [parsed.hostname.toLowerCase()];
      if (sender.tab?.url) {
        try {
          const tabHost = new URL(sender.tab.url).hostname.toLowerCase();
          if (tabHost && !chain.includes(tabHost)) {
            chain.push(tabHost);
          }
        } catch {
          // Ignore invalid tab URL
        }
      }
      return services.find((svc) => svc.matchesUrl(parsed, chain)) ?? null;
    } catch {
      return null;
    }
  }

  async function processMessage(
    message: RuntimeRequest,
    sender: chrome.runtime.MessageSender
  ): Promise<RuntimeResponse<unknown>> {
    try {
      switch (message.type) {
        case 'FREE_TRANSLATE_CUES': {
          const settings = await getSettings();
          const result = await translateCuesWindow(message.payload, {
            translationProvider: settings.translationProvider,
            myMemoryEmail: settings.myMemoryEmail,
            deeplApiKey: settings.deeplApiKey
          });
          return { ok: true, data: result };
        }
        case 'CANCEL_FREE_TRANSLATION': {
          cancelTranslationJob(message.payload?.videoId, message.payload?.targetLang);
          return { ok: true, data: true };
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
          const result = await testLlmConnection(message.payload.llmConfig);
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
        case 'OPEN_EXTENSION_POPUP': {
          const targetTab = message.payload?.tab ?? 'settings';
          try {
            if (chrome.storage?.local) {
              await chrome.storage.local.set({
                cinelingua_pending_popup_tab: {
                  tab: targetTab,
                  ts: Date.now()
                }
              });
            }
          } catch {
            // Ignore storage write errors
          }

          if (chrome.action?.openPopup) {
            try {
              await chrome.action.openPopup();
              return { ok: true, data: true };
            } catch {
              // Fallback to opening popup UI in a dedicated tab
            }
          }
          try {
            const popupUrl = chrome.runtime.getURL(
              `src/popup/index.html?tab=${targetTab}`
            );
            await chrome.tabs.create({ url: popupUrl });
            return { ok: true, data: true };
          } catch (openErr: unknown) {
            return {
              ok: false,
              error: openErr instanceof Error ? openErr.message : 'Failed to open settings'
            };
          }
        }
        case 'INJECT_MAIN_INTERCEPTOR': {
          const tabId = sender.tab?.id;
          const frameId = typeof sender.frameId === 'number' ? sender.frameId : 0;
          if (typeof tabId !== 'number') {
            return { ok: false, error: 'No tab id in sender' };
          }

          const targetService = resolveServiceForInjection(
            message.payload?.serviceId,
            sender
          );
          if (!targetService || !targetService.needsMainWorldInterceptor) {
            return {
              ok: false,
              error: 'No main-world interceptor configured for this service'
            };
          }

          const { mainWorldInterceptorPath } = getBundlePathsForService(targetService);
          if (!mainWorldInterceptorPath) {
            return { ok: false, error: 'No main-world interceptor bundle path' };
          }

          if (chrome.scripting?.executeScript) {
            try {
              await chrome.scripting.executeScript({
                target: { tabId, frameIds: [frameId] },
                world: 'MAIN',
                files: [mainWorldInterceptorPath]
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
        case 'ENABLE_SERVICE_MODULE': {
          const result = await moduleManager.enableService(message.payload.serviceId);
          return result.success
            ? { ok: true, data: result }
            : { ok: false, error: result.error || 'Failed to enable service module' };
        }
        case 'DISABLE_SERVICE_MODULE': {
          const result = await moduleManager.disableService(message.payload.serviceId);
          return { ok: true, data: result };
        }
        case 'GET_SERVICE_MODULE_STATUS': {
          const status = await moduleManager.getServiceStatus(message.payload.serviceId);
          return { ok: true, data: status };
        }
        case 'GET_ALL_SERVICE_STATUSES': {
          const statuses = await moduleManager.getAllServiceStatuses();
          return { ok: true, data: statuses };
        }
        case 'SYNC_SERVICE_MODULES': {
          const statuses = await moduleManager.syncAllServices();
          return { ok: true, data: statuses };
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

  const onInstalledListener = (): void => {
    void moduleManager.syncAllServices();
    void moduleManager.reinjectStaticServices();
  };

  const onStartupListener = (): void => {
    void moduleManager.syncAllServices();
  };

  const onPermissionsRemovedListener = (): void => {
    void moduleManager.syncAllServices();
  };

  const onMessageListener = (
    message: RuntimeRequest,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: RuntimeResponse<unknown>) => void
  ): boolean => {
    void processMessage(message, sender).then(sendResponse);
    return true;
  };

  if (typeof chrome !== 'undefined' && chrome.runtime) {
    chrome.runtime.onInstalled?.addListener(onInstalledListener);
    chrome.runtime.onStartup?.addListener(onStartupListener);
    chrome.permissions?.onRemoved?.addListener(onPermissionsRemovedListener);
    chrome.runtime.onMessage?.addListener(onMessageListener);
  }

  const destroy = (): void => {
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      chrome.runtime.onInstalled?.removeListener(onInstalledListener);
      chrome.runtime.onStartup?.removeListener(onStartupListener);
      chrome.permissions?.onRemoved?.removeListener(onPermissionsRemovedListener);
      chrome.runtime.onMessage?.removeListener(onMessageListener);
    }
  };

  return {
    moduleManager,
    processMessage,
    destroy
  };
}
