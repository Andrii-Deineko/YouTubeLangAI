import type { ActiveCueSnapshot, PlayerPlugin } from '@langai/contracts';

const YOUTUBE_NATIVE_CAPTIONS_STYLE_ID = 'langai-youtube-captions-suppression';

const YOUTUBE_SUPPRESSION_CSS = `
.ytp-caption-window-container {
  display: none !important;
}
`;

export function setYoutubeNativeCaptionSuppression(enabled: boolean): void {
  if (typeof document === 'undefined') return;

  const existing = document.getElementById(YOUTUBE_NATIVE_CAPTIONS_STYLE_ID);
  if (enabled) {
    if (!existing) {
      const styleEl = document.createElement('style');
      styleEl.id = YOUTUBE_NATIVE_CAPTIONS_STYLE_ID;
      styleEl.textContent = YOUTUBE_SUPPRESSION_CSS;
      (document.head || document.documentElement).appendChild(styleEl);
    }
  } else if (existing) {
    existing.remove();
  }
}

function detectYoutubeContainer(root?: ParentNode): HTMLElement | null {
  const searchRoot: ParentNode | null =
    root ?? (typeof document !== 'undefined' ? document : null);
  if (!searchRoot) return null;

  return (
    searchRoot.querySelector<HTMLElement>('#movie_player') ??
    searchRoot.querySelector<HTMLElement>('.html5-video-player')
  );
}

/**
 * YouTube HTML5 player plugin encapsulating `#movie_player`, `ytp-autohide` state,
 * control bar bottom offset calculation, and native `.ytp-caption-window-container` suppression.
 */
export const youtubePlayerPlugin: PlayerPlugin = {
  id: 'youtube-html5',

  detectContainer(root?: ParentNode): HTMLElement | null {
    return detectYoutubeContainer(root);
  },

  findVideo(container: HTMLElement | null, root?: ParentNode): HTMLVideoElement | null {
    const target = container ?? detectYoutubeContainer(root);
    if (target) {
      const inside = target.querySelector<HTMLVideoElement>('video.html5-main-video, video');
      if (inside) return inside;
    }

    const searchRoot: ParentNode | null =
      root ?? (typeof document !== 'undefined' ? document : null);
    if (!searchRoot) return null;

    return searchRoot.querySelector<HTMLVideoElement>('video.html5-main-video, video');
  },

  isControlsHidden(container: HTMLElement): boolean {
    return container.classList.contains('ytp-autohide');
  },

  getSubtitleBottomOffset(container: HTMLElement): number {
    if (container.classList.contains('ytp-autohide')) {
      return 28;
    }

    const bottomControls =
      container.querySelector<HTMLElement>('.ytp-chrome-bottom') ??
      (typeof document !== 'undefined'
        ? document.querySelector<HTMLElement>('.ytp-chrome-bottom')
        : null);

    const rectHeight = bottomControls ? bottomControls.getBoundingClientRect().height : 0;
    const offsetHeight = bottomControls?.offsetHeight ?? 0;
    const effectiveHeight = rectHeight > 0 ? rectHeight : offsetHeight > 0 ? offsetHeight : 48;

    return Math.max(68, effectiveHeight + 16);
  },

  suppressNativeCaptions(
    _container: HTMLElement,
    suppress: boolean,
    _activeCue?: ActiveCueSnapshot
  ): () => void {
    setYoutubeNativeCaptionSuppression(suppress);
    if (!suppress) {
      return () => {};
    }
    return () => {
      setYoutubeNativeCaptionSuppression(false);
    };
  }
};
