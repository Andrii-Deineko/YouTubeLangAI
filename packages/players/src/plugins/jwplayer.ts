import type {
  ActiveCueSnapshot,
  AvailableTrackOption,
  PlayerMainWorldContext,
  PlayerPlugin
} from '@langai/contracts';
import {
  detectLanguageFromLabel,
  detectLanguageFromLabelAndCues,
  parseSubtitles
} from '@langai/subtitle-kit';
import { createCssCaptionSuppressor } from '../shared/cssSuppression';
import { findBestVideo, isVideoVisible, measureControlBarOffset } from '../shared/dom';
import {
  getNativeFetch,
  isValidCueBody,
  pickBestCaptionTrack,
  subscribeNetworkSubtitles,
  type CandidateCaptionTrack
} from '../probes/networkInterceptor';
import { subscribeSpaNavigation } from '../probes/spaNavigation';

const JW_CONTAINER_SELECTORS = [
  '#player-placeholder.jwplayer',
  '#player-placeholder',
  '.jwplayer',
  '[id^="jwplayer"]'
] as const;

const JW_SUPPRESSION_CSS = `
.jw-captions,
.jw-captions-window,
.jw-text-track-cue,
.jw-text-track-container,
video::cue {
  opacity: 0 !important;
  pointer-events: none !important;
}
`;

const jwSuppressor = createCssCaptionSuppressor(
  'langai-jwplayer-captions-suppression',
  JW_SUPPRESSION_CSS
);

interface JwCaptionEntry {
  id?: string;
  file?: string;
  label?: string;
  language?: string;
}

interface JwPlaylistTrack {
  file?: string;
  kind?: string;
  label?: string;
  language?: string;
}

interface JwInstance {
  getCaptionsList?: () => JwCaptionEntry[];
  getCurrentCaptions?: () => number;
  setCurrentCaptions?: (index: number) => void;
  on?: (event: string, cb: (...args: unknown[]) => void) => void;
  getPlaylistItem?: () => { tracks?: JwPlaylistTrack[] };
  getPlaylistIndex?: () => number;
  getPlaylist?: () => Array<{ tracks?: JwPlaylistTrack[] }>;
  getConfig?: () => { tracks?: JwPlaylistTrack[] };
}

function getJwPlayerInstances(): JwInstance[] {
  if (typeof window === 'undefined' || typeof document === 'undefined') return [];

  const win = window as unknown as Record<string, unknown>;
  const jwplayerFn = win.jwplayer as ((id?: string) => JwInstance | undefined) | undefined;
  if (typeof jwplayerFn !== 'function') return [];

  const instances: JwInstance[] = [];
  const triedIds = new Set<string>();

  const tryAddInstance = (id?: string): void => {
    const key = id ?? '__default__';
    if (triedIds.has(key)) return;
    triedIds.add(key);
    try {
      const inst = id !== undefined ? jwplayerFn(id) : jwplayerFn();
      if (inst && !instances.includes(inst)) {
        instances.push(inst);
      }
    } catch {
      // Ignore individual JWPlayer lookup failures
    }
  };

  tryAddInstance('player-placeholder');
  const jwDomEls = document.querySelectorAll<HTMLElement>('.jwplayer[id], [id^="jwplayer"]');
  for (const el of Array.from(jwDomEls)) {
    if (el.id) tryAddInstance(el.id);
  }
  tryAddInstance(undefined);

  return instances;
}

function isPlayerJsPlaceholder(el: HTMLElement): boolean {
  return el.id === 'player-placeholder' && !el.classList.contains('jwplayer') && Boolean(el.querySelector('pjsdiv'));
}

function detectJwContainer(root?: ParentNode): HTMLElement | null {
  const searchRoot: ParentNode | null =
    root ?? (typeof document !== 'undefined' ? document : null);
  if (!searchRoot) return null;

  const candidates: HTMLElement[] = [];
  for (const selector of JW_CONTAINER_SELECTORS) {
    const matches = Array.from(searchRoot.querySelectorAll<HTMLElement>(selector));
    for (const el of matches) {
      if (isPlayerJsPlaceholder(el)) continue;
      if (!candidates.includes(el)) {
        candidates.push(el);
      }
    }
  }

  for (const el of candidates) {
    const video = el.querySelector<HTMLVideoElement>('video.jw-video, video');
    if (video && isVideoVisible(video)) {
      return el;
    }
  }

  return candidates[0] ?? null;
}

function toAvailableTracks(candidates: readonly CandidateCaptionTrack[]): AvailableTrackOption[] {
  const seen = new Set<string>();
  const out: AvailableTrackOption[] = [];
  for (const c of candidates) {
    if (!c.url || seen.has(c.url)) continue;
    seen.add(c.url);
    out.push({
      label: c.label || c.language || 'Captions',
      language: c.language || detectLanguageFromLabel(c.label || c.url) || 'auto',
      url: c.url
    });
  }
  return out;
}

