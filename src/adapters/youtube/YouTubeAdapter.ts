import type { PlatformAdapter, PlatformSessionCallbacks } from '../types';
import {
  ISOLATED_MESSAGE_SOURCE,
  MAIN_MESSAGE_SOURCE,
  type IsolatedToMainMessage,
  type MainToIsolatedMessage
} from '../../core/types/messages';
import {
  getCachedCaptionTrack,
  getRateLimitBlockedUntil,
  saveCachedCaptionTrack
} from '../../core/storage/captionCache';
import { SubtitleEngine } from '../../core/engine/SubtitleEngine';
import type { TrackMetadata } from '../../core/types/subtitles';

const NATIVE_CAPTIONS_STYLE_ID = 'yt-lang-ai-hide-native-captions';

export class YouTubeAdapter implements PlatformAdapter {
  readonly id = 'youtube' as const;
  readonly name = 'YouTube';

  private adObserver: MutationObserver | null = null;
  private isAdShowing = false;
  private currentVideoId = '';
  private primaryEngine = new SubtitleEngine();
  private translatedEngine = new SubtitleEngine();

  matchesLocation(url: Location | URL): boolean {
    return url.hostname.includes('youtube.com');
  }

  findVideoElement(): HTMLVideoElement | null {
    const playerEl = this.findPlayerContainer();
    if (playerEl) {
      const v = playerEl.querySelector<HTMLVideoElement>('video.html5-main-video, video');
      if (v) return v;
    }
    return document.querySelector<HTMLVideoElement>('video.html5-main-video, video');
  }

  findPlayerContainer(): HTMLElement | null {
    return (
      document.querySelector<HTMLElement>('#movie_player') ??
      document.querySelector<HTMLElement>('.html5-video-player')
    );
  }

  getControlsBottomOffset(): number {
    const bottomControls = document.querySelector<HTMLElement>('.ytp-chrome-bottom');
    if (bottomControls && bottomControls.offsetHeight > 0) {
      return bottomControls.offsetHeight;
    }
    return 56;
  }

  init(callbacks: PlatformSessionCallbacks): () => void {
    const handleMessage = (event: MessageEvent<unknown>) => {
      if (event.source !== window) return;
      if (typeof event.data !== 'object' || event.data === null) return;

      const msg = event.data as Partial<MainToIsolatedMessage>;
      if (msg.source !== MAIN_MESSAGE_SOURCE) return;

      if (msg.type === 'TRACK_CAPTURED' && msg.payload) {
        const payload = msg.payload;
        this.currentVideoId = payload.videoId || this.getVideoIdFromUrl();
        this.primaryEngine.loadJson3(payload.data, payload.kind);
        void saveCachedCaptionTrack(payload);

        const primaryMeta: TrackMetadata = {
          videoId: this.currentVideoId,
          lang: payload.lang,
          tlang: payload.tlang,
          kind: payload.kind,
          isAsr: this.primaryEngine.getIsAsr(),
          url: payload.url
        };

        callbacks.onTracksLoaded({
          primaryCues: this.primaryEngine.getCues(),
          primaryMeta
        });
      } else if (msg.type === 'TRANSLATED_TRACK_CAPTURED' && msg.payload) {
        const payload = msg.payload;
        this.translatedEngine.loadJson3(payload.data, payload.kind);
        void saveCachedCaptionTrack(payload);

        const translatedMeta: TrackMetadata = {
          videoId: this.currentVideoId,
          lang: payload.lang,
          tlang: payload.tlang,
          kind: payload.kind,
          isAsr: this.translatedEngine.getIsAsr(),
          url: payload.url
        };

        callbacks.onTracksLoaded({
          translatedCues: this.translatedEngine.getCues(),
          translatedMeta
        });
      } else if (msg.type === 'CAPTION_RATE_LIMITED' && msg.payload) {
        callbacks.onTracksLoaded({
          rateLimitedUntil: msg.payload.blockedUntil
        });
      }
    };

    window.addEventListener('message', handleMessage);

    const checkAdState = () => {
      const playerEl = this.findPlayerContainer();
      if (!playerEl) return;
      const nextAd =
        playerEl.classList.contains('ad-showing') ||
        playerEl.classList.contains('ad-interrupting');
      if (nextAd !== this.isAdShowing) {
        this.isAdShowing = nextAd;
        callbacks.onAdStateChange?.(nextAd);
      }
    };

    const attachAdObserver = () => {
      const playerEl = this.findPlayerContainer();
      if (playerEl && !this.adObserver) {
        this.adObserver = new MutationObserver(() => checkAdState());
        this.adObserver.observe(playerEl, {
          attributes: true,
          attributeFilter: ['class']
        });
        checkAdState();
      }
    };

    attachAdObserver();

    // Check cached tracks on init
    const vid = this.getVideoIdFromUrl();
    if (vid) {
      void this.loadCached(vid, callbacks);
    }

    const onNavFinish = () => {
      const nextVid = this.getVideoIdFromUrl();
      if (nextVid && nextVid !== this.currentVideoId) {
        this.currentVideoId = nextVid;
        this.primaryEngine.clear();
        this.translatedEngine.clear();
        void this.loadCached(nextVid, callbacks);
      }
      attachAdObserver();
    };

    window.addEventListener('yt-navigate-finish', onNavFinish);

    return () => {
      window.removeEventListener('message', handleMessage);
      window.removeEventListener('yt-navigate-finish', onNavFinish);
      this.adObserver?.disconnect();
      this.adObserver = null;
      this.suppressNativeSubtitles(false);
    };
  }

  requestTranslatedTrack(targetLang: string): void {
    const message: IsolatedToMainMessage = {
      source: ISOLATED_MESSAGE_SOURCE,
      type: 'REQUEST_TRANSLATED_TRACK',
      payload: { targetLang, nativeLang: targetLang }
    };
    window.postMessage(message, '*');
  }

  suppressNativeSubtitles(suppress: boolean): void {
    const existing = document.getElementById(NATIVE_CAPTIONS_STYLE_ID);
    if (suppress) {
      if (!existing) {
        const style = document.createElement('style');
        style.id = NATIVE_CAPTIONS_STYLE_ID;
        style.textContent = `
          .ytp-caption-window-container {
            display: none !important;
          }
        `;
        (document.head || document.documentElement).appendChild(style);
      }
    } else if (existing) {
      existing.remove();
    }
  }

  private getVideoIdFromUrl(): string {
    try {
      const url = new URL(window.location.href);
      const v = url.searchParams.get('v');
      if (v) return v;
      const match = url.pathname.match(/\/shorts\/([a-zA-Z0-9_-]+)/);
      return match?.[1] ?? '';
    } catch {
      return '';
    }
  }

  private async loadCached(vid: string, callbacks: PlatformSessionCallbacks): Promise<void> {
    try {
      const cachedPrimary = await getCachedCaptionTrack(vid);
      if (cachedPrimary) {
        this.primaryEngine.loadJson3(cachedPrimary.data, cachedPrimary.kind);
        callbacks.onTracksLoaded({
          primaryCues: this.primaryEngine.getCues(),
          primaryMeta: {
            videoId: vid,
            lang: cachedPrimary.lang,
            tlang: cachedPrimary.tlang,
            kind: cachedPrimary.kind,
            isAsr: this.primaryEngine.getIsAsr(),
            url: cachedPrimary.url
          },
          rateLimitedUntil: getRateLimitBlockedUntil()
        });
      }
    } catch {
      // Ignore
    }
  }
}
