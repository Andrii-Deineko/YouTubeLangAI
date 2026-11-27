import type {
  MediaIdentity,
  PlatformSessionCallbacks,
  PlayerMainWorldContext,
  ServicePlugin
} from '@langai/contracts';
import {
  html5PlayerPlugin,
  jwplayerPlugin,
  videojsPlugin
} from '@langai/players';
import {
  HIANIME_ALL_DOMAINS,
  HIANIME_DOMAINS,
  HIANIME_HOST_MATCHES,
  HIANIME_PLAYER_IFRAME_DOMAINS,
  HIANIME_PLAYER_IFRAME_MATCHES,
  getAncestorOriginsHosts,
  getCustomMirrors,
  getFrameChainHosts,
  isCurrentWindowAllowed,
  matchesDomainList,
  normalizeDomain,
  setCustomMirrors
} from './domainUtils';
import { initHianimeMainWorldExtractor } from './extractor';
import { HianimeSessionController, resolveHianimeMediaIdentity } from './session';

export {
  HIANIME_ALL_DOMAINS,
  HIANIME_DOMAINS,
  HIANIME_HOST_MATCHES,
  HIANIME_PLAYER_IFRAME_DOMAINS,
  HIANIME_PLAYER_IFRAME_MATCHES,
  getAncestorOriginsHosts,
  getCustomMirrors,
  getFrameChainHosts,
  isCurrentWindowAllowed,
  matchesDomainList,
  normalizeDomain,
  setCustomMirrors
};

export function createHianimeService(): ServicePlugin {
  const session = new HianimeSessionController();

  return {
    id: 'hianime',
    name: 'HiAnime / Anime Streams',
    badgeLabel: 'HiAnime',
    hostMatches: HIANIME_HOST_MATCHES,
    playerIframeMatches: HIANIME_PLAYER_IFRAME_MATCHES,
    allFrames: true,
    needsMainWorldInterceptor: true,
    capabilities: {
      cueSeeking: true,
      nativeTranslatedTrack: false,
      dynamicModule: true
    },
    players: [jwplayerPlugin, videojsPlugin, html5PlayerPlugin],

    matchesUrl(url: URL, frameChainHosts: readonly string[]): boolean {
      return matchesDomainList(url.hostname, frameChainHosts, HIANIME_ALL_DOMAINS);
    },

    resolveMediaIdentity(url: URL, doc: Document): MediaIdentity | null {
      return resolveHianimeMediaIdentity(url, doc);
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
      if (!isCurrentWindowAllowed(HIANIME_ALL_DOMAINS)) {
        return () => {};
      }
      return initHianimeMainWorldExtractor(ctx);
    },

    initIsolatedSession(callbacks: PlatformSessionCallbacks): () => void {
      return session.init(callbacks);
    },

    selectTrack(trackIdOrUrl: string): void {
      session.selectTrack(trackIdOrUrl);
    }
  };
}

export const hianimeService: ServicePlugin = createHianimeService();
export default hianimeService;
