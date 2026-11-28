import { createElement } from 'react';
import {
  DEFAULT_KEYBINDINGS,
  DEFAULT_SETTINGS,
  SHADOW_HOST_ID,
  isValidTranslationText,
  type ActiveCueSnapshot,
  type ActiveListeningMode,
  type AIExplanation,
  type AvailableTrackOption,
  type CapturedTrackPayload,
  type MediaIdentity,
  type PlayerPlugin,
  type QuickTranslationResult,
  type ServicePlugin,
  type SubtitleCue,
  type SubtitleTrackMode,
  type SystemLogEntry,
  type TrackMetadata,
  type TranslationRuntimeStatus,
  type UserSettings,
  type WordToken
} from '@langai/contracts';
import {
  createNewCard,
  getSettings,
  getVocabulary,
  onSettingsChanged,
  saveSettings,
  saveVocabularyCard
} from '@langai/storage';
import {
  SubtitleEngine,
  isSameBaseLang,
  normalizeLanguageCode,
  resolveLanguagePair
} from '@langai/subtitle-kit';
import { WordPopup, type WordSelectionPayload } from '@langai/ui';
import { VideoController } from '../engine/VideoController';
import { isExtensionContextValid, sendRuntimeMessage } from '../messaging/runtimeClient';
import { mountShadowUI, type MountedShadowUI } from './mountShadowUI';

export function getFrameChainHosts(): string[] {
  const hosts: string[] = [];
  if (typeof window === 'undefined') return hosts;
  try {
    if (window.location?.hostname) {
      hosts.push(window.location.hostname.toLowerCase());
    }
    const ancestors = window.location?.ancestorOrigins;
    if (ancestors && ancestors.length > 0) {
      for (let i = 0; i < ancestors.length; i++) {
        try {
          const host = new URL(ancestors[i]).hostname.toLowerCase();
          if (host && !hosts.includes(host)) {
            hosts.push(host);
          }
        } catch {
          // Ignore malformed ancestor origin
        }
      }
    } else if (typeof document !== 'undefined' && document.referrer) {
      try {
        const host = new URL(document.referrer).hostname.toLowerCase();
        if (host && !hosts.includes(host)) {
          hosts.push(host);
        }
      } catch {
        // Ignore malformed referrer
      }
    }
  } catch {
    // Ignore cross-origin frame access errors
  }
  return hosts;
}

export function resolveMatchingService(
  services: readonly ServicePlugin[],
  url?: URL,
  frameChainHosts: readonly string[] = getFrameChainHosts()
): ServicePlugin | null {
  const targetUrl =
    url ?? (typeof window !== 'undefined' ? new URL(window.location.href) : null);
  if (!targetUrl) return null;
  for (const svc of services) {
    try {
      if (svc.matchesUrl(targetUrl, frameChainHosts)) {
        return svc;
      }
    } catch {
      // Ignore matcher errors for unrelated services
    }
  }
  return null;
}

export class ContentRunner {
  private readonly serviceOrList: ServicePlugin | readonly ServicePlugin[];
  private service: ServicePlugin | null = null;
  private activePlayer: PlayerPlugin | null = null;
  private primaryEngine = new SubtitleEngine();
  private translatedEngine = new SubtitleEngine();
  private settings: UserSettings = { ...DEFAULT_SETTINGS };
  private trackMeta: TrackMetadata | null = null;
  private isAdShowing = false;
  private altPressed = false;
  private controlsHidden = false;
  private subtitleBottomOffset = 48;
  private activePrimaryCue: SubtitleCue | null = null;
  private activeTranslatedCue: SubtitleCue | null = null;
  private selectedSelection: WordSelectionPayload | null = null;
  private lastAutoPausedCueId: string | null = null;
  private savedWordKeys = new Set<string>();
  private captionRateLimitedUntil = 0;
  private hasNativeTranslatedTrack = false;
  private translationStatus: TranslationRuntimeStatus = { state: 'idle' };
  private lastLookaheadCheckMs = 0;
  private seekDebounceTimer: number | null = null;
  private retryCooldownTimer: number | null = null;
  private pendingLiveTrackData: CapturedTrackPayload | null = null;
  private autoPauseCountdown: number | null = null;
  private availableTracks: AvailableTrackOption[] = [];
  private systemLogs: SystemLogEntry[] = [];
  private nextLogId = 1;

  private mountedUI: MountedShadowUI | null = null;
  private currentPlayerEl: HTMLElement | null = null;
  private videoController: VideoController | null = null;
  private serviceTeardown: (() => void) | null = null;
  private navTeardown: (() => void) | null = null;
  private suppressTeardown: (() => void) | null = null;
  private lastSuppressedState = false;
  private lastSuppressedContainer: HTMLElement | null = null;
  private lastSuppressedPlayer: PlayerPlugin | null = null;
  private unsubscribeSettings: (() => void) | null = null;
  private domObserver: MutationObserver | null = null;
  private playerStateObserver: MutationObserver | null = null;
  private playerStateRafId: number | null = null;
  private resizeListener: (() => void) | null = null;
  private runtimeMessageListener: ((message: unknown) => void) | null = null;
  private popstateListener: (() => void) | null = null;
  private fullscreenListener: (() => void) | null = null;
  private isDestroyed = false;

  constructor(serviceOrServices: ServicePlugin | readonly ServicePlugin[]) {
    this.serviceOrList = serviceOrServices;
    if (!Array.isArray(serviceOrServices)) {
      this.service = serviceOrServices as ServicePlugin;
    }
  }

  private pushLog(level: 'info' | 'warn' | 'error', message: string, shouldRender = false): void {
    const clean = message.trim();
    if (!clean) return;
    const now = new Date();
    const pad = (n: number): string => String(n).padStart(2, '0');
    const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    const entry: SystemLogEntry = {
      id: this.nextLogId++,
      time,
      level,
      message: clean
    };
    this.systemLogs = [...this.systemLogs.slice(-59), entry];
    if (shouldRender && !this.isDestroyed) {
      this.renderUI();
    }
  }

  private handleOpenSettings(): void {
    if (!isExtensionContextValid()) return;
    this.pushLog('info', 'Opening extension settings', true);
    void sendRuntimeMessage<boolean>({
      type: 'OPEN_EXTENSION_POPUP',
      payload: { tab: 'settings' }
    }).catch(() => undefined);
  }

  private handleSelectAvailableTrack(trackUrl: string): void {
    if (!trackUrl) return;
    if (this.service?.selectTrack) {
      this.service.selectTrack(trackUrl);
      return;
    }
    this.activePlayer?.selectTrackInPage?.(trackUrl);
  }

  private handleClearSystemLogs(): void {
    this.systemLogs = [];
    this.renderUI();
  }

