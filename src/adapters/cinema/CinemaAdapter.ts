import type { PlatformAdapter, PlatformSessionCallbacks } from '../types';
import {
  DEFAULT_CINEMA_DOMAINS,
  normalizeDomain,
  shouldActivateCinema
} from './domainUtils';
import {
  restoreNativeNodes,
  setHtml5CaptionsSuppression,
  syncPlayerJsSubtitles
} from './nativeSuppression';
import {
  detectLanguageFromLabelAndCues,
  parsePlayerJsSubtitles,
  parseSrtSubtitle,
  parseSubtitleFile,
  type PlayerJsTrackInfo
} from '../../core/engine/subtitleParser';
import type { SubtitleCue, TrackMetadata } from '../../core/types/subtitles';

export class CinemaAdapter implements PlatformAdapter {
  readonly id = 'cinema' as const;
  readonly name = 'Cinema (HDRezka / HiAnime / PlayerJS)';

  private currentCues: SubtitleCue[] = [];
  private currentSecondaryCues: SubtitleCue[] = [];
  private suppressionActive = false;

  matchesLocation(url: Location | URL): boolean {
    return shouldActivateCinema({
      allowedDomains: DEFAULT_CINEMA_DOMAINS,
      currentHost: normalizeDomain(url.hostname)
    });
  }

  findVideoElement(): HTMLVideoElement | null {
    if (typeof document === 'undefined') return null;
    const allVideos = Array.from(document.querySelectorAll('video'));
    const videos = allVideos.filter((v) => v.isConnected);
    if (videos.length === 0) return null;

    // 1. Actively playing video
    const playingVideo = videos.find((v) => !v.paused && v.readyState >= 1);
    if (playingVideo) return playingVideo;

    // 2. Video with progress
    const activeProgress = videos.find((v) => !v.paused || v.currentTime > 0);
    if (activeProgress && !Number.isNaN(activeProgress.duration) && activeProgress.duration > 0) {
      return activeProgress;
    }

    // 3. Long video with source
    const longVideoWithSrc = videos.find(
      (v) =>
        !Number.isNaN(v.duration) &&
        v.duration > 60 &&
        Boolean(v.currentSrc || v.src || v.srcObject)
    );
    if (longVideoWithSrc) return longVideoWithSrc;

    // 4. Largest video by area
    let largestVideo: HTMLVideoElement | null = null;
    let maxArea = 0;
    for (const v of videos) {
      const rect = v.getBoundingClientRect();
      const area = rect.width * rect.height;
      if (area > maxArea && area > 10000) {
        maxArea = area;
        largestVideo = v;
      }
    }

    return largestVideo || videos[0] || null;
  }

  findPlayerContainer(): HTMLElement | null {
    const video = this.findVideoElement();
    if (!video) return null;

    const prioritySelectors = [
      '#oframecdnplayer',
      '#cdnplayer',
      '.jwplayer',
      '.plyr',
      '[data-player]',
      '.video-js',
      '#player'
    ];

    for (const sel of prioritySelectors) {
      const el = document.querySelector(sel);
      if (el && el.contains(video)) {
        return el as HTMLElement;
      }
    }

    for (const sel of prioritySelectors) {
      const el = video.closest(sel);
      if (el) {
        return el as HTMLElement;
      }
    }

    // Upward traversal to find tight container
    const videoRect = video.getBoundingClientRect();
    let current: HTMLElement | null = video.parentElement;
    let bestContainer: HTMLElement = video.parentElement || (document.body as HTMLElement);

    while (current && current !== document.body && current !== document.documentElement) {
      const rect = current.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        const widthDiff = Math.abs(rect.width - videoRect.width);
        const heightDiff = rect.height - videoRect.height;
        if (heightDiff >= -5 && heightDiff <= 70 && widthDiff <= 30) {
          bestContainer = current;
        } else if (heightDiff > 70) {
          break;
        }
      }
      current = current.parentElement;
    }

