import type { SubtitleCue, TrackMetadata } from '../core/types/subtitles';

export interface CapturedTrackData {
  primaryCues?: SubtitleCue[];
  translatedCues?: SubtitleCue[];
  primaryMeta?: TrackMetadata;
  translatedMeta?: TrackMetadata;
  rateLimitedUntil?: number;
}

export interface PlatformSessionCallbacks {
  onTracksLoaded: (data: CapturedTrackData) => void;
  onAdStateChange?: (isAd: boolean) => void;
  onVideoElementChange?: (video: HTMLVideoElement | null) => void;
}

export interface PlatformAdapter {
  readonly id: 'youtube' | 'cinema';
  readonly name: string;

  /**
   * Check if this adapter can run on the current page / frame.
   */
  matchesLocation(url: Location | URL): boolean;

  /**
   * Locate the active HTML5 video element on the page or inside child accessible frames.
   */
  findVideoElement(): HTMLVideoElement | null;

  /**
   * Locate the player container element where the Shadow DOM HUD should be attached.
   */
  findPlayerContainer(): HTMLElement | null;

  /**
   * Dynamic bottom offset (in px) for controls (e.g., YouTube control bar or PlayerJS controls).
   */
  getControlsBottomOffset(): number;

  /**
   * Initialize platform listeners, message listeners from interceptors, DOM observers.
   * Returns a teardown function.
   */
  init(callbacks: PlatformSessionCallbacks): () => void;

  /**
   * Request or switch translated track if supported.
   */
  requestTranslatedTrack?(targetLang: string): void;

  /**
   * Suppress or restore native platform subtitles.
   */
  suppressNativeSubtitles?(suppress: boolean): void;

  /**
   * Optional custom frame capture logic if standard canvas capture fails due to CORS.
   */
  captureFrame?(video: HTMLVideoElement): Promise<string | null>;
}
