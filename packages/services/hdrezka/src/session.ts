import {
  POST_MESSAGE_SOURCE_MAIN,
  type AvailableTrackOption,
  type CapturedTrackPayload,
  type MediaIdentity,
  type PlatformSessionCallbacks,
  type SubtitleCue,
  type TrackMetadata
} from '@langai/contracts';
import { playerjsPlugin, html5PlayerPlugin, resolvePlayerPlugin } from '@langai/players';
import {
  detectLanguageFromLabel,
  detectLanguageFromLabelAndCues,
  isSameBaseLang,
  normalizeLanguageCode,
  parseSubtitles
} from '@langai/subtitle-kit';
import { setCustomMirrors } from './domainUtils';

interface HdrezkaSettingsSnapshot {
  nativeLang: string;
  sourceLang: string;
  reversePair: boolean;
  customMirrors: string[];
}

const DEFAULT_SNAPSHOT: HdrezkaSettingsSnapshot = {
  nativeLang: 'uk',
  sourceLang: 'auto',
  reversePair: false,
  customMirrors: []
};

async function readSettingsSnapshot(): Promise<HdrezkaSettingsSnapshot> {
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
          reversePair: Boolean(candidate.reversePair),
          customMirrors
        };
      }
    }
  } catch {
    // Ignore storage read errors
  }
  return { ...DEFAULT_SNAPSHOT };
}