  private getLanguagePair() {
    return resolveLanguagePair(
      {
        ...this.settings,
        sourceLang:
          this.settings.sourceLang === 'auto' && this.service?.defaultSourceLang
            ? this.service.defaultSourceLang
            : this.settings.sourceLang
      },
      this.trackMeta?.lang
    );
  }

  private canUseNativeTranslatedTrack(pair: {
    effectiveSource: string;
    effectiveTarget: string;
  }): boolean {
    if (!this.service?.capabilities.nativeTranslatedTrack) return false;
    if (!this.trackMeta?.lang) return false;
    const trackLang = normalizeLanguageCode(this.trackMeta.lang);
    if (!trackLang || trackLang === 'auto') return false;
    if (isSameBaseLang(trackLang, pair.effectiveTarget)) return false;
    return pair.effectiveSource === 'auto' || isSameBaseLang(trackLang, pair.effectiveSource);
  }

  private getMediaIdentity(): MediaIdentity | null {
    if (!this.service || typeof window === 'undefined' || typeof document === 'undefined') {
      return null;
    }
    try {
      return this.service.resolveMediaIdentity(new URL(window.location.href), document);
    } catch {
      return null;
    }
  }

  private getCleanVideoTitle(): string {
    if (this.trackMeta?.title) return this.trackMeta.title;
    const identity = this.getMediaIdentity();
    if (identity?.title) return identity.title;
    if (typeof document !== 'undefined' && document.title) {
      return document.title.trim() || 'Video';
    }
    return this.service?.name ?? 'Video';
  }

  private getActiveVideoId(): string {
    if (this.trackMeta?.videoId) return this.trackMeta.videoId;
    const identity = this.getMediaIdentity();
    if (identity?.mediaId) return identity.mediaId;
    return typeof window !== 'undefined' ? window.location.hostname : 'unknown';
  }

  async start(): Promise<void> {
    if (!isExtensionContextValid()) return;

    if (!this.service) {
      this.service = resolveMatchingService(
        this.serviceOrList as readonly ServicePlugin[]
      );
    }
    if (!this.service) {
      return;
    }

    this.settings = await getSettings();
    if (this.isDestroyed || !isExtensionContextValid()) {
      this.destroy();
      return;
    }

    if (this.settings.enabledServices?.[this.service.id] === false) {
      return;
    }

    try {
      const vocab = await getVocabulary();
      for (const card of vocab) {
        this.savedWordKeys.add(
          this.buildSavedKey(card.word, card.videoId || '', card.timestampSec || 0)
        );
      }
    } catch {
      // Ignore storage read errors
    }

    this.unsubscribeSettings = onSettingsChanged((newSettings) => {
      this.applySettings(newSettings);
    });

    this.runtimeMessageListener = (message: unknown) => {
      if (this.isDestroyed || !message || typeof message !== 'object') return;
      const msg = message as {
        type?: string;
        payload?: {
          videoId?: string;
          sourceLang?: string;
          targetLang?: string;
          batchTranslations?: Array<{ id: string; text: string }>;
          status?: TranslationRuntimeStatus;
        };
      };
      if (msg.type === 'FREE_TRANSLATE_CUES_BATCH' && msg.payload) {
        const vid = this.getActiveVideoId();
        const targetVid = msg.payload.videoId;
        const { effectiveSource, effectiveTarget } = this.getLanguagePair();
        const isSameTarget =
          !msg.payload.targetLang ||
          normalizeLanguageCode(msg.payload.targetLang) === effectiveTarget;
        const isSameSource =
          !msg.payload.sourceLang ||
          normalizeLanguageCode(msg.payload.sourceLang) === normalizeLanguageCode(effectiveSource);
        if (
          isSameTarget &&
          isSameSource &&
          (targetVid === vid ||
            (vid && targetVid && (targetVid.includes(vid) || vid.includes(targetVid))))
        ) {
          this.applyBatchAndStatus(msg.payload.batchTranslations, msg.payload.status);
        }
      }
    };
    try {
      if (isExtensionContextValid() && chrome.runtime?.onMessage) {
        chrome.runtime.onMessage.addListener(this.runtimeMessageListener);
      }
    } catch {
      // Ignore invalidated context
    }

    this.pushLog('info', `Module started: ${this.service.name}`);

    this.serviceTeardown = this.service.initIsolatedSession({
      onTracksLoaded: (data) => this.handleTracksLoaded(data),
      onAdStateChange: (isAd) => {
        if (this.isDestroyed) return;
        this.isAdShowing = isAd;
        this.syncNativeCaptions();
        this.renderUI();
      },
      onVideoElementChange: (video) => {
        if (this.isDestroyed) return;
        if (video && this.videoController) {
          this.videoController.attach(video);
        }
      },
      onLog: (level, message) => {
        if (this.isDestroyed) return;
        this.pushLog(level, message, true);
      }
    });

    this.attachToPlayer();
    this.setupDomObserver();

    this.popstateListener = () => this.handleNavigation();
    window.addEventListener('popstate', this.popstateListener);
    if (this.service.observeNavigation) {
      this.navTeardown = this.service.observeNavigation(() => this.handleNavigation());
    }

    this.fullscreenListener = () => {
      if (this.isDestroyed) return;
      if (!isExtensionContextValid()) {
        this.destroy();
        return;
      }
      this.attachToPlayer();
      this.syncPlayerOverlayMetrics();
      this.renderUI();
    };
    document.addEventListener('fullscreenchange', this.fullscreenListener);
    document.addEventListener('webkitfullscreenchange', this.fullscreenListener);
  }

  private handleNavigation(): void {
    if (this.isDestroyed) return;
    if (!isExtensionContextValid()) {
      this.destroy();
      return;
    }
    this.videoController?.clearPauseTimer();
    this.closePopupAndResume(false);
    if (this.trackMeta?.videoId && !this.doesLocationMatchVideoId(this.trackMeta.videoId)) {
      this.clearActiveSubtitles();
    }
    this.attachToPlayer();
  }

  private handleTracksLoaded(data: CapturedTrackPayload): void {
    if (this.isDestroyed) return;
    if (!isExtensionContextValid()) {
      this.destroy();
      return;
    }
    if (data.error) {
      this.pushLog('warn', data.error, true);
    }
    if (
      data.liveCueBoundary &&
      this.settings.autoPauseAfterCue &&
      this.activePrimaryCue &&
      this.videoController &&
      !this.videoController.isPaused() &&
      this.lastAutoPausedCueId !== this.activePrimaryCue.id
    ) {
      this.lastAutoPausedCueId = this.activePrimaryCue.id;
      this.pendingLiveTrackData = data;
      this.videoController.pauseVideo();
      const timerSec = this.settings.pauseTimerSeconds ?? 0;
      if (timerSec > 0) this.videoController.schedulePauseTimer(timerSec);
      this.renderUI();
      return;
    }
    this.applyTrackData(data);
  }

