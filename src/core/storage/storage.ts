import {
  DEFAULT_BLACKLISTED_DOMAINS,
  DEFAULT_SETTINGS,
  type ActiveListeningMode,
  type ControlsScale,
  type FontFamily,
  type FontWeight,
  type SubtitleBoxSize,
  type SubtitlePosition,
  type SubtitleScale,
  type TextOutline,
  type UserSettings
} from '../types/settings';
import type { VocabularyCard } from '../types/vocabulary';

export const SETTINGS_KEY = 'cinelingua_settings';
export const LEGACY_SETTINGS_KEY = 'yt_lang_ai_settings';
export const VOCABULARY_KEY = 'cinelingua_vocabulary';
export const LEGACY_VOCABULARY_KEY = 'yt_lang_ai_vocabulary';
export const MODELS_CACHE_KEY = 'cinelingua_models_cache';

let storageWriteQueue: Promise<void> = Promise.resolve();

function enqueueStorageWrite<T>(op: () => Promise<T>): Promise<T> {
  const resultPromise = storageWriteQueue.then(op);
  storageWriteQueue = resultPromise.then(
    () => undefined,
    () => undefined
  );
  return resultPromise;
}

export interface CachedModelsState {
  baseUrl: string;
  models: string[];
  updatedAt: string;
}

