import { useEffect, useState, type ReactElement } from 'react';
import { AlertCircle, Film, Globe, Loader2, Play, ShieldCheck } from 'lucide-react';
import {
  POPUP_SCALE_OPTIONS,
  type AllServiceStatusesResponse,
  type RuntimeRequest,
  type RuntimeResponse,
  type ServiceDescriptor,
  type ServiceModuleStatus,
  type UserSettings
} from '@langai/contracts';
import { getUiStrings } from '../../i18n/translations';
import { ToggleSwitch } from '../ToggleSwitch';
import {
  accentBtnStyle,
  activePillStyle,
  innerCardStyle,
  mutedTextStyle,
  primaryTextStyle,
  sectionCardStyle,
  segmentedTrackStyle
} from './styles';

export interface GeneralTabProps {
  settings: UserSettings;
  services: readonly ServiceDescriptor[];
  onUpdateSettings: (partial: Partial<UserSettings>) => Promise<void>;
}

const CATCH_ALL_PATTERNS = new Set(['<all_urls>', '*://*/*', 'https://*/*', 'http://*/*']);

function normalizeHostname(input: string): string {
  let str = input.trim().toLowerCase();
  if (str.includes('://')) {
    try {
      str = new URL(str).hostname;
    } catch {
      str = str.replace(/^[a-z]+:\/\//, '');
    }
  }
  str = str.split('/')[0]?.split('?')[0]?.split('#')[0]?.split(':')[0] ?? '';
  if (str.startsWith('www.')) {
    str = str.slice(4);
  }
  return str.trim();
}

function isCatchAllService(svc: ServiceDescriptor): boolean {
  return (
    svc.hostMatches.length === 0 ||
    svc.hostMatches.some((pattern) => CATCH_ALL_PATTERNS.has(pattern.trim()))
  );
}

function matchesServiceHost(hostname: string, svc: ServiceDescriptor): boolean {
  const cleanHost = normalizeHostname(hostname);
  if (!cleanHost) return false;
  for (const pattern of svc.hostMatches) {
    if (CATCH_ALL_PATTERNS.has(pattern.trim())) continue;
    const rawHost = pattern
      .replace(/^(?:\*|https?):\/\//i, '')
      .split('/')[0]
      ?.replace(/^\*\./, '')
      .toLowerCase();
    if (!rawHost) continue;
    if (cleanHost === rawHost || cleanHost.endsWith(`.${rawHost}`)) {
      return true;
    }
  }
  return false;
}

function formatServiceHosts(svc: ServiceDescriptor): string {
  const labels: string[] = [];
  for (const pattern of svc.hostMatches) {
    if (CATCH_ALL_PATTERNS.has(pattern.trim())) continue;
    const host = pattern
      .replace(/^(?:\*|https?):\/\//i, '')
      .split('/')[0]
      ?.replace(/^\*\./, '');
    if (host && !labels.includes(host)) {
      labels.push(host);
    }
  }
  return labels.slice(0, 3).join(', ');
}

function hasChromeRuntime(): boolean {
  return typeof chrome !== 'undefined' && typeof chrome.runtime?.sendMessage === 'function';
}

function sendRuntime<TRes>(request: RuntimeRequest): Promise<TRes> {
  return new Promise((resolve, reject) => {
    if (!hasChromeRuntime()) {
      reject(new Error('Extension runtime unavailable'));
      return;
    }
    chrome.runtime.sendMessage(request, (res: TRes | undefined) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!res) {
        reject(new Error('No response from service worker'));
        return;
      }
      resolve(res);
    });
  });
}

export function GeneralTab({
  settings,
  services,
  onUpdateSettings
}: GeneralTabProps): ReactElement {
  const t = getUiStrings(settings.uiLanguage);

  const [serviceStatuses, setServiceStatuses] = useState<Record<string, ServiceModuleStatus>>({});
  const [busyServiceId, setBusyServiceId] = useState<string | null>(null);
  const [serviceErrors, setServiceErrors] = useState<Record<string, string>>({});

  const [currentSiteHostname, setCurrentSiteHostname] = useState('');
  const [hasCurrentSitePermission, setHasCurrentSitePermission] = useState(false);
  const [enablingCurrentSite, setEnablingCurrentSite] = useState(false);
  const [currentSiteError, setCurrentSiteError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    if (hasChromeRuntime()) {
      void sendRuntime<AllServiceStatusesResponse>({ type: 'GET_ALL_SERVICE_STATUSES' })
        .then((res) => {
          if (active && res.ok) {
            setServiceStatuses(res.data);
          }
        })
        .catch(() => undefined);
    }

    if (typeof chrome !== 'undefined' && typeof chrome.tabs?.query === 'function') {
      chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
        if (!active || !tabs[0]?.url) return;
        try {
          const urlObj = new URL(tabs[0].url);
          if (urlObj.protocol === 'http:' || urlObj.protocol === 'https:') {
            const host = urlObj.hostname;
            setCurrentSiteHostname(host);
            if (typeof chrome.permissions?.contains === 'function') {
              const cleanHost = normalizeHostname(host);
              const hasBroad = await chrome.permissions.contains({ origins: ['https://*/*'] });
              const hasOrigin =
                hasBroad ||
                (await chrome.permissions.contains({ origins: [`${urlObj.origin}/*`] }));
              const hasSpecific =
                hasOrigin ||
                (await chrome.permissions.contains({ origins: [`*://${cleanHost}/*`] }));
              if (active) setHasCurrentSitePermission(hasSpecific);
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

  const handleToggleService = async (
    svc: ServiceDescriptor,
    checked: boolean
  ): Promise<void> => {
    setBusyServiceId(svc.id);
    setServiceErrors((prev) => {
      const next = { ...prev };
      delete next[svc.id];
      return next;
    });

    try {
      if (checked) {
        const origins =
          svc.hostMatches.length > 0 ? [...svc.hostMatches] : ['https://*/*', 'http://*/*'];
        const granted =
          typeof chrome !== 'undefined' && typeof chrome.permissions?.request === 'function'
            ? await chrome.permissions.request({ origins })
            : true;

        if (!granted) {
          setServiceErrors((prev) => ({
            ...prev,
            [svc.id]: t.servicePermissionDenied(svc.name)
          }));
          return;
        }

        if (hasChromeRuntime()) {
          const res = await sendRuntime<RuntimeResponse<unknown>>({
            type: 'ENABLE_SERVICE_MODULE',
            payload: { serviceId: svc.id }
          });
          if (!res.ok) {
            throw new Error(res.error);
          }
        }

        await onUpdateSettings({
          enabledServices: {
            ...settings.enabledServices,
            [svc.id]: true
          }
        });

        setServiceStatuses((prev) => ({
          ...prev,
          [svc.id]: {
            serviceId: svc.id,
            enabled: true,
            hasPermission: true,
            registered: true
          }
        }));

        if (hasChromeRuntime()) {
          void sendRuntime<RuntimeResponse<unknown>>({
            type: 'INJECT_MAIN_INTERCEPTOR',
            payload: { serviceId: svc.id }
          }).catch(() => undefined);
        }
      } else {
        if (hasChromeRuntime()) {
          const res = await sendRuntime<RuntimeResponse<unknown>>({
            type: 'DISABLE_SERVICE_MODULE',
            payload: { serviceId: svc.id }
          });
          if (!res.ok) {
            throw new Error(res.error);
          }
        }

        await onUpdateSettings({
          enabledServices: {
            ...settings.enabledServices,
            [svc.id]: false
          }
        });

        setServiceStatuses((prev) => ({
          ...prev,
          [svc.id]: {
            serviceId: svc.id,
            enabled: false,
            hasPermission: prev[svc.id]?.hasPermission ?? true,
            registered: false
          }
        }));
      }
    } catch (err: unknown) {
      setServiceErrors((prev) => ({
        ...prev,
        [svc.id]: err instanceof Error ? err.message : t.serviceToggleFailed(svc.name)
      }));
    } finally {
      setBusyServiceId(null);
    }
  };

  const builtInMatched =
    Boolean(currentSiteHostname) &&
    services.some(
      (svc) => !svc.capabilities.dynamicModule && matchesServiceHost(currentSiteHostname, svc)
    );

  const dynamicCatchAllService = services.find(
    (svc) => svc.capabilities.dynamicModule && isCatchAllService(svc)
  );
  const dynamicMatchedService = currentSiteHostname
    ? services.find(
        (svc) => svc.capabilities.dynamicModule && matchesServiceHost(currentSiteHostname, svc)
      ) ?? dynamicCatchAllService
    : undefined;

  const showCurrentSiteCard = Boolean(
    currentSiteHostname && !builtInMatched && dynamicMatchedService
  );

  const handleEnableCurrentSite = async (): Promise<void> => {
    if (!currentSiteHostname || !dynamicMatchedService) return;
    setEnablingCurrentSite(true);
    setCurrentSiteError(null);
    try {
      const cleanHost = normalizeHostname(currentSiteHostname);
      const isIpOrLocal =
        cleanHost === 'localhost' || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(cleanHost);
      const requestOrigins = isIpOrLocal
        ? [`*://${cleanHost}/*`]
        : [`*://*.${cleanHost}/*`, `*://${cleanHost}/*`];

      const granted =
        typeof chrome !== 'undefined' && typeof chrome.permissions?.request === 'function'
          ? await chrome.permissions.request({ origins: requestOrigins })
          : true;

      if (!granted) {
        setCurrentSiteError(t.sitePermissionDenied(currentSiteHostname));
        return;
      }

      setHasCurrentSitePermission(true);

      const nextCustomMirrors = [...(settings.customMirrors ?? [])];
      const blacklisted = settings.blacklistedDomains ?? [];
      if (
        cleanHost &&
        !nextCustomMirrors.includes(cleanHost) &&
        !blacklisted.some((d) => cleanHost === d || cleanHost.endsWith(`.${d}`))
      ) {
        nextCustomMirrors.push(cleanHost);
      }

      if (hasChromeRuntime()) {
        const res = await sendRuntime<RuntimeResponse<unknown>>({
          type: 'ENABLE_SERVICE_MODULE',
          payload: { serviceId: dynamicMatchedService.id }
        });
        if (!res.ok) {
          throw new Error(res.error);
        }
      }

      await onUpdateSettings({
        enabledServices: {
          ...settings.enabledServices,
          [dynamicMatchedService.id]: true
        },
        customMirrors: nextCustomMirrors
      });

      setServiceStatuses((prev) => ({
        ...prev,
        [dynamicMatchedService.id]: {
          serviceId: dynamicMatchedService.id,
          enabled: true,
          hasPermission: true,
          registered: true
        }
      }));

      if (hasChromeRuntime()) {
        void sendRuntime<RuntimeResponse<unknown>>({
          type: 'INJECT_MAIN_INTERCEPTOR',
          payload: { serviceId: dynamicMatchedService.id }
        }).catch(() => undefined);
      }
    } catch (err: unknown) {
      setCurrentSiteError(
        err instanceof Error
          ? err.message
          : t.serviceToggleFailed(dynamicMatchedService.name)
      );
    } finally {
      setEnablingCurrentSite(false);
    }
  };

  return (
    <>
      {/* App Language + Widget Zoom */}
      <section className="space-y-2.5 rounded-2xl border p-3" style={sectionCardStyle}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <Globe className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--ytai-accent)' }} />
            <span className="truncate font-semibold" style={primaryTextStyle}>
              {t.appLanguageTitle}
            </span>
          </div>
          <div
            className="grid shrink-0 grid-cols-2 gap-1 rounded-xl border p-0.5"
            style={segmentedTrackStyle}
          >
            {(
              [
                { id: 'en' as const, label: 'English' },
                { id: 'uk' as const, label: 'Українська' }
              ] as const
            ).map((opt) => {
              const active = (settings.uiLanguage ?? 'en') === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => void onUpdateSettings({ uiLanguage: opt.id })}
                  style={active ? accentBtnStyle : mutedTextStyle}
                  className={`rounded-lg px-2.5 py-1 text-[0.6875rem] font-semibold transition cursor-pointer ${
                    active ? 'shadow-sm' : 'hover:bg-[rgba(var(--ytai-accent-rgb),0.14)]'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        <div
          className="flex items-center justify-between gap-2 border-t pt-2.5"
          style={{ borderColor: 'var(--ytai-border)' }}
        >
          <span className="truncate font-semibold" style={primaryTextStyle}>
            {t.popupScaleTitle}
          </span>
          <div
            className="grid shrink-0 grid-cols-4 gap-1 rounded-xl border p-0.5"
            style={segmentedTrackStyle}
          >
            {POPUP_SCALE_OPTIONS.map((scaleVal) => {
              const active = Math.abs((settings.popupScale ?? 1) - scaleVal) < 0.01;
              return (
                <button
                  key={scaleVal}
                  type="button"
                  onClick={() => void onUpdateSettings({ popupScale: scaleVal })}
                  style={active ? activePillStyle : mutedTextStyle}
                  className={`rounded-lg px-2 py-1 font-mono text-[0.625rem] transition cursor-pointer ${
                    active ? 'font-bold shadow-sm' : 'hover:bg-[rgba(var(--ytai-accent-rgb),0.14)]'
                  }`}
                >
                  {Math.round(scaleVal * 100)}%
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* Dynamic Platform Modules */}
      <section className="space-y-2 rounded-2xl border p-3" style={sectionCardStyle}>
        <div className="flex items-center justify-between">
          <span
            className="text-[0.6875rem] font-semibold uppercase tracking-wider"
            style={mutedTextStyle}
          >
            {t.platformModules}
          </span>
          <span className="text-[0.625rem]" style={mutedTextStyle}>
            {t.modularSystem}
          </span>
        </div>

        {services.map((svc) => {
          const status = serviceStatuses[svc.id];
          const isDynamic = svc.capabilities.dynamicModule;
          const isEnabled = isDynamic
            ? Boolean(settings.enabledServices?.[svc.id] ?? status?.enabled ?? false)
            : true;
          const isBusy = busyServiceId === svc.id;
          const svcError = serviceErrors[svc.id];
          const hostSummary = formatServiceHosts(svc);

          return (
            <div key={svc.id} className="space-y-2 rounded-xl border p-2.5" style={innerCardStyle}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2.5">
                  <div
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border"
                    style={{
                      backgroundColor: 'rgba(var(--ytai-accent-rgb), 0.16)',
                      borderColor: 'rgba(var(--ytai-accent-rgb), 0.35)',
                      color: 'var(--ytai-accent)'
                    }}
                  >
                    {isDynamic ? (
                      <Film className="h-4 w-4" />
                    ) : (
                      <Play className="h-4 w-4 fill-current" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate font-semibold" style={primaryTextStyle}>
                        {svc.name}
                      </span>
                      {isEnabled ? (
                        <span
                          title={status?.registered ? `${svc.name} registered` : undefined}
                          className="inline-flex shrink-0 items-center gap-1 rounded border border-emerald-500/30 bg-emerald-500/15 px-1.5 py-0.5 text-[0.625rem] font-semibold text-emerald-400"
                        >
                          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                          {isDynamic ? t.activeBadge : t.builtInBadge}
                        </span>
                      ) : (
                        <span
                          className="shrink-0 rounded border px-1.5 py-0.5 text-[0.625rem]"
                          style={{
                            backgroundColor: 'var(--ytai-control-bg)',
                            borderColor: 'var(--ytai-border)',
                            color: 'var(--ytai-text-muted, var(--ytai-text-secondary))'
                          }}
                        >
                          {t.disabledBadge}
                        </span>
                      )}
                    </div>
                    <p className="truncate text-[0.625rem]" style={mutedTextStyle}>
                      {isDynamic ? t.dynamicServiceDesc(hostSummary) : t.builtInServiceDesc}
                    </p>
                  </div>
                </div>

                {isDynamic && (
                  <ToggleSwitch
                    checked={isEnabled}
                    disabled={isBusy}
                    onChange={(checked) => void handleToggleService(svc, checked)}
                  />
                )}
              </div>

              {svcError && (
                <div className="flex items-center gap-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 p-2 text-[0.625rem] text-rose-300">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  <span>{svcError}</span>
                </div>
              )}
            </div>
          );
        })}

        {showCurrentSiteCard && dynamicMatchedService && (
          <div
            className="space-y-2 rounded-xl border p-2.5"
            style={{
              backgroundColor: 'rgba(var(--ytai-accent-rgb), 0.12)',
              borderColor: 'rgba(var(--ytai-accent-rgb), 0.3)'
            }}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div
                  className="flex items-center gap-1.5 text-[0.6875rem] font-medium"
                  style={primaryTextStyle}
                >
                  <Globe className="h-3 w-3 shrink-0" style={{ color: 'var(--ytai-accent)' }} />
                  <span className="truncate">{currentSiteHostname}</span>
                </div>
                <div className="text-[0.625rem]" style={mutedTextStyle}>
                  {hasCurrentSitePermission ? t.siteAllowed : t.siteNeedsPerm}
                </div>
              </div>

              <button
                type="button"
                disabled={enablingCurrentSite}
                onClick={() => void handleEnableCurrentSite()}
                style={accentBtnStyle}
                className="flex shrink-0 items-center gap-1 rounded-md px-2.5 py-1 text-[0.625rem] font-semibold shadow transition hover:opacity-90 disabled:opacity-50 cursor-pointer"
              >
                {enablingCurrentSite ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <ShieldCheck className="h-3 w-3" />
                )}
                <span>{hasCurrentSitePermission ? t.restartScript : t.enableOnSite}</span>
              </button>
            </div>

            {currentSiteError && (
              <div className="flex items-center gap-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 p-2 text-[0.625rem] text-rose-300">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                <span>{currentSiteError}</span>
              </div>
            )}
          </div>
        )}
      </section>
    </>
  );
}
