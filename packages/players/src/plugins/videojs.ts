import type { ActiveCueSnapshot, PlayerPlugin } from '@langai/contracts';
import { createCssCaptionSuppressor } from '../shared/cssSuppression';
import {
  findBestVideo,
  isVideoVisible,
  measureControlBarOffset,
  selectHtml5TextTrack
} from '../shared/dom';

const VIDEOJS_SUPPRESSION_CSS = `
.vjs-text-track-display,
video::cue {
  opacity: 0 !important;
  visibility: hidden !important;
  pointer-events: none !important;
}
`;

const videojsSuppressor = createCssCaptionSuppressor(
  'langai-videojs-captions-suppression',
  VIDEOJS_SUPPRESSION_CSS
);

function detectVideoJsContainer(root?: ParentNode): HTMLElement | null {
  const searchRoot: ParentNode | null =
    root ?? (typeof document !== 'undefined' ? document : null);
  if (!searchRoot) return null;

  const containers = Array.from(searchRoot.querySelectorAll<HTMLElement>('.video-js'));
  const withVisibleVideo = containers.find((el) => {
    const video = el.querySelector<HTMLVideoElement>('video.vjs-tech, video');
    return video ? isVideoVisible(video) : false;
  });
  return withVisibleVideo ?? containers[0] ?? null;
}

export const videojsPlugin: PlayerPlugin = {
  id: 'videojs',

  detectContainer(root?: ParentNode): HTMLElement | null {
    return detectVideoJsContainer(root);
  },

  findVideo(container: HTMLElement | null, root?: ParentNode): HTMLVideoElement | null {
    const target = container ?? detectVideoJsContainer(root);
    if (!target) return null;
    const direct = target.querySelector<HTMLVideoElement>('video.vjs-tech, video');
    if (direct && direct.isConnected) return direct;
    return findBestVideo(target);
  },

  isControlsHidden(container: HTMLElement): boolean {
    return container.classList.contains('vjs-user-inactive');
  },

  getSubtitleBottomOffset(container: HTMLElement): number {
    if (container.classList.contains('vjs-user-inactive')) {
      return 28;
    }
    return measureControlBarOffset(container, '.vjs-control-bar', 44, 60, 16);
  },

  suppressNativeCaptions(
    _container: HTMLElement,
    suppress: boolean,
    _activeCue?: ActiveCueSnapshot
  ): () => void {
    videojsSuppressor.setEnabled(suppress);
    if (!suppress) {
      return () => {};
    }
    return () => {
      videojsSuppressor.setEnabled(false);
    };
  },

  selectTrackInPage(trackIdOrUrl: string): void {
    if (typeof document === 'undefined') return;
    const videos = document.querySelectorAll<HTMLVideoElement>('.video-js video');
    selectHtml5TextTrack(videos, trackIdOrUrl);
  }
};
