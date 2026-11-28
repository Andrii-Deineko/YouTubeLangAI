import {
  POST_MESSAGE_SOURCE_ISOLATED,
  POST_MESSAGE_SOURCE_MAIN,
  type AvailableTrackOption,
  type CapturedTrackPayload,
  type InterceptedSubtitlePayload,
  type PlatformSessionCallbacks,
  type SubtitleCue,
  type TrackMetadata
} from '@langai/contracts';
import { jwplayerPlugin } from '@langai/players';
import { cleanSubtitleText, tokenizeCueText } from '@langai/subtitle-kit';
import {
  cleanUrPlayTitle,
  extractUrPlayTitle,
  isUrPlayHost,
  resolveUrPlayVideoId
} from './domain';
import {
  detectUrPlayTrackLanguage,
  filterAvailableTrackOptions,
  isAccessibilityTrack,
  parseUrPlaySubtitleText
} from './nextData';

const MAIN_WORLD_TRACKS_EVENT = 'LANGAI_TRACKS_CAPTURED';
const MAIN_WORLD_LOG_EVENT = 'LANGAI_MAIN_LOG';

export interface UrPlaySessionController {
  initIsolatedSession(callbacks: PlatformSessionCallbacks): () => void;
  selectTrack(trackIdOrUrl: string): void;
  observeNavigation(onNavigate: () => void): () => void;
}

async function fetchSubtitleContent(url: string): Promise<string> {
  try {
    const res = await fetch(url);
    if (res.ok) {
      const text = await res.text();
      if (text && text.trim().length > 0) {
        return text;
      }
    }
  } catch {
    // Fall through to service worker fetch
  }

  try {
    if (
      typeof chrome !== 'undefined' &&
      chrome.runtime?.id &&
      typeof chrome.runtime?.sendMessage === 'function'
    ) {
      return await new Promise<string>((resolve) => {
        try {
          chrome.runtime.sendMessage(
            {
              type: 'FETCH_SUBTITLE_TEXT',
              payload: { url }
            },
            (
              response:
                | { ok?: boolean; data?: { text?: string }; text?: string }
                | undefined
            ) => {
              const lastErr =
                typeof chrome !== 'undefined' ? chrome.runtime?.lastError : undefined;
              const resolvedText = response?.data?.text ?? response?.text;
              if (lastErr || !resolvedText) {
                resolve('');
              } else {
                resolve(resolvedText);
              }
            }
          );
        } catch {
          resolve('');
        }
      });
    }
  } catch {
    // Ignore runtime errors
  }

  return '';
}

function getCurrentLocationKey(): string {
  if (typeof window === 'undefined') return '';
  return `${window.location.pathname}${window.location.search}`;
}

function getCurrentVideoId(): string {
  if (typeof window === 'undefined') return 'urplay';
  try {
    return resolveUrPlayVideoId(new URL(window.location.href));
  } catch {
    return 'urplay';
  }
}

function getCurrentMediaTitle(): string {
  if (typeof document === 'undefined') return '';
  return extractUrPlayTitle(document);
}

/**
 * Creates the isolated-world session controller for UR Play, bridging MAIN-world events,
 * SW subtitle fallback fetching, track switching, and JWPlayer DOM cue fallback.
 */
