import { DEFAULT_SETTINGS, type UserSettings } from '../types/settings';
import type { VocabularyCard } from '../types/vocabulary';

const SETTINGS_KEY = 'yt_lang_ai_settings';
const VOCABULARY_KEY = 'yt_lang_ai_vocabulary';
const MODELS_CACHE_KEY = 'yt_lang_ai_models_cache';

export interface CachedModelsState {
  baseUrl: string;
  models: string[];
  updatedAt: string;
}

export async function getCachedModels(): Promise<CachedModelsState | null> {
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
}

export async function saveCachedModels(state: CachedModelsState): Promise<void> {
  await chrome.storage.local.set({ [MODELS_CACHE_KEY]: state });
}

function mergeSettings(raw: Partial<UserSettings> | undefined): UserSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...raw,
    llm: {
      ...DEFAULT_SETTINGS.llm,
      ...(raw?.llm ?? {})
    }
  };
}

export async function getSettings(): Promise<UserSettings> {
  const result = await chrome.storage.local.get(SETTINGS_KEY);
  const raw = result[SETTINGS_KEY] as Partial<UserSettings> | undefined;
  return mergeSettings(raw);
}

export async function saveSettings(partial: Partial<UserSettings>): Promise<UserSettings> {
  const current = await getSettings();
  const next: UserSettings = {
    ...current,
    ...partial,
    llm: {
      ...current.llm,
      ...(partial.llm ?? {})
    }
  };
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

export function onSettingsChanged(callback: (settings: UserSettings) => void): () => void {
  const listener = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: string
  ): void => {
    if (areaName !== 'local') return;
    const change = changes[SETTINGS_KEY];
    if (!change) return;
    const raw = change.newValue as Partial<UserSettings> | undefined;
    callback(mergeSettings(raw));
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

export async function getVocabulary(): Promise<VocabularyCard[]> {
  const result = await chrome.storage.local.get(VOCABULARY_KEY);
  const raw = result[VOCABULARY_KEY];
  return Array.isArray(raw) ? (raw as VocabularyCard[]) : [];
}

export async function saveVocabularyCard(card: VocabularyCard): Promise<VocabularyCard[]> {
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
  await chrome.storage.local.set({ [VOCABULARY_KEY]: updated });
  return updated;
}

export async function updateVocabularyCard(card: VocabularyCard): Promise<VocabularyCard[]> {
  const cards = await getVocabulary();
  const updated = cards.map((c) => (c.id === card.id ? card : c));
  await chrome.storage.local.set({ [VOCABULARY_KEY]: updated });
  return updated;
}

export async function deleteVocabularyCard(cardId: string): Promise<VocabularyCard[]> {
  const cards = await getVocabulary();
  const updated = cards.filter((c) => c.id !== cardId);
  await chrome.storage.local.set({ [VOCABULARY_KEY]: updated });
  return updated;
}

export function onVocabularyChanged(callback: (cards: VocabularyCard[]) => void): () => void {
  const listener = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: string
  ): void => {
    if (areaName !== 'local') return;
    const change = changes[VOCABULARY_KEY];
    if (!change) return;
    const raw = change.newValue;
    callback(Array.isArray(raw) ? (raw as VocabularyCard[]) : []);
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
