export type ThemeId =
  | 'midnight-glass'
  | 'cinema-transparent'
  | 'nordic-frost'
  | 'warm-espresso'
  | 'emerald-noir'
  | 'oled-pure';

export type UiLanguage = 'en' | 'uk';

export type ControlsScale = 'sm' | 'md' | 'lg' | 'xl';

export const POPUP_SCALE_OPTIONS = [0.85, 1, 1.15, 1.3] as const;
export type PopupScale = (typeof POPUP_SCALE_OPTIONS)[number];

export type ActiveListeningMode = 'off' | 'blur' | 'hidden';

export type SubtitleTrackMode = 'dual' | 'translation' | 'original';

export type FontFamily =
  | 'sans'
  | 'inter'
  | 'rounded'
  | 'condensed'
  | 'readable'
  | 'serif'
  | 'slab'
  | 'mono';

export type FontWeight = 'normal' | 'bold';

export type TextOutline = 'none' | 'shadow' | 'outline';

export type TranslationProvider = 'mymemory' | 'deepl' | 'google' | 'googleDict';

export interface SubtitlePosition {
  xPercent: number;
  yPercent: number;
}

export interface SubtitleBoxSize {
  width: number;
  height: number;
}

export const DEFAULT_SUBTITLE_BOX_SIZE: SubtitleBoxSize = {
  width: 840,
  height: 96
};

export interface KeybindValue {
  code: string;
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
}

export type KeybindAction =
  | 'holdPeekAndPause'
  | 'repeatCue'
  | 'prevCue'
  | 'nextCue'
  | 'cycleSubtitleMode'
  | 'cycleTrackMode'
  | 'toggleAutoPause'
  | 'quickSaveCard';

export type KeybindingsMap = Record<KeybindAction, KeybindValue | null>;

export const DEFAULT_KEYBINDINGS: KeybindingsMap = {
  holdPeekAndPause: { code: 'AltLeft' },
  repeatCue: { code: 'KeyR' },
  prevCue: { code: 'BracketLeft' },
  nextCue: { code: 'BracketRight' },
  cycleSubtitleMode: { code: 'KeyB' },
  cycleTrackMode: { code: 'KeyT' },
  toggleAutoPause: { code: 'KeyP' },
  quickSaveCard: { code: 'KeyS' }
};

export interface LLMConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface UserSettings {
  enabled: boolean;
  uiLanguage: UiLanguage;
  nativeLang: string;
  sourceLang: string;
  secondaryLang: string;
  reversePair: boolean;
  subtitleTrackMode: SubtitleTrackMode;
  activeListeningMode: ActiveListeningMode;
  pauseOnAltHold: boolean;
  pauseTimerSeconds: number;
  autoPauseAfterCue: boolean;
  autoPauseOnWordClick: boolean;
  autoHideControls: boolean;
  showSystemLogs: boolean;
  controlsScale: ControlsScale;
  popupScale: number;
  subtitleFontSize: number;
  translationFontSize: number;
  translationScale: number;
  fontFamily: FontFamily;
  fontWeight: FontWeight;
  backdropOpacity: number;
  textOutline: TextOutline;
  subtitlePosition: SubtitlePosition | null;
  subtitleBoxFixed: boolean;
  subtitleBoxSize: SubtitleBoxSize | null;
  subtitleBoxCompact: boolean;
  subtitleOffsetSec: number;
  theme: ThemeId;
  fallbackModel: string;
  ankiDeckName: string;
  ankiConnectUrl: string;
  llm: LLMConfig;
  translationProvider: TranslationProvider;
  myMemoryEmail: string;
  deeplApiKey: string;
  enabledServices: Record<string, boolean>;
  customMirrors: string[];
  blacklistedDomains: string[];
  keybindings: KeybindingsMap;
}

export const DEFAULT_BLACKLISTED_DOMAINS: readonly string[] = [
  'youtube.com',
  'youtu.be',
  'music.youtube.com',
  'twitch.tv'
];

export const DEFAULT_SETTINGS: UserSettings = {
  enabled: true,
  uiLanguage: 'en',
  nativeLang: 'uk',
  sourceLang: 'auto',
  secondaryLang: 'en',
  reversePair: false,
  subtitleTrackMode: 'dual',
  activeListeningMode: 'off',
  pauseOnAltHold: true,
  pauseTimerSeconds: 0,
  autoPauseAfterCue: false,
  autoPauseOnWordClick: true,
  autoHideControls: true,
  showSystemLogs: true,
  controlsScale: 'md',
  popupScale: 1,
  subtitleFontSize: 20,
  translationFontSize: 17,
  translationScale: 0.85,
  fontFamily: 'sans',
  fontWeight: 'normal',
  backdropOpacity: 80,
  textOutline: 'shadow',
  subtitlePosition: null,
  subtitleBoxFixed: false,
  subtitleBoxSize: null,
  subtitleBoxCompact: false,
  subtitleOffsetSec: 0,
  theme: 'midnight-glass',
  fallbackModel: 'gemini-2.0-flash-lite',
  ankiDeckName: 'YouTube Lang AI',
  ankiConnectUrl: 'http://127.0.0.1:8765',
  llm: {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    apiKey: '',
    model: 'gemini-2.0-flash'
  },
  translationProvider: 'googleDict',
  myMemoryEmail: '',
  deeplApiKey: '',
  enabledServices: {
    youtube: true
  },
  customMirrors: [],
  blacklistedDomains: [...DEFAULT_BLACKLISTED_DOMAINS],
  keybindings: { ...DEFAULT_KEYBINDINGS }
};
