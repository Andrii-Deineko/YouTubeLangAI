export interface VideoContext {
  videoId: string;
  isShorts: boolean;
}

export function getVideoContextFromUrl(rawUrl?: string): VideoContext {
  try {
    const urlStr = rawUrl || (typeof window !== 'undefined' ? window.location.href : '');
    if (!urlStr) {
      return { videoId: '', isShorts: false };
    }
    const url = new URL(urlStr, 'https://www.youtube.com');
    const shortsMatch = url.pathname.match(/\/shorts\/([a-zA-Z0-9_-]+)/);
    if (shortsMatch?.[1]) {
      return { videoId: shortsMatch[1], isShorts: true };
    }
    const v = url.searchParams.get('v');
    if (v) {
      return { videoId: v, isShorts: false };
    }
  } catch {
    // Malformed URL fallback
  }
  return { videoId: '', isShorts: false };
}

export function buildYouTubeVideoUrl(
  videoId: string,
  timestampSec: number,
  isShorts?: boolean
): string {
  if (isShorts) {
    return `https://www.youtube.com/shorts/${encodeURIComponent(videoId)}`;
  }
  const sec = Math.max(0, Math.floor(timestampSec));
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&t=${sec}s`;
}
