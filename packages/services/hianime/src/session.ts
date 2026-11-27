import {
  POST_MESSAGE_SOURCE_MAIN,
  type AvailableTrackOption,
  type CapturedTrackPayload,
  type MediaIdentity,
  type PlatformSessionCallbacks,
  type SubtitleCue,
  type TrackMetadata
} from '@langai/contracts';
import {
  html5PlayerPlugin,
  jwplayerPlugin,
  resolvePlayerPlugin,
  videojsPlugin
} from '@langai/players';
import {
  cleanSubtitleText,
  detectLanguageFromLabel,
  detectLanguageFromLabelAndCues,
  isSameBaseLang,
  normalizeLanguageCode,
  parseSubtitles,
  tokenizeCueText
} from '@langai/subtitle-kit';
import { setCustomMirrors } from './domainUtils';

interface HianimeSettingsSnapshot {
  nativeLang: string;
  sourceLang: string;
  customMirrors: string[];
}

const DEFAULT_SNAPSHOT: HianimeSettingsSnapshot = {
  nativeLang: 'uk',
  sourceLang: 'auto',
  customMirrors: []
};

async function readSettingsSnapshot(): Promise<HianimeSettingsSnapshot> {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local?.get) {
      const keys = ['langai_settings', 'cinelingua_settings', 'yt_lang_ai_settings'];
      const raw = await new Promise<Record<string, unknown>>((resolve) => {
        try {
          chrome.storage.local.get(keys, (items: Record<string, unknown>) => {
            resolve(items || {});
          });
        } catch {
          resolve({});
        }
      });

      const candidate =
        (raw.langai_settings as Record<string, unknown> | undefined) ??
        (raw.cinelingua_settings as Record<string, unknown> | undefined) ??
        (raw.yt_lang_ai_settings as Record<string, unknown> | undefined);

      if (candidate && typeof candidate === 'object') {
        const customMirrors = Array.isArray(candidate.customMirrors)
          ? candidate.customMirrors.filter((m): m is string => typeof m === 'string')
          : [];
        if (customMirrors.length > 0) {
          setCustomMirrors(customMirrors);
        }
        return {
          nativeLang:
            typeof candidate.nativeLang === 'string' && candidate.nativeLang
              ? candidate.nativeLang
              : 'uk',
          sourceLang:
            typeof candidate.sourceLang === 'string' && candidate.sourceLang
              ? candidate.sourceLang
              : 'auto',
          customMirrors
        };
      }
    }
  } catch {
    // Ignore storage read errors
  }
  return { ...DEFAULT_SNAPSHOT };
}