    return bestContainer;
  }

  getControlsBottomOffset(): number {
    return 48; // Standard PlayerJS bottom control bar height
  }

  init(callbacks: PlatformSessionCallbacks): () => void {
    const handleMessage = async (event: MessageEvent) => {
      if (event.source !== window || !event.data) return;
      if (event.data.source !== 'CINELINGUA_MAIN') return;

      if (event.data.type === 'SUBTITLES_INTERCEPTED') {
        const payload = event.data.payload;
        if (!payload) return;

        let cues: SubtitleCue[] = [];
        let trackLabel = 'Cinema Track';

        if (payload.playerJsString) {
          const tracks = parsePlayerJsSubtitles(payload.playerJsString);
          if (tracks.length > 0) {
            // Pick first track or english track
            const enTrack = tracks.find(
              (t: PlayerJsTrackInfo) => t.language === 'en' || /eng/i.test(t.label)
            ) || tracks[0];

            trackLabel = enTrack.label;
            try {
              const text = await this.fetchSubtitleContent(enTrack.url);
              if (text) {
                cues = text.includes('WEBVTT')
                  ? parseSubtitleFile(text)
                  : parseSrtSubtitle(text);
              }
            } catch {
              // Ignore fetch error
            }
          }
        } else if (payload.rawText) {
          trackLabel = payload.url ? new URL(payload.url, window.location.href).pathname.split('/').pop() || 'Track' : 'Track';
          cues = payload.rawText.includes('WEBVTT')
            ? parseSubtitleFile(payload.rawText)
            : parseSrtSubtitle(payload.rawText);
        }

        if (cues.length > 0) {
          const detectedLang = detectLanguageFromLabelAndCues(trackLabel, cues);
          const meta: TrackMetadata = {
            id: 'cinema-track-' + Date.now(),
            videoId: window.location.hostname + window.location.pathname,
            lang: detectedLang,
            language: detectedLang,
            label: trackLabel,
            source: 'native'
          };

          this.currentCues = cues;
          callbacks.onTracksLoaded({
            primaryCues: cues,
            primaryMeta: meta
          });

          if (this.suppressionActive) {
            this.syncSuppression();
          }
        }
      }
    };

    window.addEventListener('message', handleMessage);

    // Request MAIN world interceptor injection
    try {
      if (chrome.runtime?.id) {
        chrome.runtime.sendMessage({ type: 'INJECT_MAIN_INTERCEPTOR' });
      }
    } catch {
      // Context invalidated
    }

    return () => {
      window.removeEventListener('message', handleMessage);
      this.suppressNativeSubtitles(false);
    };
  }

  suppressNativeSubtitles(suppress: boolean): void {
    this.suppressionActive = suppress;
    setHtml5CaptionsSuppression(suppress);
    if (!suppress) {
      restoreNativeNodes();
    } else {
      this.syncSuppression();
    }
  }

  private syncSuppression(): void {
    const container = this.findPlayerContainer();
    if (container) {
      const firstCue = this.currentCues[0] || null;
      const secondCue = this.currentSecondaryCues[0] || null;
      syncPlayerJsSubtitles(container, firstCue, secondCue, this.suppressionActive);
    }
  }

  private async fetchSubtitleContent(url: string): Promise<string> {
    try {
      const res = await fetch(url);
      if (res.ok) {
        const text = await res.text();
        if (text && text.trim().length > 0) {
          return text;
        }
      }
    } catch {
      // Service Worker fallback
    }

    try {
      if (chrome.runtime?.id) {
        return new Promise<string>((resolve) => {
          chrome.runtime.sendMessage(
            {
              type: 'FETCH_SUBTITLE_TEXT',
              payload: { url }
            },
            (response: { text?: string }) => {
              if (chrome.runtime.lastError || !response?.text) {
                resolve('');
              } else {
                resolve(response.text);
              }
            }
          );
        });
      }
    } catch {
      // Ignore
    }

    return '';
  }
}
