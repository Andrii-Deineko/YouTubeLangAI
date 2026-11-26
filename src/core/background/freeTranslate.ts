import { getCachedCueTranslations, saveCachedCueTranslations } from '../storage/db';
import type { TranslationRuntimeStatus } from '../types/messages';
import type { TranslationProvider } from '../types/settings';
import { isValidTranslationText, normalizeCueText } from '../types/subtitles';

export interface CueItem {
  id: string;
  text: string;
  startTime?: number;
  endTime?: number;
}

export interface SingleParseResult {
  translation: string;
  alternatives: string[];
  partOfSpeech?: string;
  detectedLang?: string;
}

type ProgressFn = (batch: Array<{ id: string; text: string }>, status: TranslationRuntimeStatus) => void;

const DELIM = '\n|||\n';
const COOLDOWN_MS = 60_000;
const BG_DELAY_MS = 600;
const HOT_AHEAD = 15;
const BG_BATCH = 14;
const GTX_MAX_CHARS = 1800;
const MM_MAX_BYTES = 450;

const utf8 = new TextEncoder();
const byteLen = (s: string): number => utf8.encode(s).length;

let gtxPausedUntil = 0;
let mmPausedUntil = 0;
let dictPausedUntil = 0;
let deepLPausedUntil = 0;

export function clearProviderCooldowns(): void {
  gtxPausedUntil = 0;
  mmPausedUntil = 0;
  dictPausedUntil = 0;
  deepLPausedUntil = 0;
}

const isPaused = (until: number): boolean => Date.now() < until;
const sanitize = (raw: string): string => normalizeCueText(raw).replace(/\|\|\|/g, '|').trim();

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0 || signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(t);
      resolve();
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function parseGtxJson(raw: unknown): SingleParseResult {
  if (!Array.isArray(raw) || !Array.isArray(raw[0])) throw new Error('Invalid GTX response');
  const translation = (raw[0] as Array<[string | null]>)
    .map((s) => (Array.isArray(s) && typeof s[0] === 'string' ? s[0] : ''))
    .join('')
    .trim();
  if (!isValidTranslationText(translation)) throw new Error('Invalid GTX translation');

  const alternatives: string[] = [];
  let partOfSpeech: string | undefined;
  if (Array.isArray(raw[1])) {
    for (const d of raw[1]) {
      if (!Array.isArray(d)) continue;
      if (!partOfSpeech && typeof d[0] === 'string' && d[0].trim()) partOfSpeech = d[0].trim();
      for (const c of Array.isArray(d[1]) ? d[1] : []) {
        if (typeof c === 'string' && isValidTranslationText(c) && !alternatives.includes(c.trim())) {
          alternatives.push(c.trim());
        }
      }
    }
  }
  return {
    translation,
    alternatives: alternatives.slice(0, 6),
    partOfSpeech,
    detectedLang: typeof raw[2] === 'string' ? raw[2] : undefined
  };
}

async function fetchGtx(q: string, sl: string, tl: string, dict: boolean, signal?: AbortSignal): Promise<SingleParseResult> {
  if (isPaused(gtxPausedUntil)) throw new Error('GTX cooldown');
  const dt = dict ? '&dt=t&dt=bd&dt=rm' : '&dt=t';
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(sl)}&tl=${encodeURIComponent(tl)}${dt}&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { signal });
  if (res.status === 429 || res.status === 403) {
    gtxPausedUntil = Date.now() + COOLDOWN_MS;
    throw new Error(`GTX HTTP ${res.status}`);
  }
  if (!res.ok) throw new Error(`GTX HTTP ${res.status}`);
  const body = await res.text();
  if (!body || /^\s*</.test(body)) {
    gtxPausedUntil = Date.now() + COOLDOWN_MS;
    throw new Error('GTX challenge');
  }
  return parseGtxJson(JSON.parse(body));
}