function resolveTrackUrl(rawUrl: string): string {
  if (!rawUrl) return '';
  if (typeof window === 'undefined') return rawUrl;
  try {
    return new URL(rawUrl, window.location.href).href;
  } catch {
    return rawUrl;
  }
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
    // Fallback to Service Worker
  }

  try {
    if (
      typeof chrome !== 'undefined' &&
      chrome.runtime?.id &&
      typeof chrome.runtime.sendMessage === 'function'
    ) {
      return await new Promise<string>((resolve) => {
        try {
          chrome.runtime.sendMessage(
            {
              type: 'FETCH_SUBTITLE_TEXT',
              payload: { url }
            },
            (response: { ok?: boolean; data?: { text?: string }; text?: string } | undefined) => {
              const lastErr = typeof chrome !== 'undefined' ? chrome.runtime?.lastError : undefined;
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
    // Ignore invalidated context
  }

  return '';
}

export function resolveHianimeMediaIdentity(url: URL, doc: Document): MediaIdentity | null {
  const titleEl = doc.querySelector('.film-name, .anime-title, .entry-title, h1.title, h1');
  const rawTitle = titleEl?.textContent?.trim() || doc.title || 'HiAnime';
  const cleanTitle =
    rawTitle
      .replace(/(\s*[-|–—]\s*(HiAnime|AniWatch|9anime|Zoro|Watch Online).*)$/i, '')
      .trim() || 'HiAnime';

  const ep = url.searchParams.get('ep');
  const mediaId = ep
    ? `hianime:${url.pathname}?ep=${ep}`
    : `hianime:${url.hostname}${url.pathname}${url.search}`;

  return {
    mediaId,
    serviceId: 'hianime',
    badgeLabel: 'HiAnime',
    title: cleanTitle,
    canonicalUrl: url.href
  };
}

export class HianimeSessionController {
  private callbacksRef: PlatformSessionCallbacks | null = null;
  private sessionGeneration = 0;
  private availableTracks: AvailableTrackOption[] = [];
  private selectedTrackUrl: string | null = null;
  private userSelectedTrackUrl: string | null = null;
  private domFallbackCues: SubtitleCue[] = [];
  private lastDomText = '';
  private hasNetworkTrack = false;
  private lastLoadedTrackSignature = '';
  private mediaTitle = '';
  private currentVideoKey = '';
  private currentMediaSrc = '';
  private lastSubtitleLoadMs = 0;
  private domCaptionObserver: MutationObserver | null = null;
  private domFallbackRafId: number | null = null;

  private resolveVideoId(): string {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return 'hianime:unknown';
    }
    try {
      const identity = resolveHianimeMediaIdentity(new URL(window.location.href), document);
      return (
        identity?.mediaId ??
        `hianime:${window.location.hostname}${window.location.pathname}${window.location.search}`
      );
    } catch {
      return `hianime:${window.location.hostname}${window.location.pathname}`;
    }
  }

  private findActiveVideo(): HTMLVideoElement | null {
    if (typeof document === 'undefined') return null;
    const resolved = resolvePlayerPlugin(
      [jwplayerPlugin, videojsPlugin, html5PlayerPlugin],
      document
    );
    return resolved?.video ?? null;
  }

  private buildAvailableTrackOptions(): AvailableTrackOption[] | undefined {
    if (this.availableTracks.length === 0) return undefined;
    return this.availableTracks.map((t) => ({
      label: t.label,
      language: t.language || 'auto',
      url: t.url,
      active: t.url === this.selectedTrackUrl
    }));
  }

  private chooseBestTrack(
    tracks: readonly AvailableTrackOption[],
    settings: HianimeSettingsSnapshot
  ): AvailableTrackOption {
    if (this.userSelectedTrackUrl) {
      const manual = tracks.find((t) => t.url === this.userSelectedTrackUrl);
      if (manual) return manual;
    }

    const preferredLang =
      settings.sourceLang && settings.sourceLang !== 'auto'
        ? normalizeLanguageCode(settings.sourceLang)
        : '';
    const nativeLang = normalizeLanguageCode(settings.nativeLang || 'uk');

    if (preferredLang) {
      const exact = tracks.find(
        (t) => t.language && t.language !== 'auto' && isSameBaseLang(t.language, preferredLang)
      );
      if (exact) return exact;
    }

    const english = tracks.find((t) => {
      const norm = t.language && t.language !== 'auto' ? normalizeLanguageCode(t.language) : '';
      return (
        (norm === 'en' || /\b(eng|english)\b/i.test(t.label)) &&
        !isSameBaseLang(norm, nativeLang)
      );
    });
    if (english) return english;

    const nonNative = tracks.find((t) => {
      const norm = t.language && t.language !== 'auto' ? normalizeLanguageCode(t.language) : '';
      return !norm || !isSameBaseLang(norm, nativeLang);
    });
    if (nonNative) return nonNative;

    return tracks[0];
  }

  private normalizeIncomingTracks(tracks: readonly AvailableTrackOption[]): AvailableTrackOption[] {
    const seen = new Set<string>();
    const out: AvailableTrackOption[] = [];
    for (const tr of tracks) {
      const resolvedUrl = resolveTrackUrl(tr.url);
      if (!resolvedUrl || seen.has(resolvedUrl)) continue;
      seen.add(resolvedUrl);
      out.push({
        label: tr.label,
        language: tr.language || detectLanguageFromLabel(tr.label || resolvedUrl) || 'auto',
        url: resolvedUrl,
        active: tr.active
      });
    }
    return out;
  }

  private emitCuesToRunner(
    callbacks: PlatformSessionCallbacks,
    cues: SubtitleCue[],
    options: {
      url?: string;
      label: string;
      detectedLang: string;
      source: string;
      resetPrimaryCues?: boolean;
    }
  ): void {
    const videoId = this.resolveVideoId();
    const signature = `${videoId}::${options.url ?? ''}::${cues.length}::${cues[0]?.text ?? ''}::${cues[cues.length - 1]?.text ?? ''}`;
    if (this.hasNetworkTrack && signature === this.lastLoadedTrackSignature && !options.resetPrimaryCues) {
      return;
    }
    this.lastLoadedTrackSignature = signature;

    if (options.url) {
      const matched = this.availableTracks.find((t) => t.url === options.url);
      if (matched) {
        this.selectedTrackUrl = matched.url;
      }
    }
    this.hasNetworkTrack = true;
    this.lastSubtitleLoadMs = Date.now();
    this.domCaptionObserver?.disconnect();
    this.domCaptionObserver = null;

    const available = this.buildAvailableTrackOptions();
    const meta: TrackMetadata = {
      id: `hianime-track-${Date.now()}`,
      videoId,
      lang: options.detectedLang,
      language: options.detectedLang,
      label: options.label,
      source: options.source,
      url: options.url,
      title: this.mediaTitle || undefined,
      availableTracks: available
    };

    callbacks.onTracksLoaded({
      primaryCues: cues,
      primaryMeta: meta,
      availableTracks: available,
      ...(options.resetPrimaryCues ? { resetPrimaryCues: true } : {})
    });
    callbacks.onLog?.(
      'info',
      `Loaded subtitles (${options.source}): ${options.detectedLang.toUpperCase()} · ${cues.length} cues`
    );
  }

  private buildDomFallbackMeta(): TrackMetadata {
    const detectedLang = detectLanguageFromLabelAndCues('', this.domFallbackCues, 'en');
    return {
      id: 'hianime-dom-track',
      videoId: this.resolveVideoId(),
      lang: detectedLang,
      language: detectedLang,
      label: 'JWPlayer Captions',
      source: 'dom',
      isAsr: false,
      title: this.mediaTitle || undefined
    };
  }

  private setupJwDomFallback(callbacks: PlatformSessionCallbacks): void {
    if (this.domFallbackRafId !== null) {
      window.cancelAnimationFrame(this.domFallbackRafId);
      this.domFallbackRafId = null;
    }
    this.domCaptionObserver?.disconnect();
    this.domCaptionObserver = null;

    if (typeof document === 'undefined' || this.hasNetworkTrack) return;
    const rootTarget = document.body || document.documentElement;
    if (!rootTarget || typeof MutationObserver === 'undefined') return;

    const inspectDomCues = (): void => {
      if (this.hasNetworkTrack) {
        this.domCaptionObserver?.disconnect();
        this.domCaptionObserver = null;
        return;
      }

      const cueEls = document.querySelectorAll<HTMLElement>(
        '#player-placeholder .jw-text-track-cue, .jwplayer .jw-text-track-cue, .jw-captions .jw-text-track-cue'
      );

      const rawCombined = Array.from(cueEls)
        .map((el) => el.textContent || '')
        .join(' ');
      const cleaned = cleanSubtitleText(rawCombined);
      const video = this.findActiveVideo();
      const nowSec = video ? video.currentTime : 0;

      if (!cleaned) {
        if (this.lastDomText !== '') {
          this.lastDomText = '';
          const lastCue = this.domFallbackCues[this.domFallbackCues.length - 1];
          if (lastCue && nowSec > lastCue.startTime && nowSec < lastCue.endTime) {
            lastCue.endTime = Math.max(lastCue.startTime + 0.2, nowSec);
            callbacks.onTracksLoaded({
              primaryCues: [...this.domFallbackCues],
              primaryMeta: this.buildDomFallbackMeta()
            });
          }
        }
        return;
      }

      if (cleaned === this.lastDomText) return;
      this.lastDomText = cleaned;

      const normNew = cleaned.toLowerCase();
      const prevCue = this.domFallbackCues[this.domFallbackCues.length - 1];

      const existingSame = this.domFallbackCues.find(
        (c) =>
          c.text.toLowerCase() === normNew &&
          Math.abs(c.startTime - nowSec) <= 1.5
      );
      if (existingSame) {
        existingSame.endTime = Math.max(existingSame.endTime, nowSec + 3.5);
        return;
      }

      if (prevCue && prevCue.endTime > nowSec && nowSec > prevCue.startTime) {
        prevCue.endTime = Math.max(prevCue.startTime + 0.2, nowSec - 0.02);
      }

      const startTime = Math.max(0, nowSec);
      const endTime = startTime + 4.5;
      const id = `jw-dom-${this.domFallbackCues.length}-${Math.round(startTime * 100)}`;

      this.domFallbackCues.push({
        id,
        index: this.domFallbackCues.length,
        startTime,
        endTime,
        text: cleaned,
        tokens: tokenizeCueText(id, cleaned, startTime, endTime)
      });

      callbacks.onTracksLoaded({
        primaryCues: [...this.domFallbackCues],
        primaryMeta: this.buildDomFallbackMeta()
      });
    };

    this.domCaptionObserver = new MutationObserver(() => {
      if (this.hasNetworkTrack) {
        this.domCaptionObserver?.disconnect();
        this.domCaptionObserver = null;
        return;
      }
      if (this.domFallbackRafId !== null) return;
      this.domFallbackRafId = window.requestAnimationFrame(() => {
        this.domFallbackRafId = null;
        inspectDomCues();
      });
    });

    this.domCaptionObserver.observe(rootTarget, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }

  selectTrack(trackUrl: string): void {
    const resolvedTarget = resolveTrackUrl(trackUrl);
    const target =
      this.availableTracks.find((t) => t.url === resolvedTarget || t.url === trackUrl) ?? null;

    jwplayerPlugin.selectTrackInPage?.(trackUrl);
    videojsPlugin.selectTrackInPage?.(trackUrl);
    html5PlayerPlugin.selectTrackInPage?.(trackUrl);

    if (!target || !this.callbacksRef) return;

    this.userSelectedTrackUrl = target.url;
    const requestGen = this.sessionGeneration;
    const callbacks = this.callbacksRef;

    void (async () => {
      try {
        callbacks.onLog?.(
          'info',
          `Switching subtitle track: ${(target.language || 'auto').toUpperCase()}`
        );
        const text = await fetchSubtitleContent(target.url);
        if (requestGen !== this.sessionGeneration || !text) return;
        const cues = parseSubtitles(text);
        if (cues.length === 0) return;

        const detectedLang =
          detectLanguageFromLabel(target.language !== 'auto' ? target.language : target.label) ||
          detectLanguageFromLabelAndCues(`${target.label} ${target.url}`, cues, 'en');

        this.selectedTrackUrl = target.url;
        this.emitCuesToRunner(callbacks, cues, {
          url: target.url,
          label: target.label,
          detectedLang,
          source: 'native',
          resetPrimaryCues: true
        });
      } catch {
        callbacks.onLog?.(
          'error',
          `Failed to load track ${(target.language || 'auto').toUpperCase()}`
        );
      }
    })();
  }

  init(callbacks: PlatformSessionCallbacks): () => void {
    this.callbacksRef = callbacks;
    this.currentVideoKey = this.resolveVideoId();

    const resetSessionTracks = (emitEmpty: boolean): void => {
      this.sessionGeneration += 1;
      this.availableTracks = [];
      this.selectedTrackUrl = null;
      this.userSelectedTrackUrl = null;
      this.domFallbackCues = [];
      this.lastDomText = '';
      this.hasNetworkTrack = false;
      this.lastLoadedTrackSignature = '';
      if (emitEmpty) {
        callbacks.onTracksLoaded({
          primaryCues: [],
          primaryMeta: undefined,
          availableTracks: []
        });
      }
      this.setupJwDomFallback(callbacks);
    };

    const checkUrlChanged = (): void => {
      const nextKey = this.resolveVideoId();
      if (nextKey !== this.currentVideoKey) {
        this.currentVideoKey = nextKey;
        this.currentMediaSrc = '';
        this.mediaTitle = '';
        resetSessionTracks(true);
        return;
      }

      const video = this.findActiveVideo();
      const nextSrc = video?.currentSrc || video?.src || '';
      if (nextSrc) {
        if (
          this.currentMediaSrc &&
          nextSrc !== this.currentMediaSrc &&
          Date.now() - this.lastSubtitleLoadMs > 1500
        ) {
          this.currentMediaSrc = nextSrc;
          resetSessionTracks(true);
          return;
        }
        this.currentMediaSrc = nextSrc;
      }
    };

    const handleCapturedPayload = async (payload: CapturedTrackPayload): Promise<void> => {
      checkUrlChanged();
      const requestGen = this.sessionGeneration;

      if (payload.primaryMeta?.title) {
        this.mediaTitle = payload.primaryMeta.title;
      }

      const incomingAvailable = payload.availableTracks ?? payload.primaryMeta?.availableTracks;
      if (incomingAvailable && incomingAvailable.length > 0) {
        const normalized = this.normalizeIncomingTracks(incomingAvailable);
        if (normalized.length > 0) {
          this.availableTracks = normalized;
        }
      }

      if (
        payload.resetPrimaryCues &&
        (!payload.primaryCues || payload.primaryCues.length === 0) &&
        (!incomingAvailable || incomingAvailable.length === 0)
      ) {
        resetSessionTracks(true);
        return;
      }

      if (payload.primaryCues && payload.primaryCues.length > 0) {
        const meta = payload.primaryMeta;
        const trackUrl = meta?.url ? resolveTrackUrl(meta.url) : undefined;
        const label = meta?.label || 'HiAnime Subtitles';
        const explicitRaw = meta?.lang || meta?.language || '';
        const explicitLang = explicitRaw ? detectLanguageFromLabel(explicitRaw) : '';
        const detectedLang =
          explicitLang ||
          detectLanguageFromLabelAndCues(
            trackUrl ? `${label} ${trackUrl}` : label,
            payload.primaryCues,
            'en'
          );

        this.emitCuesToRunner(callbacks, payload.primaryCues, {
          url: trackUrl,
          label,
          detectedLang,
          source: meta?.source || 'network',
          resetPrimaryCues: payload.resetPrimaryCues
        });
        return;
      }

      const settings = await readSettingsSnapshot();
      if (requestGen !== this.sessionGeneration) return;

      if (payload.primaryMeta?.url) {
        const trackUrl = resolveTrackUrl(payload.primaryMeta.url);
        const text = await fetchSubtitleContent(trackUrl);
        if (requestGen !== this.sessionGeneration || !text) return;
        const cues = parseSubtitles(text);
        if (cues.length === 0) return;

        const label = payload.primaryMeta.label || 'HiAnime Subtitles';
        const explicitRaw = payload.primaryMeta.lang || payload.primaryMeta.language || '';
        const explicitLang = explicitRaw ? detectLanguageFromLabel(explicitRaw) : '';
        const detectedLang =
          explicitLang || detectLanguageFromLabelAndCues(`${label} ${trackUrl}`, cues, 'en');

        this.emitCuesToRunner(callbacks, cues, {
          url: trackUrl,
          label,
          detectedLang,
          source: payload.primaryMeta.source || 'network',
          resetPrimaryCues: payload.resetPrimaryCues
        });
        return;
      }

      if (this.availableTracks.length > 0) {
        const chosen = this.chooseBestTrack(this.availableTracks, settings);
        const text = await fetchSubtitleContent(chosen.url);
        if (requestGen !== this.sessionGeneration || !text) return;
        const cues = parseSubtitles(text);
        if (cues.length === 0) return;

        const explicit =
          chosen.language !== 'auto' ? detectLanguageFromLabel(chosen.language) : '';
        const detectedLang =
          explicit || detectLanguageFromLabelAndCues(`${chosen.label} ${chosen.url}`, cues, 'en');

        this.selectedTrackUrl = chosen.url;
        this.emitCuesToRunner(callbacks, cues, {
          url: chosen.url,
          label: chosen.label,
          detectedLang,
          source: 'jwplayer',
          resetPrimaryCues: payload.resetPrimaryCues
        });
      }
    };

    const handleMessage = (event: MessageEvent): void => {
      if (typeof window === 'undefined' || event.source !== window || !event.data) return;
      if (typeof event.data !== 'object') return;
      const msg = event.data as {
        source?: unknown;
        type?: unknown;
        serviceId?: unknown;
        payload?: unknown;
      };
      if (msg.source !== POST_MESSAGE_SOURCE_MAIN) return;
      if (typeof msg.serviceId === 'string' && msg.serviceId !== 'hianime') return;

      if (msg.type === 'LANGAI_MAIN_LOG' && msg.payload && typeof msg.payload === 'object') {
        const logPayload = msg.payload as { level?: unknown; message?: unknown };
        if (typeof logPayload.message === 'string') {
          const level: 'info' | 'warn' | 'error' =
            logPayload.level === 'warn' || logPayload.level === 'error'
              ? logPayload.level
              : 'info';
          callbacks.onLog?.(level, logPayload.message);
        }
        return;
      }

      if (msg.type === 'LANGAI_TRACKS_CAPTURED' && msg.payload && typeof msg.payload === 'object') {
        void handleCapturedPayload(msg.payload as CapturedTrackPayload);
      }
    };

    window.addEventListener('message', handleMessage);
    window.addEventListener('popstate', checkUrlChanged);
    const urlPollId = window.setInterval(checkUrlChanged, 1000);
    this.setupJwDomFallback(callbacks);

    try {
      if (
        typeof chrome !== 'undefined' &&
        chrome.runtime?.id &&
        typeof chrome.runtime.sendMessage === 'function'
      ) {
        chrome.runtime.sendMessage(
          { type: 'INJECT_MAIN_INTERCEPTOR', payload: { serviceId: 'hianime' } },
          () => {
            try {
              void chrome.runtime?.lastError;
            } catch {
              // Ignore invalidated context
            }
          }
        );
      }
    } catch {
      // Ignore runtime messaging failure
    }

    return () => {
      window.removeEventListener('message', handleMessage);
      window.removeEventListener('popstate', checkUrlChanged);
      window.clearInterval(urlPollId);
      if (this.domFallbackRafId !== null) {
        window.cancelAnimationFrame(this.domFallbackRafId);
        this.domFallbackRafId = null;
      }
      this.domCaptionObserver?.disconnect();
      this.domCaptionObserver = null;
      this.callbacksRef = null;
    };
  }
}
