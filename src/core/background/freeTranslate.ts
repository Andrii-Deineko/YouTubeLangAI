import { getCachedCueTranslations, saveCachedCueTranslations } from '../storage/db';
import type { TranslationRuntimeStatus } from '../types/messages';
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

export function clearProviderCooldowns(): void {
  gtxPausedUntil = 0;
  mmPausedUntil = 0;
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

async function fetchMyMemory(q: string, sl: string, tl: string, signal?: AbortSignal): Promise<string> {
  if (isPaused(mmPausedUntil)) throw new Error('MyMemory cooldown');
  const cleanSl = sl.trim().toLowerCase().split('-')[0];
  const src =
    cleanSl && cleanSl !== 'auto' && cleanSl !== 'unknown' && cleanSl !== 'und'
      ? cleanSl
      : /[а-яё]/i.test(q) ? 'ru' : /[іїєґ]/i.test(q) ? 'uk' : 'en';
  const dst = tl.trim().toLowerCase().split('-')[0] || 'ru';
  if (src === dst) throw new Error('Same language');

  const params = new URLSearchParams({ q, langpair: `${src}|${dst}` });
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

export async function translateSingleText(params: {
  text: string;
  sourceLang?: string;
  targetLang: string;
  includeDictionary?: boolean;
}): Promise<SingleParseResult> {
  const clean = params.text.trim();
  const sl = params.sourceLang && params.sourceLang !== 'unknown' ? params.sourceLang : 'auto';
  const tl = params.targetLang || 'ru';
  try {
    return await fetchGtx(clean, sl, tl, Boolean(params.includeDictionary));
  } catch {
    const out: string[] = [];
    for (const part of splitToMaxBytes(clean, MM_MAX_BYTES)) {
      if (out.length > 0) await delay(250);
      out.push(await fetchMyMemory(part, sl, tl));
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

async function translateBatch(texts: string[], sl: string, tl: string, signal?: AbortSignal) {
  const map = await translateChunk(
    texts,
    async (q) => (await fetchGtx(q, sl, tl, false, signal)).translation,
    () => isPaused(gtxPausedUntil),
    120,
    signal
  );

  const missing = texts.filter((t) => !map[t]);
  if (missing.length > 0 && !signal?.aborted && !isPaused(mmPausedUntil)) {
    const mmChunks: string[][] = [];
    let cur: string[] = [];
    let curBytes = 0;
    const delimBytes = byteLen(DELIM);
    for (const t of missing) {
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
              res.push(await fetchMyMemory(parts[k], sl, tl, signal));
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

  return { map, failed: Object.keys(map).length === 0 };
}

interface JobState {
  version: number;
  cache: Record<string, string>;
  controller: AbortController;
  onProgress?: ProgressFn;
}

const jobs = new Map<string, JobState>();

function takeBatchTexts(cues: CueItem[], cache: Record<string, string>, maxCues: number): string[] {
  const out: string[] = [];
  for (const cue of cues) {
    const norm = sanitize(cue.text);
    if (!norm || cache[norm] || out.includes(norm)) continue;
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

function cooldownStatus(): TranslationRuntimeStatus {
  const now = Date.now();
  const times = [gtxPausedUntil, mmPausedUntil].filter((t) => t > now);
  return { state: 'cooldown', retryAt: times.length ? Math.min(...times) : now + 15_000 };
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
  priorityTime?: number;
  forceRetry?: boolean;
  onBatchProgress?: ProgressFn;
}): Promise<{ translations: Array<{ id: string; text: string }>; status: TranslationRuntimeStatus }> {
  const { videoId, cues, targetLang, priorityTime = 0, forceRetry = false, onBatchProgress } = params;
  if (!cues.length) return { translations: [], status: { state: 'idle' } };
  if (forceRetry) clearProviderCooldowns();

  const sl = params.sourceLang && params.sourceLang !== 'unknown' ? params.sourceLang : 'auto';
  const tl = targetLang || 'ru';
  const key = `${videoId}:${sl}:${tl}`;
  const stored = await getCachedCueTranslations(videoId, tl);

  let job = jobs.get(key);
  if (job) {
    job.controller.abort();
    job.version++;
    job.cache = { ...stored, ...job.cache };
    job.controller = new AbortController();
    job.onProgress = onBatchProgress ?? job.onProgress;
  } else {
    job = { version: 1, cache: { ...stored }, controller: new AbortController(), onProgress: onBatchProgress };
    jobs.set(key, job);
  }

  const version = job.version;
  const signal = job.controller.signal;
  const rawIdx = cues.findIndex((c) => (c.endTime ?? (c.startTime ?? 0) + 4) >= priorityTime);
  const curIdx = rawIdx >= 0 ? rawIdx : Math.max(0, cues.length - 1);

  const runStep = async (texts: string[], emitNewOnly: boolean): Promise<'ok' | 'cooldown' | 'aborted'> => {
    if (isPaused(gtxPausedUntil) && isPaused(mmPausedUntil)) {
      job!.onProgress?.(emitNewOnly ? [] : mapCues(cues, job!.cache), cooldownStatus());
      return 'cooldown';
    }
    const { map, failed } = await translateBatch(texts, sl, tl, signal);
    if (signal.aborted || job!.version !== version) return 'aborted';
    if (Object.keys(map).length > 0) {
      Object.assign(job!.cache, map);
      void saveCachedCueTranslations(videoId, tl, map);
      if (emitNewOnly) job!.onProgress?.(mapCues(cues, map), { state: 'translating' });
      return 'ok';
    }
    if (failed) {
      job!.onProgress?.(emitNewOnly ? [] : mapCues(cues, job!.cache), cooldownStatus());
      return 'cooldown';
    }
    return 'ok';
  };

  const hotTexts = takeBatchTexts(cues.slice(curIdx, curIdx + HOT_AHEAD + 1), job.cache, HOT_AHEAD + 1);
  if (hotTexts.length > 0) {
    const res = await runStep(hotTexts, false);
    if (res === 'cooldown') return { translations: mapCues(cues, job.cache), status: cooldownStatus() };
    if (res === 'aborted') return { translations: mapCues(cues, job.cache), status: { state: 'translating' } };
  }

  const translated = mapCues(cues, job.cache);
  if (!cues.some((c) => sanitize(c.text) && !job!.cache[sanitize(c.text)])) {
    job.onProgress?.(translated, { state: 'idle' });
    jobs.delete(key);
    return { translations: translated, status: { state: 'idle' } };
  }

  job.onProgress?.(translated, { state: 'translating' });

  void (async () => {
    const ordered = [...cues.slice(curIdx + HOT_AHEAD + 1), ...cues.slice(0, curIdx).reverse()];
    while (!signal.aborted && job!.version === version) {
      const batch = takeBatchTexts(ordered, job!.cache, BG_BATCH);
      if (!batch.length) {
        job!.onProgress?.([], { state: 'idle' });
        break;
      }
      await delay(BG_DELAY_MS, signal);
      if (signal.aborted || job!.version !== version) break;
      if ((await runStep(batch, true)) !== 'ok') break;
    }
    if (job!.version === version) jobs.delete(key);
  })();

  return { translations: translated, status: { state: 'translating' } };
}
