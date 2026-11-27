import type { AvailableTrackOption, SubtitleCue, TrackMetadata } from './subtitles';
import type { QuickTranslationResult } from './vocabulary';

export const POST_MESSAGE_SOURCE_MAIN = 'LANGAI_MAIN' as const;
export const POST_MESSAGE_SOURCE_ISOLATED = 'LANGAI_ISOLATED' as const;
export const SHADOW_HOST_ID = 'langai-hud-root' as const;

export interface ActiveCueSnapshot {
  primaryText: string;
  secondaryText?: string;
}

export interface CapturedTrackPayload {
  primaryCues?: SubtitleCue[];
  /** Incremental live-cue additions/updates; avoids resending the full history. */
  primaryCueUpdates?: SubtitleCue[];
  /** Clear the accumulated live timeline before applying primaryCueUpdates. */
  resetPrimaryCues?: boolean;
  translatedCues?: SubtitleCue[];
  primaryMeta?: TrackMetadata;
  translatedMeta?: TrackMetadata;
  availableTracks?: AvailableTrackOption[];
  rateLimitedUntil?: number;
  liveCueBoundary?: boolean;
  /** Update cue timing/UI without starting another translation request. */
  skipTranslation?: boolean;
  /** Optional error message emitted by an extractor/interceptor (e.g. TRACK_ERROR). */
  error?: string;
}

export interface PlayerMainWorldContext {
  emitTracks(payload: CapturedTrackPayload): void;
  log(level: 'info' | 'warn' | 'error', message: string): void;
}

export interface PlayerPlugin {
  readonly id: string; // 'youtube-html5' | 'netflix-cadmium' | 'jwplayer' | 'playerjs' | 'videojs' | 'plyr' | 'html5'
  detectContainer(root?: ParentNode): HTMLElement | null;
  findVideo(container: HTMLElement | null, root?: ParentNode): HTMLVideoElement | null;
  isControlsHidden(container: HTMLElement): boolean;
  getSubtitleBottomOffset(container: HTMLElement): number;
  suppressNativeCaptions?(container: HTMLElement, suppress: boolean, activeCue?: ActiveCueSnapshot): () => void;
  selectTrackInPage?(trackIdOrUrl: string): void;
  initMainWorldProbe?(ctx: PlayerMainWorldContext): () => void;
}

export interface MediaIdentity {
  mediaId: string;          // stable video/episode ID
  serviceId: string;        // 'youtube' | 'netflix' | 'urplay' | 'hdrezka' | 'hianime' | 'custom-cinema'
  badgeLabel: string;       // short badge for vocabulary card ('YouTube', 'Netflix', 'UR Play', 'HDRezka')
  title: string;            // cleaned title without site suffixes
  canonicalUrl: string;     // full http(s) watch URL
  buildTimestampUrl?: (timestampSec: number) => string;
}

export interface ServiceCapabilities {
  readonly cueSeeking: boolean;
  readonly nativeTranslatedTrack: boolean;
  readonly dynamicModule: boolean; // false for core YouTube, true for optional dynamic modules
}

export interface ServiceDescriptor {
  readonly id: string;
  readonly name: string;
  readonly badgeLabel: string;
  readonly defaultSourceLang?: string;
  readonly hostMatches: readonly string[];
  readonly playerIframeMatches?: readonly string[];
  readonly capabilities: ServiceCapabilities;
}

export interface PlatformSessionCallbacks {
  onTracksLoaded: (data: CapturedTrackPayload) => void;
  onAdStateChange?: (isAd: boolean) => void;
  onVideoElementChange?: (video: HTMLVideoElement | null) => void;
  onLog?: (level: 'info' | 'warn' | 'error', message: string) => void;
}

export interface ServicePlugin extends ServiceDescriptor {
  readonly needsMainWorldInterceptor: boolean;
  readonly allFrames?: boolean;
  readonly players: readonly PlayerPlugin[]; // ordered list of supported players (last should be html5)

  matchesUrl(url: URL, frameChainHosts: readonly string[]): boolean;
  resolveMediaIdentity(url: URL, doc: Document): MediaIdentity | null;
  observeNavigation?(onNavigate: () => void): () => void;
  initMainWorldExtractor?(ctx: PlayerMainWorldContext): () => void;
  initIsolatedSession(callbacks: PlatformSessionCallbacks): () => void;
  requestTranslatedTrack?(targetLang: string): void;
  selectTrack?(trackIdOrUrl: string): void;
  captureFrame?(video: HTMLVideoElement): Promise<string | null>;
}

export interface TranslationProviderOptions {
  apiKey?: string;
  email?: string;
  signal?: AbortSignal;
}

export interface TranslationProviderPlugin {
  readonly id: string;
  readonly name: string;
  isAvailable(options?: TranslationProviderOptions): Promise<boolean> | boolean;
  translateWord(
    text: string,
    sourceLang: string,
    targetLang: string,
    options?: TranslationProviderOptions
  ): Promise<QuickTranslationResult | null>;
  translateBatch?(
    texts: string[],
    sourceLang: string,
    targetLang: string,
    options?: TranslationProviderOptions
  ): Promise<Array<string | null>>;
}
