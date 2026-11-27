import { isValidTranslationText, normalizeCueText } from '@langai/contracts';

export const DELIM = '\n|||\n';
export const GTX_MAX_CHARS = 1800;
export const MM_MAX_BYTES = 450;

const utf8 = new TextEncoder();

export function byteLen(text: string): number {
  return utf8.encode(text).length;
}

export function sanitizeCueText(raw: string): string {
  return normalizeCueText(raw).replace(/\|\|\|/g, '|').trim();
}

export function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name?: unknown }).name === 'AbortError'
  );
}

export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0 || signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve();
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export function splitToMaxBytes(text: string, maxBytes: number): string[] {
  if (byteLen(text) <= maxBytes) return [text];
  const chunks: string[] = [];
  let cur = '';
  for (const word of text.split(/\s+/)) {
    const next = cur ? `${cur} ${word}` : word;
    if (byteLen(next) <= maxBytes) {
      cur = next;
    } else {
      if (cur) chunks.push(cur);
      if (byteLen(word) <= maxBytes) {
        cur = word;
      } else {
        cur = '';
        for (const ch of word) {
          if (byteLen(cur + ch) > maxBytes) {
            if (cur) chunks.push(cur);
            cur = ch;
          } else {
            cur += ch;
          }
        }
      }
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

export async function translateChunk(
  items: string[],
  fetchBatchOrOne: (query: string) => Promise<string>,
  isPaused: () => Promise<boolean>,
  perItemGapMs: number,
  signal?: AbortSignal
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (!items.length || signal?.aborted || (await isPaused())) return out;

  if (items.length > 1) {
    try {
      const joinedResult = await fetchBatchOrOne(items.join(DELIM));
      const parts = joinedResult
        .split(/\s*\|\s*\|\s*\|\s*/)
        .map((s) => s.trim());
      if (parts.length === items.length && parts.every(isValidTranslationText)) {
        items.forEach((item, index) => {
          out[item] = parts[index];
        });
        return out;
      }
    } catch (error: unknown) {
      if (isAbortError(error) || (await isPaused())) return out;
    }
  }

  for (let i = 0; i < items.length; i++) {
    if (signal?.aborted || (await isPaused())) break;
    if (i > 0) await delay(perItemGapMs, signal);
    if (signal?.aborted || (await isPaused())) break;
    try {
      const translated = await fetchBatchOrOne(items[i]);
      if (isValidTranslationText(translated)) {
        out[items[i]] = translated.trim();
      }
    } catch (error: unknown) {
      if (isAbortError(error) || (await isPaused())) break;
    }
  }

  return out;
}
