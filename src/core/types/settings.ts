export type ThemeId =
  | 'midnight-glass'
  | 'cinema-transparent'
  | 'nordic-frost'
  | 'warm-espresso'
  | 'emerald-noir';

export type SubtitleScale = 'sm' | 'md' | 'lg' | 'xl' | 'tv';

export type ControlsScale = 'sm' | 'md' | 'lg' | 'xl';

export type ActiveListeningMode = 'off' | 'blur' | 'hidden';

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
  autoPauseAfterCue: boolean;
  autoPauseOnWordClick: boolean;
  autoHideControls: boolean;
  controlsScale?: ControlsScale;
  subtitleFontSize: number;
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

export const DEFAULT_CINEMA_SITES: readonly string[] = [
  'localhost',
  '127.0.0.1',
  'rezka.ag',
  'hdrezka.ag',
  'hdrezka.me',
  'hdrezka.ac',
  'hdrezka.cm',
  'hdrezka.co',
  'hdrezka.tv',
  'hdrezka.app',
  'hdrezka.re',
  'hdrezka-ag.com',
  '9animetv.to',
  '9anime.to',
  '9anime.pl',
  'hianime.to',
  'megacloud.tv',
  'vidplay.online',
  'filemoon.sx',
  'rabbitstream.net',
  'streamguard.cc',
  'voidboost.net',
  'voidboost.cc'
];

export const DEFAULT_SETTINGS: UserSettings = {
  enabled: true,
  nativeLang: 'ru',
  videoLang: 'en',
  showDualSubtitles: true,
  showTranslation: true,
  activeListeningMode: 'off',
  pauseOnAltReveal: false,
  autoPauseAfterCue: false,
  autoPauseOnWordClick: true,
  autoHideControls: true,
  controlsScale: 'md',
  subtitleFontSize: 20,
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
