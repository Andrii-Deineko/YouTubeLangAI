import type { TranslationProvider } from '@langai/contracts';

export const COOLDOWN_MS = 60_000;
export const DEEPL_QUOTA_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const COOLDOWN_STORAGE_KEY = 'langai_translator_cooldowns';

type CooldownMap = Record<string, number>;

const memoryCooldowns = new Map<string, number>();
let hydrated = false;
let hydratePromise: Promise<void> | null = null;

interface SessionStorageAreaLike {
  get(keys: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove?(keys: string | string[]): Promise<void>;
}

function getSessionStorage(): SessionStorageAreaLike | null {
  try {
    const storage = globalThis.chrome?.storage?.session;
    if (storage && typeof storage.get === 'function' && typeof storage.set === 'function') {
      return storage;
    }
  } catch {
    // Ignore environments without chrome.storage.session
  }
  return null;
}

function pruneExpired(now = Date.now()): CooldownMap {
  const active: CooldownMap = {};
  for (const [key, until] of memoryCooldowns.entries()) {
    if (typeof until === 'number' && Number.isFinite(until) && until > now) {
      active[key] = until;
    } else {
      memoryCooldowns.delete(key);
    }
  }
  return active;
}

async function ensureHydrated(): Promise<void> {
  if (hydrated) return;
  if (hydratePromise) {
    await hydratePromise;
    return;
  }

  hydratePromise = (async () => {
    const session = getSessionStorage();
    if (!session) {
      hydrated = true;
      return;
    }
    try {
      const result = await session.get(COOLDOWN_STORAGE_KEY);
      const raw = result[COOLDOWN_STORAGE_KEY];
      if (raw && typeof raw === 'object') {
        const now = Date.now();
        for (const [provider, until] of Object.entries(raw as Record<string, unknown>)) {
          if (typeof until === 'number' && Number.isFinite(until) && until > now) {
            const existing = memoryCooldowns.get(provider) ?? 0;
            if (until > existing) {
              memoryCooldowns.set(provider, until);
            }
          }
        }
      }
    } catch {
      // Fallback to in-memory cooldowns
    } finally {
      hydrated = true;
      hydratePromise = null;
    }
  })();

  await hydratePromise;
}

async function persistCooldowns(): Promise<void> {
  const session = getSessionStorage();
  if (!session) return;
  try {
    const active = pruneExpired();
    if (Object.keys(active).length === 0 && typeof session.remove === 'function') {
      await session.remove(COOLDOWN_STORAGE_KEY);
    } else {
      await session.set({ [COOLDOWN_STORAGE_KEY]: active });
    }
  } catch {
    // Ignore storage persistence failures; in-memory state remains active
  }
}

export async function getProviderPausedUntil(
  provider: TranslationProvider | string
): Promise<number> {
  await ensureHydrated();
  const until = memoryCooldowns.get(provider) ?? 0;
  if (until <= Date.now()) {
    memoryCooldowns.delete(provider);
    return 0;
  }
  return until;
}

export async function isProviderPaused(
  provider: TranslationProvider | string
): Promise<boolean> {
  return (await getProviderPausedUntil(provider)) > Date.now();
}

export async function setProviderCooldown(
  provider: TranslationProvider | string,
  durationMs: number = COOLDOWN_MS
): Promise<number> {
  await ensureHydrated();
  const until = Date.now() + Math.max(0, durationMs);
  memoryCooldowns.set(provider, until);
  await persistCooldowns();
  return until;
}

export async function clearProviderCooldowns(
  provider?: TranslationProvider | string
): Promise<void> {
  hydrated = true;
  if (provider) {
    memoryCooldowns.delete(provider);
  } else {
    memoryCooldowns.clear();
  }
  await persistCooldowns();
}

/**
 * Resets internal hydration state for unit tests simulating service worker restarts.
 */
export function resetCooldownHydrationForTest(): void {
  memoryCooldowns.clear();
  hydrated = false;
  hydratePromise = null;
}