function isLocalNativeLang(lang: string, nativeLang: string): boolean {
  if (!lang) return false;
  const norm = normalizeLanguageCode(lang);
  const normNative = normalizeLanguageCode(nativeLang || 'ru');
  if (isSameBaseLang(norm, normNative)) return true;
  // On HDRezka, both Russian and Ukrainian are common translation tracks for Slavic users
  if ((normNative === 'ru' || normNative === 'uk') && (norm === 'ru' || norm === 'uk')) {
    return true;
  }
  return false;
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

export function resolveHdrezkaMediaIdentity(url: URL, doc: Document): MediaIdentity | null {
  const titleEl = doc.querySelector('.b-post__title, .b-content__main .name, h1');
  const rawTitle = titleEl?.textContent?.trim() || doc.title || 'HDRezka';
  const cleanTitle =
    rawTitle
      .replace(/(\s*[-|–—]\s*(HDRezka|Rezka|Watch Online|Смотреть онлайн).*)$/i, '')
      .trim() || 'HDRezka';

  const idMatch = url.pathname.match(/\/(\d+)(?:-[^/]+)?\.html$/i);
  const mediaId = idMatch?.[1]
    ? `hdrezka:${idMatch[1]}`
    : `hdrezka:${url.hostname}${url.pathname}`;

  return {
    mediaId,
    serviceId: 'hdrezka',
    badgeLabel: 'HDRezka',
    title: cleanTitle,
    canonicalUrl: url.href
  };
}

export class HdrezkaSessionController {
  private callbacksRef: PlatformSessionCallbacks | null = null;
  private sessionGeneration = 0;
  private currentCues: SubtitleCue[] = [];
  private availableTracks: AvailableTrackOption[] = [];
  private selectedTrackUrl: string | null = null;
  private userSelectedTrackUrl: string | null = null;
  private hasPlayerJsManifest = false;
  private currentPrimaryLang = '';
  private hasNetworkTrack = false;
  private lastLoadedTrackSignature = '';
  private mediaTitle = '';
  private currentVideoKey = '';
  private currentMediaSrc = '';
  private lastSubtitleLoadMs = 0;

  private resolveVideoId(): string {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return 'hdrezka:unknown';
    }
    try {
      const identity = resolveHdrezkaMediaIdentity(new URL(window.location.href), document);
      return identity?.mediaId ?? `hdrezka:${window.location.hostname}${window.location.pathname}`;
    } catch {
      return `hdrezka:${window.location.hostname}${window.location.pathname}`;
    }
  }

  private findVideoSrc(): string {
    if (typeof document === 'undefined') return '';
    const resolved = resolvePlayerPlugin([playerjsPlugin, html5PlayerPlugin], document);
    const video = resolved?.video;
    return video?.currentSrc || video?.src || '';
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
    settings: HdrezkaSettingsSnapshot
  ): AvailableTrackOption {
    if (this.userSelectedTrackUrl) {
      const manual = tracks.find((t) => t.url === this.userSelectedTrackUrl);
      if (manual) return manual;
    }

    const preferredLang =
      settings.sourceLang && settings.sourceLang !== 'auto'
        ? normalizeLanguageCode(settings.sourceLang)
        : '';
    const nativeLang = normalizeLanguageCode(settings.nativeLang || 'ru');

    if (preferredLang) {
      const exact = tracks.find(
        (t) => t.language && t.language !== 'auto' && isSameBaseLang(t.language, preferredLang)
      );
      if (exact) return exact;
    }

    const englishOrOrig = tracks.find((t) => {
      const norm = t.language && t.language !== 'auto' ? normalizeLanguageCode(t.language) : '';
      const isEngOrOrig =
        norm === 'en' || /\b(eng|english|англ|orig|ориг)\b/i.test(t.label);
      return isEngOrOrig && !isLocalNativeLang(norm, nativeLang);
    });
    if (englishOrOrig) return englishOrOrig;

    const foreignKnown = tracks.find((t) => {
      const norm = t.language && t.language !== 'auto' ? normalizeLanguageCode(t.language) : '';
      return Boolean(norm) && !isLocalNativeLang(norm, nativeLang);
    });
    if (foreignKnown) return foreignKnown;

    const nonNativeUnlabeled = tracks.find((t) => {
      const norm = t.language && t.language !== 'auto' ? normalizeLanguageCode(t.language) : '';
      return !norm || !isLocalNativeLang(norm, nativeLang);
    });
    if (nonNativeUnlabeled) return nonNativeUnlabeled;

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
    this.currentPrimaryLang = options.detectedLang;
    this.hasNetworkTrack = true;
    this.lastSubtitleLoadMs = Date.now();
    this.currentCues = cues;

    const available = this.buildAvailableTrackOptions();
    const meta: TrackMetadata = {
      id: `hdrezka-track-${Date.now()}`,
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

  selectTrack(trackUrl: string): void {
    const resolvedTarget = resolveTrackUrl(trackUrl);
    const target =
      this.availableTracks.find((t) => t.url === resolvedTarget || t.url === trackUrl) ?? null;
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
      this.currentCues = [];
      this.availableTracks = [];
      this.selectedTrackUrl = null;
      this.userSelectedTrackUrl = null;
      this.hasPlayerJsManifest = false;
      this.currentPrimaryLang = '';
      this.hasNetworkTrack = false;
      this.lastLoadedTrackSignature = '';
      if (emitEmpty) {
        callbacks.onTracksLoaded({
          primaryCues: [],
          primaryMeta: undefined,
          availableTracks: []
        });
      }
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

      const nextSrc = this.findVideoSrc();
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
      if (
        payload.resetPrimaryCues &&
        (!payload.primaryCues || payload.primaryCues.length === 0) &&
        (!incomingAvailable || incomingAvailable.length === 0)
      ) {
        resetSessionTracks(true);
        return;
      }

      const settings = await readSettingsSnapshot();
      if (requestGen !== this.sessionGeneration) return;

      if (incomingAvailable && incomingAvailable.length > 0) {
        const normalizedTracks = this.normalizeIncomingTracks(incomingAvailable);
        if (normalizedTracks.length > 0) {
          this.availableTracks = normalizedTracks;
          this.hasPlayerJsManifest = true;

          // If single track already has parsed cues from MAIN world, emit directly
          if (payload.primaryCues && payload.primaryCues.length > 0 && normalizedTracks.length === 1) {
            const single = normalizedTracks[0];
            const explicit =
              payload.primaryMeta?.lang ||
              payload.primaryMeta?.language ||
              (single.language !== 'auto' ? detectLanguageFromLabel(single.language) : '');
            const detectedLang =
              explicit ||
              detectLanguageFromLabelAndCues(
                `${single.label} ${single.url}`,
                payload.primaryCues,
                'en'
              );
            this.selectedTrackUrl = single.url;
            this.emitCuesToRunner(callbacks, payload.primaryCues, {
              url: single.url,
              label: single.label,
              detectedLang,
              source: payload.primaryMeta?.source || 'playerjs',
              resetPrimaryCues: payload.resetPrimaryCues
            });
            return;
          }

          let chosenTrack = this.chooseBestTrack(normalizedTracks, settings);
          let cues: SubtitleCue[] = [];
          const text = await fetchSubtitleContent(chosenTrack.url);
          if (requestGen !== this.sessionGeneration) return;
          if (text) {
            cues = parseSubtitles(text);
          }

          // Auto-mode guard: if chosen track turned out to be local native (RU/UK), look for foreign/original track
          const nativeLang = normalizeLanguageCode(settings.nativeLang || 'ru');
          const isAutoSource = !settings.sourceLang || settings.sourceLang === 'auto';
          if (
            cues.length > 0 &&
            isAutoSource &&
            !this.userSelectedTrackUrl &&
            normalizedTracks.length > 1
          ) {
            const detectedContent = detectLanguageFromLabelAndCues(chosenTrack.label, cues, '');
            if (isLocalNativeLang(detectedContent, nativeLang)) {
              for (const alt of normalizedTracks) {
                if (alt.url === chosenTrack.url) continue;
                if (alt.language !== 'auto' && isLocalNativeLang(alt.language, nativeLang)) {
                  continue;
                }
                const altText = await fetchSubtitleContent(alt.url);
                if (requestGen !== this.sessionGeneration) return;
                if (!altText) continue;
                const altCues = parseSubtitles(altText);
                if (altCues.length === 0) continue;
                const altLang = detectLanguageFromLabelAndCues(alt.label, altCues, '');
                if (!isLocalNativeLang(altLang, nativeLang)) {
                  chosenTrack = alt;
                  cues = altCues;
                  callbacks.onLog?.(
                    'info',
                    `Auto-selected original track (${(altLang || 'en').toUpperCase()}) instead of native track`
                  );
                  break;
                }
              }
            }
          }

          if (cues.length > 0) {
            const explicit =
              chosenTrack.language !== 'auto'
                ? detectLanguageFromLabel(chosenTrack.language)
                : '';
            const detectedLang =
              explicit ||
              detectLanguageFromLabelAndCues(`${chosenTrack.label} ${chosenTrack.url}`, cues, 'en');
            this.selectedTrackUrl = chosenTrack.url;
            this.emitCuesToRunner(callbacks, cues, {
              url: chosenTrack.url,
              label: chosenTrack.label,
              detectedLang,
              source: 'playerjs',
              resetPrimaryCues: payload.resetPrimaryCues
            });
          }
          return;
        }
      }

      if (payload.primaryCues && payload.primaryCues.length > 0) {
        const meta = payload.primaryMeta;
        const trackUrl = meta?.url ? resolveTrackUrl(meta.url) : undefined;
        const label = meta?.label || 'HDRezka Subtitles';
        const explicitRaw = meta?.lang || meta?.language || '';
        const explicitLang = explicitRaw ? detectLanguageFromLabel(explicitRaw) : '';
        const detectedLang =
          explicitLang ||
          detectLanguageFromLabelAndCues(
            trackUrl ? `${label} ${trackUrl}` : label,
            payload.primaryCues,
            'en'
          );

        const isRawNetworkSource = meta?.source === 'fetch' || meta?.source === 'xhr';
        const nativeLang = normalizeLanguageCode(settings.nativeLang || 'ru');
        const isAutoSource = !settings.sourceLang || settings.sourceLang === 'auto';
        if (
          isRawNetworkSource &&
          this.hasPlayerJsManifest &&
          this.availableTracks.length > 1 &&
          this.hasNetworkTrack &&
          this.currentCues.length > 0 &&
          isAutoSource &&
          !settings.reversePair &&
          !this.userSelectedTrackUrl &&
          isLocalNativeLang(detectedLang, nativeLang) &&
          this.currentPrimaryLang &&
          !isLocalNativeLang(this.currentPrimaryLang, nativeLang)
        ) {
          callbacks.onLog?.(
            'info',
            `Skipped native player track (${detectedLang.toUpperCase()}), kept original (${this.currentPrimaryLang.toUpperCase()})`
          );
          return;
        }

        this.emitCuesToRunner(callbacks, payload.primaryCues, {
          url: trackUrl,
          label,
          detectedLang,
          source: meta?.source || 'network',
          resetPrimaryCues: payload.resetPrimaryCues
        });
        return;
      }

      if (payload.primaryMeta?.url) {
        const trackUrl = resolveTrackUrl(payload.primaryMeta.url);
        const text = await fetchSubtitleContent(trackUrl);
        if (requestGen !== this.sessionGeneration || !text) return;
        const cues = parseSubtitles(text);
        if (cues.length === 0) return;

        const label = payload.primaryMeta.label || 'HDRezka Subtitles';
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
      if (typeof msg.serviceId === 'string' && msg.serviceId !== 'hdrezka') return;

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

    try {
      if (
        typeof chrome !== 'undefined' &&
        chrome.runtime?.id &&
        typeof chrome.runtime.sendMessage === 'function'
      ) {
        chrome.runtime.sendMessage(
          { type: 'INJECT_MAIN_INTERCEPTOR', payload: { serviceId: 'hdrezka' } },
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
      this.callbacksRef = null;
    };
  }
}
