import type { Json3Response } from './subtitles';
import type { LLMConfig } from './settings';
import type { AIExplanation, QuickTranslationResult, VocabularyCard } from './vocabulary';

export const MAIN_MESSAGE_SOURCE = 'YT_LANG_AI_MAIN' as const;
export const ISOLATED_MESSAGE_SOURCE = 'YT_LANG_AI_ISOLATED' as const;

export interface TrackCapturedPayload {
  videoId: string;
  lang: string;
  tlang?: string;
  kind?: string;
  url: string;
  data: Json3Response;
}

export type MainToIsolatedMessage =
  | {
      source: typeof MAIN_MESSAGE_SOURCE;
      type: 'TRACK_CAPTURED';
      payload: TrackCapturedPayload;
    }
  | {
      source: typeof MAIN_MESSAGE_SOURCE;
      type: 'TRANSLATED_TRACK_CAPTURED';
      payload: TrackCapturedPayload;
    }
  | {
      source: typeof MAIN_MESSAGE_SOURCE;
      type: 'TRACK_ERROR';
      payload: {
        error: string;
        url?: string;
      };
    };

export type IsolatedToMainMessage =
  | {
      source: typeof ISOLATED_MESSAGE_SOURCE;
      type: 'REQUEST_TRANSLATED_TRACK';
      payload: {
        nativeLang: string;
        videoId?: string;
      };
    }
  | {
      source: typeof ISOLATED_MESSAGE_SOURCE;
      type: 'NAVIGATED';
      payload: {
        videoId: string;
      };
    };

export type RuntimeRequest =
  | {
      type: 'QUICK_TRANSLATE';
      payload: {
        text: string;
        sourceLang?: string;
        nativeLang: string;
      };
    }
  | {
      type: 'AI_EXPLAIN';
      payload: {
        videoId: string;
        cueId: string;
        target: string;
        prevSentence: string;
        currentSentence: string;
        nextSentence: string;
        videoTitle: string;
        nativeLang: string;
        llmConfig: LLMConfig;
      };
    }
  | {
      type: 'ANKI_TEST';
      payload: {
        url: string;
      };
    }
  | {
      type: 'ANKI_EXPORT_CARDS';
      payload: {
        url: string;
        deckName: string;
        cards: VocabularyCard[];
      };
    }
  | {
      type: 'LLM_TEST';
      payload: {
        llmConfig: LLMConfig;
      };
    }
  | {
      type: 'FETCH_AVAILABLE_MODELS';
      payload: {
        baseUrl: string;
        apiKey: string;
      };
    };

export type RuntimeResponse<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export interface AnkiTestResult {
  version: number;
}

export interface AnkiExportResult {
  added: number;
  skipped: number;
  errors: string[];
}

export interface LLMTestResult {
  resolvedUrl: string;
  status: number;
  model: string;
  replyPreview: string;
}

export type QuickTranslateResponse = RuntimeResponse<QuickTranslationResult>;
export type AIExplainResponse = RuntimeResponse<AIExplanation>;
export type AnkiTestResponse = RuntimeResponse<AnkiTestResult>;
export type AnkiExportResponse = RuntimeResponse<AnkiExportResult>;
export type LLMTestResponse = RuntimeResponse<LLMTestResult>;
export type FetchModelsResponse = RuntimeResponse<string[]>;
