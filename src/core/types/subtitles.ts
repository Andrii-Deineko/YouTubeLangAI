export interface WordToken {
  id: string;
  text: string;
  isWord: boolean;
  startTime: number;
  endTime: number;
  normalized: string;
}

export interface SubtitleCue {
  id: string;
  index?: number;
  startTime: number;
  endTime: number;
  text: string;
  tokens: WordToken[];
  translation?: string;
  translationError?: string;
}

export interface TrackMetadata {
  id?: string;
  videoId?: string;
  lang?: string;
  language?: string;
  label?: string;
  source?: string;
  tlang?: string;
  kind?: string;
  isAsr?: boolean;
  url?: string;
  title?: string;
}

export interface Json3Seg {
  utf8: string;
  tOffsetMs?: number;
}

export interface Json3Event {
  tStartMs: number;
  dDurationMs?: number;
  wWinId?: number;
  aAppend?: number;
  segs?: Json3Seg[];
}

export interface Json3Response {
  events?: Json3Event[];
  wireMagic?: string;
}

export interface InterceptedSubtitlePayload {
  source: 'fetch' | 'xhr' | 'playerjs';
  url?: string;
  rawText?: string;
  playerJsString?: string;
  resetPrevious?: boolean;
}

const INVALID_TRANSLATION_RE =
  /^\s*ошибка перевода|MYMEMORY WARNING|QUOTA EXCEEDED|QUERY LENGTH LIMIT EXCEEDED|PLEASE SELECT TWO DISTINCT LANGUAGES|INVALID LANGUAGE PAIR|TOO MANY REQUESTS|<!doctype html|<html\b/i;

export function normalizeCueText(text: string): string {
  return text.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function isValidTranslationText(text: unknown): text is string {
  return typeof text === 'string' && text.trim().length > 0 && !INVALID_TRANSLATION_RE.test(text);
}