export async function getCachedModels(): Promise<CachedModelsState | null> {
  try {
    if (!chrome?.storage?.local || !chrome?.runtime?.id) return null;
    const result = await chrome.storage.local.get(MODELS_CACHE_KEY);
    const raw = result[MODELS_CACHE_KEY] as Partial<CachedModelsState> | undefined;
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
  return enqueueStorageWrite(async () => {
    try {
      if (chrome?.storage?.local && chrome?.runtime?.id) {
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

export function parseControlsScale(rawVal: unknown): ControlsScale {
  if (rawVal === 'sm' || rawVal === 'md' || rawVal === 'lg' || rawVal === 'xl') {
    return rawVal;
  }
  return 'md';
}

export function parseSubtitleScale(rawVal: unknown): SubtitleScale {
  if (
    rawVal === 'sm' ||
    rawVal === 'md' ||
    rawVal === 'lg' ||
    rawVal === 'xl' ||
    rawVal === 'tv'
  ) {
    return rawVal;
  }
  return 'md';
}

export function parseFontFamily(rawVal: unknown): FontFamily {
  if (rawVal === 'sans' || rawVal === 'serif' || rawVal === 'mono') {
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

export function mergeSettings(
  raw: (Partial<UserSettings> & {
    ai?: Partial<UserSettings['llm']>;
    anki?: { url?: string; deckName?: string };
    overlayEnabled?: boolean;
    secondTrackEnabled?: boolean;
    activeListening?: boolean;
    autoPauseAtCueEnd?: boolean;
  }) | undefined
): UserSettings {
  const enabled = raw?.enabled ?? raw?.overlayEnabled ?? DEFAULT_SETTINGS.enabled;
  const showDualSubtitles =
    raw?.showDualSubtitles ?? raw?.showTranslation ?? raw?.secondTrackEnabled ?? DEFAULT_SETTINGS.showDualSubtitles;
  const showTranslation =
    raw?.showTranslation ?? raw?.showDualSubtitles ?? raw?.secondTrackEnabled ?? DEFAULT_SETTINGS.showTranslation;
  const activeListeningMode = parseActiveListeningMode(
    raw?.activeListeningMode ?? raw?.activeListening
  );

  const subtitlePosition: SubtitlePosition | null =
    raw?.subtitlePosition &&
    typeof raw.subtitlePosition.xPercent === 'number' &&
    typeof raw.subtitlePosition.yPercent === 'number'
      ? raw.subtitlePosition
      : null;

  const subtitleBoxFixed =
    typeof raw?.subtitleBoxFixed === 'boolean'
      ? raw.subtitleBoxFixed
      : DEFAULT_SETTINGS.subtitleBoxFixed;

  const subtitleBoxSize: SubtitleBoxSize | null =
    raw?.subtitleBoxSize &&
    typeof raw.subtitleBoxSize.width === 'number' &&
    typeof raw.subtitleBoxSize.height === 'number' &&
    raw.subtitleBoxSize.width > 0 &&
    raw.subtitleBoxSize.height > 0
      ? {
          width: Math.max(260, Math.round(raw.subtitleBoxSize.width)),
          height: Math.max(56, Math.round(raw.subtitleBoxSize.height))
        }
      : null;

  const autoPauseAfterCue =
    raw?.autoPauseAfterCue ?? raw?.autoPauseAtCueEnd ?? DEFAULT_SETTINGS.autoPauseAfterCue;

  const ankiDeckName =
    typeof raw?.ankiDeckName === 'string' && raw.ankiDeckName.trim()
      ? raw.ankiDeckName
      : typeof raw?.anki?.deckName === 'string' && raw.anki.deckName.trim()
        ? raw.anki.deckName
        : DEFAULT_SETTINGS.ankiDeckName;

  const ankiConnectUrl =
    typeof raw?.ankiConnectUrl === 'string' && raw.ankiConnectUrl.trim()
      ? raw.ankiConnectUrl
      : typeof raw?.anki?.url === 'string' && raw.anki.url.trim()
        ? raw.anki.url
        : DEFAULT_SETTINGS.ankiConnectUrl;

  const llm = {
    ...DEFAULT_SETTINGS.llm,
    ...(raw?.llm ?? raw?.ai ?? {})
  };

  const rawFontSize =
    typeof raw?.fontSize === 'number'
      ? raw.fontSize
      : typeof raw?.subtitleFontSize === 'number'
        ? raw.subtitleFontSize
        : DEFAULT_SETTINGS.fontSize;
  const fontSize = Math.max(12, Math.min(56, rawFontSize));

  const translationScale =
    typeof raw?.translationScale === 'number' &&
    [0.75, 0.85, 1.0, 1.15].includes(raw.translationScale)
      ? raw.translationScale
      : DEFAULT_SETTINGS.translationScale;

  const fontFamily = parseFontFamily(raw?.fontFamily);
  const fontWeight = parseFontWeight(raw?.fontWeight);
  const textOutline = parseTextOutline(raw?.textOutline);

  const rawBackdrop =
    typeof raw?.backdropOpacity === 'number'
      ? raw.backdropOpacity
      : typeof raw?.overlayOpacity === 'number'
        ? Math.round(raw.overlayOpacity * 100)
        : DEFAULT_SETTINGS.backdropOpacity;
  const backdropOpacity = Math.max(0, Math.min(100, rawBackdrop));
  const overlayOpacity = backdropOpacity / 100;

  return {
    ...DEFAULT_SETTINGS,
    ...raw,
    enabled,
    showDualSubtitles,
    showTranslation,
    activeListeningMode,
    pauseOnAltReveal: raw?.pauseOnAltReveal ?? DEFAULT_SETTINGS.pauseOnAltReveal,
    pauseOnAltHold:
      typeof raw?.pauseOnAltHold === 'boolean'
        ? raw.pauseOnAltHold
        : DEFAULT_SETTINGS.pauseOnAltHold,
    pauseTimerSeconds:
      typeof raw?.pauseTimerSeconds === 'number'
        ? Math.max(0, Math.min(300, raw.pauseTimerSeconds))
        : typeof (raw as { autoPauseResumeDelaySec?: number })?.autoPauseResumeDelaySec === 'number'
          ? Math.max(0, Math.min(300, (raw as { autoPauseResumeDelaySec?: number }).autoPauseResumeDelaySec!))
          : DEFAULT_SETTINGS.pauseTimerSeconds,
    autoPauseAfterCue,
    autoPauseOnWordClick:
      raw?.autoPauseOnWordClick ?? DEFAULT_SETTINGS.autoPauseOnWordClick,
    subtitlePosition,
    subtitleBoxFixed,
    subtitleBoxSize,
    nativeLang: raw?.nativeLang ?? DEFAULT_SETTINGS.nativeLang,
    videoLang: raw?.videoLang ?? DEFAULT_SETTINGS.videoLang,
    fontSize,
    subtitleFontSize: fontSize,
    translationScale,
    fontFamily,
    fontWeight,
    backdropOpacity,
    textOutline,
    subtitleScale: parseSubtitleScale(raw?.subtitleScale),
    subtitleOffsetSec:
      typeof raw?.subtitleOffsetSec === 'number'
        ? raw.subtitleOffsetSec
        : DEFAULT_SETTINGS.subtitleOffsetSec,
    theme: raw?.theme ?? DEFAULT_SETTINGS.theme,
    overlayOpacity,
    fallbackModel:
      typeof raw?.fallbackModel === 'string'
        ? raw.fallbackModel
        : DEFAULT_SETTINGS.fallbackModel,
    ankiDeckName,
    ankiConnectUrl,
    llm,
    cinemaModuleEnabled:
      typeof raw?.cinemaModuleEnabled === 'boolean'
        ? raw.cinemaModuleEnabled
        : DEFAULT_SETTINGS.cinemaModuleEnabled,
    customMirrors: Array.isArray(raw?.customMirrors) ? raw.customMirrors : [],
    blacklistedDomains: Array.isArray(raw?.blacklistedDomains)
      ? raw.blacklistedDomains
      : [...DEFAULT_BLACKLISTED_DOMAINS]
  };
}

export async function getSettings(): Promise<UserSettings> {
  try {
    if (!chrome?.storage?.local || !chrome?.runtime?.id) {
      return mergeSettings(undefined);
    }
    const result = await chrome.storage.local.get([SETTINGS_KEY, LEGACY_SETTINGS_KEY]);
    const raw = (result[SETTINGS_KEY] ?? result[LEGACY_SETTINGS_KEY]) as
      | Partial<UserSettings>
      | undefined;
    return mergeSettings(raw);
  } catch {
    return mergeSettings(undefined);
  }
}

export async function saveSettings(partial: Partial<UserSettings>): Promise<UserSettings> {
  return enqueueStorageWrite(async () => {
    const current = await getSettings();
    const syncedPartial = { ...partial };
    if (syncedPartial.showTranslation !== undefined && syncedPartial.showDualSubtitles === undefined) {
      syncedPartial.showDualSubtitles = syncedPartial.showTranslation;
    } else if (syncedPartial.showDualSubtitles !== undefined && syncedPartial.showTranslation === undefined) {
      syncedPartial.showTranslation = syncedPartial.showDualSubtitles;
    }
    if (syncedPartial.fontSize !== undefined && syncedPartial.subtitleFontSize === undefined) {
      syncedPartial.subtitleFontSize = syncedPartial.fontSize;
    } else if (syncedPartial.subtitleFontSize !== undefined && syncedPartial.fontSize === undefined) {
      syncedPartial.fontSize = syncedPartial.subtitleFontSize;
    }
    if (syncedPartial.backdropOpacity !== undefined && syncedPartial.overlayOpacity === undefined) {
      syncedPartial.overlayOpacity = syncedPartial.backdropOpacity / 100;
    } else if (syncedPartial.overlayOpacity !== undefined && syncedPartial.backdropOpacity === undefined) {
      syncedPartial.backdropOpacity = Math.round(syncedPartial.overlayOpacity * 100);
    }
    const next: UserSettings = mergeSettings({
      ...current,
      ...syncedPartial,
      llm: {
        ...current.llm,
        ...(syncedPartial.llm ?? {})
      }
    });
    try {
      if (chrome?.storage?.local && chrome?.runtime?.id) {
        await chrome.storage.local.set({ [SETTINGS_KEY]: next, [LEGACY_SETTINGS_KEY]: next });
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
      const change = changes[SETTINGS_KEY] ?? changes[LEGACY_SETTINGS_KEY];
      if (!change) return;
      const raw = change.newValue as Partial<UserSettings> | undefined;
      callback(mergeSettings(raw));
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

export async function getVocabulary(): Promise<VocabularyCard[]> {
  try {
    if (!chrome?.storage?.local || !chrome?.runtime?.id) {
      return [];
    }
    const result = await chrome.storage.local.get([VOCABULARY_KEY, LEGACY_VOCABULARY_KEY]);
    const raw = result[VOCABULARY_KEY] ?? result[LEGACY_VOCABULARY_KEY];
    return Array.isArray(raw) ? (raw as VocabularyCard[]) : [];
  } catch {
    return [];
  }
}

export async function saveVocabularyCard(card: VocabularyCard): Promise<VocabularyCard[]> {
  return enqueueStorageWrite(async () => {
    const cards = await getVocabulary();
    const existingIdx = cards.findIndex(
      (c) =>
        c.id === card.id ||
        (c.word.toLowerCase() === card.word.toLowerCase() &&
          c.videoId === card.videoId &&
          Math.abs(c.timestampSec - card.timestampSec) < 2)
    );
    const updated =
      existingIdx >= 0
        ? cards.map((c, idx) => (idx === existingIdx ? card : c))
        : [card, ...cards];
    try {
      if (chrome?.storage?.local && chrome?.runtime?.id) {
        await chrome.storage.local.set({ [VOCABULARY_KEY]: updated, [LEGACY_VOCABULARY_KEY]: updated });
      }
    } catch {
      // ignore
    }
    return updated;
  });
}

export async function updateVocabularyCard(card: VocabularyCard): Promise<VocabularyCard[]> {
  return enqueueStorageWrite(async () => {
    const cards = await getVocabulary();
    const updated = cards.map((c) => (c.id === card.id ? card : c));
    try {
      if (chrome?.storage?.local && chrome?.runtime?.id) {
        await chrome.storage.local.set({ [VOCABULARY_KEY]: updated, [LEGACY_VOCABULARY_KEY]: updated });
      }
    } catch {
      // ignore
    }
    return updated;
  });
}

export async function deleteVocabularyCard(cardId: string): Promise<VocabularyCard[]> {
  return enqueueStorageWrite(async () => {
    const cards = await getVocabulary();
    const updated = cards.filter((c) => c.id !== cardId);
    try {
      if (chrome?.storage?.local && chrome?.runtime?.id) {
        await chrome.storage.local.set({ [VOCABULARY_KEY]: updated, [LEGACY_VOCABULARY_KEY]: updated });
      }
    } catch {
      // ignore
    }
    return updated;
  });
}

export function onVocabularyChanged(callback: (cards: VocabularyCard[]) => void): () => void {
  try {
    if (!chrome?.storage?.onChanged || !chrome?.runtime?.id) {
      return () => {};
    }
    const listener = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string
    ): void => {
      if (areaName !== 'local') return;
      const change = changes[VOCABULARY_KEY] ?? changes[LEGACY_VOCABULARY_KEY];
      if (!change) return;
      const raw = change.newValue;
      callback(Array.isArray(raw) ? (raw as VocabularyCard[]) : []);
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