function splitToMaxBytes(text: string, maxBytes: number): string[] {
  if (byteLen(text) <= maxBytes) return [text];
  const chunks: string[] = [];
  let cur = '';
  for (const w of text.split(/\s+/)) {
    const next = cur ? `${cur} ${w}` : w;
    if (byteLen(next) <= maxBytes) {
      cur = next;
    } else {
      if (cur) chunks.push(cur);
      if (byteLen(w) <= maxBytes) {
        cur = w;
      } else {
        cur = '';
        for (const ch of w) {
          if (byteLen(cur + ch) > maxBytes) {
            if (cur) chunks.push(cur);
            cur = ch;
          } else cur += ch;
        }
      }
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

async function fetchMyMemory(
  q: string,
  sl: string,
  tl: string,
  email?: string,
  signal?: AbortSignal
): Promise<string> {
  if (isPaused(mmPausedUntil)) throw new Error('MyMemory cooldown');
  const cleanSl = sl.trim().toLowerCase().split('-')[0];
  const src =
    cleanSl && cleanSl !== 'auto' && cleanSl !== 'unknown' && cleanSl !== 'und'
      ? cleanSl
      : /[а-яё]/i.test(q) ? 'ru' : /[іїєґ]/i.test(q) ? 'uk' : 'en';
  const dst = tl.trim().toLowerCase().split('-')[0] || 'ru';
  if (src === dst) throw new Error('Same language');

  const params = new URLSearchParams({ q, langpair: `${src}|${dst}` });
  if (email?.trim()) params.set('de', email.trim());
  const res = await fetch(`https://api.mymemory.translated.net/get?${params}`, { signal });
  if (res.status === 429 || res.status === 403) {
    mmPausedUntil = Date.now() + COOLDOWN_MS;
    throw new Error(`MyMemory HTTP ${res.status}`);
  }
  if (!res.ok) throw new Error(`MyMemory HTTP ${res.status}`);

  const data = (await res.json()) as {
    responseData?: { translatedText?: string };
    responseStatus?: number | string;
    responseDetails?: string;
    quotaFinished?: boolean;
  };
  const tr = data.responseData?.translatedText?.trim() ?? '';
  if (
    data.quotaFinished ||
    Number(data.responseStatus) === 429 ||
    /MYMEMORY WARNING|QUOTA EXCEEDED|TOO MANY REQUESTS/i.test(`${data.responseDetails ?? ''} ${tr}`)
  ) {
    mmPausedUntil = Date.now() + COOLDOWN_MS;
    throw new Error('MyMemory quota exceeded');
  }
  if (Number(data.responseStatus ?? 200) !== 200 || !isValidTranslationText(tr)) {
    throw new Error(data.responseDetails || 'Invalid MyMemory response');
  }
  return tr;
}

async function fetchGoogleDict(
  texts: string[],
  sl: string,
  tl: string,
  signal?: AbortSignal
): Promise<Array<string | null>> {
  if (isPaused(dictPausedUntil)) throw new Error('Google Dict cooldown');
  const params = new URLSearchParams({
    client: 'dict-chrome-ex',
    sl: sl && sl !== 'unknown' ? sl : 'auto',
    tl
  });
  for (const text of texts) params.append('q', text);
  const res = await fetch(`https://clients5.google.com/translate_a/t?${params}`, { signal });
  if (res.status === 429 || res.status === 403) {
    dictPausedUntil = Date.now() + COOLDOWN_MS;
    throw new Error(`Google Dict HTTP ${res.status}`);
  }
  if (!res.ok) throw new Error(`Google Dict HTTP ${res.status}`);
  const raw: unknown = await res.json();
  if (!Array.isArray(raw)) throw new Error('Invalid Google Dict response');
  return texts.map((_, index) => {
    const item = raw[index];
    const translated =
      Array.isArray(item) && typeof item[0] === 'string'
        ? item[0].trim()
        : typeof item === 'string'
          ? item.trim()
          : '';
    return isValidTranslationText(translated) ? translated : null;
  });
}

function mapDeepLLanguage(language: string, target: boolean): string | undefined {
  const clean = language.trim().toLowerCase();
  if (!clean || clean === 'auto' || clean === 'unknown') return undefined;
  if (clean === 'zh-cn' || clean === 'zh-hans') return target ? 'ZH-HANS' : 'ZH';
  if (clean === 'zh-tw' || clean === 'zh-hant') return target ? 'ZH-HANT' : 'ZH';
  if (clean === 'en') return target ? 'EN-US' : 'EN';
  if (clean === 'pt') return target ? 'PT-BR' : 'PT';
  return clean.toUpperCase();
}

async function fetchDeepL(
  texts: string[],
  sl: string,
  tl: string,
  apiKey: string,
  signal?: AbortSignal
): Promise<Array<string | null>> {
  if (isPaused(deepLPausedUntil)) throw new Error('DeepL cooldown');
  const cleanKey = apiKey.trim();
  if (!cleanKey) throw new Error('DeepL API key is not configured');
  const target = mapDeepLLanguage(tl, true);
  if (!target) throw new Error(`Invalid DeepL target language: ${tl}`);
  const endpoint = cleanKey.endsWith(':fx')
    ? 'https://api-free.deepl.com/v2/translate'
    : 'https://api.deepl.com/v2/translate';
  const source = mapDeepLLanguage(sl, false);
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `DeepL-Auth-Key ${cleanKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      text: texts,
      target_lang: target,
      ...(source ? { source_lang: source } : {})
    }),
    signal
  });
  if (res.status === 429 || res.status === 456) {
    deepLPausedUntil = Date.now() + (res.status === 456 ? 24 * 60 * 60 * 1000 : COOLDOWN_MS);
    throw new Error(`DeepL HTTP ${res.status}`);
  }
  if (!res.ok) throw new Error(`DeepL HTTP ${res.status}`);
  const raw = (await res.json()) as { translations?: Array<{ text?: string }> };
  if (!Array.isArray(raw.translations)) throw new Error('Invalid DeepL response');
  return texts.map((_, index) => {
    const translated = raw.translations?.[index]?.text?.trim() ?? '';
    return isValidTranslationText(translated) ? translated : null;
  });
}

interface ProviderConfig {
  provider: TranslationProvider;
  myMemoryEmail?: string;
  deeplApiKey?: string;
}

export async function translateSingleText(params: {
  text: string;
  sourceLang?: string;
  targetLang: string;
  includeDictionary?: boolean;
  provider: TranslationProvider;
  myMemoryEmail?: string;
  deeplApiKey?: string;
}): Promise<SingleParseResult> {
  const clean = params.text.trim();
  const sl = params.sourceLang && params.sourceLang !== 'unknown' ? params.sourceLang : 'auto';
  const tl = params.targetLang || 'ru';
  if (params.provider === 'google') {
    return fetchGtx(clean, sl, tl, Boolean(params.includeDictionary));
  }
  if (params.provider === 'googleDict') {
    const [translation] = await fetchGoogleDict([clean], sl, tl);
    if (!translation) throw new Error('Google Dict returned no translation');
    return { translation, alternatives: [] };
  }
  if (params.provider === 'deepl') {
    const [translation] = await fetchDeepL([clean], sl, tl, params.deeplApiKey ?? '');
    if (!translation) throw new Error('DeepL returned no translation');
    return { translation, alternatives: [] };
  }

  {
    const out: string[] = [];
    for (const part of splitToMaxBytes(clean, MM_MAX_BYTES)) {
      if (out.length > 0) await delay(250);
      out.push(await fetchMyMemory(part, sl, tl, params.myMemoryEmail));
    }
    return { translation: out.join(' ').trim(), alternatives: [] };
  }
}

async function translateChunk(
  items: string[],
  fetchBatchOrOne: (q: string) => Promise<string>,
  paused: () => boolean,
  perItemGapMs: number,
  signal?: AbortSignal
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (!items.length || paused() || signal?.aborted) return out;

  if (items.length > 1) {
    try {
      const parts = (await fetchBatchOrOne(items.join(DELIM))).split(/\s*\|\s*\|\s*\|\s*/).map((s) => s.trim());
      if (parts.length === items.length && parts.every(isValidTranslationText)) {
        items.forEach((t, i) => (out[t] = parts[i]));
        return out;
      }
    } catch (e) {
      if ((e as Error)?.name === 'AbortError' || paused()) return out;
    }
  }

  for (let i = 0; i < items.length; i++) {
    if (signal?.aborted || paused()) break;
    if (i > 0) await delay(perItemGapMs, signal);
    try {
      const tr = await fetchBatchOrOne(items[i]);
      if (isValidTranslationText(tr)) out[items[i]] = tr.trim();
    } catch (e) {
      if ((e as Error)?.name === 'AbortError' || paused()) break;
    }
  }
  return out;
}

async function translateBatch(
  texts: string[],
  sl: string,
  tl: string,
  config: ProviderConfig,
  signal?: AbortSignal
) {
  if (config.provider === 'google') {
    const map = await translateChunk(
      texts,
      async (q) => (await fetchGtx(q, sl, tl, false, signal)).translation,
      () => isPaused(gtxPausedUntil),
      120,
      signal
    );
    const skipped = texts.filter((text) => !map[text]);
    return { map, failed: isPaused(gtxPausedUntil), skipped };
  }

  if (config.provider === 'googleDict' || config.provider === 'deepl') {
    const map: Record<string, string> = {};
    const skipped: string[] = [];
    let missing = [...texts];
    try {
      const translated =
        config.provider === 'googleDict'
          ? await fetchGoogleDict(texts, sl, tl, signal)
          : await fetchDeepL(texts, sl, tl, config.deeplApiKey ?? '', signal);
      texts.forEach((text, index) => {
        const result = translated[index];
        if (isValidTranslationText(result)) map[text] = result;
      });
      missing = texts.filter((text) => !map[text]);
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') return { map, failed: false, skipped };
      if (isPaused(providerPauseUntil(config.provider))) {
        return { map, failed: true, skipped };
      }
    }

    // Keep valid batch results and retry only the missing entries. A single
    // untranslatable sound marker must not discard the rest of the batch.
    for (const text of missing) {
      if (signal?.aborted) return { map, failed: false, skipped };
      try {
        const [result] =
          config.provider === 'googleDict'
            ? await fetchGoogleDict([text], sl, tl, signal)
            : await fetchDeepL([text], sl, tl, config.deeplApiKey ?? '', signal);
        if (isValidTranslationText(result)) map[text] = result;
        else skipped.push(text);
      } catch (error) {
        if ((error as Error)?.name === 'AbortError') return { map, failed: false, skipped };
        if (isPaused(providerPauseUntil(config.provider))) {
          return { map, failed: true, skipped };
        }
        skipped.push(text);
      }
    }
    return { map, failed: false, skipped };
  }

  const map: Record<string, string> = {};
  if (!signal?.aborted && !isPaused(mmPausedUntil)) {
    const mmChunks: string[][] = [];
    let cur: string[] = [];
    let curBytes = 0;
    const delimBytes = byteLen(DELIM);
    for (const t of texts) {
      const b = byteLen(t);
      if (cur.length > 0 && curBytes + delimBytes + b > MM_MAX_BYTES) {
        mmChunks.push(cur);
        cur = [t];
        curBytes = b;
      } else {
        cur.push(t);
        curBytes = cur.length === 1 ? b : curBytes + delimBytes + b;
      }
    }
    if (cur.length) mmChunks.push(cur);

    for (let i = 0; i < mmChunks.length; i++) {
      if (signal?.aborted || isPaused(mmPausedUntil)) break;
      if (i > 0) await delay(250, signal);
      Object.assign(
        map,
        await translateChunk(
          mmChunks[i],
          async (q) => {
            const parts = splitToMaxBytes(q, MM_MAX_BYTES);
            const res: string[] = [];
            for (let k = 0; k < parts.length; k++) {
              if (k > 0) await delay(250, signal);
              res.push(await fetchMyMemory(parts[k], sl, tl, config.myMemoryEmail, signal));
            }
            return res.join(' ').trim();
          },
          () => isPaused(mmPausedUntil),
          250,
          signal
        )
      );
    }
  }

  const skipped = texts.filter((text) => !map[text]);
  return { map, failed: isPaused(mmPausedUntil), skipped };
}

function providerPauseUntil(provider: TranslationProvider): number {
  if (provider === 'google') return gtxPausedUntil;
  if (provider === 'googleDict') return dictPausedUntil;
  if (provider === 'deepl') return deepLPausedUntil;
  return mmPausedUntil;
}

interface JobState {
  version: number;
  cache: Record<string, string>;
  controller: AbortController;
  onProgress?: ProgressFn;
  skipped: Set<string>;
}

const jobs = new Map<string, JobState>();

function takeBatchTexts(
  cues: CueItem[],
  cache: Record<string, string>,
  skipped: Set<string>,
  maxCues: number
): string[] {
  const out: string[] = [];
  for (const cue of cues) {
    const norm = sanitize(cue.text);
    if (!norm || cache[norm] || skipped.has(norm) || out.includes(norm)) continue;
    const candidate = [...out, norm].join(DELIM);
    if (out.length > 0 && (out.length >= maxCues || candidate.length > GTX_MAX_CHARS || encodeURIComponent(candidate).length > 3600)) break;
    out.push(norm);
  }
  return out;
}

function mapCues(cues: CueItem[], map: Record<string, string>): Array<{ id: string; text: string }> {
  return cues.flatMap((c) => {
    const tr = map[sanitize(c.text)];
    return isValidTranslationText(tr) ? [{ id: c.id, text: tr }] : [];
  });
}

function cooldownStatus(provider: TranslationProvider): TranslationRuntimeStatus {
  const now = Date.now();
  const retryAt = providerPauseUntil(provider);
  return { state: 'cooldown', retryAt: retryAt > now ? retryAt : now + 15_000 };
}

export function cancelCueTranslation(videoId?: string): void {
  for (const [key, job] of jobs.entries()) {
    if (videoId && !key.startsWith(`${videoId}:`)) continue;
    job.version++;
    job.controller.abort();
    jobs.delete(key);
  }
}

export async function translateCueBatch(params: {
  videoId: string;
  cues: CueItem[];
  sourceLang?: string;
  targetLang: string;
  provider: TranslationProvider;
  myMemoryEmail?: string;
  deeplApiKey?: string;
  priorityTime?: number;
  forceRetry?: boolean;
  onBatchProgress?: ProgressFn;
}): Promise<{ translations: Array<{ id: string; text: string }>; status: TranslationRuntimeStatus }> {
  const {
    videoId,
    cues,
    targetLang,
    provider,
    priorityTime = 0,
    forceRetry = false,
    onBatchProgress
  } = params;
  if (!cues.length) return { translations: [], status: { state: 'idle' } };
  if (forceRetry) clearProviderCooldowns();

  const sl = params.sourceLang && params.sourceLang !== 'unknown' ? params.sourceLang : 'auto';
  const tl = targetLang || 'ru';
  const key = `${videoId}:${provider}:${sl}:${tl}`;
  const stored = await getCachedCueTranslations(videoId, tl, provider);
  const providerConfig: ProviderConfig = {
    provider,
    myMemoryEmail: params.myMemoryEmail,
    deeplApiKey: params.deeplApiKey
  };

  let job = jobs.get(key);
  if (job) {
    job.controller.abort();
    job.version++;
    job.cache = { ...stored, ...job.cache };
    job.controller = new AbortController();
    job.onProgress = onBatchProgress ?? job.onProgress;
    if (forceRetry) job.skipped.clear();
  } else {
    job = {
      version: 1,
      cache: { ...stored },
      controller: new AbortController(),
      onProgress: onBatchProgress,
      skipped: new Set<string>()
    };
    jobs.set(key, job);
  }

  const version = job.version;
  const signal = job.controller.signal;
  const rawIdx = cues.findIndex((c) => (c.endTime ?? (c.startTime ?? 0) + 4) >= priorityTime);
  const curIdx = rawIdx >= 0 ? rawIdx : Math.max(0, cues.length - 1);

  const runStep = async (texts: string[], emitNewOnly: boolean): Promise<'ok' | 'cooldown' | 'aborted'> => {
    if (isPaused(providerPauseUntil(provider))) {
      job!.onProgress?.(
        emitNewOnly ? [] : mapCues(cues, job!.cache),
        cooldownStatus(provider)
      );
      return 'cooldown';
    }
    const { map, failed, skipped } = await translateBatch(
      texts,
      sl,
      tl,
      providerConfig,
      signal
    );
    if (signal.aborted || job!.version !== version) return 'aborted';
    for (const text of skipped) job!.skipped.add(text);
    if (Object.keys(map).length > 0) {
      Object.assign(job!.cache, map);
      void saveCachedCueTranslations(videoId, tl, map, provider);
      if (emitNewOnly) job!.onProgress?.(mapCues(cues, map), { state: 'translating' });
    }
    if (failed) {
      job!.onProgress?.(
        emitNewOnly ? [] : mapCues(cues, job!.cache),
        cooldownStatus(provider)
      );
      return 'cooldown';
    }
    return 'ok';
  };

  const hotTexts = takeBatchTexts(
    cues.slice(curIdx, curIdx + HOT_AHEAD + 1),
    job.cache,
    job.skipped,
    HOT_AHEAD + 1
  );
  if (hotTexts.length > 0) {
    const res = await runStep(hotTexts, false);
    if (res === 'cooldown') {
      return { translations: mapCues(cues, job.cache), status: cooldownStatus(provider) };
    }
    if (res === 'aborted') return { translations: mapCues(cues, job.cache), status: { state: 'translating' } };
  }

  const translated = mapCues(cues, job.cache);
  if (
    !cues.some((c) => {
      const text = sanitize(c.text);
      return text && !job!.cache[text] && !job!.skipped.has(text);
    })
  ) {
    job.onProgress?.(translated, { state: 'idle' });
    return { translations: translated, status: { state: 'idle' } };
  }

  job.onProgress?.(translated, { state: 'translating' });

  void (async () => {
    const ordered = [...cues.slice(curIdx + HOT_AHEAD + 1), ...cues.slice(0, curIdx).reverse()];
    while (!signal.aborted && job!.version === version) {
      const batch = takeBatchTexts(ordered, job!.cache, job!.skipped, BG_BATCH);
      if (!batch.length) {
        job!.onProgress?.([], { state: 'idle' });
        break;
      }
      await delay(BG_DELAY_MS, signal);
      if (signal.aborted || job!.version !== version) break;
      if ((await runStep(batch, true)) !== 'ok') break;
    }
  })();

  return { translations: translated, status: { state: 'translating' } };
}