  private doesLocationMatchVideoId(videoId: string): boolean {
    if (!videoId || typeof window === 'undefined') return true;
    const identity = this.getMediaIdentity();
    if (identity?.mediaId) {
      return identity.mediaId === videoId;
    }
    try {
      const url = new URL(window.location.href);
      const hostPath = `${url.hostname}${url.pathname}`;
      return hostPath === videoId || window.location.href.includes(videoId);
    } catch {
      return window.location.href.includes(videoId);
    }
  }

  private clearActiveSubtitles(availableTracks: AvailableTrackOption[] = []): void {
    if (this.trackMeta?.videoId) {
      this.cancelBackgroundTranslation(this.trackMeta.videoId);
    }
    this.resetTranslationState(false);
    this.hasNativeTranslatedTrack = false;
    this.primaryEngine.clear();
    this.translatedEngine.clear();
    this.trackMeta = null;
    this.availableTracks = availableTracks;
    this.activePrimaryCue = null;
    this.activeTranslatedCue = null;
    this.lastAutoPausedCueId = null;
    this.pendingLiveTrackData = null;
    this.captionRateLimitedUntil = 0;
    this.videoController?.clearPauseTimer();
    this.closePopupAndResume(false);
    this.syncNativeCaptions();
    this.renderUI();
  }

  private applyTrackData(data: CapturedTrackPayload): void {
    if (!this.service) return;
    const hasPrimaryData = Boolean(data.primaryCues || data.primaryCueUpdates);
    if (hasPrimaryData) {
      if (data.primaryCues && data.primaryCues.length === 0 && !data.primaryMeta) {
        this.clearActiveSubtitles(data.availableTracks ?? []);
        return;
      }

      const prevVid = this.trackMeta?.videoId;
      const nextVid = data.primaryMeta?.videoId;
      if (prevVid && nextVid && prevVid !== nextVid) this.cancelBackgroundTranslation(prevVid);
      if (!prevVid || prevVid !== nextVid) {
        this.hasNativeTranslatedTrack = false;
        this.primaryEngine.clear();
        this.translatedEngine.clear();
        this.activeTranslatedCue = null;
        this.resetTranslationState(false);
      }
      if (data.resetPrimaryCues) {
        this.cancelBackgroundTranslation(nextVid || prevVid);
        this.primaryEngine.clear();
        this.translatedEngine.clear();
        this.activeTranslatedCue = null;
        this.resetTranslationState(false);
      }
      if (data.primaryCues) {
        const prevById = new Map<string, string>();
        const prevByText = new Map<string, string>();
        for (const existing of this.primaryEngine.getCues()) {
          if (isValidTranslationText(existing.translation)) {
            prevById.set(existing.id, existing.translation);
            prevByText.set(existing.text.trim(), existing.translation);
          }
        }
        const cuesToLoad =
          prevById.size > 0
            ? data.primaryCues.map((c) => {
                if (isValidTranslationText(c.translation)) return c;
                const preserved = prevById.get(c.id) ?? prevByText.get(c.text.trim());
                return preserved ? { ...c, translation: preserved } : c;
              })
            : data.primaryCues;
        this.primaryEngine.loadCues(
          cuesToLoad,
          this.service.capabilities.cueSeeking
        );
      } else if (data.primaryCueUpdates) {
        this.primaryEngine.upsertCues(data.primaryCueUpdates, false);
      }
      this.trackMeta = data.primaryMeta ?? this.trackMeta;
      if (data.availableTracks !== undefined) {
        this.availableTracks = data.availableTracks;
      } else if (data.primaryMeta?.availableTracks !== undefined) {
        this.availableTracks = data.primaryMeta.availableTracks;
      }
      this.activePrimaryCue = this.primaryEngine.getCueAt(
        this.videoController?.getCurrentTime() ?? 0,
        this.settings.subtitleOffsetSec
      );
      if (data.primaryCues && data.primaryCues.length > 0 && this.service.capabilities.cueSeeking) {
        const langStr = (this.trackMeta?.lang || 'auto').toUpperCase();
        const kindStr = this.trackMeta?.isAsr ? 'ASR' : 'author';
        this.pushLog(
          'info',
          `Track loaded: ${langStr} (${kindStr}, ${data.primaryCues.length} cues)`
        );
      }

      const pair = this.getLanguagePair();
      if (
        this.isTranslationEnabled(this.settings) &&
        !this.hasNativeTranslatedTrack &&
        this.canUseNativeTranslatedTrack(pair)
      ) {
        this.service.requestTranslatedTrack?.(pair.effectiveTarget);
      }
    }
    if (data.translatedCues) {
      const pair = this.getLanguagePair();
      const tlangMatches =
        !data.translatedMeta?.tlang ||
        isSameBaseLang(data.translatedMeta.tlang, pair.effectiveTarget);
      if (
        data.translatedCues.length > 0 &&
        tlangMatches &&
        this.canUseNativeTranslatedTrack(pair)
      ) {
        this.hasNativeTranslatedTrack = true;
        this.resetTranslationState(true);
        this.translatedEngine.loadCues(data.translatedCues);
        this.activeTranslatedCue = this.translatedEngine.getCueAt(
          this.videoController?.getCurrentTime() ?? 0,
          this.settings.subtitleOffsetSec
        );
      }
    }
    if (data.rateLimitedUntil !== undefined) this.captionRateLimitedUntil = data.rateLimitedUntil;
    this.syncNativeCaptions();
    this.attachToPlayer();
    this.renderUI();
    if (!data.skipTranslation) this.triggerSubtitleTranslation();
  }

