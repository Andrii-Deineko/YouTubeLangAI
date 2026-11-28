import {
  POST_MESSAGE_SOURCE_ISOLATED,
  POST_MESSAGE_SOURCE_MAIN,
  type IsolatedToMainMessage,
  type MainToIsolatedMessage,
  type MediaIdentity,
  type PlatformSessionCallbacks,
  type PlayerMainWorldContext,
  type ServicePlugin,
  type TrackMetadata
} from '@langai/contracts';
import { html5PlayerPlugin } from '@langai/players';
import { SubtitleEngine } from '@langai/subtitle-kit';
import {
  getCachedCaptionTrack,
  getRateLimitBlockedUntil,
  saveCachedCaptionTrack
} from './captionCache';
import { initYoutubeMainWorldInterceptor } from './interceptor';
import { setYoutubeNativeCaptionSuppression, youtubePlayerPlugin } from './player';

const YOUTUBE_HOST_RE = /(?:^|\.)youtube\.com$/i;
const YOUTUBE_PATH_ID_RE = /\/(?:shorts|live|embed)\/([a-zA-Z0-9_-]+)/;

export function extractYouTubeVideoId(url: URL): string {
  const v = url.searchParams.get('v');
  if (v) return v;
  const match = url.pathname.match(YOUTUBE_PATH_ID_RE);
  return match?.[1] ?? '';
}

function getVideoIdFromLocation(): string {
  if (typeof window === 'undefined') return '';
  try {
    return extractYouTubeVideoId(new URL(window.location.href));
  } catch {
    return '';
  }
}

function getLocationKey(): string {
  if (typeof window === 'undefined') return '';
  return `${window.location.pathname}${window.location.search}`;
}

function observeYouTubeNavigation(onNavigate: () => void): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  let lastLocationKey = getLocationKey();

  const checkUrlChange = (): void => {
    const nextKey = getLocationKey();
    if (nextKey !== lastLocationKey) {
      lastLocationKey = nextKey;
      onNavigate();
    }
  };

  const handleNavigateFinish = (): void => {
    lastLocationKey = getLocationKey();
    onNavigate();
  };

  window.addEventListener('yt-navigate-start', checkUrlChange);
  window.addEventListener('yt-navigate-finish', handleNavigateFinish);
  window.addEventListener('popstate', checkUrlChange);
  const pollId = window.setInterval(checkUrlChange, 800);

  return () => {
    window.removeEventListener('yt-navigate-start', checkUrlChange);
    window.removeEventListener('yt-navigate-finish', handleNavigateFinish);
    window.removeEventListener('popstate', checkUrlChange);
    window.clearInterval(pollId);
  };
}

/**
 * Core YouTube service plugin providing media identity resolution, SPA navigation tracking,
 * main-world timedtext interception, isolated-world session management, caption caching,
 * and native translated track requests.
 */
