import type { Json3Event, Json3Response, SubtitleCue } from '@langai/contracts';
import { cleanSubtitleText, decodeHtmlEntities } from './htmlEntities';
import { splitLongCues } from './splitter';
import { tokenizeCueText } from './tokenizer';

interface TimedPiece {
  text: string;
  startMs: number;
  endMs: number;
}

const SENTENCE_END_REGEX = /[.!?]["'”’)\]]*$/;
const TIMESTAMP_CAPTURE_REGEX = /(?:(\d{1,3}):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/;

export interface ParseSubtitlesOptions {
  kind?: string;
  splitLong?: boolean;
  maxCueLength?: number;
}

export interface ParseAsrOptions {
  maxPauseMs?: number;
  maxCueLength?: number;
}

/**
 * Parses a VTT/SRT timestamp string (`HH:MM:SS.mmm` or `MM:SS,mmm`) into seconds.
 */
export function parseTimestampToSeconds(timestamp: string): number {
  const trimmed = timestamp.trim();
  const match = trimmed.match(TIMESTAMP_CAPTURE_REGEX);
  if (!match) return 0;

  const hours = match[1] ? Number.parseInt(match[1], 10) : 0;
  const minutes = Number.parseInt(match[2], 10);
  const seconds = Number.parseInt(match[3], 10);
  const millisStr = match[4].padEnd(3, '0').slice(0, 3);
  const millis = Number.parseInt(millisStr, 10);

  return hours * 3600 + minutes * 60 + seconds + millis / 1000;
}

function parseTimestampToMs(
  hours: string | undefined,
  minutes: string,
  seconds: string,
  millis: string
): number {
  const h = hours ? Number.parseInt(hours, 10) : 0;
  const m = Number.parseInt(minutes, 10);
  const s = Number.parseInt(seconds, 10);
  const ms = Number.parseInt(millis.padEnd(3, '0').slice(0, 3), 10);
  return (h * 3600 + m * 60 + s) * 1000 + ms;
}

function maybeSplitCues(cues: SubtitleCue[], options?: ParseSubtitlesOptions): SubtitleCue[] {
  if (options?.splitLong === false) return cues;
  return splitLongCues(cues, options?.maxCueLength ?? 85);
}

/**
 * Parses WebVTT subtitle content into normalized, tokenized `SubtitleCue[]`.
 */
export function parseVtt(content: string, options?: ParseSubtitlesOptions): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  const lines = content
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n');

  let i = 0;
  while (i < lines.length && !lines[i].includes('-->')) {
    i++;
  }

  while (i < lines.length) {
    const line = lines[i].trim();

    if (/^(?:NOTE|STYLE|REGION)\b/.test(line)) {
      i++;
      while (i < lines.length && lines[i].trim() !== '') {
        i++;
      }
      i++;
      continue;
    }

    if (line.includes('-->')) {
      const parts = line.split('-->');
      const startStr = parts[0].trim();
      const endPart = parts[1].trim().split(/\s+/)[0];

      if (TIMESTAMP_CAPTURE_REGEX.test(startStr) && TIMESTAMP_CAPTURE_REGEX.test(endPart)) {
        const startTime = parseTimestampToSeconds(startStr);
        const endTime = parseTimestampToSeconds(endPart);

        i++;
        const textLines: string[] = [];
        while (i < lines.length && lines[i].trim() !== '') {
          if (lines[i].includes('-->')) {
            i--;
            break;
          }
          textLines.push(lines[i]);
          i++;
        }

        const text = cleanSubtitleText(textLines.join('\n'));
        if (text && endTime > startTime) {
          const id = `cue_${cues.length}_${startTime.toFixed(2)}`;
          cues.push({
            id,
            index: cues.length,
            startTime,
            endTime,
            text,
            tokens: tokenizeCueText(id, text, startTime, endTime)
          });
        }
      }
    }
    i++;
  }

  return maybeSplitCues(cues, options);
}

/**
 * Parses SubRip (SRT) subtitle content into normalized, tokenized `SubtitleCue[]`.
 */
export function parseSrt(content: string, options?: ParseSubtitlesOptions): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  const normalized = content
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
  const blocks = normalized.split(/\n\s*\n/);

  for (let b = 0; b < blocks.length; b++) {
    const block = blocks[b].trim();
    if (!block) continue;

    const lines = block.split('\n');
    let timeLineIdx = -1;

    for (let l = 0; l < lines.length; l++) {
      if (lines[l].includes('-->')) {
        timeLineIdx = l;
        break;
      }
    }

    if (timeLineIdx === -1) continue;

    const timeLine = lines[timeLineIdx];
    const parts = timeLine.split('-->');
    if (parts.length !== 2) continue;

    const startTime = parseTimestampToSeconds(parts[0]);
    const endTime = parseTimestampToSeconds(parts[1]);

    const textLines = lines.slice(timeLineIdx + 1);
    const text = cleanSubtitleText(textLines.join('\n'));

    if (text && endTime > startTime) {
      const id = `cue_${cues.length}_${startTime.toFixed(2)}`;
      cues.push({
        id,
        index: cues.length,
        startTime,
        endTime,
        text,
        tokens: tokenizeCueText(id, text, startTime, endTime)
      });
    }
  }

  return maybeSplitCues(cues, options);
}