  destroy(): void {
    if (this.isDestroyed) return;
    this.isDestroyed = true;
    this.clearTranslationTimers();
    this.cancelBackgroundTranslation();
    if (this.playerStateRafId !== null) {
      window.cancelAnimationFrame(this.playerStateRafId);
      this.playerStateRafId = null;
    }
    this.playerStateObserver?.disconnect();
    this.playerStateObserver = null;
    if (this.resizeListener) {
      window.removeEventListener('resize', this.resizeListener);
      this.resizeListener = null;
    }
    if (this.popstateListener) {
      window.removeEventListener('popstate', this.popstateListener);
      this.popstateListener = null;
    }
    this.navTeardown?.();
    this.navTeardown = null;
    if (this.fullscreenListener) {
      document.removeEventListener('fullscreenchange', this.fullscreenListener);
      document.removeEventListener('webkitfullscreenchange', this.fullscreenListener);
      this.fullscreenListener = null;
    }
    if (this.runtimeMessageListener) {
      try {
        if (isExtensionContextValid() && chrome.runtime?.onMessage) {
          chrome.runtime.onMessage.removeListener(this.runtimeMessageListener);
        }
      } catch {
        // Ignore invalidated context
      }
      this.runtimeMessageListener = null;
    }
    this.serviceTeardown?.();
    this.serviceTeardown = null;
    this.unsubscribeSettings?.();
    this.unsubscribeSettings = null;
    this.domObserver?.disconnect();
    this.domObserver = null;
    this.videoController?.destroy();
    const hostId = this.mountedUI?.host.id;
    const currentHostInDom =
      hostId && typeof document !== 'undefined' ? document.getElementById(hostId) : null;
    const replacedByNewInstance = Boolean(
      this.mountedUI && currentHostInDom && currentHostInDom !== this.mountedUI.host
    );
    this.mountedUI?.unmount();
    if (!replacedByNewInstance) {
      this.suppressTeardown?.();
      this.suppressTeardown = null;
      if (this.currentPlayerEl && this.activePlayer?.suppressNativeCaptions) {
        try {
          this.activePlayer.suppressNativeCaptions(this.currentPlayerEl, false);
        } catch {
          // Ignore restore errors
        }
      }
    }
  }

  private buildSavedKey(word: string, videoId: string, cueStartSec: number): string {
    return `${videoId}:${word.trim().toLowerCase()}:${Math.floor(cueStartSec)}`;
  }

  private resolvePlayer(): {
    player: PlayerPlugin;
    container: HTMLElement;
    video: HTMLVideoElement | null;
  } | null {
    if (!this.service || typeof document === 'undefined') return null;
    let fallback: {
      player: PlayerPlugin;
      container: HTMLElement;
      video: HTMLVideoElement | null;
    } | null = null;

    for (const player of this.service.players) {
      const container = player.detectContainer(document);
      if (!container) continue;
      const video = player.findVideo(container, document);
      if (video) {
        return { player, container, video };
      }
      if (!fallback) {
        fallback = { player, container, video: null };
      }
    }
    return fallback;
  }

  private setupDomObserver(): void {
    let pending = false;
    this.domObserver = new MutationObserver(() => {
      if (pending || this.isDestroyed) return;
      pending = true;
      window.requestAnimationFrame(() => {
        pending = false;
        if (this.isDestroyed) return;
        if (!isExtensionContextValid()) {
          this.destroy();
          return;
        }
        const resolved = this.resolvePlayer();
        if (
          resolved &&
          (!this.mountedUI ||
            !resolved.container.contains(this.mountedUI.host) ||
            resolved.player !== this.activePlayer)
        ) {
          this.attachToPlayer();
        } else if (resolved && this.videoController) {
          const currentVideo = this.videoController.getVideo();
          const videoEl = resolved.video ?? resolved.player.findVideo(resolved.container, document);
          if (videoEl && (!currentVideo || !currentVideo.isConnected || videoEl !== currentVideo)) {
            this.videoController.attach(videoEl);
          }
        }
      });
    });

    const rootTarget = document.body || document.documentElement;
    if (rootTarget) {
      this.domObserver.observe(rootTarget, { childList: true, subtree: true });
    }
  }

  private createVideoController(): VideoController {
    return new VideoController({
      onTimeUpdate: (timeSec: number) => {
        if (this.isDestroyed) return;
        if (!isExtensionContextValid()) {
          this.destroy();
          return;
        }
        if (!this.settings.enabled || this.isAdShowing || !this.videoController) return;

        if (this.pendingLiveTrackData && !this.videoController.isPaused()) {
          const pending = this.pendingLiveTrackData;
          this.pendingLiveTrackData = null;
          this.applyTrackData(pending);
        }

        const isTranslationVisible = this.isTranslationEnabled(this.settings);
        const offsetSec = this.settings.subtitleOffsetSec ?? 0;
        const nextPrimary = this.primaryEngine.getCueAt(timeSec, offsetSec);
        const nextTranslated =
          isTranslationVisible && nextPrimary && this.hasNativeTranslatedTrack
            ? this.translatedEngine.getCueAt(timeSec, offsetSec)
            : null;

        if (
          this.settings.autoPauseAfterCue &&
          this.service?.capabilities.cueSeeking &&
          this.activePrimaryCue &&
          !this.videoController.isPaused() &&
          this.lastAutoPausedCueId !== this.activePrimaryCue.id &&
          timeSec - offsetSec >= this.activePrimaryCue.endTime - 0.05
        ) {
          this.lastAutoPausedCueId = this.activePrimaryCue.id;
          this.videoController.pauseVideo();
          const timerSec = this.settings.pauseTimerSeconds ?? 0;
          if (timerSec > 0) {
            this.videoController.schedulePauseTimer(timerSec);
          }
        }

        if (
          nextPrimary?.id !== this.activePrimaryCue?.id ||
          nextPrimary?.translation !== this.activePrimaryCue?.translation ||
          nextTranslated?.id !== this.activeTranslatedCue?.id ||
          nextTranslated?.text !== this.activeTranslatedCue?.text
        ) {
          this.activePrimaryCue = nextPrimary;
          this.activeTranslatedCue = nextTranslated;
          if (nextPrimary && nextPrimary.id !== this.lastAutoPausedCueId) {
            this.lastAutoPausedCueId = null;
          }
          this.renderUI();
        }

        const nowMs = Date.now();
        if (
          isTranslationVisible &&
          !this.hasNativeTranslatedTrack &&
          nowMs - this.lastLookaheadCheckMs > 3500 &&
          (this.translationStatus.state !== 'cooldown' ||
            (this.translationStatus.retryAt ?? 0) <= nowMs) &&
          this.hasUntranslatedInWindow(timeSec)
        ) {
          this.lastLookaheadCheckMs = nowMs;
          this.triggerSubtitleTranslation(timeSec);
        }
      },
      onSeeked: () => {
        this.lastAutoPausedCueId = null;
        this.pendingLiveTrackData = null;
        this.lastLookaheadCheckMs = 0;
        if (this.seekDebounceTimer !== null) {
          window.clearTimeout(this.seekDebounceTimer);
        }
        if (!this.isTranslationEnabled(this.settings) || this.hasNativeTranslatedTrack) return;

        this.seekDebounceTimer = window.setTimeout(() => {
          this.seekDebounceTimer = null;
          if (this.isDestroyed) return;
          const curTime = this.videoController?.getCurrentTime() ?? 0;
          if (this.hasUntranslatedInWindow(curTime)) {
            this.triggerSubtitleTranslation(curTime);
          }
        }, 120);
      },
      onRepeatCue: () => this.handleRepeatCue(),
      onPreviousCue: () => this.handlePreviousCue(),
      onNextCue: () => this.handleNextCue(),
      onSaveActiveWord: () => this.handleQuickSaveShortcut(),
      onClosePopup: () => this.closePopupAndResume(true),
      onAdjustFontSize: (delta: number) => {
        const current = this.settings.subtitleFontSize ?? 20;
        const next = Math.min(56, Math.max(12, current + delta));
        if (next !== current) {
          void this.handleUpdateSettings({ subtitleFontSize: next });
        }
      },
      onAltKeyChange: (pressed: boolean) => {
        if (this.altPressed !== pressed) {
          this.altPressed = pressed;
          this.renderUI();
        }
      },
      shouldPauseOnAltHold: () => this.settings.pauseOnAltHold ?? true,
      isPopupOpen: () => this.selectedSelection !== null,
      hasCues: () => this.primaryEngine.getCues().length > 0,
      isOverlayEnabled: () => this.settings.enabled,
      isAdShowing: () => this.isAdShowing,
      getKeybindings: () => this.settings.keybindings ?? DEFAULT_KEYBINDINGS,
      onCycleSubtitleMode: () => this.handleCycleSubtitleMode(),
      onCycleTrackMode: () => this.handleCycleTrackMode(),
      onToggleAutoPause: () => this.handleToggleAutoPause(),
      onPauseTimerTick: (remainingSec) => {
        if (this.autoPauseCountdown !== remainingSec) {
          this.autoPauseCountdown = remainingSec;
          this.renderUI();
        }
      }
    });
  }

