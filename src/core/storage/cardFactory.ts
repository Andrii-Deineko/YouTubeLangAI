import type { AIExplanation, FSRSState, VocabularyCard } from '../types/vocabulary';

export interface CreateCardInput {
  word: string;
  lemma?: string;
  translation: string;
  aiExplanation?: AIExplanation | null;
  contextSentence: string;
  contextTranslation: string;
  videoId: string;
  videoTitle: string;
  timestampSec: number;
  screenshotBase64: string | null;
  sourceLang: string;
  nativeLang: string;
}

export function createInitialFSRSState(now: Date = new Date()): FSRSState {
  return {
    due: now.toISOString(),
    stability: 0,
    difficulty: 0,
    elapsed_days: 0,
    scheduled_days: 0,
    learning_steps: 0,
    reps: 0,
    lapses: 0,
    state: 0, // State.New
    last_review: undefined
  };
}

export function createNewCard(input: CreateCardInput, now: Date = new Date()): VocabularyCard {
  const cleanWord = input.word.trim();
  const id =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `card-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  return {
    id,
    word: cleanWord,
    lemma: (input.lemma ?? input.aiExplanation?.lemma ?? cleanWord).trim(),
    translation: input.translation.trim(),
    aiExplanation: input.aiExplanation ?? null,
    contextSentence: input.contextSentence.trim(),
    contextTranslation: input.contextTranslation.trim(),
    videoId: input.videoId,
    videoTitle: input.videoTitle,
    timestampSec: Math.max(0, Math.floor(input.timestampSec)),
    screenshotBase64: input.screenshotBase64,
    sourceLang: input.sourceLang,
    nativeLang: input.nativeLang,
    createdAt: now.toISOString(),
    fsrsState: createInitialFSRSState(now)
  };
}
