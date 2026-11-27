export interface AIExample {
  source: string;
  translation: string;
}

export interface AIExplanation {
  lemma: string;
  partOfSpeech: string;
  contextualTranslation: string;
  literalTranslation?: string | null;
  grammarNote?: string;
  nuanceExplanation?: string;
  grammarBreakdown?: string;
  examples?: AIExample[];
  exampleSentence?: string;
  exampleTranslation?: string;
  culturalNote?: string;
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

export interface QuickTranslationResult {
  word: string;
  translation: string;
  alternatives: string[];
  detectedLang?: string;
  partOfSpeech?: string;
  fromCache?: boolean;
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
  /** Key referencing a WebP Blob in IndexedDB `card_media` store. */
  mediaBlobKey?: string;
  /** Optional transient base64 data URL used for backwards-compatible import/export or display hydration. */
  screenshotBase64?: string | null;
  sourceLang: string;
  nativeLang: string;
  createdAt: string;
  fsrsState: FSRSState;
  /** Open service identifier, e.g. 'youtube' | 'netflix' | 'urplay' | 'hdrezka' | 'hianime'. */
  source: string;
  /** Short human-readable badge label for UI cards, e.g. 'YouTube', 'Netflix', 'UR Play'. */
  sourceLabel?: string;
  /** Full canonical watch URL (optionally with timestamp) for navigation & export. */
  sourceUrl?: string;
  /** Legacy title alias preserved for compatibility. */
  sourceTitle?: string;
}