  private syncPlayerOverlayMetrics(): boolean {
    if (!this.activePlayer || !this.currentPlayerEl) return false;
    let nextHidden = this.controlsHidden;
    let nextOffset = this.subtitleBottomOffset;
    try {
      nextHidden = this.activePlayer.isControlsHidden(this.currentPlayerEl);
    } catch {
      // Ignore player metric probe errors
    }
    try {
      nextOffset = this.activePlayer.getSubtitleBottomOffset(this.currentPlayerEl);
    } catch {
      // Ignore player offset probe errors
    }
    const changed =
      nextHidden !== this.controlsHidden || nextOffset !== this.subtitleBottomOffset;
    this.controlsHidden = nextHidden;
    this.subtitleBottomOffset = nextOffset;
    return changed;
  }

  private observePlayerContainerMetrics(container: HTMLElement): void {
    this.playerStateObserver?.disconnect();
    this.playerStateObserver = null;
    if (this.resizeListener) {
      window.removeEventListener('resize', this.resizeListener);
      this.resizeListener = null;
    }

    const scheduleSync = (): void => {
      if (this.playerStateRafId !== null || this.isDestroyed) return;
      this.playerStateRafId = window.requestAnimationFrame(() => {
        this.playerStateRafId = null;
        if (this.isDestroyed) return;
        if (this.syncPlayerOverlayMetrics()) {
          this.renderUI();
        }
      });
    };

    this.playerStateObserver = new MutationObserver(() => {
      scheduleSync();
    });
    this.playerStateObserver.observe(container, {
      attributes: true,
      attributeFilter: ['class', 'style']
    });

    this.resizeListener = () => scheduleSync();
    window.addEventListener('resize', this.resizeListener);
  }

  private attachToPlayer(): void {
    const resolved = this.resolvePlayer();
    if (!resolved) return;

    const { player, container: playerEl, video: videoEl } = resolved;
    this.activePlayer = player;

    if (typeof window !== 'undefined' && window.getComputedStyle) {
      const pos = window.getComputedStyle(playerEl).position;
      if (pos === 'static') {
        playerEl.style.position = 'relative';
      }
    }

    if (!this.videoController) {
      this.videoController = this.createVideoController();
    }

    if (videoEl) {
      this.videoController.attach(videoEl);
    }

    this.syncPlayerOverlayMetrics();

    if (
      this.currentPlayerEl !== playerEl ||
      !this.mountedUI ||
      !playerEl.contains(this.mountedUI.host)
    ) {
      this.mountedUI?.unmount();
      this.currentPlayerEl = playerEl;
      this.observePlayerContainerMetrics(playerEl);

      this.mountedUI = mountShadowUI(
        playerEl,
        {
          settings: this.settings,
          playerContainer: playerEl,
          isAdShowing: this.isAdShowing,
          controlsHidden: this.controlsHidden,
          subtitleBottomOffset: this.subtitleBottomOffset,
          serviceName: this.service?.name,
          trackMeta: this.trackMeta,
          availableTracks: this.availableTracks,
          systemLogs: this.systemLogs,
          cueCount: this.primaryEngine.getCues().length,
          captionRateLimitedUntil: this.captionRateLimitedUntil,
          translationStatus: this.translationStatus,
          supportsCueSeeking: this.service?.capabilities.cueSeeking !== false,
          primaryCue: this.activePrimaryCue,
          translatedCue: this.activeTranslatedCue,
          altPressed: this.altPressed,
          selectedTarget: this.selectedSelection?.target ?? null,
          autoPauseCountdown: this.autoPauseCountdown,
          onResumeAutoPause: () => this.videoController?.resumeAutoPause(),
          onUpdateSettings: (partial) => {
            void this.handleUpdateSettings(partial);
          },
          onRepeatCue: () => this.handleRepeatCue(),
          onResetPosition: () => {
            void this.handleUpdateSettings({ subtitlePosition: null });
          },
          onRetryTranslation: () => this.handleRetryTranslation(),
          onOpenSettings: () => this.handleOpenSettings(),
          onSelectAvailableTrack: (url) => this.handleSelectAvailableTrack(url),
          onClearSystemLogs: () => this.handleClearSystemLogs(),
          onSelectTarget: (sel) => this.handleSelectTarget(sel)
        },
        SHADOW_HOST_ID
      );

      this.syncNativeCaptions();
      this.renderUI();
    }
  }

  private syncNativeCaptions(): void {
    const container = this.currentPlayerEl;
    const player = this.activePlayer;
    if (!container || !player?.suppressNativeCaptions) return;

    const shouldSuppress =
      this.settings.enabled &&
      !this.isAdShowing &&
      this.primaryEngine.getCues().length > 0;

    if (
      shouldSuppress === this.lastSuppressedState &&
      container === this.lastSuppressedContainer &&
      player === this.lastSuppressedPlayer
    ) {
      return;
    }

    this.suppressTeardown?.();
    this.suppressTeardown = null;

    const activeCue: ActiveCueSnapshot | undefined = this.activePrimaryCue
      ? {
          primaryText: this.activePrimaryCue.text,
          ...(this.activeTranslatedCue?.text || this.activePrimaryCue.translation
            ? {
                secondaryText:
                  this.activeTranslatedCue?.text ?? this.activePrimaryCue.translation
              }
            : {})
        }
      : undefined;

    this.lastSuppressedState = shouldSuppress;
    this.lastSuppressedContainer = container;
    this.lastSuppressedPlayer = player;
    this.suppressTeardown =
      player.suppressNativeCaptions(container, shouldSuppress, activeCue) ?? null;
  }