export function createUrPlaySessionController(): UrPlaySessionController {
  let callbacksRef: PlatformSessionCallbacks | null = null;
  let sessionGeneration = 0;
  let hasNetworkTrack = false;
  let lastLoadedTrackSignature = '';
  let mediaTitle = '';
  let currentVideoKey = '';
  let currentMediaSrc = '';
  let lastSubtitleLoadMs = 0;
  let availableTracks: AvailableTrackOption[] = [];
  let selectedTrackUrl: string | null = null;

  let domFallbackCues: SubtitleCue[] = [];
  let lastDomText = '';
  let domCaptionObserver: MutationObserver | null = null;
  let domFallbackRafId: number | null = null;

  const stopDomFallback = (): void => {
    if (domFallbackRafId !== null && typeof window !== 'undefined') {
      window.cancelAnimationFrame(domFallbackRafId);
      domFallbackRafId = null;
    }
    domCaptionObserver?.disconnect();
    domCaptionObserver = null;
  };

  const buildDomFallbackMeta = (): TrackMetadata => ({
    id: 'urplay-dom-track',
    videoId: getCurrentVideoId(),
    lang: 'sv',
    language: 'sv',
    label: 'JWPlayer Captions',
    source: 'dom',
    isAsr: false,
    title: mediaTitle || getCurrentMediaTitle() || undefined
  });

  const setupJwDomFallback = (callbacks: PlatformSessionCallbacks): void => {
    stopDomFallback();
    if (typeof document === 'undefined' || hasNetworkTrack) return;

    const rootTarget = document.body || document.documentElement;
    if (!rootTarget || typeof MutationObserver === 'undefined') return;

    const inspectDomCues = (): void => {
      if (hasNetworkTrack) {
        stopDomFallback();
        return;
      }

      const cueEls = document.querySelectorAll<HTMLElement>(
        '#player-placeholder .jw-text-track-cue, .jwplayer .jw-text-track-cue, .jw-captions .jw-text-track-cue'
      );

      const rawCombined = Array.from(cueEls)
        .map((el) => el.textContent || '')
        .join(' ');
      const cleaned = cleanSubtitleText(rawCombined);

      const container = jwplayerPlugin.detectContainer(document);
      const video = jwplayerPlugin.findVideo(container, document);
      const nowSec = video ? video.currentTime : 0;

      if (!cleaned) {
        if (lastDomText !== '') {
          lastDomText = '';
          const lastCue = domFallbackCues[domFallbackCues.length - 1];
          if (lastCue && nowSec > lastCue.startTime && nowSec < lastCue.endTime) {
            lastCue.endTime = Math.max(lastCue.startTime + 0.2, nowSec);
            callbacks.onTracksLoaded({
              primaryCues: [...domFallbackCues],
              primaryMeta: buildDomFallbackMeta()
            });
          }
        }
        return;
      }

      if (cleaned === lastDomText) return;
      lastDomText = cleaned;

      const normNew = cleaned.toLowerCase();
      const existingSame = domFallbackCues.find(
        (c) =>
          c.text.toLowerCase() === normNew && Math.abs(c.startTime - nowSec) <= 1.5
      );
      if (existingSame) {
        existingSame.endTime = Math.max(existingSame.endTime, nowSec + 3.5);
        return;
      }

      const prevCue = domFallbackCues[domFallbackCues.length - 1];
      if (prevCue && prevCue.endTime > nowSec && nowSec > prevCue.startTime) {
        prevCue.endTime = Math.max(prevCue.startTime + 0.2, nowSec - 0.02);
      }

      const startTime = Math.max(0, nowSec);
      const endTime = startTime + 4.5;
      const id = `jw-dom-${domFallbackCues.length}-${Math.round(startTime * 100)}`;

      domFallbackCues.push({
        id,
        index: domFallbackCues.length,
        startTime,
        endTime,
        text: cleaned,
        tokens: tokenizeCueText(id, cleaned, startTime, endTime)
      });

      callbacks.onTracksLoaded({
        primaryCues: [...domFallbackCues],
        primaryMeta: buildDomFallbackMeta()
      });
    };

    domCaptionObserver = new MutationObserver(() => {
      if (hasNetworkTrack) {
        stopDomFallback();
        return;
      }
      if (domFallbackRafId !== null) return;
      domFallbackRafId = window.requestAnimationFrame(() => {
        domFallbackRafId = null;
        inspectDomCues();
      });
    });

    domCaptionObserver.observe(rootTarget, {
      childList: true,
      subtree: true,
      characterData: true
    });
  };

  const withActiveTrackFlag = (
    tracks: readonly AvailableTrackOption[] | undefined,
    activeUrl: string | null
  ): AvailableTrackOption[] | undefined => {
    const filtered = filterAvailableTrackOptions(tracks);
    if (!filtered || filtered.length === 0) return undefined;
    return filtered.map((t) => ({
      ...t,
      active: activeUrl ? t.url === activeUrl : t.active
    }));
  };

  const emitLoadedCues = (
    callbacks: PlatformSessionCallbacks,
    cues: SubtitleCue[],
    opts: {
      url?: string;
      label?: string;
      language?: string;
      source?: string;
      title?: string;
      availableTracks?: AvailableTrackOption[];
      resetPrimaryCues?: boolean;
    }
  ): void => {
    if (cues.length === 0) return;

    const videoId = getCurrentVideoId();
    const trackUrl = opts.url;
    const signature = `${videoId}::${trackUrl ?? ''}::${cues.length}::${cues[0]?.text ?? ''}::${cues[cues.length - 1]?.text ?? ''}`;

    if (!opts.resetPrimaryCues && hasNetworkTrack && signature === lastLoadedTrackSignature) {
      return;
    }
    lastLoadedTrackSignature = signature;

    if (trackUrl) {
      selectedTrackUrl = trackUrl;
    }

    const incomingTracks = filterAvailableTrackOptions(opts.availableTracks);
    if (incomingTracks && incomingTracks.length > 0) {
      availableTracks = incomingTracks;
    }
    const mergedAvailable = withActiveTrackFlag(
      availableTracks.length > 0 ? availableTracks : incomingTracks,
      selectedTrackUrl
    );

    const detectedLang = detectUrPlayTrackLanguage(
      {
        label: opts.label,
        language: opts.language,
        url: trackUrl
      },
      cues
    );

    const resolvedTitle =
      cleanUrPlayTitle(opts.title || '') ||
      mediaTitle ||
      getCurrentMediaTitle() ||
      undefined;

    hasNetworkTrack = true;
    lastSubtitleLoadMs = Date.now();
    stopDomFallback();

    const meta: TrackMetadata = {
      id: `urplay-track-${Date.now()}`,
      videoId,
      lang: detectedLang,
      language: detectedLang,
      label: opts.label || 'Svenska',
      source: opts.source || 'native',
      url: trackUrl,
      title: resolvedTitle,
      availableTracks: mergedAvailable
    };

    callbacks.onTracksLoaded({
      primaryCues: cues,
      primaryMeta: meta,
      availableTracks: mergedAvailable,
      ...(opts.resetPrimaryCues ? { resetPrimaryCues: true } : {})
    });
  };

  const handleCapturedPayload = async (
    callbacks: PlatformSessionCallbacks,
    payload: CapturedTrackPayload
  ): Promise<void> => {
    const requestGen = sessionGeneration;

    if (
      payload.resetPrimaryCues &&
      (!payload.primaryCues || payload.primaryCues.length === 0) &&
      !payload.primaryMeta?.url
    ) {
      return;
    }

    const incomingTracks = filterAvailableTrackOptions(
      payload.availableTracks ?? payload.primaryMeta?.availableTracks
    );
    if (incomingTracks && incomingTracks.length > 0) {
      availableTracks = incomingTracks;
    }

    if (payload.primaryCues && payload.primaryCues.length > 0) {
      if (
        payload.primaryMeta &&
        isAccessibilityTrack(payload.primaryMeta) &&
        incomingTracks &&
        incomingTracks.length > 0
      ) {
        return;
      }

      emitLoadedCues(callbacks, payload.primaryCues, {
        url: payload.primaryMeta?.url,
        label: payload.primaryMeta?.label,
        language: payload.primaryMeta?.language || payload.primaryMeta?.lang,
        source: payload.primaryMeta?.source,
        title: payload.primaryMeta?.title,
        availableTracks: incomingTracks,
        resetPrimaryCues: payload.resetPrimaryCues
      });
      return;
    }

    const fallbackUrl = payload.primaryMeta?.url;
    if (!fallbackUrl) return;

    if (
      payload.primaryMeta &&
      isAccessibilityTrack(payload.primaryMeta) &&
      incomingTracks &&
      incomingTracks.length > 0
    ) {
      return;
    }

    const rawText = await fetchSubtitleContent(fallbackUrl);
    if (requestGen !== sessionGeneration || !rawText) return;

    const cues = parseUrPlaySubtitleText(rawText);
    if (cues.length === 0) return;

    emitLoadedCues(callbacks, cues, {
      url: fallbackUrl,
      label: payload.primaryMeta?.label,
      language: payload.primaryMeta?.language || payload.primaryMeta?.lang,
      source: payload.primaryMeta?.source || 'sw-fetch',
      title: payload.primaryMeta?.title,
      availableTracks: incomingTracks,
      resetPrimaryCues: payload.resetPrimaryCues
    });
  };

  const handleInterceptedPayload = async (
    callbacks: PlatformSessionCallbacks,
    payload: InterceptedSubtitlePayload
  ): Promise<void> => {
    const requestGen = sessionGeneration;
    if (
      isAccessibilityTrack({
        url: payload.url,
        label: payload.label,
        language: payload.language
      })
    ) {
      return;
    }

    let rawText = payload.rawText ?? '';
    if (!rawText && payload.url) {
      rawText = await fetchSubtitleContent(payload.url);
    }
    if (requestGen !== sessionGeneration || !rawText) return;

    const cues = parseUrPlaySubtitleText(rawText);
    if (cues.length === 0) return;

    emitLoadedCues(callbacks, cues, {
      url: payload.url,
      label: payload.label,
      language: payload.language,
      source: payload.source,
      resetPrimaryCues: payload.resetPrevious
    });
  };

  return {
    initIsolatedSession(callbacks: PlatformSessionCallbacks): () => void {
      callbacksRef = callbacks;
      currentVideoKey = getCurrentVideoId();
      mediaTitle = getCurrentMediaTitle();

      const resetSessionTracks = (emitEmpty: boolean): void => {
        sessionGeneration += 1;
        hasNetworkTrack = false;
        lastLoadedTrackSignature = '';
        availableTracks = [];
        selectedTrackUrl = null;
        domFallbackCues = [];
        lastDomText = '';
        if (emitEmpty) {
          callbacks.onTracksLoaded({
            primaryCues: [],
            primaryMeta: undefined,
            availableTracks: []
          });
        }
        setupJwDomFallback(callbacks);
      };

      const checkUrlChanged = (): void => {
        if (typeof window === 'undefined') return;
        const nextKey = getCurrentVideoId();
        if (nextKey !== currentVideoKey) {
          currentVideoKey = nextKey;
          currentMediaSrc = '';
          mediaTitle = getCurrentMediaTitle();
          resetSessionTracks(true);
          return;
        }

        const container = jwplayerPlugin.detectContainer(document);
        const video = jwplayerPlugin.findVideo(container, document);
        const nextSrc = video?.currentSrc || video?.src || '';
        if (nextSrc) {
          if (
            currentMediaSrc &&
            nextSrc !== currentMediaSrc &&
            Date.now() - lastSubtitleLoadMs > 1500
          ) {
            currentMediaSrc = nextSrc;
            resetSessionTracks(true);
            return;
          }
          currentMediaSrc = nextSrc;
        }
      };

      const handleMessage = (event: MessageEvent): void => {
        if (
          typeof window === 'undefined' ||
          event.source !== window ||
          !event.data ||
          typeof event.data !== 'object'
        ) {
          return;
        }

        const data = event.data as {
          source?: unknown;
          type?: unknown;
          serviceId?: unknown;
          payload?: unknown;
        };

        if (data.source !== POST_MESSAGE_SOURCE_MAIN) return;
        if (data.serviceId && data.serviceId !== 'urplay') return;

        if (data.type === MAIN_WORLD_LOG_EVENT && data.payload && typeof data.payload === 'object') {
          const logPayload = data.payload as { level?: unknown; message?: unknown };
          if (typeof logPayload.message === 'string' && logPayload.message) {
            const level: 'info' | 'warn' | 'error' =
              logPayload.level === 'warn' || logPayload.level === 'error'
                ? logPayload.level
                : 'info';
            callbacks.onLog?.(level, logPayload.message);
          }
          return;
        }

        if (data.type === 'MEDIA_INFO' && data.payload && typeof data.payload === 'object') {
          const info = data.payload as { title?: unknown };
          if (typeof info.title === 'string') {
            const cleaned = cleanUrPlayTitle(info.title);
            if (cleaned) mediaTitle = cleaned;
          }
          return;
        }

        if (data.type === MAIN_WORLD_TRACKS_EVENT && data.payload && typeof data.payload === 'object') {
          checkUrlChanged();
          const payload = data.payload as CapturedTrackPayload;
          if (
            payload.resetPrimaryCues &&
            (!payload.primaryCues || payload.primaryCues.length === 0) &&
            !payload.primaryMeta?.url
          ) {
            resetSessionTracks(true);
            return;
          }
          void handleCapturedPayload(callbacks, payload);
          return;
        }

        if (data.type === 'SUBTITLES_INTERCEPTED' && data.payload && typeof data.payload === 'object') {
          checkUrlChanged();
          const payload = data.payload as InterceptedSubtitlePayload;
          if (payload.resetPrevious && !payload.rawText && !payload.url) {
            resetSessionTracks(true);
            return;
          }
          void handleInterceptedPayload(callbacks, payload);
        }
      };

      const requestMainState = (): void => {
        if (typeof window === 'undefined') return;
        window.postMessage(
          {
            source: POST_MESSAGE_SOURCE_ISOLATED,
            type: 'LANGAI_REQUEST_STATE'
          },
          '*'
        );
      };

      if (typeof window !== 'undefined') {
        window.addEventListener('message', handleMessage);
        window.addEventListener('popstate', checkUrlChanged);
      }

      const urlPollId =
        typeof window !== 'undefined' ? window.setInterval(checkUrlChanged, 1000) : null;

      setupJwDomFallback(callbacks);
      requestMainState();

      // Request MAIN world extractor injection if dynamically enabled on an already-open tab
      try {
        if (
          typeof chrome !== 'undefined' &&
          chrome.runtime?.id &&
          typeof chrome.runtime?.sendMessage === 'function'
        ) {
          chrome.runtime.sendMessage(
            { type: 'INJECT_MAIN_INTERCEPTOR', payload: { serviceId: 'urplay' } },
            () => {
              try {
                void chrome.runtime?.lastError;
              } catch {
                // Ignore invalidated context
              }
              requestMainState();
            }
          );
        }
      } catch {
        // Ignore invalidated context
      }

      return () => {
        if (typeof window !== 'undefined') {
          window.removeEventListener('message', handleMessage);
          window.removeEventListener('popstate', checkUrlChanged);
          if (urlPollId !== null) {
            window.clearInterval(urlPollId);
          }
        }
        stopDomFallback();
        callbacksRef = null;
      };
    },

    selectTrack(trackIdOrUrl: string): void {
      const target = availableTracks.find((t) => t.url === trackIdOrUrl) ?? {
        url: trackIdOrUrl,
        label: 'Svenska',
        language: 'sv'
      };
      if (!target.url || !callbacksRef) return;

      const callbacks = callbacksRef;
      const requestGen = sessionGeneration;

      void (async () => {
        try {
          callbacks.onLog?.(
            'info',
            `Switching subtitle track: ${(target.language || 'sv').toUpperCase()}`
          );
          const rawText = await fetchSubtitleContent(target.url);
          if (requestGen !== sessionGeneration || !rawText) return;

          const cues = parseUrPlaySubtitleText(rawText);
          if (cues.length === 0) return;

          emitLoadedCues(callbacks, cues, {
            url: target.url,
            label: target.label,
            language: target.language,
            source: 'native',
            resetPrimaryCues: true
          });

          callbacks.onLog?.(
            'info',
            `Loaded track ${detectUrPlayTrackLanguage(target, cues).toUpperCase()} (${cues.length} cues)`
          );
        } catch {
          callbacks.onLog?.(
            'error',
            `Failed to load track ${(target.language || 'sv').toUpperCase()}`
          );
        }
      })();
    },

    observeNavigation(onNavigate: () => void): () => void {
      if (typeof window === 'undefined' || !isUrPlayHost(window.location.hostname)) {
        return () => {};
      }

      let lastPathKey = getCurrentLocationKey();

      const check = (): void => {
        const nextKey = getCurrentLocationKey();
        if (nextKey !== lastPathKey) {
          lastPathKey = nextKey;
          onNavigate();
        }
      };

      window.addEventListener('popstate', check);
      const pollId = window.setInterval(check, 1000);

      let observer: MutationObserver | null = null;
      if (typeof MutationObserver !== 'undefined' && typeof document !== 'undefined') {
        const root = document.documentElement;
        if (root) {
          observer = new MutationObserver(check);
          observer.observe(root, { childList: true, subtree: true });
        }
      }

      return () => {
        window.removeEventListener('popstate', check);
        window.clearInterval(pollId);
        observer?.disconnect();
      };
    }
  };
}