/**
 * Type guard checking whether an unknown parsed JSON value matches `Json3Response`.
 */
export function isJson3Response(value: unknown): value is Json3Response {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { events?: unknown };
  return Array.isArray(candidate.events);
}

/**
 * Converts WebVTT text into a `Json3Response` structure for unified timedtext pipelines.
 */
export function parseVttToJson3(vttText: string): Json3Response | null {
  const events: Json3Event[] = [];
  const cueRegex =
    /(?:(\d{1,3}):)?(\d{1,2}):(\d{2})[.,](\d{1,3})\s*-->\s*(?:(\d{1,3}):)?(\d{1,2}):(\d{2})[.,](\d{1,3})[^\r\n]*\r?\n([\s\S]*?)(?=\r?\n\r?\n|\r?\n?$|$)/g;
  let match: RegExpExecArray | null = cueRegex.exec(vttText);
  while (match !== null) {
    const startMs = parseTimestampToMs(match[1], match[2], match[3], match[4]);
    const endMs = parseTimestampToMs(match[5], match[6], match[7], match[8]);
    const text = cleanSubtitleText(match[9]);
    if (text && endMs > startMs) {
      events.push({
        tStartMs: startMs,
        dDurationMs: Math.max(endMs - startMs, 100),
        segs: [{ utf8: text }]
      });
    }
    match = cueRegex.exec(vttText);
  }
  return events.length > 0 ? { events } : null;
}

/**
 * Parses YouTube SRV3 XML (`<timedtext format="3">`) into `Json3Response` without DOM APIs.
 */