  private handleRepeatCue(): void {
    if (!this.service?.capabilities.cueSeeking) return;
    if (!this.videoController) return;
    const time = this.videoController.getCurrentTime();
    const cue = this.primaryEngine.getCueAt(time, this.settings.subtitleOffsetSec);
    if (cue) {
      this.lastAutoPausedCueId = null;
      this.videoController.jumpToCue(cue);
    }
  }

  private handlePreviousCue(): boolean {
    if (!this.service?.capabilities.cueSeeking) return false;
    if (!this.videoController) return false;
    const time = this.videoController.getCurrentTime();
    const prev = this.primaryEngine.getPreviousCue(time, this.settings.subtitleOffsetSec);
    if (prev) {
      this.lastAutoPausedCueId = null;
      this.videoController.jumpToCue(prev);
      return true;
    }
    return false;
  }

  private handleNextCue(): boolean {
    if (!this.service?.capabilities.cueSeeking) return false;
    if (!this.videoController) return false;
    const time = this.videoController.getCurrentTime();
    const next = this.primaryEngine.getNextCue(time, this.settings.subtitleOffsetSec);
    if (next) {
      this.lastAutoPausedCueId = null;
      this.videoController.jumpToCue(next);
      return true;
    }
    return false;
  }

  private handleCycleSubtitleMode(): void {
    const modes: ActiveListeningMode[] = ['off', 'blur', 'hidden'];
    const currentIdx = modes.indexOf(this.settings.activeListeningMode ?? 'off');
    const nextMode = modes[(currentIdx + 1) % modes.length];
    void this.handleUpdateSettings({ activeListeningMode: nextMode });
  }

  private handleCycleTrackMode(): void {
    const modes: SubtitleTrackMode[] = ['dual', 'translation', 'original'];
    const currentIdx = modes.indexOf(this.settings.subtitleTrackMode ?? 'dual');
    const nextMode = modes[(currentIdx + 1) % modes.length];
    void this.handleUpdateSettings({ subtitleTrackMode: nextMode });
  }

  private handleToggleAutoPause(): void {
    const next = !(this.settings.autoPauseAfterCue ?? false);
    void this.handleUpdateSettings({ autoPauseAfterCue: next });
  }

  private handleQuickSaveShortcut(): boolean {
    const targetCue = this.selectedSelection?.cue ?? this.activePrimaryCue;
    if (!targetCue) return false;

    const targetWord =
      this.selectedSelection?.target ??
      targetCue.tokens.find((t: WordToken) => t.isWord)?.text ??
      '';
    if (!targetWord) return false;

    void (async () => {
      let translation = targetWord;
      const { effectiveSource, effectiveTarget } = this.getLanguagePair();
      try {
        const res = await sendRuntimeMessage<QuickTranslationResult>({
          type: 'QUICK_TRANSLATE',
          payload: {
            text: targetWord,
            sourceLang: effectiveSource,
            nativeLang: effectiveTarget
          }
        });
        if (res.ok && isValidTranslationText(res.data.translation)) {
          translation = res.data.translation;
        }
      } catch {
        // Fallback to raw targetWord
      }

      await this.handleSaveVocabulary({
        word: targetWord,
        translation,
        aiExplanation: null,
        cue: targetCue
      });
    })();

    return true;
  }

  private handleSelectTarget(selection: WordSelectionPayload): void {
    if (this.settings.autoPauseOnWordClick ?? true) {
      this.videoController?.pauseForInspection();
    }
    this.selectedSelection = selection;
    this.renderUI();
  }

  private closePopupAndResume(allowAutoResume = true): void {
    this.selectedSelection = null;
    if (allowAutoResume && this.videoController?.isInspectionPaused()) {
      this.videoController.resumeFromInspection();
    }
    this.renderUI();
  }

  public applySettings(next: UserSettings): void {
    if (this.isDestroyed) return;

    const prev = this.settings;
    const prevPair = resolveLanguagePair(prev, this.trackMeta?.lang);
    const prevShowTrans = this.isTranslationEnabled(prev);

    this.settings = next;

    const nextPair = resolveLanguagePair(next, this.trackMeta?.lang);
    const nextShowTrans = this.isTranslationEnabled(next);

    if (
      !next.enabled ||
      !next.autoPauseAfterCue ||
      (next.pauseTimerSeconds ?? 0) <= 0
    ) {
      this.videoController?.clearPauseTimer();
    }

    const langChanged =
      prevPair.effectiveSource !== nextPair.effectiveSource ||
      prevPair.effectiveTarget !== nextPair.effectiveTarget;
    const providerChanged =
      next.translationProvider !== prev.translationProvider ||
      next.myMemoryEmail !== prev.myMemoryEmail ||
      next.deeplApiKey !== prev.deeplApiKey;
    const translationJustEnabled = !prevShowTrans && nextShowTrans;
    const offsetChanged = next.subtitleOffsetSec !== prev.subtitleOffsetSec;

    if (langChanged || providerChanged) {
      this.resetTranslationState(true);
      this.hasNativeTranslatedTrack = false;
      this.primaryEngine.clearTranslations();
      this.translatedEngine.clear();
      this.activePrimaryCue = this.primaryEngine.getCueAt(
        this.videoController?.getCurrentTime() ?? 0,
        next.subtitleOffsetSec
      );
      this.activeTranslatedCue = null;
    } else if (prevShowTrans && !nextShowTrans) {
      this.resetTranslationState(true);
    } else if (offsetChanged) {
      const currentTime = this.videoController?.getCurrentTime() ?? 0;
      this.activePrimaryCue = this.primaryEngine.getCueAt(currentTime, next.subtitleOffsetSec);
      this.activeTranslatedCue =
        nextShowTrans && this.activePrimaryCue && this.hasNativeTranslatedTrack
          ? this.translatedEngine.getCueAt(currentTime, next.subtitleOffsetSec)
          : null;
    }

    if (
      (langChanged || translationJustEnabled || providerChanged) &&
      nextShowTrans &&
      !this.hasNativeTranslatedTrack &&
      this.canUseNativeTranslatedTrack(nextPair)
    ) {
      this.service?.requestTranslatedTrack?.(nextPair.effectiveTarget);
    }
    if ((langChanged || translationJustEnabled || providerChanged) && nextShowTrans) {
      this.triggerSubtitleTranslation();
    }

    this.syncNativeCaptions();
    this.renderUI();
  }

