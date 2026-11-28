import type { ActiveCueSnapshot, PlayerPlugin } from '@langai/contracts';
import { createCssCaptionSuppressor } from '../shared/cssSuppression';
import {
  findBestVideo,
  isVideoVisible,
  measureControlBarOffset,
  selectHtml5TextTrack
} from '../shared/dom';

const PLYR_SUPPRESSION_CSS = `
.plyr__captions,
video::cue {
  opacity: 0 !important;
  visibility: hidden !important;
  pointer-events: none !important;
}
`;

const plyrSuppressor = createCssCaptionSuppressor(
  'langai-plyr-captions-suppression',
  PLYR_SUPPRESSION_CSS
);

function detectPlyrContainer(root?: ParentNode): HTMLElement | null {
  const searchRoot: ParentNode | null =
    root ?? (typeof document !== 'undefined' ? document : null);
  if (!searchRoot) return null;

  const containers = Array.from(searchRoot.querySelectorAll<HTMLElement>('.plyr'));
  const withVisibleVideo = containers.find((el) => {
    const video = el.querySelector<HTMLVideoElement>('video');
    return video ? isVideoVisible(video) : false;
  });
  return withVisibleVideo ?? containers[0] ?? null;
}

export const plyrPlugin: PlayerPlugin = {
  id: 'plyr',

  detectContainer(root?: ParentNode): HTMLElement | null {
    return detectPlyrContainer(root);
  },

  findVideo(container: HTMLElement | null, root?: ParentNode): HTMLVideoElement | null {
    const target = container ?? detectPlyrContainer(root);
    if (!target) return null;
    const direct = target.querySelector<HTMLVideoElement>('video');
    if (direct && direct.isConnected) return direct;
    return findBestVideo(target);
  },

  isControlsHidden(container: HTMLElement): boolean {
    return container.classList.contains('plyr--hide-controls');
  },

  getSubtitleBottomOffset(container: HTMLElement): number {
    if (container.classList.contains('plyr--hide-controls')) {
      return 28;
    }
    return measureControlBarOffset(container, '.plyr__controls', 44, 60, 16);
  },

  suppressNativeCaptions(
    _container: HTMLElement,
    suppress: boolean,
    _activeCue?: ActiveCueSnapshot
  ): () => void {
    plyrSuppressor.setEnabled(suppress);
    if (!suppress) {
      return () => {};
    }
    return () => {
      plyrSuppressor.setEnabled(false);
    };
  },

  selectTrackInPage(trackIdOrUrl: string): void {
    if (typeof document === 'undefined') return;
    const videos = document.querySelectorAll<HTMLVideoElement>('.plyr video');
    selectHtml5TextTrack(videos, trackIdOrUrl);
  }
};
