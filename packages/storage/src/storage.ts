import {
  DEFAULT_BLACKLISTED_DOMAINS,
  DEFAULT_KEYBINDINGS,
  DEFAULT_SETTINGS,
  type ActiveListeningMode,
  type ControlsScale,
  type FontFamily,
  type FontWeight,
  type KeybindAction,
  type KeybindingsMap,
  type LLMConfig,
  type SubtitleBoxSize,
  type SubtitlePosition,
  type SubtitleTrackMode,
  type TextOutline,
  type ThemeId,
  type TranslationProvider,
  type UserSettings,
  type VocabularyCard
} from '@langai/contracts';
import {
  deleteVocabularyCardFromDB,
  getAllVocabularyCardsFromDB,
  getVocabularyCardsByMediaIdFromDB,
  putVocabularyCardInDB,
  saveCardMedia
} from './db';
import { STORAGE_LOCK_NAME, withStorageLock } from './lock';

export const SETTINGS_KEY = 'langai_settings';
export const MIGRATION_FLAG_KEY = 'langai_migrated_v2';
export const LEGACY_SETTINGS_KEYS = ['cinelingua_settings', 'yt_lang_ai_settings'] as const;
export const LEGACY_VOCABULARY_KEYS = ['cinelingua_vocabulary', 'yt_lang_ai_vocabulary'] as const;
export const MODELS_CACHE_KEY = 'langai_models_cache';
export const LEGACY_MODELS_CACHE_KEY = 'cinelingua_models_cache';
export const VOCAB_VERSION_KEY = 'langai_vocab_version';

const LEGACY_CAPTION_INDEX_KEY = 'ytai_caption_cache_index';
const LEGACY_CAPTION_PREFIX = 'ytai_cap_';

const VALID_THEMES: readonly ThemeId[] = [
  'midnight-glass',
  'cinema-transparent',
  'nordic-frost',
  'warm-espresso',
  'emerald-noir',
  'oled-pure'
];

const VALID_CONTROLS_SCALES: readonly ControlsScale[] = ['sm', 'md', 'lg', 'xl'];

const VALID_TRANSLATION_PROVIDERS: readonly TranslationProvider[] = [
  'mymemory',
  'google',
  'googleDict',
  'deepl'
];

let migrationInMemoryDone = false;
let migrationPromise: Promise<void> | null = null;

const vocabListeners = new Set<(cards: VocabularyCard[]) => void>();

