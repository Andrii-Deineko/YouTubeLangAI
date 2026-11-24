export type ThemeId =
  | 'midnight-glass'
  | 'cinema-transparent'
  | 'nordic-frost'
  | 'warm-espresso'
  | 'emerald-noir';

export type SubtitleScale = 'sm' | 'md' | 'lg' | 'xl' | 'tv';

export type ControlsScale = 'sm' | 'md' | 'lg' | 'xl';

export type ActiveListeningMode = 'off' | 'blur' | 'hidden';

export type FontFamily = 'sans' | 'serif' | 'mono';

export type FontWeight = 'normal' | 'bold';

export type TextOutline = 'none' | 'shadow' | 'outline';

export interface SubtitlePosition {
  xPercent: number;
  yPercent: number;
}

export interface LLMConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface UserSettings {
  enabled: boolean;
  nativeLang: string;
  videoLang: string;
  showDualSubtitles: boolean;
  showTranslation: boolean;
  activeListeningMode: ActiveListeningMode;
  pauseOnAltReveal: boolean;
  pauseOnAltHold: boolean;
  pauseTimerSeconds: number;
  autoPauseAfterCue: boolean;
  autoPauseOnWordClick: boolean;
  autoHideControls: boolean;
  controlsScale?: ControlsScale;
  subtitleFontSize: number;
  fontSize: number;
  translationScale: number;
  fontFamily: FontFamily;
  fontWeight: FontWeight;
  backdropOpacity: number;
  textOutline: TextOutline;
  subtitleScale: SubtitleScale;
  subtitlePosition: SubtitlePosition | null;
  subtitleOffsetSec: number;
  theme: ThemeId;
  overlayOpacity: number;
  fallbackModel: string;
  ankiDeckName: string;
  ankiConnectUrl: string;
  llm: LLMConfig;
  cinemaModuleEnabled: boolean;
  customMirrors: string[];
  blacklistedDomains: string[];
}

export const DEFAULT_BLACKLISTED_DOMAINS: readonly string[] = [
  'youtube.com',
  'youtu.be',
  'music.youtube.com',
  'twitch.tv'
];

export const DEFAULT_SETTINGS: UserSettings = {
  enabled: true,
  nativeLang: 'ru',
  videoLang: 'en',
  showDualSubtitles: true,
  showTranslation: true,
  activeListeningMode: 'off',
  pauseOnAltReveal: false,
  pauseOnAltHold: true,
  pauseTimerSeconds: 0,
  autoPauseAfterCue: false,
  autoPauseOnWordClick: true,
  autoHideControls: true,
  controlsScale: 'md',
  subtitleFontSize: 20,
  fontSize: 20,
  translationScale: 0.85,
  fontFamily: 'sans',
  fontWeight: 'normal',
  backdropOpacity: 80,
  textOutline: 'shadow',
  subtitleScale: 'md',
  subtitlePosition: null,
  subtitleOffsetSec: 0,
  theme: 'midnight-glass',
  overlayOpacity: 0.85,
  fallbackModel: 'gemini-1.5-flash',
  ankiDeckName: 'YouTube Lang AI',
  ankiConnectUrl: 'http://127.0.0.1:8765',
  llm: {
    baseUrl: 'https://generativelanguage.googleapis.com',
    apiKey: '',
    model: 'gemini-1.5-flash'
  },
  cinemaModuleEnabled: false,
  customMirrors: [],
  blacklistedDomains: [...DEFAULT_BLACKLISTED_DOMAINS]
};