export function parseSrv3ToJson3(rawXml: string): Json3Response | null {
  if (!rawXml || !rawXml.includes('<timedtext') || !rawXml.includes('<p ')) {
    return null;
  }

  const events: Json3Event[] = [];
  const pRegex = /<p\s+([^>]+)>([\s\S]*?)<\/p>/g;
  let pMatch: RegExpExecArray | null = pRegex.exec(rawXml);

  while (pMatch !== null) {
    const attrs = pMatch[1];
    const content = pMatch[2];
    const tMatch = attrs.match(/\bt=["'](\d+)["']/);
    const dMatch = attrs.match(/\bd=["'](\d+)["']/);
    const tStartMs = tMatch ? Number.parseInt(tMatch[1], 10) : 0;
    const dDurationMs = dMatch ? Number.parseInt(dMatch[1], 10) : 0;

    const segs: Array<{ utf8: string; tOffsetMs?: number }> = [];
    const sRegex = /<s([^>]*)>([^<]*)<\/s>/g;
    let sMatch: RegExpExecArray | null = sRegex.exec(content);
    let hasSegs = false;

    while (sMatch !== null) {
      hasSegs = true;
      const sAttrs = sMatch[1];
      const offsetMatch = sAttrs.match(/\bt=["'](\d+)["']/);
      const offset = offsetMatch ? Number.parseInt(offsetMatch[1], 10) : undefined;
      const text = decodeHtmlEntities(sMatch[2]);
      if (text) {
        segs.push({
          utf8: text,
          ...(offset !== undefined ? { tOffsetMs: offset } : {})
        });
      }
      sMatch = sRegex.exec(content);
    }

    if (!hasSegs) {
      const cleanText = decodeHtmlEntities(content.replace(/<[^>]+>/g, ''));
      if (cleanText) segs.push({ utf8: cleanText });
    }

    if (segs.length > 0) {
      events.push({ tStartMs, dDurationMs, segs });
    }
    pMatch = pRegex.exec(rawXml);
  }

  return events.length > 0 ? { events } : null;
}

/**
 * Parses legacy YouTube XML (`<transcript><text start="..." dur="...">`) into `Json3Response`.
 */
export function parseLegacyXmlToJson3(rawXml: string): Json3Response | null {
  if (
    !rawXml ||
    (!rawXml.includes('<transcript') && !(rawXml.includes('<text ') && rawXml.includes('start=')))
  ) {
    return null;
  }

  const events: Json3Event[] = [];
  const textRegex = /<text\s+([^>]+)>([\s\S]*?)<\/text>/g;
  let match: RegExpExecArray | null = textRegex.exec(rawXml);

  while (match !== null) {
    const attrs = match[1];
    const rawSegText = decodeHtmlEntities(match[2]);
    const startMatch = attrs.match(/\bstart=["']([\d.]+)["']/);
    const durMatch = attrs.match(/\bdur=["']([\d.]+)["']/);
    const startSec = startMatch ? Number.parseFloat(startMatch[1]) : 0;
    const durSec = durMatch ? Number.parseFloat(durMatch[1]) : 2.0;

    if (rawSegText.trim()) {
      events.push({
        tStartMs: Math.round(startSec * 1000),
        dDurationMs: Math.round(durSec * 1000),
        segs: [{ utf8: rawSegText }]
      });
    }
    match = textRegex.exec(rawXml);
  }

  return events.length > 0 ? { events } : null;
}

/**
 * Auto-detects and converts JSON3, SRV3 XML, legacy `<transcript>` XML, or VTT into `Json3Response`.
 */
export function parseTimedtextToJson3(rawText: string): Json3Response | null {
  const trimmed = rawText.replace(/^\uFEFF/, '').trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const data = JSON.parse(trimmed) as unknown;
      if (isJson3Response(data)) return data;
    } catch {
      // Fall through to XML/VTT checks
    }
  }

  const srv3 = parseSrv3ToJson3(trimmed);
  if (srv3) return srv3;

  const legacyXml = parseLegacyXmlToJson3(trimmed);
  if (legacyXml) return legacyXml;

  if (trimmed.includes('WEBVTT') || trimmed.includes('-->')) {
    const vtt = parseVttToJson3(trimmed);
    if (vtt) return vtt;
  }

  return null;
}

/**
 * Detects whether a JSON3 event stream represents an auto-generated (ASR) track
 * based on track metadata, window/append markers, or word-level timing offsets.
 */
export function detectAsrTrack(events: Json3Event[], kind?: string): boolean {
  if (kind === 'asr') return true;
  let wordOffsetSegCount = 0;
  let totalSegEvents = 0;

  for (const ev of events) {
    if (!ev.segs || ev.segs.length === 0) continue;
    totalSegEvents++;
    if (ev.wWinId !== undefined || ev.aAppend === 1) {
      return true;
    }
    if (ev.segs.some((s) => typeof s.tOffsetMs === 'number' && s.tOffsetMs > 0)) {
      wordOffsetSegCount++;
    }
  }

  return totalSegEvents > 0 && wordOffsetSegCount / totalSegEvents > 0.35;
}

function deduplicateAsrOverlaps(pieces: TimedPiece[]): TimedPiece[] {
  const result: TimedPiece[] = [];

  for (const piece of pieces) {
    const last = result[result.length - 1];
    if (!last) {
      result.push(piece);
      continue;
    }

    const normCurr = piece.text.toLowerCase();
    const normLast = last.text.toLowerCase();

    if (normCurr === normLast && Math.abs(piece.startMs - last.startMs) <= 350) {
      if (piece.endMs > last.endMs) {
        last.endMs = piece.endMs;
      }
      continue;
    }

    if (piece.startMs - last.startMs <= 1200 && piece.text.includes(' ')) {
      const currWords = piece.text.split(' ');
      const tailWords = result
        .slice(-Math.min(currWords.length, 4))
        .map((p) => p.text.toLowerCase());
      let overlapCount = 0;
      for (let k = Math.min(currWords.length, tailWords.length); k >= 1; k--) {
        const tailSlice = tailWords.slice(-k).join(' ');
        const headSlice = currWords.slice(0, k).join(' ').toLowerCase();
        if (tailSlice === headSlice) {
          overlapCount = k;
          break;
        }
      }
      if (overlapCount > 0) {
        const remaining = currWords.slice(overlapCount).join(' ').trim();
        if (!remaining) continue;
        result.push({
          text: remaining,
          startMs: piece.startMs,
          endMs: piece.endMs
        });
        continue;
      }
    }

    result.push(piece);
  }

  return result;
}

function extractTimedPieces(events: Json3Event[]): TimedPiece[] {
  const rawPieces: TimedPiece[] = [];
  const sorted = [...events].sort((a, b) => a.tStartMs - b.tStartMs);

  for (let i = 0; i < sorted.length; i++) {
    const ev = sorted[i];
    if (!ev.segs || ev.segs.length === 0) continue;

    const evStartMs = ev.tStartMs;
    const nextEvStartMs =
      i + 1 < sorted.length ? sorted[i + 1].tStartMs : evStartMs + (ev.dDurationMs ?? 3000);
    const evEndMs =
      typeof ev.dDurationMs === 'number' && ev.dDurationMs > 0
        ? evStartMs + ev.dDurationMs
        : Math.max(evStartMs + 500, nextEvStartMs);

    for (let s = 0; s < ev.segs.length; s++) {
      const seg = ev.segs[s];
      const cleaned = decodeHtmlEntities(seg.utf8)
        .replace(/[\r\n]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (!cleaned) continue;

      const segStartMs = evStartMs + (seg.tOffsetMs ?? 0);
      let segEndMs = evEndMs;
      for (let k = s + 1; k < ev.segs.length; k++) {
        const nextOffset = ev.segs[k].tOffsetMs;
        if (typeof nextOffset === 'number') {
          segEndMs = evStartMs + nextOffset;
          break;
        }
      }
      if (segEndMs <= segStartMs) {
        segEndMs = segStartMs + 250;
      }

      rawPieces.push({
        text: cleaned,
        startMs: segStartMs,
        endMs: segEndMs
      });
    }
  }

  rawPieces.sort((a, b) => a.startMs - b.startMs);
  return deduplicateAsrOverlaps(rawPieces);
}

/**
 * Merges YouTube ASR word-level JSON3/SRV3 events into natural sentence/phrase cues.
 */
export function parseAsrEvents(
  events: Json3Event[],
  options?: ParseAsrOptions
): SubtitleCue[] {
  const pieces = extractTimedPieces(events);
  if (pieces.length === 0) return [];

  const maxPauseMs = options?.maxPauseMs ?? 600;
  const maxCueLength = options?.maxCueLength ?? 80;

  const cues: SubtitleCue[] = [];
  let bufferPieces: TimedPiece[] = [];
  let bufferText = '';

  const flushBuffer = (): void => {
    if (bufferPieces.length === 0) return;
    const text = bufferText.trim();
    if (!text) {
      bufferPieces = [];
      bufferText = '';
      return;
    }
    const startMs = bufferPieces[0].startMs;
    const lastPiece = bufferPieces[bufferPieces.length - 1];
    const endMs = Math.max(lastPiece.endMs, startMs + 400);
    const index = cues.length;
    const cueId = `cue-${index}-${startMs}`;
    const startTime = startMs / 1000;
    const endTime = endMs / 1000;

    cues.push({
      id: cueId,
      index,
      startTime,
      endTime,
      text,
      tokens: tokenizeCueText(cueId, text, startTime, endTime)
    });

    bufferPieces = [];
    bufferText = '';
  };

  for (let i = 0; i < pieces.length; i++) {
    const piece = pieces[i];
    const prevPiece = bufferPieces[bufferPieces.length - 1];

    if (prevPiece) {
      const pauseMs = piece.startMs - prevPiece.endMs;
      const candidateLength = bufferText.length + 1 + piece.text.length;
      if (pauseMs > maxPauseMs || candidateLength > maxCueLength) {
        flushBuffer();
      }
    }

    bufferPieces.push(piece);
    bufferText = bufferText ? `${bufferText} ${piece.text}` : piece.text;

    if (SENTENCE_END_REGEX.test(piece.text)) {
      flushBuffer();
    }
  }

  flushBuffer();

  for (let i = 0; i < cues.length - 1; i++) {
    if (cues[i].endTime > cues[i + 1].startTime) {
      cues[i].endTime = Math.max(cues[i].startTime + 0.2, cues[i + 1].startTime - 0.02);
    }
  }

  return cues;
}

/**
 * Parses standard (non-ASR) JSON3/SRV3 events into `SubtitleCue[]`.
 */
export function parseStandardJson3Events(events: Json3Event[]): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  const sorted = [...events].sort((a, b) => a.tStartMs - b.tStartMs);

  for (let i = 0; i < sorted.length; i++) {
    const ev = sorted[i];
    if (!ev.segs || ev.segs.length === 0) continue;

    const rawText = ev.segs
      .map((s) => s.utf8)
      .join('')
      .replace(/[\r\n]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const cleaned = cleanSubtitleText(rawText);
    if (!cleaned) continue;

    const startMs = ev.tStartMs;
    const durationMs =
      typeof ev.dDurationMs === 'number' && ev.dDurationMs > 0 ? ev.dDurationMs : 2500;
    let endMs = startMs + durationMs;

    for (let j = i + 1; j < sorted.length; j++) {
      const nextEv = sorted[j];
      if (nextEv.segs && nextEv.segs.length > 0 && nextEv.tStartMs > startMs) {
        if (endMs > nextEv.tStartMs) {
          endMs = Math.max(startMs + 250, nextEv.tStartMs - 20);
        }
        break;
      }
    }

    const index = cues.length;
    const cueId = `cue-${index}-${startMs}`;
    const startTime = startMs / 1000;
    const endTime = endMs / 1000;

    cues.push({
      id: cueId,
      index,
      startTime,
      endTime,
      text: cleaned,
      tokens: tokenizeCueText(cueId, cleaned, startTime, endTime)
    });
  }

  return cues;
}

/**
 * Parses a YouTube JSON3 object or raw JSON3 string into `SubtitleCue[]`.
 */
export function parseJson3(
  input: Json3Response | string,
  options?: ParseSubtitlesOptions
): SubtitleCue[] {
  let data: Json3Response | null = null;
  if (typeof input === 'string') {
    try {
      const parsed = JSON.parse(input.replace(/^\uFEFF/, '').trim()) as unknown;
      if (isJson3Response(parsed)) {
        data = parsed;
      }
    } catch {
      return [];
    }
  } else if (isJson3Response(input)) {
    data = input;
  }

  if (!data) return [];
  const events = data.events ?? [];
  const isAsr = detectAsrTrack(events, options?.kind);
  const rawCues = isAsr ? parseAsrEvents(events) : parseStandardJson3Events(events);
  return maybeSplitCues(rawCues, options);
}

/**
 * Parses YouTube SRV3 XML (`<timedtext>`) or legacy XML (`<transcript>`) into `SubtitleCue[]`.
 */
export function parseSrv3(content: string, options?: ParseSubtitlesOptions): SubtitleCue[] {
  const trimmed = content.replace(/^\uFEFF/, '').trim();
  const json3 = parseSrv3ToJson3(trimmed) ?? parseLegacyXmlToJson3(trimmed);
  if (!json3) return [];
  return parseJson3(json3, options);
}

/**
 * Auto-detects subtitle format (JSON3, SRV3/XML, WebVTT, or SRT) and parses into `SubtitleCue[]`.
 */
export function parseSubtitles(
  content: string,
  options?: ParseSubtitlesOptions
): SubtitleCue[] {
  const clean = content.replace(/^\uFEFF/, '').trimStart();
  if (!clean) return [];

  if (clean.startsWith('{')) {
    const json3Cues = parseJson3(clean, options);
    if (json3Cues.length > 0) return json3Cues;
  }

  if (
    clean.includes('<timedtext') ||
    clean.includes('<transcript') ||
    (clean.includes('<text ') && clean.includes('start='))
  ) {
    const xmlCues = parseSrv3(clean, options);
    if (xmlCues.length > 0) return xmlCues;
  }

  if (/^WEBVTT/i.test(clean) || (clean.includes('-->') && clean.includes('.'))) {
    const vtt = parseVtt(clean, options);
    if (vtt.length > 0) return vtt;
  }

  return parseSrt(clean, options);
}
