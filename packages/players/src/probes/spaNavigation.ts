type NavigationListener = (pathKey: string) => void;

const navListeners = new Set<NavigationListener>();
let uninstallHistoryHooks: (() => void) | null = null;
let lastPathKey = '';

function getCurrentPathKey(): string {
  if (typeof window === 'undefined') return '';
  return `${window.location.pathname}${window.location.search}`;
}

function checkAndNotifyNavigation(): void {
  const nextKey = getCurrentPathKey();
  if (nextKey === lastPathKey) return;
  lastPathKey = nextKey;
  navListeners.forEach((listener) => {
    try {
      listener(nextKey);
    } catch {
      // Ignore individual listener errors
    }
  });
}

function installHistoryHooks(): () => void {
  if (typeof window === 'undefined' || typeof history === 'undefined') {
    return () => {};
  }

  lastPathKey = getCurrentPathKey();
  let origPushState: History['pushState'] | null = null;
  let origReplaceState: History['replaceState'] | null = null;
  let wrappedPushState: History['pushState'] | null = null;
  let wrappedReplaceState: History['replaceState'] | null = null;

  try {
    origPushState = history.pushState.bind(history);
    origReplaceState = history.replaceState.bind(history);
    const pushRef = origPushState;
    const replaceRef = origReplaceState;

    wrappedPushState = (...args: Parameters<History['pushState']>): void => {
      pushRef(...args);
      checkAndNotifyNavigation();
    };
    wrappedReplaceState = (...args: Parameters<History['replaceState']>): void => {
      replaceRef(...args);
      checkAndNotifyNavigation();
    };

    history.pushState = wrappedPushState;
    history.replaceState = wrappedReplaceState;
  } catch {
    // Ignore read-only history properties
  }

  window.addEventListener('popstate', checkAndNotifyNavigation);

  return () => {
    window.removeEventListener('popstate', checkAndNotifyNavigation);
    try {
      if (origPushState && wrappedPushState && history.pushState === wrappedPushState) {
        history.pushState = origPushState;
      }
      if (origReplaceState && wrappedReplaceState && history.replaceState === wrappedReplaceState) {
        history.replaceState = origReplaceState;
      }
    } catch {
      // Ignore restore errors
    }
  };
}

/**
 * Subscribes a main-world probe to ref-counted SPA navigation events (`pushState`, `replaceState`, `popstate`).
 */
export function subscribeSpaNavigation(listener: NavigationListener): () => void {
  navListeners.add(listener);
  if (!uninstallHistoryHooks) {
    uninstallHistoryHooks = installHistoryHooks();
  }

  return () => {
    navListeners.delete(listener);
    if (navListeners.size === 0 && uninstallHistoryHooks) {
      uninstallHistoryHooks();
      uninstallHistoryHooks = null;
    }
  };
}