  private async handleUpdateSettings(partial: Partial<UserSettings>): Promise<void> {
    const next = await saveSettings(partial);
    this.applySettings(next);
  }

  private async handleSaveVocabulary(params: {
    word: string;
    translation: string;
    aiExplanation: AIExplanation | null;
    cue: SubtitleCue;
    contextTranslation?: string;
  }): Promise<void> {
    const vid = this.getActiveVideoId();
    let screenshotBase64 = this.videoController?.captureFrame() ?? null;
    if (!screenshotBase64 && this.service?.captureFrame && this.videoController?.getVideo()) {
      try {
        screenshotBase64 = await this.service.captureFrame(this.videoController.getVideo()!);
      } catch {
        // Ignore frame capture fallback errors
      }
    }

    const translatedMatch =
      params.contextTranslation ||
      params.cue.translation ||
      (this.activeTranslatedCue &&
      Math.abs(this.activeTranslatedCue.startTime - params.cue.startTime) < 2
        ? this.activeTranslatedCue.text
        : this.translatedEngine.getCueAt(
            (params.cue.startTime + params.cue.endTime) / 2,
            0
          )?.text ?? '');

    const { effectiveSource, effectiveTarget } = this.getLanguagePair();
    const cleanTitle = this.getCleanVideoTitle();
    const identity = this.getMediaIdentity();
    const ts = Math.max(0, Math.floor(params.cue.startTime));
    const source = identity?.serviceId ?? this.service?.id ?? 'web';
    const sourceLabel = identity?.badgeLabel ?? this.service?.badgeLabel ?? this.service?.name;
    const sourceUrl = identity
      ? identity.buildTimestampUrl
        ? identity.buildTimestampUrl(ts)
        : identity.canonicalUrl
      : typeof window !== 'undefined'
        ? window.location.href
        : undefined;

    const card = createNewCard({
      word: params.word,
      lemma: params.aiExplanation?.lemma ?? params.word,
      translation: params.translation,
      aiExplanation: params.aiExplanation,
      contextSentence: params.cue.text,
      contextTranslation: translatedMatch,
      videoId: vid,
      videoTitle: cleanTitle,
      timestampSec: ts,
      screenshotBase64,
      sourceLang: effectiveSource,
      nativeLang: effectiveTarget,
      source,
      sourceLabel,
      sourceUrl,
      sourceTitle: cleanTitle || sourceLabel
    });

    card.source = source;
    card.sourceLabel = sourceLabel;
    card.sourceUrl = sourceUrl;

    await saveVocabularyCard(card);
    this.savedWordKeys.add(this.buildSavedKey(params.word, vid, params.cue.startTime));
    this.renderUI();
  }

  private renderUI(): void {
    if (!this.mountedUI) return;

    let popupElement = undefined;
    if (this.selectedSelection) {
      const sel = this.selectedSelection;
      const context = this.primaryEngine.getSurroundingContext(sel.cue.index ?? 0);
      const vid = this.getActiveVideoId();
      const isSaved = this.savedWordKeys.has(this.buildSavedKey(sel.target, vid, sel.cue.startTime));

      const initialContextTranslation =
        sel.cue.translation ||
        (this.activeTranslatedCue &&
        Math.abs(this.activeTranslatedCue.startTime - sel.cue.startTime) < 2
          ? this.activeTranslatedCue.text
          : this.translatedEngine.getCueAt(
              (sel.cue.startTime + sel.cue.endTime) / 2,
              0
            )?.text ?? '');

      const { effectiveSource, effectiveTarget } = this.getLanguagePair();

      popupElement = createElement(WordPopup, {
        selection: sel,
        playerContainer: this.currentPlayerEl,
        videoId: vid,
        videoTitle: this.getCleanVideoTitle(),
        sourceLang: effectiveSource,
        settings: {
          ...this.settings,
          nativeLang: effectiveTarget
        },
        prevSentence: context.prevSentence,
        nextSentence: context.nextSentence,
        contextTranslation: initialContextTranslation,
        isSaved,
        onSaveCard: async (saveParams: {
          word: string;
          translation: string;
          aiExplanation: AIExplanation | null;
          contextTranslation?: string;
        }) => {
          await this.handleSaveVocabulary({
            word: saveParams.word,
            translation: saveParams.translation,
            aiExplanation: saveParams.aiExplanation,
            cue: sel.cue,
            contextTranslation: saveParams.contextTranslation
          });
        },
        onClose: (allowAutoResume = true) => this.closePopupAndResume(allowAutoResume)
      });
    }

    this.mountedUI.update({
      settings: this.settings,
      playerContainer: this.currentPlayerEl,
      isAdShowing: this.isAdShowing,
      controlsHidden: this.controlsHidden,
      subtitleBottomOffset: this.subtitleBottomOffset,
      serviceName: this.service?.name,
      trackMeta: this.trackMeta,
      availableTracks: this.availableTracks,
      systemLogs: this.systemLogs,
      cueCount: this.primaryEngine.getCues().length,
      captionRateLimitedUntil: this.captionRateLimitedUntil,
      translationStatus: this.translationStatus,
      supportsCueSeeking: this.service?.capabilities.cueSeeking !== false,
      primaryCue: this.activePrimaryCue,
      translatedCue: this.activeTranslatedCue,
      altPressed: this.altPressed,
      selectedTarget: this.selectedSelection?.target ?? null,
      popupElement,
      autoPauseCountdown: this.autoPauseCountdown,
      onResumeAutoPause: () => this.videoController?.resumeAutoPause(),
      onUpdateSettings: (partial) => {
        void this.handleUpdateSettings(partial);
      },
      onRepeatCue: () => this.handleRepeatCue(),
      onResetPosition: () => {
        void this.handleUpdateSettings({ subtitlePosition: null });
      },
      onRetryTranslation: () => this.handleRetryTranslation(),
      onOpenSettings: () => this.handleOpenSettings(),
      onSelectAvailableTrack: (url) => this.handleSelectAvailableTrack(url),
      onClearSystemLogs: () => this.handleClearSystemLogs(),
      onSelectTarget: (sel) => this.handleSelectTarget(sel)
    });
  }

  private isTranslationEnabled(s: UserSettings): boolean {
    return s.enabled && s.subtitleTrackMode !== 'original';
  }

