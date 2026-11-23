export interface LLMConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

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

export interface UserSettings {
  enabled: boolean;
  nativeLang: string;
  showDualSubtitles: boolean;
  showTranslation: boolean;
  activeListeningMode: ActiveListeningMode;
  autoPauseAfterCue: boolean;
  autoPauseOnWordClick: boolean;
  autoHideControls: boolean;
  controlsScale?: ControlsScale;
  subtitleFontSize: number;
  subtitleScale: SubtitleScale;
  subtitlePosition: SubtitlePosition | null;
  theme: ThemeId;
  overlayOpacity: number;
  fallbackModel: string;
  ankiDeckName: string;
  ankiConnectUrl: string;
  llm: LLMConfig;
  customMirrors?: string[];
  blacklistedDomains?: string[];
}

export const DEFAULT_SETTINGS: UserSettings = {
  enabled: true,
  nativeLang: 'ru',
  showDualSubtitles: true,
  showTranslation: true,
  activeListeningMode: 'off',
  autoPauseAfterCue: false,
  autoPauseOnWordClick: true,
  autoHideControls: true,
  controlsScale: 'md',
  subtitleFontSize: 20,
  subtitleScale: 'md',
  subtitlePosition: null,
  theme: 'midnight-glass',
  overlayOpacity: 0.85,
  fallbackModel: '',
  ankiDeckName: 'YouTube Lang AI',
  ankiConnectUrl: 'http://127.0.0.1:8765',
  llm: {
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-4o-mini'
  },
  customMirrors: [],
  blacklistedDomains: []
};
