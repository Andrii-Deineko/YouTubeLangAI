export interface AIExample {
  source: string;
  translation: string;
}

export interface AIExplanation {
  lemma: string;
  partOfSpeech: string;
  contextualTranslation: string;
  literalTranslation: string | null;
  grammarNote: string;
  nuanceExplanation: string;
  examples: AIExample[];
}

export interface FSRSState {
  due: string;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  state: number;
  last_review?: string;
}

export interface VocabularyCard {
  id: string;
  word: string;
  lemma: string;
  translation: string;
  aiExplanation: AIExplanation | null;
  contextSentence: string;
  contextTranslation: string;
  videoId: string;
  videoTitle: string;
  timestampSec: number;
  screenshotBase64: string | null;
  sourceLang: string;
  nativeLang: string;
  createdAt: string;
  fsrsState: FSRSState;
}

export interface QuickTranslationResult {
  word: string;
  translation: string;
  alternatives: string[];
  detectedLang: string;
  partOfSpeech?: string;
  fromCache: boolean;
}
