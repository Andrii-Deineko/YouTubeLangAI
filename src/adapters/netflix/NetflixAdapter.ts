import type { PlatformAdapter, PlatformSessionCallbacks } from '../types';
import { tokenizeCueText } from '../../core/engine/subtitleParser';
import type { SubtitleCue, TrackMetadata } from '../../core/types/subtitles';

const CAPTION_ROOT_SELECTOR = '.player-timedtext';
const CAPTION_LINE_SELECTOR = '.player-timedtext-text-container';
const NATIVE_CAPTIONS_STYLE_ID = 'lang-ai-hide-netflix-captions';

function readCaptionText(): string {
  const lines = [...document.querySelectorAll<HTMLElement>(CAPTION_LINE_SELECTOR)]
    .map((element) => element.textContent?.replace(/\s+/g, ' ').trim() ?? '')
    .filter(Boolean);
  return [...new Set(lines)].join('\n');
}

export class NetflixAdapter implements PlatformAdapter {
  readonly id = 'netflix' as const;
  readonly name = 'Netflix';
  readonly supportsCueSeeking = false;

  private cues: SubtitleCue[] = [];
  private cueSequence = 0;
  private timelineGeneration = 0;
  private lastObservedTime = 0;
  private currentVideoId = '';
  private nativeCaptionsSuppressed = false;

  matchesLocation(url: Location | URL): boolean {
    return (
      (url.hostname === 'netflix.com' || url.hostname.endsWith('.netflix.com')) &&
      /^\/watch\/\d+/.test(url.pathname)
    );
  }

  findVideoElement(): HTMLVideoElement | null {
    return document.querySelector<HTMLVideoElement>('video');
  }

  findPlayerContainer(): HTMLElement | null {
    if (!this.matchesLocation(window.location)) return null;
    const video = this.findVideoElement();
    if (!video) return null;

    const fullscreen = document.fullscreenElement;
    if (fullscreen instanceof HTMLElement && fullscreen !== video && fullscreen.contains(video)) {
      return fullscreen;
    }

    const selectors = [
      '.watch-video--player-view',
      '.watch-video',
      '[data-uia="video-canvas"]',
      '.VideoContainer',
      '.NFPlayer'
    ];
    for (const selector of selectors) {
      const candidate = video.closest<HTMLElement>(selector);
      if (candidate) return candidate;
    }

    const videoRect = video.getBoundingClientRect();
    let candidate = video.parentElement;
    let bestMatch: HTMLElement | null = candidate;
    while (candidate && candidate !== document.body) {
      const rect = candidate.getBoundingClientRect();
      if (rect.width >= videoRect.width * 0.9 && rect.height >= videoRect.height * 0.9) {
        bestMatch = candidate;
      }
      if (rect.width >= window.innerWidth * 0.85 && rect.height >= window.innerHeight * 0.75) {
        return candidate;
      }
      candidate = candidate.parentElement;
    }
    return bestMatch;
  }

  getControlsBottomOffset(): number {
    return 72;
  }

  init(callbacks: PlatformSessionCallbacks): () => void {
    let lastText = '';
    let debounceTimer: number | null = null;
    let observedVideo: HTMLVideoElement | null = null;

    const handleSeeking = (): void => {
      if (!observedVideo || observedVideo.currentTime >= this.lastObservedTime - 0.05) return;
      this.cues = [];
      this.cueSequence = 0;
      this.timelineGeneration += 1;
      this.lastObservedTime = observedVideo.currentTime;
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
      const video = this.findVideoElement();
      observeVideo(video);
      const time = video?.currentTime ?? 0;
      const videoId = this.getVideoId();
      if (videoId !== this.currentVideoId) {
        this.currentVideoId = videoId;
        this.cues = [];
        this.cueSequence = 0;
        this.timelineGeneration = 0;
        this.lastObservedTime = time;
      } else if (time < this.lastObservedTime - 0.05) {
        // A backward seek starts a fresh live timeline. Keeping future cues in the
        // same sorted array creates overlaps and duplicate cue ids after rewind.
        this.cues = [];
        this.cueSequence = 0;
        this.timelineGeneration += 1;
      }
      this.lastObservedTime = time;

      const previous = this.cues[this.cues.length - 1];
      const nextCueStart =
        text && previous ? Math.max(time, previous.startTime + 0.06) : time;
      if (previous) {
        this.cues[this.cues.length - 1] = this.createCue(
          previous.text,
          previous.startTime,
          Math.max(nextCueStart - 0.01, previous.startTime + 0.05),
          previous.index ?? this.cues.length - 1,
          previous.id,
          previous.translation
        );
      }

      if (text) {
        this.cues.push(
          this.createCue(text, nextCueStart, nextCueStart + 30, this.cues.length)
        );
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
        primaryCues: [...this.cues],
        primaryMeta: metadata,
        liveCueBoundary: Boolean(previous),
        // An empty caption only closes the active cue. Its translation already
        // exists, so do not restart cache reads and provider requests.
        skipTranslation: !text
      });
      callbacks.onVideoElementChange?.(video);
    };

    const emitIfChanged = (): void => {
      const text = readCaptionText();
      if (text === lastText) return;
      lastText = text;
      emitText(text);
    };

    const observer = new MutationObserver(() => {
      if (debounceTimer !== null) window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(() => {
        debounceTimer = null;
        emitIfChanged();
      }, 50);
    });

    let observedCaptionRoot: Element | null = null;
    const syncCaptionObserver = (): void => {
      const captionRoot = document.querySelector(CAPTION_ROOT_SELECTOR);
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
      observeVideo(this.findVideoElement());
      emitIfChanged();
    };
    const captionRootTimer = window.setInterval(syncCaptionObserver, 500);
    syncCaptionObserver();

    return () => {
      observer.disconnect();
      window.clearInterval(captionRootTimer);
      observedVideo?.removeEventListener('seeking', handleSeeking);
      observedVideo = null;
      if (debounceTimer !== null) window.clearTimeout(debounceTimer);
      this.suppressNativeSubtitles(false);
    };
  }

  suppressNativeSubtitles(suppress: boolean): void {
    if (suppress === this.nativeCaptionsSuppressed) return;
    this.nativeCaptionsSuppressed = suppress;
    const existing = document.getElementById(NATIVE_CAPTIONS_STYLE_ID);
    if (!suppress) {
      existing?.remove();
      return;
    }
    if (existing) return;
    const style = document.createElement('style');
    style.id = NATIVE_CAPTIONS_STYLE_ID;
    style.textContent = `${CAPTION_ROOT_SELECTOR} { visibility: hidden !important; }`;
    (document.head ?? document.documentElement).appendChild(style);
  }

  private getVideoId(): string {
    const match = window.location.pathname.match(/^\/watch\/(\d+)/);
    return match ? `netflix-${match[1]}` : `netflix-${window.location.pathname}`;
  }

  private createCue(
    text: string,
    startTime: number,
    endTime: number,
    index: number,
    id?: string,
    translation?: string
  ): SubtitleCue {
    const cueId =
      id ??
      `netflix-cue-${this.timelineGeneration}-${this.cueSequence++}-${Math.round(startTime * 1000)}`;
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
  }
}
