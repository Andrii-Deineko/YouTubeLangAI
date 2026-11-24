import { getSettings, saveSettings } from '../storage/storage';

export const CINEMA_INTERCEPTOR_SCRIPT_ID = 'cinema-interceptor';
export const CINEMA_CONTENT_SCRIPT_ID = 'cinema-content';

export async function hasCinemaPermissions(): Promise<boolean> {
  if (typeof chrome === 'undefined' || !chrome.permissions?.contains) {
    return false;
  }
  try {
    const hasBroad = await chrome.permissions.contains({
      origins: ['https://*/*', 'http://*/*']
    });
    if (hasBroad) return true;

    // Check if user has granted permissions for specific origins
    const all = await chrome.permissions.getAll();
    const origins = all.origins ?? [];
    return origins.some((o) => o.includes('*://') || o.includes('https://') || o.includes('http://'));
  } catch {
    return false;
  }
}

export async function isCinemaScriptRegistered(): Promise<boolean> {
  if (typeof chrome === 'undefined' || !chrome.scripting?.getRegisteredContentScripts) {
    return false;
  }
  try {
    const scripts = await chrome.scripting.getRegisteredContentScripts({
      ids: [CINEMA_INTERCEPTOR_SCRIPT_ID, CINEMA_CONTENT_SCRIPT_ID]
    });
    return scripts.length > 0;
  } catch {
    return false;
  }
}

export async function registerCinemaScripts(): Promise<{ success: boolean; error?: string }> {
  if (typeof chrome === 'undefined' || !chrome.scripting?.registerContentScripts) {
    return { success: false, error: 'chrome.scripting not supported' };
  }

  try {
    // Clean existing registrations if any
    await unregisterCinemaScripts();

    const all = await chrome.permissions.getAll();
    const origins = all.origins ?? [];
    const hasBroad = origins.some(
      (o) => o === '<all_urls>' || o === 'https://*/*' || o === '*://*/*'
    );
    const validOrigins = origins.filter(
      (o) => o.startsWith('http://') || o.startsWith('https://') || o.startsWith('*://')
    );
    const matches = hasBroad
      ? ['https://*/*', 'http://*/*']
      : validOrigins.length > 0
        ? validOrigins
        : ['https://*/*', 'http://*/*'];

    await chrome.scripting.registerContentScripts([
      {
        id: CINEMA_INTERCEPTOR_SCRIPT_ID,
        js: ['assets/interceptor-cinema.js'],
        matches,
        world: 'MAIN',
        runAt: 'document_start',
        allFrames: true,
        persistAcrossSessions: true
      },
      {
        id: CINEMA_CONTENT_SCRIPT_ID,
        js: ['assets/content-cinema.js'],
        matches,
        world: 'ISOLATED',
        runAt: 'document_idle',
        allFrames: true,
        persistAcrossSessions: true
      }
    ]);

    await saveSettings({ cinemaModuleEnabled: true });
    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to register cinema scripts';
    console.warn('[Module Manager] Error registering cinema scripts:', message);
    return { success: false, error: message };
  }
}

export async function unregisterCinemaScripts(): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.scripting?.unregisterContentScripts) {
    return;
  }
  try {
    await chrome.scripting.unregisterContentScripts({
      ids: [CINEMA_INTERCEPTOR_SCRIPT_ID, CINEMA_CONTENT_SCRIPT_ID]
    });
  } catch {
    // Ignore error if not registered
  }
}

export async function disableCinemaModule(): Promise<{ success: boolean }> {
  await unregisterCinemaScripts();
  await saveSettings({ cinemaModuleEnabled: false });
  return { success: true };
}

export async function syncCinemaModuleState(): Promise<{
  enabled: boolean;
  registered: boolean;
}> {
  try {
    const settings = await getSettings();
    const hasPerms = await hasCinemaPermissions();
    const isRegistered = await isCinemaScriptRegistered();

    if (settings.cinemaModuleEnabled) {
      if (hasPerms) {
        if (!isRegistered) {
          await registerCinemaScripts();
        }
        return { enabled: true, registered: true };
      } else {
        // Permission was revoked by user in chrome://extensions
        await unregisterCinemaScripts();
        await saveSettings({ cinemaModuleEnabled: false });
        return { enabled: false, registered: false };
      }
    } else {
      if (isRegistered) {
        await unregisterCinemaScripts();
      }
      return { enabled: false, registered: false };
    }
  } catch (err) {
    console.warn('[Module Manager] Error syncing cinema module state:', err);
    return { enabled: false, registered: false };
  }
}
