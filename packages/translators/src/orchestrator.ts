import type {
  QuickTranslationResult,
  RuntimeRequest,
  TranslationProviderOptions,
  TranslationRuntimeStatus,
  UserSettings
} from '@langai/contracts';
import { isValidTranslationText } from '@langai/contracts';
import {
  clearProviderCooldowns,
  getProviderPausedUntil,
  isProviderPaused
} from './cooldown';
import { getTranslationProvider } from './providers';
import { DELIM, GTX_MAX_CHARS, sanitizeCueText } from './providers/shared';

export interface CueItem {
  id: string;
  text: string;
  startTime?: number;
  endTime?: number;
}

export type TranslateCuesWindowRequest = Extract<
  RuntimeRequest,
  { type: 'FREE_TRANSLATE_CUES' }
>['payload'];

export interface TranslateCuesWindowResult {
  translations: Array<{ id: string; text: string }>;
  status: TranslationRuntimeStatus;
}

export type TranslatorSettings = Pick<
  UserSettings,
  'translationProvider' | 'myMemoryEmail' | 'deeplApiKey'
>;

const WINDOW_AHEAD_CUES = 16;

interface ActiveJob {
  videoId: string;
  targetLang: string;
  controller: AbortController;
}

const activeJobs = new Map<string, ActiveJob>();
const inFlightQuickTranslations = new Map<string, Promise<QuickTranslationResult>>();

function buildProviderOptions(
  settings: TranslatorSettings,
  signal?: AbortSignal
): TranslationProviderOptions {
  return {
    apiKey: settings.deeplApiKey,
    email: settings.myMemoryEmail,
    signal
  };
}

function takeWindowBatchTexts(cues: CueItem[], maxCues: number): string[] {
  const out: string[] = [];
  for (const cue of cues) {
    const norm = sanitizeCueText(cue.text);
    if (!norm || out.includes(norm)) continue;
    const candidate = [...out, norm].join(DELIM);
    if (
      out.length > 0 &&
      (out.length >= maxCues ||
        candidate.length > GTX_MAX_CHARS ||
        encodeURIComponent(candidate).length > 3600)
    ) {
      break;
    }
    out.push(norm);
  }
  return out;
}

function mapCues(
  cues: CueItem[],
  translationsByText: Record<string, string>
): Array<{ id: string; text: string }> {
  return cues.flatMap((cue) => {
    const translated = translationsByText[sanitizeCueText(cue.text)];
    return isValidTranslationText(translated) ? [{ id: cue.id, text: translated }] : [];
  });
}

async function buildCooldownStatus(providerId: string): Promise<TranslationRuntimeStatus> {
  const now = Date.now();
  const retryAt = await getProviderPausedUntil(providerId);
  return {
    state: 'cooldown',
    retryAt: retryAt > now ? retryAt : now + 15_000
  };
}

export function getActiveTranslationJobCount(): number {
  return activeJobs.size;
}

export function cancelTranslationJob(videoId?: string, targetLang?: string): void {
  const normalizedTarget = targetLang?.trim();
  for (const [key, job] of activeJobs.entries()) {
    if (videoId && job.videoId !== videoId) continue;
    if (normalizedTarget && job.targetLang !== normalizedTarget) continue;
    job.controller.abort();
    activeJobs.delete(key);
  }
}

export async function quickTranslateWord(
  text: string,
  sourceLang: string | undefined,
  nativeLang: string,
  settings: TranslatorSettings
): Promise<QuickTranslationResult> {
  const cleanText = text.trim();
  if (!cleanText) {
    throw new Error('Text to translate is empty');
  }
  const sl = sourceLang && sourceLang !== 'unknown' ? sourceLang : 'auto';
  const tl = nativeLang || 'ru';
  const provider = getTranslationProvider(settings.translationProvider);
  const flightKey = `${provider.id}:${sl}:${tl}:${cleanText}`;

  const existing = inFlightQuickTranslations.get(flightKey);
  if (existing) {
    return existing;
  }

  const promise = (async (): Promise<QuickTranslationResult> => {
    const result = await provider.translateWord(
      cleanText,
      sl,
      tl,
      buildProviderOptions(settings)
    );
    if (!result || !isValidTranslationText(result.translation)) {
      throw new Error('Translation unavailable');
    }
    return result;
  })();

  inFlightQuickTranslations.set(flightKey, promise);
  try {
    return await promise;
  } finally {
    if (inFlightQuickTranslations.get(flightKey) === promise) {
      inFlightQuickTranslations.delete(flightKey);
    }
  }
}

