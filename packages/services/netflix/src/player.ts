import type { ActiveCueSnapshot, PlayerPlugin } from '@langai/contracts';
import { isVideoVisible } from '@langai/players';

export const NETFLIX_CAPTION_ROOT_SELECTOR = '.player-timedtext';
const NATIVE_CAPTIONS_STYLE_ID = 'lang-ai-hide-netflix-captions';

const NETFLIX_CONTAINER_SELECTORS = [
  '.watch-video--player-view',
  '.watch-video',
  '[data-uia="video-canvas"]',
  '.VideoContainer',
  '.NFPlayer'
] as const;

export const NETFLIX_WATCH_PATH_RE = /^\/watch\/(\d+)/;

export function isNetflixHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === 'netflix.com' || host.endsWith('.netflix.com');
}

export function setNetflixCaptionSuppression(suppress: boolean): void {
  if (typeof document === 'undefined') return;

  const existing = document.getElementById(NATIVE_CAPTIONS_STYLE_ID);
  if (!suppress) {
    existing?.remove();
    return;
  }
  if (existing) return;

  const style = document.createElement('style');
  style.id = NATIVE_CAPTIONS_STYLE_ID;
  style.textContent = `${NETFLIX_CAPTION_ROOT_SELECTOR} { visibility: hidden !important; }`;
  (document.head ?? document.documentElement)?.appendChild(style);
}

export function findNetflixVideo(searchRoot: ParentNode): HTMLVideoElement | null {
  if (typeof searchRoot.querySelectorAll === 'function') {
    const videos = Array.from(searchRoot.querySelectorAll<HTMLVideoElement>('video')).filter(
      (video) => video.isConnected
    );
    if (videos.length > 0) {
      const visible = videos.find((video) => isVideoVisible(video));
      return visible ?? videos[0] ?? null;
    }
  }
  if (typeof searchRoot.querySelector === 'function') {
    return searchRoot.querySelector<HTMLVideoElement>('video');
  }
  return null;
}

export const netflixPlayerPlugin: PlayerPlugin = {
  id: 'netflix-cadmium',

  detectContainer(root?: ParentNode): HTMLElement | null {
    const searchRoot: ParentNode | null =
      root ?? (typeof document !== 'undefined' ? document : null);
    if (!searchRoot) return null;

    if (
      !root &&
      typeof window !== 'undefined' &&
      isNetflixHost(window.location.hostname) &&
      !NETFLIX_WATCH_PATH_RE.test(window.location.pathname)
    ) {
      return null;
    }

    const video = findNetflixVideo(searchRoot);
    if (!video) return null;

    if (typeof document !== 'undefined' && typeof HTMLElement !== 'undefined') {
      const fullscreen = document.fullscreenElement;
      if (fullscreen instanceof HTMLElement && fullscreen !== video && fullscreen.contains(video)) {
        return fullscreen;
      }
    }

    if (typeof video.closest === 'function') {
      for (const selector of NETFLIX_CONTAINER_SELECTORS) {
        const candidate = video.closest<HTMLElement>(selector);
        if (candidate) return candidate;
      }
    }

    if (typeof searchRoot.querySelector === 'function') {
      for (const selector of NETFLIX_CONTAINER_SELECTORS) {
        const candidate = searchRoot.querySelector<HTMLElement>(selector);
        if (candidate && candidate.contains(video)) {
          return candidate;
        }
      }
    }

    if (typeof video.getBoundingClientRect === 'function' && typeof window !== 'undefined') {
      const videoRect = video.getBoundingClientRect();
      let candidate = video.parentElement;
      let bestMatch: HTMLElement | null = candidate;
      const body = typeof document !== 'undefined' ? document.body : null;
      const docEl = typeof document !== 'undefined' ? document.documentElement : null;

      while (candidate && candidate !== body && candidate !== docEl) {
        if (typeof candidate.getBoundingClientRect === 'function') {
          const rect = candidate.getBoundingClientRect();
          if (rect.width >= videoRect.width * 0.9 && rect.height >= videoRect.height * 0.9) {
            bestMatch = candidate;
          }
          if (rect.width >= window.innerWidth * 0.85 && rect.height >= window.innerHeight * 0.75) {
            return candidate;
          }
        }
        candidate = candidate.parentElement;
      }
      return bestMatch;
    }

    return video.parentElement;
  },

  findVideo(container: HTMLElement | null, root?: ParentNode): HTMLVideoElement | null {
    if (container) {
      const inside = findNetflixVideo(container);
      if (inside) return inside;
    }
    const searchRoot: ParentNode | null =
      root ?? (typeof document !== 'undefined' ? document : null);
    return searchRoot ? findNetflixVideo(searchRoot) : null;
  },

  isControlsHidden(container: HTMLElement): boolean {
    if (
      container.classList.contains('passive') ||
      container.classList.contains('inactive')
    ) {
      return true;
    }
    if (typeof container.querySelector === 'function') {
      const playerView = container.querySelector<HTMLElement>('.watch-video--player-view');
      if (
        playerView &&
        (playerView.classList.contains('passive') || playerView.classList.contains('inactive'))
      ) {
        return true;
      }
    }
    return false;
  },

  getSubtitleBottomOffset(_container: HTMLElement): number {
    return 72;
  },

  suppressNativeCaptions(
    _container: HTMLElement,
    suppress: boolean,
    _activeCue?: ActiveCueSnapshot
  ): () => void {
    setNetflixCaptionSuppression(suppress);
    if (!suppress) {
      return () => {};
    }
    return () => {
      setNetflixCaptionSuppression(false);
    };
  }
};
