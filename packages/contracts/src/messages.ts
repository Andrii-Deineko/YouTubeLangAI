import type { LLMConfig } from './settings';
import type { InterceptedSubtitlePayload, Json3Response } from './subtitles';
import type { AIExplanation, QuickTranslationResult, VocabularyCard } from './vocabulary';
import { POST_MESSAGE_SOURCE_ISOLATED, POST_MESSAGE_SOURCE_MAIN } from './plugins';

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
      source: typeof POST_MESSAGE_SOURCE_MAIN;
      type: 'TRACK_CAPTURED';
      payload: TrackCapturedPayload;
    }
  | {
      source: typeof POST_MESSAGE_SOURCE_MAIN;
      type: 'TRANSLATED_TRACK_CAPTURED';
      payload: TrackCapturedPayload;
    }
  | {
      source: typeof POST_MESSAGE_SOURCE_MAIN;
      type: 'CAPTION_RATE_LIMITED';
      payload: { blockedUntil: number; remainingMs?: number };
    }
  | {
      source: typeof POST_MESSAGE_SOURCE_MAIN;
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
      source: typeof POST_MESSAGE_SOURCE_ISOLATED;
      type: 'NAVIGATED';
      payload: { videoId: string };
    }
  | {
      source: typeof POST_MESSAGE_SOURCE_ISOLATED;
      type: 'REQUEST_TRANSLATED_TRACK';
      payload: { nativeLang?: string; targetLang?: string; videoId?: string };
    }
  | {
      source: typeof POST_MESSAGE_SOURCE_ISOLATED;
      type: 'LANGAI_SET_DISABLED';
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
      payload?: { tab?: 'trainer' | 'vocabulary' | 'settings' };
    }
  | {
      type: 'FETCH_SUBTITLE_TEXT';
      payload: { url: string };
    }
  | {
      type: 'FREE_TRANSLATE_CUES';
      payload: {
        videoId: string;
        cues: Array<{ id: string; text: string; startTime?: number; endTime?: number }>;
        sourceLang?: string;
        targetLang: string;
        priorityTime?: number;
        forceRetry?: boolean;
      };
    }
  | {
      type: 'CANCEL_FREE_TRANSLATION';
      payload?: {
        videoId?: string;
        targetLang?: string;
      };
    }
  | {
      type: 'INJECT_MAIN_INTERCEPTOR';
      payload?: { serviceId?: string };
    }
  | {
      type: 'ENABLE_SERVICE_MODULE';
      payload: { serviceId: string };
    }
  | {
      type: 'DISABLE_SERVICE_MODULE';
      payload: { serviceId: string };
    }
  | {
      type: 'GET_SERVICE_MODULE_STATUS';
      payload: { serviceId: string };
    }
  | {
      type: 'GET_ALL_SERVICE_STATUSES';
    }
  | {
      type: 'SYNC_SERVICE_MODULES';
    };

export interface ServiceModuleStatus {
  serviceId: string;
  enabled: boolean;
  hasPermission: boolean;
  registered: boolean;
}

export type RuntimeResponse<T> = { ok: true; data: T } | { ok: false; error: string };

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
export type FetchModelsResponse = RuntimeResponse<string[]>;

export interface TranslationRuntimeStatus {
  state: 'idle' | 'translating' | 'cooldown';
  retryAt?: number;
}

export type FreeTranslateCuesResponse = RuntimeResponse<{
  translations: Array<{ id: string; text: string }>;
  status: TranslationRuntimeStatus;
}>;

export type ServiceModuleStatusResponse = RuntimeResponse<ServiceModuleStatus>;
export type AllServiceStatusesResponse = RuntimeResponse<Record<string, ServiceModuleStatus>>;
