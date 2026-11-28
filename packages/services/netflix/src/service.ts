import type {
  MediaIdentity,
  PlatformSessionCallbacks,
  ServicePlugin,
  SubtitleCue,
  TrackMetadata
} from '@langai/contracts';
import { html5PlayerPlugin } from '@langai/players';
import { tokenizeCueText } from '@langai/subtitle-kit';
import {
  NETFLIX_CAPTION_ROOT_SELECTOR,
  NETFLIX_WATCH_PATH_RE,
  findNetflixVideo,
  isNetflixHost,
  netflixPlayerPlugin,
  setNetflixCaptionSuppression
} from './player';

const CAPTION_LINE_SELECTOR = '.player-timedtext-text-container';

function extractWatchId(pathname: string): string | null {
  const match = pathname.match(NETFLIX_WATCH_PATH_RE);
  return match?.[1] ?? null;
}

function getWatchPathnameKey(pathname: string): string {
  const watchId = extractWatchId(pathname);
  return watchId ? `/watch/${watchId}` : '';
}

function getNetflixVideoId(): string {
  if (typeof window === 'undefined') return 'netflix-unknown';
  const watchId = extractWatchId(window.location.pathname);
  return watchId ? `netflix-${watchId}` : `netflix-${window.location.pathname}`;
}

function readCaptionText(): string {
  if (typeof document === 'undefined') return '';
  const lines = [...document.querySelectorAll<HTMLElement>(CAPTION_LINE_SELECTOR)]
    .map((element) => element.textContent?.replace(/\s+/g, ' ').trim() ?? '')
    .filter(Boolean);
  return [...new Set(lines)].join('\n');
}

function cleanNetflixTitle(doc: Document): string {
  const rawTitle = typeof doc?.title === 'string' ? doc.title.trim() : '';
  const cleanedDocTitle = rawTitle
    .replace(/\s*[-|—]\s*Watch on Netflix\s*$/i, '')
    .replace(/\s*[-|—]\s*Netflix\s*$/i, '')
    .trim();

  if (cleanedDocTitle && cleanedDocTitle.toLowerCase() !== 'netflix') {
    return cleanedDocTitle;
  }

  if (typeof doc?.querySelector === 'function') {
    const domTitle = doc
      .querySelector<HTMLElement>('[data-uia="video-title"]')
      ?.textContent?.replace(/\s+/g, ' ')
      .trim();
    if (domTitle) return domTitle;
  }

  return 'Netflix Video';
}

