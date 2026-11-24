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

function touchesCaptions(node: Node): boolean {
  const element = node instanceof Element ? node : node.parentElement;
  return Boolean(
    element?.matches(CAPTION_ROOT_SELECTOR) || element?.closest(CAPTION_ROOT_SELECTOR)
  );
}

export class NetflixAdapter implements PlatformAdapter {
  readonly id = 'netflix' as const;
  readonly name = 'Netflix';
  readonly supportsCueSeeking = false;

  private cues: SubtitleCue[] = [];
  private cueSequence = 0;
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

    const emitText = (text: string): void => {
      const video = this.findVideoElement();
      const time = video?.currentTime ?? 0;
      const videoId = this.getVideoId();
      if (videoId !== this.currentVideoId) {
        this.currentVideoId = videoId;
        this.cues = [];
        this.cueSequence = 0;
      }

      const previous = this.cues[this.cues.length - 1];
      if (previous) {
        this.cues[this.cues.length - 1] = this.createCue(
          previous.text,
          previous.startTime,
          Math.max(time - 0.02, previous.startTime + 0.2),
          previous.index ?? this.cues.length - 1,
          previous.id
        );
      }

      if (text) {
        this.cues.push(this.createCue(text, time, time + 30, this.cues.length));
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
        liveCueBoundary: Boolean(previous)
      });
      callbacks.onVideoElementChange?.(video);
    };

    const emitIfChanged = (): void => {
      const text = readCaptionText();
      if (text === lastText) return;
      lastText = text;
      emitText(text);
    };

    const observer = new MutationObserver((mutations) => {
      const relevant = mutations.some((mutation) => {
        if (touchesCaptions(mutation.target)) return true;
        return [...mutation.addedNodes, ...mutation.removedNodes].some(touchesCaptions);
      });
      if (!relevant) return;
      if (debounceTimer !== null) window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(() => {
        debounceTimer = null;
        emitIfChanged();
      }, 50);
    });

    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      characterData: true
    });

    lastText = readCaptionText();
    if (lastText) emitText(lastText);

    return () => {
      observer.disconnect();
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
    id?: string
  ): SubtitleCue {
    const cueId = id ?? `netflix-cue-${this.cueSequence++}-${Math.round(startTime * 1000)}`;
    const safeEnd = Math.max(endTime, startTime + 0.2);
    return {
      id: cueId,
      index,
      startTime,
      endTime: safeEnd,
      text,
      tokens: tokenizeCueText(cueId, text, startTime, safeEnd)
    };
  }
}