export async function translateCuesWindow(
  payload: TranslateCuesWindowRequest,
  settings: TranslatorSettings
): Promise<TranslateCuesWindowResult> {
  const {
    videoId,
    cues,
    sourceLang,
    targetLang,
    priorityTime = 0,
    forceRetry = false
  } = payload;

  if (!cues.length) {
    return { translations: [], status: { state: 'idle' } };
  }

  const provider = getTranslationProvider(settings.translationProvider);
  const sl = sourceLang && sourceLang !== 'unknown' ? sourceLang : 'auto';
  const tl = targetLang || 'ru';

  if (forceRetry) {
    await clearProviderCooldowns(provider.id);
  }

  const jobKey = `${videoId}:${provider.id}:${sl}:${tl}`;
  const previousJob = activeJobs.get(jobKey);
  if (previousJob) {
    previousJob.controller.abort();
  }

  const controller = new AbortController();
  const job: ActiveJob = {
    videoId,
    targetLang: tl,
    controller
  };
  activeJobs.set(jobKey, job);

  try {
    if (await isProviderPaused(provider.id)) {
      return {
        translations: [],
        status: await buildCooldownStatus(provider.id)
      };
    }
    if (controller.signal.aborted) {
      return {
        translations: [],
        status: { state: 'idle' }
      };
    }

    const rawIdx = cues.findIndex((cue) => (cue.endTime ?? (cue.startTime ?? 0) + 4) >= priorityTime);
    const curIdx = rawIdx >= 0 ? rawIdx : Math.max(0, cues.length - 1);

    const ahead = cues.slice(curIdx, curIdx + WINDOW_AHEAD_CUES);
    const remainingSlots = WINDOW_AHEAD_CUES - ahead.length;
    const behind =
      remainingSlots > 0 && curIdx > 0
        ? cues.slice(Math.max(0, curIdx - remainingSlots), curIdx).reverse()
        : [];
    const windowCues = [...ahead, ...behind];

    const batchTexts = takeWindowBatchTexts(windowCues, WINDOW_AHEAD_CUES);
    if (!batchTexts.length) {
      return { translations: [], status: { state: 'idle' } };
    }

    const providerOptions = buildProviderOptions(settings, controller.signal);
    const translatedMap: Record<string, string> = {};

    if (typeof provider.translateBatch === 'function') {
      const batchResults = await provider.translateBatch(batchTexts, sl, tl, providerOptions);
      batchTexts.forEach((text, index) => {
        const result = batchResults[index];
        if (isValidTranslationText(result)) {
          translatedMap[text] = result.trim();
        }
      });
    } else {
      for (const text of batchTexts) {
        if (controller.signal.aborted || (await isProviderPaused(provider.id))) break;
        const single = await provider.translateWord(text, sl, tl, providerOptions);
        if (single && isValidTranslationText(single.translation)) {
          translatedMap[text] = single.translation.trim();
        }
      }
    }

    if (controller.signal.aborted) {
      return {
        translations: mapCues(cues, translatedMap),
        status: { state: 'idle' }
      };
    }

    const translations = mapCues(cues, translatedMap);

    if (await isProviderPaused(provider.id)) {
      return {
        translations,
        status: await buildCooldownStatus(provider.id)
      };
    }

    const attemptedSet = new Set(batchTexts);
    const hasMoreCues = cues.some((cue) => {
      const norm = sanitizeCueText(cue.text);
      return Boolean(norm) && !attemptedSet.has(norm);
    });

    return {
      translations,
      status: { state: hasMoreCues ? 'translating' : 'idle' }
    };
  } finally {
    if (activeJobs.get(jobKey)?.controller === controller) {
      activeJobs.delete(jobKey);
    }
  }
}
