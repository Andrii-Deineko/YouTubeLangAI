import type { LLMConfig } from './settings';
import type { InterceptedSubtitlePayload, Json3Response } from './subtitles';
import type { AIExplanation, QuickTranslationResult, VocabularyCard } from './vocabulary';

export const MAIN_MESSAGE_SOURCE = 'yt-lang-ai-main';
export const ISOLATED_MESSAGE_SOURCE = 'yt-lang-ai-isolated';
export const POST_MESSAGE_SOURCE_MAIN = 'cinelingua-main';
export const POST_MESSAGE_SOURCE_ISOLATED = 'cinelingua-isolated';

export interface TrackCapturedPayload {
  videoId: string;
  lang: string;
  tlang?: string;
  kind?: string;
  url: string;
  data: Json3Response;
  title?: string;
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
      type: 'CAPTION_RATE_LIMITED';
      payload: { blockedUntil: number; remainingMs?: number };
    }
  | {
      source: typeof MAIN_MESSAGE_SOURCE;
      type: 'TRACK_ERROR';
      payload: { error: string; url?: string };
    }
  | {
      source: typeof POST_MESSAGE_SOURCE_MAIN;
      type: 'SUBTITLES_INTERCEPTED';
      payload: InterceptedSubtitlePayload;
    }
  | {
      source: typeof POST_MESSAGE_SOURCE_MAIN;
      type: 'MEDIA_INFO';
      payload: { title: string; url: string };
    };

export type IsolatedToMainMessage =
  | {
      source: typeof ISOLATED_MESSAGE_SOURCE;
      type: 'NAVIGATED';
      payload: { videoId: string };
    }
  | {
      source: typeof ISOLATED_MESSAGE_SOURCE;
      type: 'REQUEST_TRANSLATED_TRACK';
      payload: { nativeLang?: string; targetLang?: string; videoId?: string };
    }
  | {
      source?: typeof ISOLATED_MESSAGE_SOURCE | string;
      type: 'CINELINGUA_SET_DISABLED';
      disabled: boolean;
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
        fallbackModel?: string;
      };
    }
  | {
      type: 'ANKI_TEST';
      payload: { url: string };
    }
  | {
      type: 'ANKI_EXPORT_CARDS';
      payload: { url: string; deckName: string; cards: VocabularyCard[] };
    }
  | {
      type: 'LLM_TEST';
      payload: { llmConfig: LLMConfig };
    }
  | {
      type: 'FETCH_AVAILABLE_MODELS';
      payload: { baseUrl: string; apiKey: string };
    }
  | {
      type: 'OPEN_EXTENSION_POPUP';
    }
  | {
      type: 'FETCH_SUBTITLE_TEXT';
      payload: { url: string };
    }
  | {
      type: 'CAPTURE_SCREENSHOT';
      payload: { rect?: { x: number; y: number; width: number; height: number } };
    }
  | {
      type: 'INJECT_MAIN_INTERCEPTOR';
    };

export interface RuntimeResponseSuccess<T> {
  ok: true;
  data: T;
}

export interface RuntimeResponseError {
  ok: false;
  error: string;
}

export type RuntimeResponse<T> = RuntimeResponseSuccess<T> | RuntimeResponseError;

export type QuickTranslateResponse = RuntimeResponse<QuickTranslationResult>;
export type AIExplainResponse = RuntimeResponse<AIExplanation>;
export type AnkiTestResponse = RuntimeResponse<{ version: number }>;
export type AnkiExportResult = { added: number; skipped?: number; errors: string[] };
export type AnkiExportResponse = RuntimeResponse<AnkiExportResult>;
export interface LLMTestResult {
  resolvedUrl?: string;
  status?: number;
  model?: string;
  replyPreview?: string;
  models?: string[];
}
export type LLMTestResponse = RuntimeResponse<LLMTestResult>;
export type ModelsResponse = RuntimeResponse<string[]>;
export type FetchModelsResponse = RuntimeResponse<string[]>;
export type FetchSubtitleTextResponse = { text?: string; error?: string };
export type ScreenshotResponse = { dataUrl?: string; error?: string };
export type InjectMainInterceptorResponse = { ok: boolean; data?: boolean; error?: string };
