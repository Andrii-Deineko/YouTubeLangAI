import type { Json3Event, Json3Response } from '../types/subtitles';
import type { FetchSubtitlesResponse, RuntimeRequest } from '../types/messages';
import { parseWebVttToJson3 } from '../shared/vtt';

export interface DetectedSubtitleTrack {
  id: string;
  label: string;
  language: string;
  kind: string;
  source: 'textTrack' | 'trackElement' | 'jwplayer';
  url?: string;
  cueCount?: number;
}

export function extractCuesFromTextTrack(track: TextTrack): Json3Response | null {
  if (!track.cues || track.cues.length === 0) return null;
  const events: Json3Event[] = [];

  for (let i = 0; i < track.cues.length; i++) {
    const cue = track.cues[i] as VTTCue;
    if (cue && typeof cue.startTime === 'number' && typeof cue.endTime === 'number') {
      const startMs = Math.round(cue.startTime * 1000);
      const endMs = Math.round(cue.endTime * 1000);
      const text = (cue.text || (cue.getCueAsHTML ? cue.getCueAsHTML().textContent : '') || '').trim();
      if (text) {
        events.push({
          tStartMs: startMs,
          dDurationMs: Math.max(200, endMs - startMs),
          segs: [{ utf8: text.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() }]
        });
      }
    }
  }

  return events.length > 0 ? { events } : null;
}

export function detectTracksFromVideo(video: HTMLVideoElement | null): DetectedSubtitleTrack[] {
  if (!video) return [];
  const detected: DetectedSubtitleTrack[] = [];
  const seenIds = new Set<string>();

  // 1. Check HTMLMediaElement.textTracks
  if (video.textTracks && video.textTracks.length > 0) {
    for (let i = 0; i < video.textTracks.length; i++) {
      const track = video.textTracks[i];
      // Include captions, subtitles, and descriptions
      const trackId = `tt-${track.id || track.label || track.language || i}`;
      if (!seenIds.has(trackId)) {
        seenIds.add(trackId);
        // If track is disabled, cues won't load in some browsers until mode is set to hidden
        if (track.mode === 'disabled') {
          try {
            track.mode = 'hidden';
          } catch {
            // Some players may throw on modifying track.mode
          }
        }
        detected.push({
          id: trackId,
          label: track.label || track.language || `Track ${i + 1}`,
          language: track.language || 'auto',
          kind: track.kind || 'subtitles',
          source: 'textTrack',
          cueCount: track.cues ? track.cues.length : undefined
        });
      }
    }
  }

  // 2. Check <track> child elements
  const trackEls = Array.from(video.querySelectorAll('track'));
  for (let i = 0; i < trackEls.length; i++) {
    const el = trackEls[i];
    const src = el.getAttribute('src');
    const label = el.getAttribute('label') || el.getAttribute('srclang') || `Track element ${i + 1}`;
    const id = `track-el-${src || label || i}`;
    if (!seenIds.has(id)) {
      seenIds.add(id);
      detected.push({
        id,
        label,
        language: el.getAttribute('srclang') || 'auto',
        kind: el.getAttribute('kind') || 'subtitles',
        source: 'trackElement',
        url: src ? new URL(src, window.location.href).toString() : undefined
      });
    }
  }

  // 3. Check JW Player API if present
  try {
    const win = window as unknown as Record<string, unknown>;
    const jwplayerFn = win.jwplayer as ((id?: string) => {
      getCaptionsList?: () => Array<{ id?: string; label?: string; file?: string }>;
    }) | undefined;
    if (typeof jwplayerFn === 'function') {
      const jw = jwplayerFn('player-placeholder') || jwplayerFn();
      if (jw && typeof jw.getCaptionsList === 'function') {
        const list = jw.getCaptionsList();
        if (Array.isArray(list)) {
          for (let i = 0; i < list.length; i++) {
            const item = list[i];
            if (item && item.label && item.label.toLowerCase() !== 'off') {
              const jwId = `jw-${item.id || item.label || i}`;
              if (!seenIds.has(jwId)) {
                seenIds.add(jwId);
                detected.push({
                  id: jwId,
                  label: item.label,
                  language: item.id || 'auto',
                  kind: 'subtitles',
                  source: 'jwplayer',
                  url: item.file ? new URL(item.file, window.location.origin).toString() : undefined
                });
              }
            }
          }
        }
      }
    }
  } catch {
    // Ignore JW player inspection errors
  }

  return detected;
}

export async function fetchSubtitleContent(url: string): Promise<string> {
  // Try background fetch first to bypass any CORS restrictions
  return new Promise((resolve, reject) => {
    const req: RuntimeRequest = {
      type: 'FETCH_SUBTITLES',
      payload: { url }
    };
    chrome.runtime.sendMessage(req, (res: FetchSubtitlesResponse | undefined) => {
      if (chrome.runtime.lastError) {
        // Fallback to direct fetch
        fetch(url, { credentials: 'include' })
          .then((r) => {
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r.text();
          })
          .then(resolve)
          .catch(reject);
        return;
      }
      if (!res || !res.ok) {
        reject(new Error(res?.error || 'Failed to fetch subtitle from URL'));
        return;
      }
      resolve(res.data);
    });
  });
}

export function parseSubtitlesText(rawText: string): Json3Response {
  return parseWebVttToJson3(rawText);
}
