// HUD Components & Hooks
export { PlayerControls, type PlayerControlsProps } from './hud/PlayerControls';
export {
  SubtitleOverlay,
  type SubtitleOverlayProps,
  type WordSelectionPayload
} from './hud/SubtitleOverlay';
export { ToolbarPopover, type PopoverLayout, type ToolbarPopoverProps } from './hud/ToolbarPopover';
export { WordPopup, type WordPopupProps } from './hud/WordPopup';
export {
  resolveHostPlayerContainer,
  useDraggableSubtitleBox,
  type UseDraggableSubtitleBoxOptions,
  type UseDraggableSubtitleBoxResult
} from './hud/hooks/useDraggableSubtitleBox';
export {
  useResizableSubtitleBox,
  type ResizeHandle,
  type UseResizableSubtitleBoxOptions,
  type UseResizableSubtitleBoxResult
} from './hud/hooks/useResizableSubtitleBox';

// Popup Components
export { App, PopupApp, type AppTab, type PopupAppProps } from './popup/App';
export { CardThumbnail, useCardMediaUrl, type CardThumbnailProps } from './popup/CardThumbnail';
export { FlashcardTrainer, type FlashcardTrainerProps } from './popup/FlashcardTrainer';
export { MarqueeText, type MarqueeTextProps } from './popup/MarqueeText';
export { SettingsPanel, type SettingsPanelProps } from './popup/SettingsPanel';
export { ThemeDropdown, type ThemeDropdownProps } from './popup/ThemeDropdown';
export { ToggleSwitch, type ToggleSwitchProps } from './popup/ToggleSwitch';
export { VocabularyList, type VocabularyListProps } from './popup/VocabularyList';
export { GeneralTab, type GeneralTabProps } from './popup/settings/GeneralTab';
export { HotkeysTab, type HotkeysTabProps } from './popup/settings/HotkeysTab';
export { IntegrationsTab, type IntegrationsTabProps } from './popup/settings/IntegrationsTab';
export { PlayerTab, type PlayerTabProps } from './popup/settings/PlayerTab';
export { StyleTab, type StyleTabProps } from './popup/settings/StyleTab';

// Styles & Themes
export {
  FONT_FAMILY_OPTIONS,
  FONT_FAMILY_STACKS,
  THEMES,
  THEME_LIST,
  type FontFamilyOption,
  type ThemeDefinition
} from './styles/themes';

// i18n
export {
  UI_TRANSLATIONS,
  getUiStrings,
  type UiTranslationStrings
} from './i18n/translations';

// Utilities
export {
  buildTelegramShareUrl,
  downloadVocabularyCsv,
  formatCardsForTelegram,
  generateVocabularyCsv,
  resolveCardSourceUrl
} from './utils/export';
export {
  KEYBIND_ACTION_LABELS,
  findKeybindConflict,
  formatKeybind,
  getKeybindActionLabels,
  isHoldKeybindRelease,
  isSameKeybind,
  matchesHoldKeybind,
  matchesTapKeybind,
  type KeybindLabelsMap
} from './utils/keybinds';
export {
  LANGUAGE_OPTIONS,
  SOURCE_LANGUAGE_OPTIONS,
  formatShortLangCode,
  getLanguageLabel,
  isSameBaseLang,
  normalizeLanguageCode,
  resolveLanguagePair,
  type LanguageOption,
  type ResolvedLanguagePair
} from './utils/languages';
export {
  isLlmConfigured,
  isLocalBaseUrl,
  resolveChatCompletionsUrl
} from './utils/llm';
export {
  ensureHostPermissionForUrl,
  hasHostPermissionForUrl,
  toOriginPermissionPattern
} from './utils/permissions';
export { speakText } from './utils/tts';