export const youtubeService: ServicePlugin = {
  id: 'youtube',
  name: 'YouTube',
  badgeLabel: 'YouTube',
  hostMatches: ['*://*.youtube.com/*', '*://youtube.com/*'],
  capabilities: {
    cueSeeking: true,
    nativeTranslatedTrack: true,
    dynamicModule: false
  },
  needsMainWorldInterceptor: true,
  players: [youtubePlayerPlugin, html5PlayerPlugin],

  matchesUrl(url: URL, _frameChainHosts: readonly string[]): boolean {
    return YOUTUBE_HOST_RE.test(url.hostname);
  },

  resolveMediaIdentity(url: URL, doc: Document): MediaIdentity | null {
    const videoId = extractYouTubeVideoId(url);
    if (!videoId) return null;

    const domTitle = doc
      .querySelector<HTMLElement>(
        'ytd-watch-metadata h1 yt-formatted-string, #title h1 yt-formatted-string'
      )
      ?.textContent?.trim();
    const docTitle = doc.title
      .replace(/^\(\d+\)\s*/, '')
      .replace(/\s*-\s*YouTube$/i, '')
      .trim();
    const title = domTitle || docTitle || 'YouTube Video';

    return {
      mediaId: videoId,
      serviceId: 'youtube',
      badgeLabel: 'YouTube',
      title,
      canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
      buildTimestampUrl: (sec: number) =>
        `https://www.youtube.com/watch?v=${videoId}&t=${Math.floor(sec)}s`
    };
  },

  observeNavigation(onNavigate: () => void): () => void {
    return observeYouTubeNavigation(onNavigate);
  },

  initMainWorldExtractor(ctx: PlayerMainWorldContext): () => void {
    return initYoutubeMainWorldInterceptor(ctx);
  },

  initIsolatedSession(callbacks: PlatformSessionCallbacks): () => void {
    if (typeof window === 'undefined') {
      return () => {};
    }

    const primaryEngine = new SubtitleEngine();
    const translatedEngine = new SubtitleEngine();
    let disposed = false;
    let adObserver: MutationObserver | null = null;
    let observedPlayerEl: HTMLElement | null = null;
    let lastVideoEl: HTMLVideoElement | null = null;
    let isAdShowing = false;
    let currentVideoId = getVideoIdFromLocation();
    let navGeneration = 0;

    const loadCached = async (vid: string, generation: number): Promise<void> => {
      try {
        const cachedPrimary = await getCachedCaptionTrack(vid);
        if (
          disposed ||
          generation !== navGeneration ||
          vid !== currentVideoId ||
          vid !== getVideoIdFromLocation()
        ) {
          return;
        }
        if (cachedPrimary) {
          primaryEngine.loadJson3(cachedPrimary.data, cachedPrimary.kind);
          callbacks.onTracksLoaded({
            primaryCues: primaryEngine.getCues(),
            primaryMeta: {
              videoId: vid,
              lang: cachedPrimary.lang,
              tlang: cachedPrimary.tlang,
              kind: cachedPrimary.kind,
              isAsr: primaryEngine.getIsAsr(),
              url: cachedPrimary.url
            },
            rateLimitedUntil: getRateLimitBlockedUntil()
          });
        }
      } catch {
        // Ignore cache read errors
      }
    };

    const checkAdState = (): void => {
      const playerEl = youtubePlayerPlugin.detectContainer();
      if (!playerEl) return;
      const nextAd =
        playerEl.classList.contains('ad-showing') ||
        playerEl.classList.contains('ad-interrupting');
      if (nextAd !== isAdShowing) {
        isAdShowing = nextAd;
        callbacks.onAdStateChange?.(nextAd);
      }
    };

    const attachAdObserver = (): void => {
      const playerEl = youtubePlayerPlugin.detectContainer();
      if (playerEl && playerEl !== observedPlayerEl) {
        adObserver?.disconnect();
        observedPlayerEl = playerEl;
        adObserver = new MutationObserver(() => checkAdState());
        adObserver.observe(playerEl, {
          attributes: true,
          attributeFilter: ['class']
        });
        checkAdState();
      }
      const videoEl = youtubePlayerPlugin.findVideo(playerEl);
      if (videoEl !== lastVideoEl) {
        lastVideoEl = videoEl;
        callbacks.onVideoElementChange?.(videoEl);
      }
    };

    const handleMessage = (event: MessageEvent<unknown>): void => {
      if (disposed || event.source !== window) return;
      if (typeof event.data !== 'object' || event.data === null) return;

      const msg = event.data as Partial<MainToIsolatedMessage>;
      if (msg.source !== POST_MESSAGE_SOURCE_MAIN) return;

      if (msg.type === 'TRACK_CAPTURED' && msg.payload) {
        const payload = msg.payload;
        const activeUrlVid = getVideoIdFromLocation();
        const payloadVid = payload.videoId || activeUrlVid;
        // Strict guard: never load stale timedtext from a previous video onto the current video
        if (activeUrlVid && payloadVid && payloadVid !== activeUrlVid) {
          return;
        }
        if (!payloadVid) return;

        currentVideoId = payloadVid;
        primaryEngine.loadJson3(payload.data, payload.kind);
        void saveCachedCaptionTrack({ ...payload, videoId: payloadVid });

        const primaryMeta: TrackMetadata = {
          videoId: payloadVid,
          lang: payload.lang,
          tlang: payload.tlang,
          kind: payload.kind,
          isAsr: primaryEngine.getIsAsr(),
          url: payload.url,
          ...(payload.title ? { title: payload.title } : {})
        };

        callbacks.onTracksLoaded({
          primaryCues: primaryEngine.getCues(),
          primaryMeta
        });
      } else if (msg.type === 'TRANSLATED_TRACK_CAPTURED' && msg.payload) {
        const payload = msg.payload;
        const activeUrlVid = getVideoIdFromLocation();
        const payloadVid = payload.videoId || activeUrlVid;
        if (activeUrlVid && payloadVid && payloadVid !== activeUrlVid) {
          return;
        }
        if (!currentVideoId || (payloadVid && payloadVid !== currentVideoId)) {
          return;
        }

        translatedEngine.loadJson3(payload.data, payload.kind);
        void saveCachedCaptionTrack({ ...payload, videoId: currentVideoId });

        const translatedMeta: TrackMetadata = {
          videoId: currentVideoId,
          lang: payload.lang,
          tlang: payload.tlang,
          kind: payload.kind,
          isAsr: translatedEngine.getIsAsr(),
          url: payload.url
        };

        callbacks.onTracksLoaded({
          translatedCues: translatedEngine.getCues(),
          translatedMeta
        });
      } else if (msg.type === 'CAPTION_RATE_LIMITED' && msg.payload) {
        callbacks.onTracksLoaded({
          rateLimitedUntil: msg.payload.blockedUntil
        });
        callbacks.onLog?.('warn', 'YouTube timedtext rate-limited; cooldown active');
      } else if (msg.type === 'TRACK_ERROR' && msg.payload) {
        const errorMsg = msg.payload.error || 'Failed to load YouTube subtitles';
        callbacks.onTracksLoaded({
          error: errorMsg
        });
        callbacks.onLog?.(
          'error',
          msg.payload.url ? `${errorMsg} (${msg.payload.url})` : errorMsg
        );
      }
    };

    const syncVideoNavigation = (): void => {
      if (disposed) return;
      const nextVid = getVideoIdFromLocation();
      if (nextVid !== currentVideoId) {
        navGeneration += 1;
        currentVideoId = nextVid;
        primaryEngine.clear();
        translatedEngine.clear();

        // Immediately wipe previous video's subtitles so a video without captions never shows stale text
        callbacks.onTracksLoaded({
          primaryCues: [],
          primaryMeta: undefined,
          availableTracks: []
        });

        const navMsg: IsolatedToMainMessage = {
          source: POST_MESSAGE_SOURCE_ISOLATED,
          type: 'NAVIGATED',
          payload: { videoId: nextVid }
        };
        window.postMessage(navMsg, '*');

        if (nextVid) {
          void loadCached(nextVid, navGeneration);
        }
      }
      attachAdObserver();
    };

    window.addEventListener('message', handleMessage);
    attachAdObserver();

    if (currentVideoId) {
      void loadCached(currentVideoId, navGeneration);
    }

    const stopNavigationObserver = observeYouTubeNavigation(syncVideoNavigation);

    return () => {
      disposed = true;
      window.removeEventListener('message', handleMessage);
      stopNavigationObserver();
      adObserver?.disconnect();
      adObserver = null;
      observedPlayerEl = null;
      setYoutubeNativeCaptionSuppression(false);
    };
  },

  requestTranslatedTrack(targetLang: string): void {
    if (typeof window === 'undefined') return;
    const videoId = getVideoIdFromLocation();
    const message: IsolatedToMainMessage = {
      source: POST_MESSAGE_SOURCE_ISOLATED,
      type: 'REQUEST_TRANSLATED_TRACK',
      payload: {
        targetLang,
        nativeLang: targetLang,
        ...(videoId ? { videoId } : {})
      }
    };
    window.postMessage(message, '*');
  }
};
