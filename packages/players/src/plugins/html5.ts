import type { ActiveCueSnapshot, PlayerPlugin } from '@langai/contracts';
import { createCssCaptionSuppressor } from '../shared/cssSuppression';
import {
  findBestVideo,
  findTightVideoContainer,
  queryFirstSelector,
  selectHtml5TextTrack
} from '../shared/dom';

const GENERIC_CONTAINER_SELECTORS = [
  'figure[class*="playerContainer"]',
  'div[class*="playerContainer"]',
  'div[class*="c-player"]',
  '[data-player]',
  '#player'
] as const;

const HTML5_SUPPRESSION_CSS = `
.art-subtitle,
video::cue {
  opacity: 0 !important;
  visibility: hidden !important;
  pointer-events: none !important;
}
`;

const html5Suppressor = createCssCaptionSuppressor(
  'langai-html5-captions-suppression',
  HTML5_SUPPRESSION_CSS
);

export const html5PlayerPlugin: PlayerPlugin = {
  id: 'html5',

  detectContainer(root?: ParentNode): HTMLElement | null {
    const searchRoot: ParentNode | null =
      root ?? (typeof document !== 'undefined' ? document : null);
    if (!searchRoot) return null;

    const video = findBestVideo(searchRoot);
    if (!video) {
      return queryFirstSelector(searchRoot, GENERIC_CONTAINER_SELECTORS);
    }

    for (const selector of GENERIC_CONTAINER_SELECTORS) {
      const candidate = searchRoot.querySelector<HTMLElement>(selector);
      if (candidate && candidate.contains(video)) {
        return candidate;
      }
    }

    for (const selector of GENERIC_CONTAINER_SELECTORS) {
      const closest = video.closest<HTMLElement>(selector);
      if (closest) {
        return closest;
      }
    }

    return findTightVideoContainer(video);
  },

  findVideo(container: HTMLElement | null, root?: ParentNode): HTMLVideoElement | null {
    if (container) {
      const inside = findBestVideo(container);
      if (inside) return inside;
    }
    return findBestVideo(root);
  },

  isControlsHidden(_container: HTMLElement): boolean {
    return false;
  },

  getSubtitleBottomOffset(_container: HTMLElement): number {
    return 48;
  },

  suppressNativeCaptions(
    _container: HTMLElement,
    suppress: boolean,
    _activeCue?: ActiveCueSnapshot
  ): () => void {
    html5Suppressor.setEnabled(suppress);
    if (!suppress) {
      return () => {};
    }
    return () => {
      html5Suppressor.setEnabled(false);
    };
  },

  selectTrackInPage(trackIdOrUrl: string): void {
    if (typeof document === 'undefined') return;
    const videos = document.querySelectorAll<HTMLVideoElement>('video');
    selectHtml5TextTrack(videos, trackIdOrUrl);
  }
};
