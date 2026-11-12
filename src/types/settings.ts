export interface LLMConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface UserSettings {
  enabled: boolean;
  nativeLang: string;
  showDualSubtitles: boolean;
  activeListeningMode: boolean;
  autoPauseAfterCue: boolean;
  autoPauseOnWordClick: boolean;
  subtitleFontSize: number;
  ankiDeckName: string;
  ankiConnectUrl: string;
  llm: LLMConfig;
}

export const DEFAULT_SETTINGS: UserSettings = {
  enabled: true,
  nativeLang: 'ru',
  showDualSubtitles: true,
  activeListeningMode: false,
  autoPauseAfterCue: false,
  autoPauseOnWordClick: true,
  subtitleFontSize: 20,
  ankiDeckName: 'YouTube Lang AI',
  ankiConnectUrl: 'http://127.0.0.1:8765',
  llm: {
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-4o-mini'
  }
};
