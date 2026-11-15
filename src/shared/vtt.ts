import type { Json3Event, Json3Response } from '../types/subtitles';

export function parseVttTimestamp(timeStr: string): number {
  const clean = timeStr.trim().replace(',', '.');
  const parts = clean.split(':');
  if (parts.length === 3) {
    const hours = parseFloat(parts[0]);
    const minutes = parseFloat(parts[1]);
    const seconds = parseFloat(parts[2]);
    return Math.round((hours * 3600 + minutes * 60 + seconds) * 1000);
  } else if (parts.length === 2) {
    const minutes = parseFloat(parts[0]);
    const seconds = parseFloat(parts[1]);
    return Math.round((minutes * 60 + seconds) * 1000);
  }
  return 0;
}

export function parseWebVttToJson3(text: string): Json3Response {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const events: Json3Event[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();
    if (line.includes('-->')) {
      const parts = line.split('-->');
      const startStr = parts[0].trim().split(/\s+/)[0];
      const endStr = parts[1].trim().split(/\s+/)[0];
      const startMs = parseVttTimestamp(startStr);
      const endMs = parseVttTimestamp(endStr);
      const durationMs = Math.max(200, endMs - startMs);

      i++;
      const textLines: string[] = [];
      while (i < lines.length) {
        const textLine = lines[i].trim();
        if (textLine === '') {
          break;
        }
        if (textLine.includes('-->')) {
          i--;
          break;
        }
        // Skip SRT index numbers if they appear on their own line right before a timestamp
        if (i + 1 < lines.length && /^\d+$/.test(textLine) && lines[i + 1].includes('-->')) {
          break;
        }
        const cleanText = textLine.replace(/<[^>]+>/g, '').trim();
        if (cleanText) {
          textLines.push(cleanText);
        }
        i++;
      }

      const cueText = textLines.join(' ');
      if (cueText) {
        events.push({
          tStartMs: startMs,
          dDurationMs: durationMs,
          segs: [{ utf8: cueText }]
        });
      }
    } else {
      i++;
    }
  }

  return { events };
}