function isChromeStorageAvailable(): boolean {
  try {
    return (
      typeof chrome !== 'undefined' &&
      Boolean(chrome?.storage?.local) &&
      Boolean(chrome?.runtime?.id)
    );
  } catch {
    return false;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export interface CachedModelsState {
  baseUrl: string;
  models: string[];
  updatedAt: string;
}

export async function getCachedModels(): Promise<CachedModelsState | null> {
  try {
    if (!isChromeStorageAvailable()) return null;
    const result = await chrome.storage.local.get([MODELS_CACHE_KEY, LEGACY_MODELS_CACHE_KEY]);
    const raw = (result[MODELS_CACHE_KEY] ?? result[LEGACY_MODELS_CACHE_KEY]) as
      | Partial<CachedModelsState>
      | undefined;
    if (!raw || typeof raw.baseUrl !== 'string' || !Array.isArray(raw.models)) {
      return null;
    }
    return {
      baseUrl: raw.baseUrl,
      models: raw.models.filter((item): item is string => typeof item === 'string'),
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : ''
    };
  } catch {
    return null;
  }
}

export async function saveCachedModels(state: CachedModelsState): Promise<void> {
  return withStorageLock(STORAGE_LOCK_NAME, async () => {
    try {
      if (isChromeStorageAvailable()) {
        await chrome.storage.local.set({ [MODELS_CACHE_KEY]: state });
      }
    } catch {
      // ignore
    }
  });
}

export function parseActiveListeningMode(rawVal: unknown): ActiveListeningMode {
  if (rawVal === 'blur' || rawVal === 'hidden' || rawVal === 'off') {
    return rawVal;
  }
  if (rawVal === true) return 'blur';
  return 'off';
}

export function parseFontFamily(rawVal: unknown): FontFamily {
  if (
    rawVal === 'sans' ||
    rawVal === 'inter' ||
    rawVal === 'rounded' ||
    rawVal === 'condensed' ||
    rawVal === 'readable' ||
    rawVal === 'serif' ||
    rawVal === 'slab' ||
    rawVal === 'mono'
  ) {
    return rawVal;
  }
  return 'sans';
}

export function parseFontWeight(rawVal: unknown): FontWeight {
  if (rawVal === 'normal' || rawVal === 'bold') {
    return rawVal;
  }
  return 'normal';
}

export function parseTextOutline(rawVal: unknown): TextOutline {
  if (rawVal === 'none' || rawVal === 'shadow' || rawVal === 'outline') {
    return rawVal;
  }
  return 'shadow';
}

function parseThemeId(rawVal: unknown): ThemeId {
  if (typeof rawVal === 'string' && (VALID_THEMES as readonly string[]).includes(rawVal)) {
    return rawVal as ThemeId;
  }
  return DEFAULT_SETTINGS.theme;
}

function parseControlsScale(rawVal: unknown): ControlsScale {
  if (
    typeof rawVal === 'string' &&
    (VALID_CONTROLS_SCALES as readonly string[]).includes(rawVal)
  ) {
    return rawVal as ControlsScale;
  }
  return DEFAULT_SETTINGS.controlsScale;
}

function parseTranslationProvider(rawVal: unknown): TranslationProvider {
  if (
    typeof rawVal === 'string' &&
    (VALID_TRANSLATION_PROVIDERS as readonly string[]).includes(rawVal)
  ) {
    return rawVal as TranslationProvider;
  }
  return DEFAULT_SETTINGS.translationProvider;
}

function parseSubtitleTrackMode(obj: Record<string, unknown>): SubtitleTrackMode {
  const mode = obj.subtitleTrackMode;
  if (mode === 'dual' || mode === 'translation' || mode === 'original') {
    return mode;
  }

  const showDual = obj.showDualSubtitles;
  const showTrans = obj.showTranslation;
  const secondTrack = obj.secondTrackEnabled;

  if (showDual === true) {
    return 'dual';
  }
  if (showTrans === true && showDual === false) {
    return 'translation';
  }
  if (showTrans === false || showDual === false || secondTrack === false) {
    return 'original';
  }

  return DEFAULT_SETTINGS.subtitleTrackMode;
}

function parseBackdropOpacity(obj: Record<string, unknown>): number {
  if (typeof obj.backdropOpacity === 'number' && Number.isFinite(obj.backdropOpacity)) {
    return Math.max(0, Math.min(100, Math.round(obj.backdropOpacity)));
  }
  if (typeof obj.overlayOpacity === 'number' && Number.isFinite(obj.overlayOpacity)) {
    const rawOverlay = obj.overlayOpacity;
    const scaled = rawOverlay >= 0 && rawOverlay <= 1 ? rawOverlay * 100 : rawOverlay;
    return Math.max(0, Math.min(100, Math.round(scaled)));
  }
  return DEFAULT_SETTINGS.backdropOpacity;
}

function parseLLMConfig(obj: Record<string, unknown>): LLMConfig {
  const rawLlm = asRecord(obj.llm ?? obj.ai);
  return {
    baseUrl:
      typeof rawLlm.baseUrl === 'string' ? rawLlm.baseUrl : DEFAULT_SETTINGS.llm.baseUrl,
    apiKey: typeof rawLlm.apiKey === 'string' ? rawLlm.apiKey : DEFAULT_SETTINGS.llm.apiKey,
    model: typeof rawLlm.model === 'string' ? rawLlm.model : DEFAULT_SETTINGS.llm.model
  };
}

function parseEnabledServices(obj: Record<string, unknown>): Record<string, boolean> {
  const enabledServices: Record<string, boolean> = { ...DEFAULT_SETTINGS.enabledServices };

  if (typeof obj.cinemaModuleEnabled === 'boolean') {
    enabledServices.urplay = obj.cinemaModuleEnabled;
    enabledServices.hdrezka = obj.cinemaModuleEnabled;
    enabledServices.hianime = obj.cinemaModuleEnabled;
  }

  if (typeof obj.netflixModuleEnabled === 'boolean') {
    enabledServices.netflix = obj.netflixModuleEnabled;
  }

  const rawServices = asRecord(obj.enabledServices);
  for (const [serviceId, enabled] of Object.entries(rawServices)) {
    if (typeof enabled === 'boolean') {
      enabledServices[serviceId] = enabled;
    }
  }

  return enabledServices;
}

function parseKeybindings(obj: Record<string, unknown>): KeybindingsMap {
  const rawKeybindings = asRecord(obj.keybindings);
  const keybindings: KeybindingsMap = { ...DEFAULT_KEYBINDINGS };

  for (const action of Object.keys(DEFAULT_KEYBINDINGS) as KeybindAction[]) {
    if (action in rawKeybindings) {
      const val = rawKeybindings[action];
      if (val === null) {
        keybindings[action] = null;
      } else if (val && typeof val === 'object' && 'code' in val) {
        const item = val as { code?: unknown; ctrl?: unknown; alt?: unknown; shift?: unknown };
        if (typeof item.code === 'string' && item.code.trim()) {
          keybindings[action] = {
            code: item.code.trim(),
            ...(item.ctrl === true ? { ctrl: true } : {}),
            ...(item.alt === true ? { alt: true } : {}),
            ...(item.shift === true ? { shift: true } : {})
          };
        }
      }
    }
  }

  return keybindings;
}

export function mergeSettings(raw: unknown): UserSettings {
  const obj = asRecord(raw);

  const enabled =
    typeof obj.enabled === 'boolean'
      ? obj.enabled
      : typeof obj.overlayEnabled === 'boolean'
        ? obj.overlayEnabled
        : DEFAULT_SETTINGS.enabled;

  const uiLanguage = obj.uiLanguage === 'uk' ? 'uk' : 'en';

  const nativeLang =
    typeof obj.nativeLang === 'string' && obj.nativeLang.trim()
      ? obj.nativeLang.trim()
      : DEFAULT_SETTINGS.nativeLang;

  const sourceLang =
    typeof obj.sourceLang === 'string' && obj.sourceLang.trim()
      ? obj.sourceLang.trim()
      : DEFAULT_SETTINGS.sourceLang;

  const secondaryLang =
    typeof obj.secondaryLang === 'string' && obj.secondaryLang.trim()
      ? obj.secondaryLang.trim()
      : nativeLang === 'en'
        ? 'ru'
        : DEFAULT_SETTINGS.secondaryLang;

  const reversePair =
    typeof obj.reversePair === 'boolean' ? obj.reversePair : DEFAULT_SETTINGS.reversePair;

  const subtitleTrackMode = parseSubtitleTrackMode(obj);
  const activeListeningMode = parseActiveListeningMode(
    obj.activeListeningMode ?? obj.activeListening
  );

  const pauseOnAltHold =
    typeof obj.pauseOnAltHold === 'boolean'
      ? obj.pauseOnAltHold
      : DEFAULT_SETTINGS.pauseOnAltHold;

  const rawPauseTimer =
    typeof obj.pauseTimerSeconds === 'number' && Number.isFinite(obj.pauseTimerSeconds)
      ? obj.pauseTimerSeconds
      : typeof obj.autoPauseResumeDelaySec === 'number' &&
          Number.isFinite(obj.autoPauseResumeDelaySec)
        ? obj.autoPauseResumeDelaySec
        : DEFAULT_SETTINGS.pauseTimerSeconds;
  const pauseTimerSeconds = Math.max(0, Math.min(300, rawPauseTimer));

  const autoPauseAfterCue =
    typeof obj.autoPauseAfterCue === 'boolean'
      ? obj.autoPauseAfterCue
      : typeof obj.autoPauseAtCueEnd === 'boolean'
        ? obj.autoPauseAtCueEnd
        : DEFAULT_SETTINGS.autoPauseAfterCue;

  const autoPauseOnWordClick =
    typeof obj.autoPauseOnWordClick === 'boolean'
      ? obj.autoPauseOnWordClick
      : DEFAULT_SETTINGS.autoPauseOnWordClick;

  const autoHideControls =
    typeof obj.autoHideControls === 'boolean'
      ? obj.autoHideControls
      : DEFAULT_SETTINGS.autoHideControls;

  const showSystemLogs =
    typeof obj.showSystemLogs === 'boolean'
      ? obj.showSystemLogs
      : DEFAULT_SETTINGS.showSystemLogs;

  const controlsScale = parseControlsScale(obj.controlsScale);

  const rawPopupScale =
    typeof obj.popupScale === 'number' && Number.isFinite(obj.popupScale)
      ? obj.popupScale
      : DEFAULT_SETTINGS.popupScale;
  const popupScale = Math.round(Math.max(0.85, Math.min(1.3, rawPopupScale)) * 100) / 100;

  const rawSubtitleFontSize =
    typeof obj.subtitleFontSize === 'number' && Number.isFinite(obj.subtitleFontSize)
      ? obj.subtitleFontSize
      : typeof obj.fontSize === 'number' && Number.isFinite(obj.fontSize)
        ? obj.fontSize
        : DEFAULT_SETTINGS.subtitleFontSize;
  const subtitleFontSize = Math.max(12, Math.min(56, rawSubtitleFontSize));

  const translationScale =
    typeof obj.translationScale === 'number' &&
    [0.75, 0.85, 1.0, 1.15].includes(obj.translationScale)
      ? obj.translationScale
      : DEFAULT_SETTINGS.translationScale;

  const rawTranslationFontSize =
    typeof obj.translationFontSize === 'number' && Number.isFinite(obj.translationFontSize)
      ? obj.translationFontSize
      : Math.round(subtitleFontSize * translationScale);
  const translationFontSize = Math.max(
    12,
    Math.min(48, Math.round(rawTranslationFontSize))
  );

  const fontFamily = parseFontFamily(obj.fontFamily);
  const fontWeight = parseFontWeight(obj.fontWeight);
  const backdropOpacity = parseBackdropOpacity(obj);
  const textOutline = parseTextOutline(obj.textOutline);

  const rawPos = asRecord(obj.subtitlePosition);
  const subtitlePosition: SubtitlePosition | null =
    typeof rawPos.xPercent === 'number' &&
    Number.isFinite(rawPos.xPercent) &&
    typeof rawPos.yPercent === 'number' &&
    Number.isFinite(rawPos.yPercent)
      ? { xPercent: rawPos.xPercent, yPercent: rawPos.yPercent }
      : null;

  const subtitleBoxFixed =
    typeof obj.subtitleBoxFixed === 'boolean'
      ? obj.subtitleBoxFixed
      : DEFAULT_SETTINGS.subtitleBoxFixed;

  const rawBoxSize = asRecord(obj.subtitleBoxSize);
  const subtitleBoxSize: SubtitleBoxSize | null =
    typeof rawBoxSize.width === 'number' &&
    Number.isFinite(rawBoxSize.width) &&
    rawBoxSize.width > 0 &&
    typeof rawBoxSize.height === 'number' &&
    Number.isFinite(rawBoxSize.height) &&
    rawBoxSize.height > 0
      ? {
          width: Math.max(160, Math.round(rawBoxSize.width)),
          height: Math.max(36, Math.round(rawBoxSize.height))
        }
      : null;

  const subtitleBoxCompact =
    typeof obj.subtitleBoxCompact === 'boolean'
      ? obj.subtitleBoxCompact
      : DEFAULT_SETTINGS.subtitleBoxCompact;

  const subtitleOffsetSec =
    typeof obj.subtitleOffsetSec === 'number' && Number.isFinite(obj.subtitleOffsetSec)
      ? obj.subtitleOffsetSec
      : DEFAULT_SETTINGS.subtitleOffsetSec;

  const theme = parseThemeId(obj.theme);

  const fallbackModel =
    typeof obj.fallbackModel === 'string'
      ? obj.fallbackModel
      : DEFAULT_SETTINGS.fallbackModel;

  const rawAnki = asRecord(obj.anki);
  const ankiDeckName =
    typeof obj.ankiDeckName === 'string' && obj.ankiDeckName.trim()
      ? obj.ankiDeckName
      : typeof rawAnki.deckName === 'string' && rawAnki.deckName.trim()
        ? rawAnki.deckName
        : DEFAULT_SETTINGS.ankiDeckName;

  const ankiConnectUrl =
    typeof obj.ankiConnectUrl === 'string' && obj.ankiConnectUrl.trim()
      ? obj.ankiConnectUrl
      : typeof rawAnki.url === 'string' && rawAnki.url.trim()
        ? rawAnki.url
        : DEFAULT_SETTINGS.ankiConnectUrl;

  const llm = parseLLMConfig(obj);
  const translationProvider = parseTranslationProvider(obj.translationProvider);

  const myMemoryEmail =
    typeof obj.myMemoryEmail === 'string'
      ? obj.myMemoryEmail.trim()
      : DEFAULT_SETTINGS.myMemoryEmail;

  const deeplApiKey =
    typeof obj.deeplApiKey === 'string'
      ? obj.deeplApiKey.trim()
      : DEFAULT_SETTINGS.deeplApiKey;

  const enabledServices = parseEnabledServices(obj);

  const customMirrors = Array.isArray(obj.customMirrors)
    ? obj.customMirrors.filter((item): item is string => typeof item === 'string')
    : [];

  const blacklistedDomains = Array.isArray(obj.blacklistedDomains)
    ? obj.blacklistedDomains.filter((item): item is string => typeof item === 'string')
    : [...DEFAULT_BLACKLISTED_DOMAINS];

  const keybindings = parseKeybindings(obj);

  return {
    enabled,
    uiLanguage,
    nativeLang,
    sourceLang,
    secondaryLang,
    reversePair,
    subtitleTrackMode,
    activeListeningMode,
    pauseOnAltHold,
    pauseTimerSeconds,
    autoPauseAfterCue,
    autoPauseOnWordClick,
    autoHideControls,
    showSystemLogs,
    controlsScale,
    popupScale,
    subtitleFontSize,
    translationFontSize,
    translationScale,
    fontFamily,
    fontWeight,
    backdropOpacity,
    textOutline,
    subtitlePosition,
    subtitleBoxFixed,
    subtitleBoxSize,
    subtitleBoxCompact,
    subtitleOffsetSec,
    theme,
    fallbackModel,
    ankiDeckName,
    ankiConnectUrl,
    llm,
    translationProvider,
    myMemoryEmail,
    deeplApiKey,
    enabledServices,
    customMirrors,
    blacklistedDomains,
    keybindings
  };
}

function inferLegacyCardSource(rawCard: Record<string, unknown>): {
  source: string;
  sourceLabel: string;
} {
  if (typeof rawCard.source === 'string' && rawCard.source.trim()) {
    const src = rawCard.source.trim();
    const label =
      typeof rawCard.sourceLabel === 'string' && rawCard.sourceLabel.trim()
        ? rawCard.sourceLabel.trim()
        : src === 'youtube'
          ? 'YouTube'
          : src === 'netflix'
            ? 'Netflix'
            : src;
    return { source: src, sourceLabel: label };
  }

  const videoId = typeof rawCard.videoId === 'string' ? rawCard.videoId : '';
  if (videoId.includes('rezka')) return { source: 'hdrezka', sourceLabel: 'HDRezka' };
  if (videoId.includes('anime')) return { source: 'hianime', sourceLabel: 'HiAnime' };
  if (videoId.includes('netflix')) return { source: 'netflix', sourceLabel: 'Netflix' };
  if (videoId.includes('cinema') || videoId.includes('/')) {
    return { source: 'cinema', sourceLabel: 'Cinema' };
  }
  return { source: 'youtube', sourceLabel: 'YouTube' };
}

function normalizeLegacyVocabularyCard(raw: unknown): VocabularyCard | null {
  const obj = asRecord(raw);
  if (typeof obj.id !== 'string' || !obj.id.trim() || typeof obj.word !== 'string') {
    return null;
  }

  const { source, sourceLabel } = inferLegacyCardSource(obj);
  const fsrs = asRecord(obj.fsrsState);
  const screenshotBase64 =
    typeof obj.screenshotBase64 === 'string' && obj.screenshotBase64.startsWith('data:image/')
      ? obj.screenshotBase64
      : null;

  return {
    id: obj.id,
    word: obj.word,
    lemma: typeof obj.lemma === 'string' ? obj.lemma : obj.word,
    translation: typeof obj.translation === 'string' ? obj.translation : '',
    aiExplanation: (obj.aiExplanation as VocabularyCard['aiExplanation']) ?? null,
    contextSentence: typeof obj.contextSentence === 'string' ? obj.contextSentence : '',
    contextTranslation:
      typeof obj.contextTranslation === 'string' ? obj.contextTranslation : '',
    videoId: typeof obj.videoId === 'string' ? obj.videoId : '',
    videoTitle: typeof obj.videoTitle === 'string' ? obj.videoTitle : '',
    timestampSec: typeof obj.timestampSec === 'number' ? obj.timestampSec : 0,
    ...(typeof obj.mediaBlobKey === 'string' && obj.mediaBlobKey
      ? { mediaBlobKey: obj.mediaBlobKey }
      : {}),
    ...(screenshotBase64 ? { screenshotBase64 } : {}),
    sourceLang: typeof obj.sourceLang === 'string' ? obj.sourceLang : 'auto',
    nativeLang: typeof obj.nativeLang === 'string' ? obj.nativeLang : 'en',
    createdAt:
      typeof obj.createdAt === 'string' ? obj.createdAt : new Date().toISOString(),
    fsrsState: {
      due: typeof fsrs.due === 'string' ? fsrs.due : new Date().toISOString(),
      stability: typeof fsrs.stability === 'number' ? fsrs.stability : 0,
      difficulty: typeof fsrs.difficulty === 'number' ? fsrs.difficulty : 0,
      elapsed_days: typeof fsrs.elapsed_days === 'number' ? fsrs.elapsed_days : 0,
      scheduled_days: typeof fsrs.scheduled_days === 'number' ? fsrs.scheduled_days : 0,
      learning_steps: typeof fsrs.learning_steps === 'number' ? fsrs.learning_steps : 0,
      reps: typeof fsrs.reps === 'number' ? fsrs.reps : 0,
      lapses: typeof fsrs.lapses === 'number' ? fsrs.lapses : 0,
      state: typeof fsrs.state === 'number' ? fsrs.state : 0,
      ...(typeof fsrs.last_review === 'string' ? { last_review: fsrs.last_review } : {})
    },
    source,
    sourceLabel,
    ...(typeof obj.sourceUrl === 'string' && obj.sourceUrl.trim()
      ? { sourceUrl: obj.sourceUrl.trim() }
      : {}),
    ...(typeof obj.sourceTitle === 'string' ? { sourceTitle: obj.sourceTitle } : {})
  };
}

/**
 * One-time idempotent migration from legacy storage keys (`cinelingua_*`, `yt_lang_ai_*`)
 * into unified `langai_settings` (chrome.storage.local) and IndexedDB (`vocabulary_cards` + `card_media`).
 */
export async function migrateLegacyStorageIfNeeded(): Promise<void> {
  if (migrationInMemoryDone || !isChromeStorageAvailable()) {
    return;
  }

  if (migrationPromise) {
    return migrationPromise;
  }

  migrationPromise = withStorageLock(STORAGE_LOCK_NAME, async () => {
    try {
      const keysToRead = [
        MIGRATION_FLAG_KEY,
        SETTINGS_KEY,
        ...LEGACY_SETTINGS_KEYS,
        ...LEGACY_VOCABULARY_KEYS
      ];
      const result = await chrome.storage.local.get(keysToRead);

      if (result[MIGRATION_FLAG_KEY] === true) {
        migrationInMemoryDone = true;
        return;
      }

      // 1. Migrate settings if langai_settings does not already exist
      if (result[SETTINGS_KEY] === undefined) {
        const legacyRaw = result[LEGACY_SETTINGS_KEYS[0]] ?? result[LEGACY_SETTINGS_KEYS[1]];
        if (legacyRaw !== undefined) {
          const migratedSettings = mergeSettings(legacyRaw);
          await chrome.storage.local.set({ [SETTINGS_KEY]: migratedSettings });
        }
      }

      // 2. Migrate vocabulary cards into IndexedDB (vocabulary_cards + card_media)
      const legacyVocab =
        result[LEGACY_VOCABULARY_KEYS[0]] ?? result[LEGACY_VOCABULARY_KEYS[1]];
      if (Array.isArray(legacyVocab) && legacyVocab.length > 0) {
        for (const item of legacyVocab) {
          const normalized = normalizeLegacyVocabularyCard(item);
          if (!normalized) continue;

          if (normalized.screenshotBase64) {
            const mediaKey = normalized.mediaBlobKey || `media:${normalized.id}`;
            try {
              await saveCardMedia(mediaKey, normalized.screenshotBase64);
              normalized.mediaBlobKey = mediaKey;
              normalized.screenshotBase64 = null;
            } catch {
              // Keep card even if media blob conversion fails
            }
          }

          await putVocabularyCardInDB(normalized);
        }
      }

      // 3. Clean up any orphaned legacy ytai_cap_* keys
      try {
        const allItems = await chrome.storage.local.get(null);
        const orphanKeys = Object.keys(allItems).filter(
          (k) => k === LEGACY_CAPTION_INDEX_KEY || k.startsWith(LEGACY_CAPTION_PREFIX)
        );
        if (orphanKeys.length > 0) {
          await chrome.storage.local.remove(orphanKeys);
        }
      } catch {
        // Ignore orphan cleanup errors
      }

      await chrome.storage.local.set({ [MIGRATION_FLAG_KEY]: true });
      migrationInMemoryDone = true;
    } catch {
      // Allow retry on transient failure
    }
  }).finally(() => {
    migrationPromise = null;
  });

  return migrationPromise;
}

export function resetMigrationStateForTesting(): void {
  migrationInMemoryDone = false;
  migrationPromise = null;
}

export async function getSettings(): Promise<UserSettings> {
  try {
    if (!isChromeStorageAvailable()) {
      return mergeSettings(undefined);
    }
    await migrateLegacyStorageIfNeeded();
    const result = await chrome.storage.local.get(SETTINGS_KEY);
    return mergeSettings(result[SETTINGS_KEY]);
  } catch {
    return mergeSettings(undefined);
  }
}

export async function saveSettings(partial: Partial<UserSettings>): Promise<UserSettings> {
  return withStorageLock(STORAGE_LOCK_NAME, async () => {
    await migrateLegacyStorageIfNeeded();
    const current = isChromeStorageAvailable()
      ? mergeSettings((await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY])
      : mergeSettings(undefined);

    const syncedPartial = { ...partial };
    if (
      syncedPartial.subtitleFontSize !== undefined &&
      syncedPartial.translationFontSize === undefined
    ) {
      const scale = syncedPartial.translationScale ?? current.translationScale;
      syncedPartial.translationFontSize = Math.max(
        12,
        Math.min(48, Math.round(syncedPartial.subtitleFontSize * scale))
      );
    }

    const next: UserSettings = mergeSettings({
      ...current,
      ...syncedPartial,
      llm: {
        ...current.llm,
        ...(syncedPartial.llm ?? {})
      },
      enabledServices: {
        ...current.enabledServices,
        ...(syncedPartial.enabledServices ?? {})
      },
      keybindings: {
        ...current.keybindings,
        ...(syncedPartial.keybindings ?? {})
      }
    });

    try {
      if (isChromeStorageAvailable()) {
        await chrome.storage.local.set({ [SETTINGS_KEY]: next });
      }
    } catch {
      // ignore
    }
    return next;
  });
}

export function onSettingsChanged(callback: (settings: UserSettings) => void): () => void {
  try {
    if (!chrome?.storage?.onChanged || !chrome?.runtime?.id) {
      return () => {};
    }
    const listener = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string
    ): void => {
      if (areaName !== 'local') return;
      const change = changes[SETTINGS_KEY];
      if (!change) return;
      callback(mergeSettings(change.newValue));
    };
    chrome.storage.onChanged.addListener(listener);
    return () => {
      try {
        if (chrome?.storage?.onChanged && chrome?.runtime?.id) {
          chrome.storage.onChanged.removeListener(listener);
        }
      } catch {
        // ignore
      }
    };
  } catch {
    return () => {};
  }
}

async function notifyVocabularyChanged(cards: VocabularyCard[]): Promise<void> {
  for (const listener of vocabListeners) {
    try {
      listener(cards);
    } catch {
      // ignore listener errors
    }
  }
  try {
    if (isChromeStorageAvailable()) {
      await chrome.storage.local.set({ [VOCAB_VERSION_KEY]: Date.now() });
    }
  } catch {
    // ignore
  }
}

export async function getVocabulary(): Promise<VocabularyCard[]> {
  try {
    await migrateLegacyStorageIfNeeded();
    return await getAllVocabularyCardsFromDB();
  } catch {
    return [];
  }
}

export async function saveVocabularyCard(card: VocabularyCard): Promise<VocabularyCard[]> {
  return withStorageLock(STORAGE_LOCK_NAME, async () => {
    await migrateLegacyStorageIfNeeded();

    let existingId = card.id;
    let existingMediaBlobKey = card.mediaBlobKey;

    try {
      const sameVideoCards = await getVocabularyCardsByMediaIdFromDB(card.videoId);
      const duplicate = sameVideoCards.find(
        (c) =>
          c.id === card.id ||
          (c.word.toLowerCase() === card.word.toLowerCase() &&
            Math.abs(c.timestampSec - card.timestampSec) < 2)
      );
      if (duplicate) {
        existingId = duplicate.id;
        existingMediaBlobKey = existingMediaBlobKey ?? duplicate.mediaBlobKey;
      }
    } catch {
      // ignore index lookup failure
    }

    const toStore: VocabularyCard = {
      ...card,
      id: existingId
    };

    if (toStore.screenshotBase64 && toStore.screenshotBase64.startsWith('data:image/')) {
      const mediaKey = existingMediaBlobKey || `media:${toStore.id}`;
      try {
        await saveCardMedia(mediaKey, toStore.screenshotBase64);
        toStore.mediaBlobKey = mediaKey;
        toStore.screenshotBase64 = null;
      } catch {
        // Keep inline screenshot if media store fails
      }
    } else if (existingMediaBlobKey) {
      toStore.mediaBlobKey = existingMediaBlobKey;
    }

    await putVocabularyCardInDB(toStore);
    const updated = await getAllVocabularyCardsFromDB();
    await notifyVocabularyChanged(updated);
    return updated;
  });
}

/**
 * Updates a single vocabulary card in IndexedDB in O(1) via `store.put(card)`,
 * without rewriting the entire vocabulary collection.
 */
export async function updateVocabularyCard(card: VocabularyCard): Promise<VocabularyCard[]> {
  const toStore: VocabularyCard = { ...card };
  if (toStore.screenshotBase64 && toStore.screenshotBase64.startsWith('data:image/')) {
    const mediaKey = toStore.mediaBlobKey || `media:${toStore.id}`;
    try {
      await saveCardMedia(mediaKey, toStore.screenshotBase64);
      toStore.mediaBlobKey = mediaKey;
      toStore.screenshotBase64 = null;
    } catch {
      // ignore
    }
  }

  await putVocabularyCardInDB(toStore);
  const updated = await getAllVocabularyCardsFromDB();
  await notifyVocabularyChanged(updated);
  return updated;
}

export async function deleteVocabularyCard(cardId: string): Promise<VocabularyCard[]> {
  await deleteVocabularyCardFromDB(cardId);
  const updated = await getAllVocabularyCardsFromDB();
  await notifyVocabularyChanged(updated);
  return updated;
}

export function onVocabularyChanged(callback: (cards: VocabularyCard[]) => void): () => void {
  vocabListeners.add(callback);

  let chromeListener:
    | ((changes: Record<string, chrome.storage.StorageChange>, areaName: string) => void)
    | null = null;

  try {
    if (chrome?.storage?.onChanged && chrome?.runtime?.id) {
      chromeListener = (changes, areaName) => {
        if (areaName !== 'local') return;
        if (!(VOCAB_VERSION_KEY in changes)) return;
        void getVocabulary().then((cards) => callback(cards));
      };
      chrome.storage.onChanged.addListener(chromeListener);
    }
  } catch {
    chromeListener = null;
  }

  return () => {
    vocabListeners.delete(callback);
    if (chromeListener) {
      try {
        if (chrome?.storage?.onChanged && chrome?.runtime?.id) {
          chrome.storage.onChanged.removeListener(chromeListener);
        }
      } catch {
        // ignore
      }
    }
  };
}