export const netflixService: ServicePlugin = {
  id: 'netflix',
  name: 'Netflix',
  badgeLabel: 'Netflix',
  hostMatches: ['*://*.netflix.com/*', '*://netflix.com/*'],
  capabilities: {
    cueSeeking: false,
    nativeTranslatedTrack: false,
    dynamicModule: true
  },
  needsMainWorldInterceptor: false,
  players: [netflixPlayerPlugin, html5PlayerPlugin],

  matchesUrl(url: URL, _frameChainHosts: readonly string[]): boolean {
    return isNetflixHost(url.hostname) && NETFLIX_WATCH_PATH_RE.test(url.pathname);
  },

  resolveMediaIdentity(url: URL, doc: Document): MediaIdentity | null {
    if (!isNetflixHost(url.hostname)) return null;
    const watchId = extractWatchId(url.pathname);
    if (!watchId) return null;

    return {
      mediaId: `netflix-${watchId}`,
      serviceId: 'netflix',
      badgeLabel: 'Netflix',
      title: cleanNetflixTitle(doc),
      canonicalUrl: `https://www.netflix.com/watch/${watchId}`,
      buildTimestampUrl: (sec: number): string =>
        `https://www.netflix.com/watch/${watchId}?t=${Math.max(0, Math.floor(sec))}`
    };
  },

  observeNavigation(onNavigate: () => void): () => void {
    if (typeof window === 'undefined') {
      return () => {};
    }

    let disposed = false;
    let lastWatchPath = getWatchPathnameKey(window.location.pathname);

    const checkNavigation = (): void => {
      if (disposed) return;
      const nextWatchPath = getWatchPathnameKey(window.location.pathname);
      if (nextWatchPath !== lastWatchPath) {
        lastWatchPath = nextWatchPath;
        onNavigate();
      }
    };

    // Netflix is an SPA. Compare only /watch/\d+ pathname so query-param changes do not reset subtitles.
    const navigationTimer = window.setInterval(checkNavigation, 1000);
    window.addEventListener('popstate', checkNavigation);
    window.addEventListener('hashchange', checkNavigation);

    const teardown = (): void => {
      if (disposed) return;
      disposed = true;
      window.clearInterval(navigationTimer);
      window.removeEventListener('popstate', checkNavigation);
      window.removeEventListener('hashchange', checkNavigation);
      window.removeEventListener('pagehide', teardown);
    };

    window.addEventListener('pagehide', teardown, { once: true });
    return teardown;
  },

  initIsolatedSession(callbacks: PlatformSessionCallbacks): () => void {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return () => {};
    }

    let cues: SubtitleCue[] = [];
    let cueSequence = 0;
    let timelineGeneration = 0;
    let lastObservedTime = 0;
    let pendingTimelineReset = false;
    let currentVideoId = '';
    let lastText = '';
    let debounceTimer: number | null = null;
    let observedVideo: HTMLVideoElement | null = null;
    let observedCaptionRoot: Element | null = null;
    let disposed = false;

    const createCue = (
      text: string,
      startTime: number,
      endTime: number,
      index: number,
      id?: string,
      translation?: string
    ): SubtitleCue => {
      const cueId =
        id ??
        `netflix-cue-${timelineGeneration}-${cueSequence++}-${Math.round(startTime * 1000)}`;
      const safeEnd = Math.max(endTime, startTime + 0.05);
      return {
        id: cueId,
        index,
        startTime,
        endTime: safeEnd,
        text,
        ...(translation ? { translation } : {}),
        tokens: tokenizeCueText(cueId, text, startTime, safeEnd)
      };
    };

    const handleSeeking = (): void => {
      if (!observedVideo || observedVideo.currentTime >= lastObservedTime - 0.05) return;
      cues = [];
      cueSequence = 0;
      timelineGeneration += 1;
      lastObservedTime = observedVideo.currentTime;
      pendingTimelineReset = true;
      // Force the current caption to be emitted again even if the text before and
      // after the seek happens to be identical.
      lastText = '';
    };

    const observeVideo = (video: HTMLVideoElement | null): void => {
      if (video === observedVideo) return;
      observedVideo?.removeEventListener('seeking', handleSeeking);
      observedVideo = video;
      observedVideo?.addEventListener('seeking', handleSeeking);
    };

    const emitText = (text: string): void => {
      if (disposed) return;
      const video = findNetflixVideo(document);
      observeVideo(video);
      const time = video?.currentTime ?? 0;
      const videoId = getNetflixVideoId();

      if (videoId !== currentVideoId) {
        currentVideoId = videoId;
        cues = [];
        cueSequence = 0;
        timelineGeneration = 0;
        lastObservedTime = time;
        pendingTimelineReset = true;
      } else if (time < lastObservedTime - 0.05) {
        // A backward seek starts a fresh live timeline. Keeping future cues in the
        // same sorted array creates overlaps and duplicate cue ids after rewind.
        cues = [];
        cueSequence = 0;
        timelineGeneration += 1;
        pendingTimelineReset = true;
      }
      lastObservedTime = time;

      const previous = cues[cues.length - 1];
      const nextCueStart =
        text && previous ? Math.max(time, previous.startTime + 0.06) : time;
      const updates: SubtitleCue[] = [];
      if (previous) {
        const closedPrevious = createCue(
          previous.text,
          previous.startTime,
          Math.max(nextCueStart - 0.01, previous.startTime + 0.05),
          previous.index ?? cues.length - 1,
          previous.id,
          previous.translation
        );
        cues[cues.length - 1] = closedPrevious;
        updates.push(closedPrevious);
      }

      if (text) {
        const nextCue = createCue(
          text,
          nextCueStart,
          nextCueStart + 30,
          cues.length
        );
        cues.push(nextCue);
        updates.push(nextCue);
      }

      const metadata: TrackMetadata = {
        id: `netflix-track-${videoId}`,
        videoId,
        lang: 'auto',
        language: 'auto',
        label: 'Netflix captions',
        source: 'netflix-dom',
        url: window.location.href
      };
      callbacks.onTracksLoaded({
        primaryCueUpdates: updates,
        resetPrimaryCues: pendingTimelineReset,
        primaryMeta: metadata,
        liveCueBoundary: Boolean(previous),
        // An empty caption only closes the active cue. Its translation already
        // exists, so do not restart cache reads and provider requests.
        skipTranslation: !text
      });
      pendingTimelineReset = false;
      callbacks.onVideoElementChange?.(video);
    };

    const emitIfChanged = (): void => {
      if (disposed) return;
      const text = readCaptionText();
      if (text === lastText) return;
      lastText = text;
      emitText(text);
    };

    const observer = new MutationObserver(() => {
      if (disposed) return;
      if (debounceTimer !== null) window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(() => {
        debounceTimer = null;
        emitIfChanged();
      }, 50);
    });

    const syncCaptionObserver = (): void => {
      if (disposed) return;
      const activeVideoId = getNetflixVideoId();
      if (currentVideoId && activeVideoId !== currentVideoId) {
        currentVideoId = activeVideoId;
        cues = [];
        cueSequence = 0;
        timelineGeneration = 0;
        lastObservedTime = 0;
        pendingTimelineReset = true;
        lastText = '';
        callbacks.onTracksLoaded({
          primaryCues: [],
          primaryMeta: undefined,
          availableTracks: []
        });
      }

      const captionRoot = document.querySelector(NETFLIX_CAPTION_ROOT_SELECTOR);
      if (captionRoot !== observedCaptionRoot) {
        observer.disconnect();
        observedCaptionRoot = captionRoot;
        if (captionRoot) {
          observer.observe(captionRoot, {
            subtree: true,
            childList: true,
            characterData: true
          });
        }
      }
      observeVideo(findNetflixVideo(document));
      emitIfChanged();
    };

    const captionRootTimer = window.setInterval(syncCaptionObserver, 500);
    syncCaptionObserver();

    return () => {
      if (disposed) return;
      disposed = true;
      observer.disconnect();
      observedCaptionRoot = null;
      window.clearInterval(captionRootTimer);
      observedVideo?.removeEventListener('seeking', handleSeeking);
      observedVideo = null;
      if (debounceTimer !== null) {
        window.clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      setNetflixCaptionSuppression(false);
    };
  }
};