export const jwplayerPlugin: PlayerPlugin = {
  id: 'jwplayer',

  detectContainer(root?: ParentNode): HTMLElement | null {
    return detectJwContainer(root);
  },

  findVideo(container: HTMLElement | null, root?: ParentNode): HTMLVideoElement | null {
    const target = container ?? detectJwContainer(root);
    if (!target) return null;
    const direct = target.querySelector<HTMLVideoElement>('video.jw-video, video');
    if (direct && direct.isConnected) return direct;
    return findBestVideo(target);
  },

  isControlsHidden(container: HTMLElement): boolean {
    return container.classList.contains('jw-flag-user-inactive');
  },

  getSubtitleBottomOffset(container: HTMLElement): number {
    if (container.classList.contains('jw-flag-user-inactive')) {
      return 28;
    }
    return measureControlBarOffset(container, '.jw-controlbar', 44, 60, 16);
  },

  suppressNativeCaptions(
    _container: HTMLElement,
    suppress: boolean,
    _activeCue?: ActiveCueSnapshot
  ): () => void {
    // Never set video.textTracks[i].mode = 'hidden' on JWPlayer — keep cue rendering intact via CSS.
    jwSuppressor.setEnabled(suppress);
    if (!suppress) {
      return () => {};
    }
    return () => {
      jwSuppressor.setEnabled(false);
    };
  },

  selectTrackInPage(trackIdOrUrl: string): void {
    const target = trackIdOrUrl.trim();
    if (!target) return;

    const instances = getJwPlayerInstances();
    for (const jw of instances) {
      if (typeof jw.getCaptionsList !== 'function' || typeof jw.setCurrentCaptions !== 'function') {
        continue;
      }
      const list = jw.getCaptionsList();
      if (!Array.isArray(list)) continue;

      const lowerTarget = target.toLowerCase();
      const idx = list.findIndex((item, index) => {
        if (!item) return false;
        return (
          String(index) === target ||
          (item.id && item.id.toLowerCase() === lowerTarget) ||
          (item.file && item.file === target) ||
          (item.label && item.label.toLowerCase() === lowerTarget) ||
          (item.language && item.language.toLowerCase() === lowerTarget)
        );
      });

      if (idx !== -1) {
        try {
          jw.setCurrentCaptions(idx);
        } catch {
          // Ignore setCurrentCaptions errors
        }
      }
    }
  },

  initMainWorldProbe(ctx: PlayerMainWorldContext): () => void {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return () => {};
    }

    let disposed = false;
    let navGeneration = 0;
    let lastPostedSubUrl = '';
    let hasAuthoritativeTrack = false;
    let autoEnabledJwCaptions = false;
    let pollIntervalId: number | null = null;
    let mutationTimerId: number | null = null;
    const pendingTimeouts = new Set<number>();
    const hookedInstances = new WeakSet<object>();
    const scannedTrackSrcs = new Set<string>();
    let latestAvailableTracks: AvailableTrackOption[] = [];

    const isUrPlay = /(?:^|\.)ur(?:play)?\.se$/i.test(window.location.hostname);
    const nativeFetch = getNativeFetch();

    const fetchAndEmitTrack = (
      track: CandidateCaptionTrack,
      source: 'jwplayer' | 'track',
      availableTracks: AvailableTrackOption[]
    ): void => {
      try {
        const resolvedUrl = new URL(track.url, window.location.href).href;
        if (resolvedUrl === lastPostedSubUrl) return;
        lastPostedSubUrl = resolvedUrl;
        const reqGen = navGeneration;

        nativeFetch(resolvedUrl)
          .then((res) => (res.ok ? res.text() : ''))
          .then((rawText) => {
            if (disposed || reqGen !== navGeneration) return;
            if (isValidCueBody(rawText)) {
              const cues = parseSubtitles(rawText);
              if (cues.length > 0) {
                const defaultLang = isUrPlay ? 'sv' : 'en';
                const explicitLang = track.language
                  ? detectLanguageFromLabel(track.language)
                  : '';
                const detectedLang =
                  explicitLang ||
                  detectLanguageFromLabelAndCues(
                    `${track.label ?? ''} ${resolvedUrl}`,
                    cues,
                    defaultLang
                  );
                hasAuthoritativeTrack = true;
                ctx.emitTracks({
                  primaryCues: cues,
                  primaryMeta: {
                    url: resolvedUrl,
                    label: track.label,
                    lang: detectedLang,
                    language: detectedLang,
                    source,
                    availableTracks
                  },
                  availableTracks
                });
                return;
              }
            }

            // Fallback metadata emission so isolated world can fetch via SW
            ctx.emitTracks({
              primaryMeta: {
                url: resolvedUrl,
                label: track.label,
                language: track.language,
                lang: track.language,
                source,
                availableTracks
              },
              availableTracks
            });
          })
          .catch(() => {
            if (disposed || reqGen !== navGeneration) return;
            ctx.emitTracks({
              primaryMeta: {
                url: resolvedUrl,
                label: track.label,
                language: track.language,
                lang: track.language,
                source,
                availableTracks
              },
              availableTracks
            });
          });
      } catch {
        // Ignore invalid URL
      }
    };

    const checkJwPlayerCaptions = (): void => {
      if (disposed) return;
      try {
        const instances = getJwPlayerInstances();
        if (instances.length === 0) return;

        const candidates: CandidateCaptionTrack[] = [];
        const pushTracks = (tracks?: JwPlaylistTrack[]): void => {
          if (!Array.isArray(tracks)) return;
          for (const tr of tracks) {
            if (tr?.file && typeof tr.file === 'string') {
              candidates.push({
                url: tr.file,
                label: tr.label,
                language: tr.language,
                kind: tr.kind
              });
            }
          }
        };

        for (const jw of instances) {
          if (typeof jw.on === 'function' && !hookedInstances.has(jw)) {
            hookedInstances.add(jw);
            try {
              jw.on('captionsList', () => {
                if (!disposed) checkJwPlayerCaptions();
              });
              jw.on('playlistItem', () => {
                if (disposed) return;
                navGeneration += 1;
                autoEnabledJwCaptions = false;
                lastPostedSubUrl = '';
                hasAuthoritativeTrack = false;
                latestAvailableTracks = [];
                ctx.emitTracks({ resetPrimaryCues: true });
                const timer = window.setTimeout(() => {
                  pendingTimeouts.delete(timer);
                  checkJwPlayerCaptions();
                }, 250);
                pendingTimeouts.add(timer);
              });
            } catch {
              // Ignore event hook failures
            }
          }

          if (typeof jw.getCaptionsList === 'function') {
            const list = jw.getCaptionsList();
            if (Array.isArray(list)) {
              for (const item of list) {
                if (item?.file && typeof item.file === 'string' && item.id !== 'off') {
                  candidates.push({
                    url: item.file,
                    label: item.label,
                    language: item.language
                  });
                }
              }

              // Auto-enable captions on JWPlayer (e.g. UR Play HLS/DASH) so subtitles load without manual click
              if (
                !autoEnabledJwCaptions &&
                list.length > 1 &&
                typeof jw.getCurrentCaptions === 'function' &&
                typeof jw.setCurrentCaptions === 'function'
              ) {
                const currentIdx = jw.getCurrentCaptions();
                if (currentIdx === 0) {
                  const validEntries = list
                    .map((item, idx) => ({ item, idx }))
                    .filter(({ item, idx }) => {
                      if (idx === 0) return false;
                      const id = String(item?.id ?? '').toLowerCase();
                      const lbl = String(item?.label ?? '').trim().toLowerCase();
                      return id !== 'off' && lbl !== 'off' && lbl !== 'av' && lbl !== 'none';
                    });
                  const standardEntries = validEntries.filter(({ item }) => {
                    const combined =
                      `${item?.label ?? ''} ${item?.language ?? ''} ${item?.id ?? ''}`.toLowerCase();
                    return (
                      !combined.includes('syntolk') &&
                      !combined.includes('teckenspr') &&
                      !combined.includes('description')
                    );
                  });
                  const pool = standardEntries.length > 0 ? standardEntries : validEntries;
                  if (pool.length > 0) {
                    let chosen = pool[0];
                    if (isUrPlay) {
                      const svEntry = pool.find(({ item }) => {
                        const s = `${item?.label ?? ''} ${item?.language ?? ''}`.toLowerCase();
                        return s.includes('svensk') || /\b(sv|swe|sve)(?:[-_][a-z0-9]+)?\b/.test(s);
                      });
                      if (svEntry) chosen = svEntry;
                    }
                    if (chosen) {
                      try {
                        jw.setCurrentCaptions(chosen.idx);
                        autoEnabledJwCaptions = true;
                        ctx.log(
                          'info',
                          `JWPlayer: auto-enabled captions (${chosen.item?.label || chosen.item?.language || `#${chosen.idx}`})`
                        );
                      } catch {
                        // Ignore setCurrentCaptions error
                      }
                    }
                  }
                }
              }
            }
          }

          if (typeof jw.getPlaylistItem === 'function') {
            pushTracks(jw.getPlaylistItem()?.tracks);
          }
          if (typeof jw.getPlaylist === 'function') {
            const idx = typeof jw.getPlaylistIndex === 'function' ? jw.getPlaylistIndex() : 0;
            const pl = jw.getPlaylist();
            if (Array.isArray(pl)) {
              pushTracks(pl[idx]?.tracks ?? pl[0]?.tracks);
            }
          }
          if (typeof jw.getConfig === 'function') {
            pushTracks(jw.getConfig()?.tracks);
          }
        }

        const availableTracks = toAvailableTracks(candidates);
        if (availableTracks.length > 0) {
          latestAvailableTracks = availableTracks;
        }
        const best = pickBestCaptionTrack(candidates);
        if (best) {
          fetchAndEmitTrack(best, 'jwplayer', availableTracks);
        }
      } catch {
        // Ignore JWPlayer probe errors
      }
    };

    const scanTrackElements = (): void => {
      if (disposed || hasAuthoritativeTrack) return;
      try {
        const trackEls = document.querySelectorAll<HTMLTrackElement>('video track, track');
        const candidates: CandidateCaptionTrack[] = [];
        for (const tr of Array.from(trackEls)) {
          const src = tr.src || tr.getAttribute('src') || '';
          if (!src || scannedTrackSrcs.has(src)) continue;
          candidates.push({
            url: src,
            label: tr.label || undefined,
            language: tr.srclang || undefined,
            kind: tr.kind || undefined
          });
        }
        const best = pickBestCaptionTrack(candidates);
        if (best) {
          scannedTrackSrcs.add(best.url);
          fetchAndEmitTrack(best, 'track', toAvailableTracks(candidates));
        }
      } catch {
        // Ignore track scan errors
      }
    };

    const unsubscribeNetwork = subscribeNetworkSubtitles((event) => {
      if (disposed || event.kind !== 'subtitle-text') return;
      const cues = parseSubtitles(event.rawText);
      if (cues.length === 0) return;

      const defaultLang = isUrPlay ? 'sv' : 'en';
      const detectedLang = detectLanguageFromLabelAndCues(event.url, cues, defaultLang);
      lastPostedSubUrl = event.url;
      hasAuthoritativeTrack = true;
      ctx.emitTracks({
        primaryCues: cues,
        primaryMeta: {
          url: event.url,
          lang: detectedLang,
          language: detectedLang,
          source: event.source,
          availableTracks: latestAvailableTracks.length > 0 ? latestAvailableTracks : undefined
        },
        availableTracks: latestAvailableTracks.length > 0 ? latestAvailableTracks : undefined
      });
    });

    const handleSpaNavigate = (): void => {
      if (disposed) return;
      navGeneration += 1;
      autoEnabledJwCaptions = false;
      lastPostedSubUrl = '';
      hasAuthoritativeTrack = false;
      latestAvailableTracks = [];
      scannedTrackSrcs.clear();
      checkJwPlayerCaptions();
      scanTrackElements();
    };
    const unsubscribeSpa = subscribeSpaNavigation(handleSpaNavigate);

    const handlePlay = (e: Event): void => {
      if (e.target instanceof HTMLVideoElement && !hasAuthoritativeTrack) {
        checkJwPlayerCaptions();
        scanTrackElements();
      }
    };
    document.addEventListener('play', handlePlay, true);

    const observer = new MutationObserver(() => {
      if (disposed || hasAuthoritativeTrack || mutationTimerId !== null) return;
      mutationTimerId = window.setTimeout(() => {
        mutationTimerId = null;
        if (!disposed && !hasAuthoritativeTrack) {
          checkJwPlayerCaptions();
          scanTrackElements();
        }
      }, 250);
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });

    let attempts = 0;
    pollIntervalId = window.setInterval(() => {
      attempts += 1;
      if (!disposed) {
        checkJwPlayerCaptions();
        scanTrackElements();
      }
      if (attempts >= 30 || hasAuthoritativeTrack) {
        if (pollIntervalId !== null) {
          window.clearInterval(pollIntervalId);
          pollIntervalId = null;
        }
      }
    }, 1000);

    checkJwPlayerCaptions();
    scanTrackElements();

    return () => {
      disposed = true;
      unsubscribeNetwork();
      unsubscribeSpa();
      document.removeEventListener('play', handlePlay, true);
      observer.disconnect();
      if (pollIntervalId !== null) {
        window.clearInterval(pollIntervalId);
        pollIntervalId = null;
      }
      if (mutationTimerId !== null) {
        window.clearTimeout(mutationTimerId);
        mutationTimerId = null;
      }
      pendingTimeouts.forEach((id) => window.clearTimeout(id));
      pendingTimeouts.clear();
    };
  }
};
