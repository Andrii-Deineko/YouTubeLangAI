import type { ServiceModuleStatus, ServicePlugin } from '@langai/contracts';
import { getSettings, saveSettings } from '@langai/storage';

const FORBIDDEN_GLOBAL_PATTERNS = new Set([
  '<all_urls>',
  '*://*/*',
  'https://*/*',
  'http://*/*'
]);

export function isForbiddenGlobalPattern(pattern: string): boolean {
  const clean = pattern.trim().toLowerCase();
  if (!clean) return true;
  if (FORBIDDEN_GLOBAL_PATTERNS.has(clean)) return true;
  if (/^(?:\*|https?):\/\/\*(?:\/.*)?$/i.test(clean)) {
    return true;
  }
  return false;
}

export function normalizeMirrorToMatchPatterns(mirror: string): string[] {
  const raw = mirror.trim();
  if (!raw || isForbiddenGlobalPattern(raw)) {
    return [];
  }

  const hasScheme = /^(?:\*|https?):\/\//i.test(raw);
  if (hasScheme) {
    const match = raw.match(/^(\*|https?):\/\/([^/?#]+)(\/.*)?$/i);
    if (!match) return [];
    const scheme = match[1].toLowerCase();
    const host = match[2].toLowerCase();
    if (!host || host === '*' || host === '*.*') return [];
    const path = match[3] && match[3].startsWith('/') ? match[3] : '/*';
    const candidate = `${scheme}://${host}${path}`;
    return isForbiddenGlobalPattern(candidate) ? [] : [candidate];
  }

  const hostOnly = raw
    .replace(/^\/+/, '')
    .split('/')[0]
    ?.split('?')[0]
    ?.split('#')[0]
    ?.toLowerCase();

  if (!hostOnly || hostOnly === '*' || hostOnly === '*.*') {
    return [];
  }

  if (hostOnly.startsWith('*.')) {
    const base = hostOnly.slice(2);
    if (!/^[a-z0-9.-]+$/.test(base) || !base.includes('.')) {
      return [];
    }
    return [`*://${hostOnly}/*`, `*://${base}/*`];
  }

  if (!/^[a-z0-9.-]+$/.test(hostOnly)) {
    return [];
  }

  return [`*://${hostOnly}/*`, `*://*.${hostOnly}/*`];
}

export function getBundlePathsForService(service: ServicePlugin): {
  contentScriptPath: string;
  mainWorldInterceptorPath: string | null;
} {
  return {
    contentScriptPath: `assets/content-${service.id}.js`,
    mainWorldInterceptorPath: service.needsMainWorldInterceptor
      ? `assets/interceptor-${service.id}.js`
      : null
  };
}

export function getScriptIdsForService(service: ServicePlugin): {
  contentScriptId: string;
  interceptorScriptId: string | null;
  allIds: string[];
} {
  const contentScriptId = `content-${service.id}`;
  const interceptorScriptId = service.needsMainWorldInterceptor
    ? `interceptor-${service.id}`
    : null;
  const allIds = interceptorScriptId
    ? [interceptorScriptId, contentScriptId]
    : [contentScriptId];
  return { contentScriptId, interceptorScriptId, allIds };
}

export function collectServiceMatchPatterns(
  service: ServicePlugin,
  customMirrors: readonly string[] = []
): string[] {
  const patterns: string[] = [];
  const seen = new Set<string>();

  const addPattern = (p: string): void => {
    const trimmed = p.trim();
    if (!trimmed || isForbiddenGlobalPattern(trimmed) || seen.has(trimmed)) return;
    seen.add(trimmed);
    patterns.push(trimmed);
  };

  for (const hostMatch of service.hostMatches) {
    addPattern(hostMatch);
  }
  if (service.playerIframeMatches) {
    for (const iframeMatch of service.playerIframeMatches) {
      addPattern(iframeMatch);
    }
  }
  if (service.capabilities.dynamicModule) {
    for (const mirror of customMirrors) {
      for (const normalized of normalizeMirrorToMatchPatterns(mirror)) {
        addPattern(normalized);
      }
    }
  }

  return patterns;
}

export interface ModuleManager {
  getServices(): readonly ServicePlugin[];
  getServiceMatchPatterns(serviceId: string, customMirrors?: readonly string[]): string[];
  requestServicePermissions(serviceId: string): Promise<boolean>;
  hasServicePermissions(serviceId: string): Promise<boolean>;
  isServiceScriptRegistered(serviceId: string): Promise<boolean>;
  enableService(serviceId: string): Promise<{ success: boolean; error?: string }>;
  disableService(serviceId: string): Promise<{ success: boolean }>;
  getServiceStatus(serviceId: string): Promise<ServiceModuleStatus>;
  getAllServiceStatuses(): Promise<Record<string, ServiceModuleStatus>>;
  syncAllServices(): Promise<Record<string, ServiceModuleStatus>>;
  reinjectStaticServices(): Promise<void>;
}

export function createModuleManager(services: readonly ServicePlugin[]): ModuleManager {
  const serviceMap = new Map<string, ServicePlugin>(services.map((s) => [s.id, s]));

  async function getGrantedPatternsForService(
    service: ServicePlugin,
    customMirrors: readonly string[]
  ): Promise<string[]> {
    const desired = collectServiceMatchPatterns(service, customMirrors);
    if (desired.length === 0) return [];
    if (typeof chrome === 'undefined' || !chrome.permissions?.contains) {
      return [];
    }

    try {
      const hasAll = await chrome.permissions.contains({ origins: desired });
      if (hasAll) {
        return desired;
      }
    } catch {
      // Fall through to per-origin checks
    }

    const granted: string[] = [];
    for (const origin of desired) {
      if (isForbiddenGlobalPattern(origin)) continue;
      try {
        const ok = await chrome.permissions.contains({ origins: [origin] });
        if (ok) {
          granted.push(origin);
        }
      } catch {
        // Ignore invalid origin checks
      }
    }
    return granted;
  }

  async function unregisterServiceScripts(service: ServicePlugin): Promise<void> {
    if (typeof chrome === 'undefined' || !chrome.scripting?.unregisterContentScripts) {
      return;
    }
    const { allIds } = getScriptIdsForService(service);
    try {
      await chrome.scripting.unregisterContentScripts({ ids: allIds });
    } catch {
      // Ignore if scripts were not registered
    }
  }

  async function registerServiceScripts(
    service: ServicePlugin,
    matches: readonly string[]
  ): Promise<void> {
    if (typeof chrome === 'undefined' || !chrome.scripting?.registerContentScripts) {
      throw new Error('chrome.scripting not supported');
    }

    const safeMatches = matches.filter((m) => !isForbiddenGlobalPattern(m));
    if (safeMatches.length === 0) {
      throw new Error(`No valid non-global host patterns for service "${service.id}"`);
    }

    await unregisterServiceScripts(service);

    const { contentScriptId, interceptorScriptId } = getScriptIdsForService(service);
    const { contentScriptPath, mainWorldInterceptorPath } = getBundlePathsForService(service);
    const allFrames = Boolean(service.allFrames);

    const scripts: chrome.scripting.RegisteredContentScript[] = [];
    if (interceptorScriptId && mainWorldInterceptorPath) {
      scripts.push({
        id: interceptorScriptId,
        js: [mainWorldInterceptorPath],
        matches: safeMatches,
        world: 'MAIN',
        runAt: 'document_start',
        allFrames,
        persistAcrossSessions: true
      });
    }

    scripts.push({
      id: contentScriptId,
      js: [contentScriptPath],
      matches: safeMatches,
      world: 'ISOLATED',
      runAt: 'document_idle',
      allFrames,
      persistAcrossSessions: true
    });

    await chrome.scripting.registerContentScripts(scripts);
  }

  async function hasServicePermissions(serviceId: string): Promise<boolean> {
    const service = serviceMap.get(serviceId);
    if (!service) return false;
    if (!service.capabilities.dynamicModule) return true;

    const settings = await getSettings();
    const granted = await getGrantedPatternsForService(service, settings.customMirrors);
    return granted.length > 0;
  }

  async function isServiceScriptRegistered(serviceId: string): Promise<boolean> {
    const service = serviceMap.get(serviceId);
    if (!service) return false;
    if (!service.capabilities.dynamicModule) return true;
    if (typeof chrome === 'undefined' || !chrome.scripting?.getRegisteredContentScripts) {
      return false;
    }

    const { allIds } = getScriptIdsForService(service);
    try {
      const scripts = await chrome.scripting.getRegisteredContentScripts({ ids: allIds });
      return scripts.length > 0;
    } catch {
      return false;
    }
  }

  async function requestServicePermissions(serviceId: string): Promise<boolean> {
    const service = serviceMap.get(serviceId);
    if (!service) return false;
    if (!service.capabilities.dynamicModule) return true;
    if (typeof chrome === 'undefined' || !chrome.permissions?.request) {
      return false;
    }

    const settings = await getSettings();
    const targets = collectServiceMatchPatterns(service, settings.customMirrors);
    if (targets.length === 0) return false;

    try {
      return await chrome.permissions.request({ origins: targets });
    } catch {
      return false;
    }
  }

  async function enableService(
    serviceId: string
  ): Promise<{ success: boolean; error?: string }> {
    const service = serviceMap.get(serviceId);
    if (!service) {
      return { success: false, error: `Unknown service: ${serviceId}` };
    }

    const settings = await getSettings();

    if (!service.capabilities.dynamicModule) {
      await saveSettings({
        enabledServices: {
          ...settings.enabledServices,
          [service.id]: true
        }
      });
      return { success: true };
    }

    const grantedMatches = await getGrantedPatternsForService(
      service,
      settings.customMirrors
    );
    if (grantedMatches.length === 0) {
      return {
        success: false,
        error: `Host permissions not granted for service "${service.id}"`
      };
    }

    try {
      await registerServiceScripts(service, grantedMatches);
      await saveSettings({
        enabledServices: {
          ...settings.enabledServices,
          [service.id]: true
        }
      });
      return { success: true };
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : `Failed to register scripts for ${service.id}`;
      return { success: false, error: message };
    }
  }

  async function disableService(serviceId: string): Promise<{ success: boolean }> {
    const service = serviceMap.get(serviceId);
    if (service?.capabilities.dynamicModule) {
      await unregisterServiceScripts(service);
    }

    const settings = await getSettings();
    await saveSettings({
      enabledServices: {
        ...settings.enabledServices,
        [serviceId]: false
      }
    });
    return { success: true };
  }

  async function getServiceStatus(serviceId: string): Promise<ServiceModuleStatus> {
    const service = serviceMap.get(serviceId);
    const settings = await getSettings();
    if (!service) {
      return {
        serviceId,
        enabled: false,
        hasPermission: false,
        registered: false
      };
    }

    if (!service.capabilities.dynamicModule) {
      return {
        serviceId: service.id,
        enabled: settings.enabledServices?.[service.id] !== false,
        hasPermission: true,
        registered: true
      };
    }

    const hasPermission = await hasServicePermissions(service.id);
    const registered = await isServiceScriptRegistered(service.id);
    return {
      serviceId: service.id,
      enabled: Boolean(settings.enabledServices?.[service.id]),
      hasPermission,
      registered
    };
  }

  async function syncAllServices(): Promise<Record<string, ServiceModuleStatus>> {
    const settings = await getSettings();
    const enabledMap = { ...settings.enabledServices };
    let settingsDirty = false;
    const statuses: Record<string, ServiceModuleStatus> = {};

    for (const service of services) {
      if (!service.capabilities.dynamicModule) {
        statuses[service.id] = {
          serviceId: service.id,
          enabled: enabledMap[service.id] !== false,
          hasPermission: true,
          registered: true
        };
        continue;
      }

      const wantEnabled = Boolean(enabledMap[service.id]);
      const grantedMatches = await getGrantedPatternsForService(
        service,
        settings.customMirrors
      );
      const hasPermission = grantedMatches.length > 0;
      let registered = await isServiceScriptRegistered(service.id);

      if (wantEnabled) {
        if (hasPermission) {
          try {
            await registerServiceScripts(service, grantedMatches);
            registered = true;
          } catch {
            registered = false;
          }
          statuses[service.id] = {
            serviceId: service.id,
            enabled: true,
            hasPermission: true,
            registered
          };
        } else {
          await unregisterServiceScripts(service);
          enabledMap[service.id] = false;
          settingsDirty = true;
          statuses[service.id] = {
            serviceId: service.id,
            enabled: false,
            hasPermission: false,
            registered: false
          };
        }
      } else {
        if (registered) {
          await unregisterServiceScripts(service);
          registered = false;
        }
        statuses[service.id] = {
          serviceId: service.id,
          enabled: false,
          hasPermission,
          registered
        };
      }
    }

    if (settingsDirty) {
      await saveSettings({ enabledServices: enabledMap });
    }

    return statuses;
  }

  async function getAllServiceStatuses(): Promise<Record<string, ServiceModuleStatus>> {
    const result: Record<string, ServiceModuleStatus> = {};
    for (const service of services) {
      result[service.id] = await getServiceStatus(service.id);
    }
    return result;
  }

  async function reinjectStaticServices(): Promise<void> {
    if (
      typeof chrome === 'undefined' ||
      !chrome.tabs?.query ||
      !chrome.scripting?.executeScript
    ) {
      return;
    }

    for (const service of services) {
      if (service.capabilities.dynamicModule) continue;
      const urlPatterns = service.hostMatches.filter((m) => !isForbiddenGlobalPattern(m));
      if (urlPatterns.length === 0) continue;

      const { contentScriptPath, mainWorldInterceptorPath } =
        getBundlePathsForService(service);

      try {
        const tabs = await chrome.tabs.query({ url: urlPatterns });
        for (const tab of tabs) {
          if (typeof tab.id !== 'number') continue;
          if (mainWorldInterceptorPath) {
            try {
              await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                world: 'MAIN',
                files: [mainWorldInterceptorPath]
              });
            } catch {
              // Ignore restricted or unloaded tabs
            }
          }
          try {
            await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              world: 'ISOLATED',
              files: [contentScriptPath]
            });
          } catch {
            // Ignore restricted or unloaded tabs
          }
        }
      } catch {
        // Ignore tab query errors
      }
    }
  }

  return {
    getServices: () => services,
    getServiceMatchPatterns: (serviceId: string, customMirrors?: readonly string[]) => {
      const svc = serviceMap.get(serviceId);
      return svc ? collectServiceMatchPatterns(svc, customMirrors) : [];
    },
    requestServicePermissions,
    hasServicePermissions,
    isServiceScriptRegistered,
    enableService,
    disableService,
    getServiceStatus,
    getAllServiceStatuses,
    syncAllServices,
    reinjectStaticServices
  };
}
