import {
  createEmptyCard,
  fsrs,
  generatorParameters,
  Rating,
  State,
  type Card,
  type Grade
} from 'ts-fsrs';
import type { AIExplanation, FSRSState, VocabularyCard } from '../types/vocabulary';

const scheduler = fsrs(
  generatorParameters({
    enable_fuzz: true,
    enable_short_term: true
  })
);

export function toFsrsCard(state: FSRSState): Card {
  return {
    due: new Date(state.due),
    stability: state.stability,
    difficulty: state.difficulty,
    elapsed_days: state.elapsed_days,
    scheduled_days: state.scheduled_days,
    learning_steps: state.learning_steps,
    reps: state.reps,
    lapses: state.lapses,
    state: state.state as State,
    last_review: state.last_review ? new Date(state.last_review) : undefined
  };
}

export function fromFsrsCard(card: Card): FSRSState {
  return {
    due: card.due.toISOString(),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsed_days,
    scheduled_days: card.scheduled_days,
    learning_steps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    last_review: card.last_review ? card.last_review.toISOString() : undefined
  };
}

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

export function createNewCard(input: CreateCardInput, now: Date = new Date()): VocabularyCard {
  const emptyCard = createEmptyCard(now);
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
    fsrsState: fromFsrsCard(emptyCard)
  };
}

export function reviewCard(
  card: VocabularyCard,
  grade: Grade,
  now: Date = new Date()
): VocabularyCard {
  const fsrsCard = toFsrsCard(card.fsrsState);
  const recordLog = scheduler.repeat(fsrsCard, now);
  const updated = recordLog[grade].card;

  return {
    ...card,
    fsrsState: fromFsrsCard(updated)
  };
}

export function getDueCards(
  cards: VocabularyCard[],
  now: Date = new Date()
): VocabularyCard[] {
  const nowMs = now.getTime();
  return cards
    .filter((card) => new Date(card.fsrsState.due).getTime() <= nowMs)
    .sort(
      (a, b) =>
        new Date(a.fsrsState.due).getTime() - new Date(b.fsrsState.due).getTime()
    );
}

export function formatIntervalLabel(dueDate: Date, now: Date): string {
  const diffMs = Math.max(0, dueDate.getTime() - now.getTime());
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return '<1m';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo`;
  const years = (days / 365).toFixed(1).replace(/\.0$/, '');
  return `${years}y`;
}

export interface GradePreview {
  grade: Grade;
  label: 'Again' | 'Hard' | 'Good' | 'Easy';
  interval: string;
}

export function previewCardGrades(
  card: VocabularyCard,
  now: Date = new Date()
): GradePreview[] {
  const fsrsCard = toFsrsCard(card.fsrsState);
  const record = scheduler.repeat(fsrsCard, now);

  return [
    {
      grade: Rating.Again,
      label: 'Again',
      interval: formatIntervalLabel(record[Rating.Again].card.due, now)
    },
    {
      grade: Rating.Hard,
      label: 'Hard',
      interval: formatIntervalLabel(record[Rating.Hard].card.due, now)
    },
    {
      grade: Rating.Good,
      label: 'Good',
      interval: formatIntervalLabel(record[Rating.Good].card.due, now)
    },
    {
      grade: Rating.Easy,
      label: 'Easy',
      interval: formatIntervalLabel(record[Rating.Easy].card.due, now)
    }
  ];
}

export function getCardStateLabel(state: number): string {
  switch (state) {
    case State.New:
      return 'New';
    case State.Learning:
      return 'Learning';
    case State.Review:
      return 'Review';
    case State.Relearning:
      return 'Relearning';
    default:
      return 'New';
  }
}
