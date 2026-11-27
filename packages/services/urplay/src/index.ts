import type { ServicePlugin } from '@langai/contracts';
import { html5PlayerPlugin, jwplayerPlugin } from '@langai/players';
import {
  isUrPlayHost,
  resolveUrPlayMediaIdentity,
  URPLAY_HOST_MATCHES
} from './domain';
import { initUrPlayMainWorldExtractor } from './extractor';
import { createUrPlaySessionController } from './session';

const sessionController = createUrPlaySessionController();

export const urplayService: ServicePlugin = {
  id: 'urplay',
  name: 'UR Play',
  badgeLabel: 'UR Play',
  defaultSourceLang: 'sv',
  hostMatches: URPLAY_HOST_MATCHES,
  capabilities: {
    cueSeeking: true,
    nativeTranslatedTrack: false,
    dynamicModule: true
  },
  needsMainWorldInterceptor: true,
  allFrames: false,
  players: [jwplayerPlugin, html5PlayerPlugin],

  matchesUrl(url: URL, _frameChainHosts: readonly string[]): boolean {
    return isUrPlayHost(url.hostname);
  },

  resolveMediaIdentity: resolveUrPlayMediaIdentity,
  observeNavigation: sessionController.observeNavigation,
  initMainWorldExtractor: initUrPlayMainWorldExtractor,
  initIsolatedSession: sessionController.initIsolatedSession,
  selectTrack: sessionController.selectTrack
};

export {
  cleanUrPlayTitle,
  extractUrPlayTitle,
  getUrPlayProgramId,
  isUrPlayHost,
  resolveUrPlayMediaIdentity,
  resolveUrPlayVideoId,
  URPLAY_HOST_MATCHES
} from './domain';
export { initUrPlayMainWorldExtractor } from './extractor';
export {
  detectUrPlayTrackLanguage,
  extractTracksFromNextData,
  filterAvailableTrackOptions,
  filterStandardUrPlayTracks,
  isAccessibilityTrack,
  isUrPlayCaptionUrl,
  isValidSubtitleBody,
  parseUrPlaySubtitleText,
  pickBestUrPlayTrack,
  toUrPlayAvailableTrackOptions,
  type CandidateUrPlayTrack
} from './nextData';
export {
  createUrPlaySessionController,
  type UrPlaySessionController
} from './session';