  private resetTranslationState(cancelBg: boolean): void {
    if (cancelBg) this.cancelBackgroundTranslation();
    this.clearTranslationTimers();
    this.lastLookaheadCheckMs = 0;
    this.translationStatus = { state: 'idle' };
  }

  private applyBatchAndStatus(
    items?: Array<{ id: string; text: string }>,
    status?: TranslationRuntimeStatus
  ): void {
    if (Array.isArray(items) && items.length > 0) {
      const valid = items.filter((item) => isValidTranslationText(item.text));
      if (valid.length > 0) {
        this.primaryEngine.applyBatchTranslations(valid);
        const t = this.videoController?.getCurrentTime() ?? 0;
        const offsetSec = this.settings.subtitleOffsetSec ?? 0;
        this.activePrimaryCue = this.primaryEngine.getCueAt(t, offsetSec);
        this.activeTranslatedCue = this.hasNativeTranslatedTrack
          ? this.translatedEngine.getCueAt(t, offsetSec)
          : null;
      }
    }
    this.applyTranslationStatus(status);
    this.renderUI();
  }

  private clearTranslationTimers(): void {
    if (this.seekDebounceTimer !== null) {
      window.clearTimeout(this.seekDebounceTimer);
      this.seekDebounceTimer = null;
    }
    if (this.retryCooldownTimer !== null) {
      window.clearTimeout(this.retryCooldownTimer);
      this.retryCooldownTimer = null;
    }
  }

  private cancelBackgroundTranslation(videoIdOverride?: string): void {
    const vid = videoIdOverride ?? this.getActiveVideoId();
    if (!vid || !isExtensionContextValid()) return;
    void sendRuntimeMessage<boolean>({
      type: 'CANCEL_FREE_TRANSLATION',
      payload: { videoId: vid }
    }).catch(() => undefined);
  }

  private applyTranslationStatus(status?: TranslationRuntimeStatus): void {
    if (!status) return;
    if (this.retryCooldownTimer !== null) {
      window.clearTimeout(this.retryCooldownTimer);
      this.retryCooldownTimer = null;
    }
    const prevState = this.translationStatus.state;
    this.translationStatus = status;
    if (status.state === 'cooldown' && prevState !== 'cooldown') {
      const waitSec = status.retryAt
        ? Math.max(1, Math.ceil((status.retryAt - Date.now()) / 1000))
        : 10;
      this.pushLog('warn', `Translator cooldown (rate limit), retrying in ${waitSec}s`);
    }
    if (status.state === 'cooldown' && status.retryAt && status.retryAt > Date.now()) {
      const waitMs = Math.max(1000, status.retryAt - Date.now() + 250);
      this.retryCooldownTimer = window.setTimeout(() => {
        this.retryCooldownTimer = null;
        if (this.isDestroyed) return;
        this.translationStatus = { state: 'translating' };
        this.renderUI();
        this.triggerSubtitleTranslation(this.videoController?.getCurrentTime() ?? 0);
      }, waitMs);
    }
  }

  private handleRetryTranslation(): void {
    if (this.isDestroyed) return;
    this.clearTranslationTimers();
    this.translationStatus = { state: 'translating' };
    this.renderUI();
    this.triggerSubtitleTranslation(this.videoController?.getCurrentTime() ?? 0, true);
  }

  private hasUntranslatedInWindow(timeSec: number): boolean {
    const cues = this.primaryEngine.getCues();
    if (cues.length === 0) return false;
    const anchorIdx = Math.max(
      0,
      this.primaryEngine.findCueIndexAtOrBefore(timeSec, this.settings.subtitleOffsetSec)
    );
    const endIdx = Math.min(cues.length, anchorIdx + 16);
    for (let i = anchorIdx; i < endIdx; i++) {
      if (!isValidTranslationText(cues[i].translation)) return true;
    }
    return false;
  }

  private triggerSubtitleTranslation(priorityTimeOverride?: number, forceRetry = false): void {
    if (this.isDestroyed || !this.service) return;
    if (!isExtensionContextValid()) {
      this.destroy();
      return;
    }
    if (!this.isTranslationEnabled(this.settings) || this.hasNativeTranslatedTrack) return;
    const primaryCues = this.primaryEngine.getCues();
    if (primaryCues.length === 0) return;

    if (!primaryCues.some((c) => !isValidTranslationText(c.translation))) {
      this.applyTranslationStatus({ state: 'idle' });
      this.renderUI();
      return;
    }

    if (
      !forceRetry &&
      this.translationStatus.state === 'cooldown' &&
      (this.translationStatus.retryAt ?? 0) > Date.now()
    ) {
      return;
    }

    const requestCues = !this.service.capabilities.cueSeeking
      ? primaryCues.filter((cue) => !isValidTranslationText(cue.translation)).slice(-4)
      : primaryCues;
    if (requestCues.length === 0) return;

    const { effectiveSource, effectiveTarget } = this.getLanguagePair();
    if (
      effectiveSource !== 'auto' &&
      effectiveSource.toLowerCase() === effectiveTarget.toLowerCase()
    ) {
      this.applyTranslationStatus({ state: 'idle' });
      this.renderUI();
      return;
    }

    const offsetSec = this.settings.subtitleOffsetSec ?? 0;
    const baseTime = priorityTimeOverride ?? this.videoController?.getCurrentTime() ?? 0;

    void sendRuntimeMessage<{
      translations: Array<{ id: string; text: string }>;
      status: TranslationRuntimeStatus;
    }>({
      type: 'FREE_TRANSLATE_CUES',
      payload: {
        videoId: this.getActiveVideoId(),
        cues: requestCues.map((c) => ({
          id: c.id,
          text: c.text,
          startTime: c.startTime,
          endTime: c.endTime
        })),
        sourceLang: effectiveSource,
        targetLang: effectiveTarget,
        priorityTime: baseTime - offsetSec,
        ...(forceRetry ? { forceRetry: true } : {})
      }
    })
      .then((response) => {
        if (this.isDestroyed || !isExtensionContextValid()) return;
        if (response.ok && response.data) {
          this.applyBatchAndStatus(response.data.translations, response.data.status);
        } else if (!response.ok) {
          this.applyTranslationStatus({ state: 'cooldown', retryAt: Date.now() + 10_000 });
          this.renderUI();
        }
      })
      .catch(() => {
        if (this.isDestroyed) return;
        if (!isExtensionContextValid()) {
          this.destroy();
          return;
        }
        this.applyTranslationStatus({ state: 'cooldown', retryAt: Date.now() + 10_000 });
        this.renderUI();
      });
  }
}

export function initContentRunner(
  serviceOrServices: ServicePlugin | readonly ServicePlugin[]
): () => void {
  const runner = new ContentRunner(serviceOrServices);
  void runner.start();
  return () => runner.destroy();
}
