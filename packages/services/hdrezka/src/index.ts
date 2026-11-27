import type {
  MediaIdentity,
  PlatformSessionCallbacks,
  PlayerMainWorldContext,
  ServicePlugin
} from '@langai/contracts';
import { html5PlayerPlugin, playerjsPlugin } from '@langai/players';
import {
  HDREZKA_ALL_DOMAINS,
  HDREZKA_DOMAINS,
  HDREZKA_HOST_MATCHES,
  HDREZKA_PLAYER_IFRAME_DOMAINS,
  HDREZKA_PLAYER_IFRAME_MATCHES,
  getAncestorOriginsHosts,
  getCustomMirrors,
  getFrameChainHosts,
  isCurrentWindowAllowed,
  matchesDomainList,
  normalizeDomain,
  setCustomMirrors
} from './domainUtils';
import { initHdrezkaMainWorldExtractor } from './extractor';
import { HdrezkaSessionController, resolveHdrezkaMediaIdentity } from './session';

export {
  HDREZKA_ALL_DOMAINS,
  HDREZKA_DOMAINS,
  HDREZKA_HOST_MATCHES,
  HDREZKA_PLAYER_IFRAME_DOMAINS,
  HDREZKA_PLAYER_IFRAME_MATCHES,
  getAncestorOriginsHosts,
  getCustomMirrors,
  getFrameChainHosts,
  isCurrentWindowAllowed,
  matchesDomainList,
  normalizeDomain,
  setCustomMirrors
};

export function createHdrezkaService(): ServicePlugin {
  const session = new HdrezkaSessionController();

  return {
    id: 'hdrezka',
    name: 'HDRezka & Mirrors',
    badgeLabel: 'HDRezka',
    hostMatches: HDREZKA_HOST_MATCHES,
    playerIframeMatches: HDREZKA_PLAYER_IFRAME_MATCHES,
    allFrames: true,
    needsMainWorldInterceptor: true,
    capabilities: {
      cueSeeking: true,
      nativeTranslatedTrack: false,
      dynamicModule: true
    },
    players: [playerjsPlugin, html5PlayerPlugin],

    matchesUrl(url: URL, frameChainHosts: readonly string[]): boolean {
      return matchesDomainList(url.hostname, frameChainHosts, HDREZKA_ALL_DOMAINS);
    },

    resolveMediaIdentity(url: URL, doc: Document): MediaIdentity | null {
      return resolveHdrezkaMediaIdentity(url, doc);
    },

    observeNavigation(onNavigate: () => void): () => void {
      if (typeof window === 'undefined') {
        return () => {};
      }
      const handlePopstate = (): void => onNavigate();
      window.addEventListener('popstate', handlePopstate);
      return () => {
        window.removeEventListener('popstate', handlePopstate);
      };
    },

    initMainWorldExtractor(ctx: PlayerMainWorldContext): () => void {
      // Check domain and ancestorOrigins before installing any interceptors or observers
      if (!isCurrentWindowAllowed(HDREZKA_ALL_DOMAINS)) {
        return () => {};
      }
      return initHdrezkaMainWorldExtractor(ctx);
    },

    initIsolatedSession(callbacks: PlatformSessionCallbacks): () => void {
      return session.init(callbacks);
    },

    selectTrack(trackIdOrUrl: string): void {
      session.selectTrack(trackIdOrUrl);
    }
  };
}

export const hdrezkaService: ServicePlugin = createHdrezkaService();
export default hdrezkaService;
