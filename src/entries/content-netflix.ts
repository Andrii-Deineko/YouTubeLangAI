import { NetflixAdapter } from '../adapters/netflix/NetflixAdapter';
import { initContentRunner } from '../core/content/ContentRunner';

const adapter = new NetflixAdapter();
const stateKey = '__LANG_AI_NETFLIX_MODULE__';
const moduleWindow = window as typeof window & {
  [stateKey]?: { teardown: (() => void) | null; url: string };
};

if (!moduleWindow[stateKey]) {
  const state = { teardown: null as (() => void) | null, url: '' };
  moduleWindow[stateKey] = state;

  const sync = (): void => {
    const currentUrl = window.location.href;
    const matches = adapter.matchesLocation(window.location);
    if (matches && (!state.teardown || state.url !== currentUrl)) {
      state.teardown?.();
      state.teardown = initContentRunner(adapter);
      state.url = currentUrl;
    } else if (!matches && state.teardown) {
      state.teardown();
      state.teardown = null;
      state.url = currentUrl;
    }
  };

  sync();
  const observer = new MutationObserver(sync);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('popstate', sync);
}
