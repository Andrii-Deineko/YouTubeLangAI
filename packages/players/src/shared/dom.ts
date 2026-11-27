/**
 * Checks whether a video element is connected to the DOM and visually non-collapsed.
 */
export function isVideoVisible(video: HTMLVideoElement): boolean {
  if (!video.isConnected) return false;

  if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
    const style = window.getComputedStyle(video);
    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.opacity === '0'
    ) {
      return false;
    }
  }

  const rect = video.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

/**
 * Returns the first matching HTMLElement across an ordered list of CSS selectors.
 */
export function queryFirstSelector(
  root: ParentNode,
  selectors: readonly string[]
): HTMLElement | null {
  for (const selector of selectors) {
    const el = root.querySelector<HTMLElement>(selector);
    if (el) return el;
  }
  return null;
}

/**
 * Selects the most likely primary video element within a root node.
 * Prefers visible videos, then falls back to connected videos matching playback/duration heuristics.
 */
export function findBestVideo(root?: ParentNode): HTMLVideoElement | null {
  const searchRoot: ParentNode | null =
    root ?? (typeof document !== 'undefined' ? document : null);
  if (!searchRoot) return null;

  const connected = Array.from(searchRoot.querySelectorAll('video')).filter(
    (video) => video.isConnected
  );
  if (connected.length === 0) return null;

  const visible = connected.filter(isVideoVisible);
  const pool = visible.length > 0 ? visible : connected;

  // 1. Actively playing video
  const playingVideo = pool.find((v) => !v.paused && v.readyState >= 1);
  if (playingVideo) return playingVideo;

  // 2. Video with active playback progress
  const activeProgress = pool.find(
    (v) => (!v.paused || v.currentTime > 0) && !Number.isNaN(v.duration) && v.duration > 0
  );
  if (activeProgress) return activeProgress;

  // 3. Long video with a media source
  const longVideoWithSrc = pool.find(
    (v) =>
      !Number.isNaN(v.duration) &&
      v.duration > 60 &&
      Boolean(v.currentSrc || v.src || v.srcObject)
  );
  if (longVideoWithSrc) return longVideoWithSrc;

  // 4. Largest video by bounding-box area (> 10,000 px^2, or largest non-zero)
  let largestVideo: HTMLVideoElement | null = null;
  let maxArea = 0;
  for (const video of pool) {
    const rect = video.getBoundingClientRect();
    const area = rect.width * rect.height;
    if (area > maxArea && area > 10000) {
      maxArea = area;
      largestVideo = video;
    }
  }
  if (largestVideo) return largestVideo;

  return pool[0] ?? null;
}

/**
 * Walks upward from a video element to locate a tight wrapper element matching the video dimensions.
 */
export function findTightVideoContainer(video: HTMLVideoElement): HTMLElement | null {
  if (typeof document === 'undefined') return video.parentElement;

  const videoRect = video.getBoundingClientRect();
  let current: HTMLElement | null = video.parentElement;
  let bestContainer: HTMLElement | null = video.parentElement || document.body || null;

  while (current && current !== document.body && current !== document.documentElement) {
    if (!current.classList.contains('jw-wrapper')) {
      const rect = current.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        const widthDiff = Math.abs(rect.width - videoRect.width);
        const heightDiff = rect.height - videoRect.height;
        if (heightDiff >= -5 && heightDiff <= 70 && widthDiff <= 30) {
          bestContainer = current;
        } else if (heightDiff > 70) {
          break;
        }
      }
    }
    current = current.parentElement;
  }

  const fsEl = document.fullscreenElement;
  if (
    typeof HTMLElement !== 'undefined' &&
    fsEl instanceof HTMLElement &&
    fsEl.tagName !== 'VIDEO' &&
    fsEl.contains(video) &&
    (!bestContainer || !fsEl.contains(bestContainer))
  ) {
    return fsEl;
  }

  return bestContainer;
}

/**
 * Measures a player control bar's height with fallback, computing a clean subtitle bottom offset.
 */
export function measureControlBarOffset(
  container: HTMLElement,
  controlBarSelector: string,
  fallbackHeight = 44,
  minOffset = 60,
  padding = 16
): number {
  const controlBar = container.querySelector<HTMLElement>(controlBarSelector);
  const rawHeight = controlBar ? controlBar.getBoundingClientRect().height : fallbackHeight;
  const effectiveHeight = rawHeight > 0 ? rawHeight : fallbackHeight;
  return Math.max(minOffset, effectiveHeight + padding);
}

/**
 * Selects a native HTMLVideoElement TextTrack matching an id, language, or label.
 */
export function selectHtml5TextTrack(
  videos: Iterable<HTMLVideoElement>,
  trackIdOrUrl: string
): boolean {
  const target = trackIdOrUrl.trim().toLowerCase();
  if (!target) return false;

  let matchedAny = false;
  for (const video of videos) {
    const tracks = video.textTracks;
    if (!tracks || tracks.length === 0) continue;

    let matchedIndex = -1;
    for (let i = 0; i < tracks.length; i++) {
      const tr = tracks[i];
      if (!tr) continue;
      if (
        tr.id.toLowerCase() === target ||
        tr.language.toLowerCase() === target ||
        tr.label.toLowerCase() === target
      ) {
        matchedIndex = i;
        break;
      }
    }

    if (matchedIndex !== -1) {
      for (let i = 0; i < tracks.length; i++) {
        const tr = tracks[i];
        if (!tr) continue;
        tr.mode = i === matchedIndex ? 'showing' : 'disabled';
      }
      matchedAny = true;
    }
  }

  return matchedAny;
}
