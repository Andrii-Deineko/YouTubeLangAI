import type { AIExplanation, FSRSState, VocabularyCard } from '@langai/contracts';

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
  screenshotBase64?: string | null;
  mediaBlobKey?: string;
  sourceLang: string;
  nativeLang: string;
  source?: string;
  sourceLabel?: string;
  sourceUrl?: string;
  sourceTitle?: string;
}

export function createInitialFsrsState(now: Date = new Date()): FSRSState {
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

/** Legacy alias preserved for compatibility. */
export const createInitialFSRSState = createInitialFsrsState;

function formatDefaultSourceLabel(source: string): string {
  switch (source) {
    case 'youtube':
      return 'YouTube';
    case 'netflix':
      return 'Netflix';
    case 'urplay':
      return 'UR Play';
    case 'hdrezka':
      return 'HDRezka';
    case 'hianime':
      return 'HiAnime';
    default:
      return source;
  }
}

export function createVocabularyCard(
  input: CreateCardInput,
  now: Date = new Date()
): VocabularyCard {
  const cleanWord = input.word.trim();
  const id =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `card-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  const source = input.source?.trim() || 'youtube';
  const sourceLabel = input.sourceLabel?.trim() || formatDefaultSourceLabel(source);
  const screenshotBase64 = input.screenshotBase64 ?? null;
  const mediaBlobKey =
    input.mediaBlobKey?.trim() || (screenshotBase64 ? `media:${id}` : undefined);

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
    ...(mediaBlobKey ? { mediaBlobKey } : {}),
    screenshotBase64,
    sourceLang: input.sourceLang,
    nativeLang: input.nativeLang,
    createdAt: now.toISOString(),
    fsrsState: createInitialFsrsState(now),
    source,
    sourceLabel,
    ...(input.sourceUrl?.trim() ? { sourceUrl: input.sourceUrl.trim() } : {}),
    sourceTitle: input.sourceTitle ?? input.videoTitle
  };
}

/** Legacy alias preserved for compatibility. */
export const createNewCard = createVocabularyCard;
