import { createElement } from 'react';
import type { PlatformAdapter } from '../../adapters/types';
import { SubtitleEngine } from '../engine/SubtitleEngine';
import { VideoController } from '../engine/VideoController';
import { createNewCard } from '../storage/cardFactory';
import {
  getSettings,
  getVocabulary,
  onSettingsChanged,
  saveSettings,
  saveVocabularyCard
} from '../storage/storage';
import type {
  ActiveListeningMode,
  SubtitleTrackMode,
  UserSettings
} from '../types/settings';
import { DEFAULT_KEYBINDINGS, DEFAULT_SETTINGS } from '../types/settings';
import type { SubtitleCue, TrackMetadata } from '../types/subtitles';
import type { AIExplanation } from '../types/vocabulary';
import type {
  FreeTranslateCuesResponse,
  QuickTranslateResponse,
  RuntimeRequest,
  TranslationRuntimeStatus
} from '../types/messages';
import { isValidTranslationText, normalizeSubtitleForHash } from '../utils/translationCache';
import { mountShadowUI, type MountedShadowUI } from './mountShadowUI';
import { WordPopup } from '../components/WordPopup';
import type { WordSelectionPayload } from '../components/SubtitleOverlay';

export class ContentRunner {
  private adapter: PlatformAdapter;
  private primaryEngine = new SubtitleEngine();
  private translatedEngine = new SubtitleEngine();
  private settings: UserSettings = { ...DEFAULT_SETTINGS };
  private trackMeta: TrackMetadata | null = null;
  private isAdShowing = false;
  private altPressed = false;
  private activePrimaryCue: SubtitleCue | null = null;
  private activeTranslatedCue: SubtitleCue | null = null;
  private selectedSelection: WordSelectionPayload | null = null;
  private lastAutoPausedCueId: string | null = null;
  private savedWordKeys = new Set<string>();
  private captionRateLimitedUntil = 0;
  private hasNativeTranslatedTrack = false;
  private translationStatus: TranslationRuntimeStatus = { state: 'idle' };
  private hotRequestInFlight = false;
  private pendingPrioritySeekTime: number | null = null;
  private lastLookaheadCheckMs = 0;
  private seekDebounceTimer: number | null = null;
  private retryCooldownTimer: number | null = null;

  private mountedUI: MountedShadowUI | null = null;
  private currentPlayerEl: HTMLElement | null = null;
  private videoController: VideoController | null = null;
  private adapterTeardown: (() => void) | null = null;
  private unsubscribeSettings: (() => void) | null = null;
  private domObserver: MutationObserver | null = null;
  private runtimeMessageListener: ((message: unknown) => void) | null = null;
  private navFinishListener: (() => void) | null = null;
  private isDestroyed = false;

  constructor(adapter: PlatformAdapter) {
    this.adapter = adapter;
  }

  async start(): Promise<void> {
    this.settings = await getSettings();

    try {
      const vocab = await getVocabulary();
      for (const card of vocab) {
        this.savedWordKeys.add(
          this.buildSavedKey(card.word, card.videoId || '', card.timestampSec || 0)
        );
      }
    } catch {
      // Ignore
    }

    this.unsubscribeSettings = onSettingsChanged((newSettings) => {
      const prevNativeLang = this.settings.nativeLang;
      const prevShowTrans =
        this.settings.subtitleTrackMode
          ? this.settings.subtitleTrackMode !== 'original'
          : (this.settings.showTranslation ?? this.settings.showDualSubtitles);
      this.settings = newSettings;
      const nextShowTrans =
        newSettings.subtitleTrackMode
          ? newSettings.subtitleTrackMode !== 'original'
          : (newSettings.showTranslation ?? newSettings.showDualSubtitles);

      if (newSettings.nativeLang !== prevNativeLang) {
        this.cancelBackgroundTranslation();
        this.clearTranslationTimers();
        this.hasNativeTranslatedTrack = false;
        this.hotRequestInFlight = false;
        this.pendingPrioritySeekTime = null;
        this.translationStatus = { state: 'idle' };
        this.primaryEngine.clearTranslations();
        this.translatedEngine.clear();
        this.triggerSubtitleTranslation();
      } else if (!prevShowTrans && nextShowTrans) {
        this.triggerSubtitleTranslation();
      } else if (prevShowTrans && (!nextShowTrans || !newSettings.enabled)) {
        this.cancelBackgroundTranslation();
        this.clearTranslationTimers();
        this.hotRequestInFlight = false;
        this.pendingPrioritySeekTime = null;
        this.translationStatus = { state: 'idle' };
      }

      this.syncNativeCaptions();
      this.renderUI();
    });

    this.runtimeMessageListener = (message: unknown) => {
      if (!message || typeof message !== 'object') return;
      const msg = message as {
        type?: string;
        payload?: {
          videoId?: string;
          targetLang?: string;
          batchTranslations?: Array<{ id: string; text: string }>;
          status?: TranslationRuntimeStatus;
        };
      };
      if (msg.type === 'FREE_TRANSLATE_CUES_BATCH' && msg.payload) {
        const vid = this.trackMeta?.videoId || window.location.hostname;
        const targetVid = msg.payload.videoId;
        const activeTargetLang = this.settings.nativeLang || 'ru';
        const isSameLang = !msg.payload.targetLang || msg.payload.targetLang === activeTargetLang;
        if (
          isSameLang &&
          (targetVid === vid ||
            (vid && targetVid && (targetVid.includes(vid) || vid.includes(targetVid))))
        ) {
          if (
            Array.isArray(msg.payload.batchTranslations) &&
            msg.payload.batchTranslations.length > 0
          ) {
            const validBatch = msg.payload.batchTranslations.filter((item) =>
              isValidTranslationText(item.text)
            );
            if (validBatch.length > 0) {
              this.primaryEngine.applyTranslations(validBatch);
              this.translatedEngine.setTranslatedCuesFromBatch(
                validBatch,
                this.primaryEngine.getCues()
              );
              const curTime = this.videoController?.getCurrentTime() ?? 0;
              this.activePrimaryCue = this.primaryEngine.findActiveCue(curTime);
              this.activeTranslatedCue = this.translatedEngine.findActiveCue(curTime);
            }
          }
          if (msg.payload.status) {
            this.applyTranslationStatus(msg.payload.status);
          }
          this.renderUI();
        }
      }
    };
    if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
      chrome.runtime.onMessage.addListener(this.runtimeMessageListener);
    }

    this.adapterTeardown = this.adapter.init({
      onTracksLoaded: (data) => {
        if (data.primaryCues) {
          const prevVid = this.trackMeta?.videoId;
          const nextVid = data.primaryMeta?.videoId;
          if (prevVid && nextVid && prevVid !== nextVid) {
            this.cancelBackgroundTranslation(prevVid);
          }
          if (!prevVid || prevVid !== nextVid) {
            this.hasNativeTranslatedTrack = false;
            this.translatedEngine.clear();
          }
          this.clearTranslationTimers();
          this.hotRequestInFlight = false;
          this.pendingPrioritySeekTime = null;
          this.lastLookaheadCheckMs = 0;
          this.translationStatus = { state: 'idle' };

          this.primaryEngine.loadCues(data.primaryCues);
          this.trackMeta = data.primaryMeta ?? null;
          this.activePrimaryCue = this.primaryEngine.findActiveCue(
            this.videoController?.getCurrentTime() ?? 0
          );
        }
        if (data.translatedCues) {
          if (data.translatedCues.length > 0) {
            this.hasNativeTranslatedTrack = true;
            this.translationStatus = { state: 'idle' };
            this.clearTranslationTimers();
            this.cancelBackgroundTranslation();
          }
          this.translatedEngine.loadCues(data.translatedCues);
          this.activeTranslatedCue = this.translatedEngine.findActiveCue(
            this.videoController?.getCurrentTime() ?? 0
          );
        }
        if (data.rateLimitedUntil !== undefined) {
          this.captionRateLimitedUntil = data.rateLimitedUntil;
        }

        this.syncNativeCaptions();
        this.attachToPlayer();
        this.renderUI();

        this.triggerSubtitleTranslation();
      },
      onAdStateChange: (isAd) => {
        this.isAdShowing = isAd;
        this.syncNativeCaptions();
        this.renderUI();
      },
      onVideoElementChange: (video) => {
        if (video && this.videoController) {
          this.videoController.attach(video);
        }
      }
    });

    this.attachToPlayer();
    this.setupDomObserver();

    this.navFinishListener = () => {
      this.videoController?.clearPauseTimer();
      this.closePopupAndResume(false);
      if (this.trackMeta?.videoId && !window.location.href.includes(this.trackMeta.videoId)) {
        this.cancelBackgroundTranslation(this.trackMeta.videoId);
        this.clearTranslationTimers();
      }
    };
    window.addEventListener('yt-navigate-finish', this.navFinishListener);
  }

  destroy(): void {
    this.isDestroyed = true;
    this.clearTranslationTimers();
    this.cancelBackgroundTranslation();
    if (this.navFinishListener) {
      window.removeEventListener('yt-navigate-finish', this.navFinishListener);
      this.navFinishListener = null;
    }
    if (this.runtimeMessageListener && typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
      chrome.runtime.onMessage.removeListener(this.runtimeMessageListener);
      this.runtimeMessageListener = null;
    }
    this.adapterTeardown?.();
    this.unsubscribeSettings?.();
    this.domObserver?.disconnect();
    this.videoController?.destroy();
    this.mountedUI?.unmount();
    this.adapter.suppressNativeSubtitles?.(false);
  }

  private buildSavedKey(word: string, videoId: string, cueStartSec: number): string {
    return `${videoId}:${word.trim().toLowerCase()}:${Math.floor(cueStartSec)}`;
  }

  private setupDomObserver(): void {
    let pending = false;
    this.domObserver = new MutationObserver(() => {
      if (pending || this.isDestroyed) return;
      pending = true;
      window.requestAnimationFrame(() => {
        pending = false;
        const playerEl = this.adapter.findPlayerContainer();
        if (playerEl && (!this.mountedUI || !playerEl.contains(this.mountedUI.host))) {
          this.attachToPlayer();
        } else if (playerEl && this.videoController && !this.videoController.getVideo()) {
          const videoEl = this.adapter.findVideoElement();
          if (videoEl) this.videoController.attach(videoEl);
        }
      });
    });

    const rootTarget = this.adapter.findPlayerContainer() || document.body;
    this.domObserver.observe(rootTarget, { childList: true, subtree: true });
  }

  private createVideoController(): VideoController {
    return new VideoController({
      onTimeUpdate: (timeSec: number) => {
        if (!this.settings.enabled || this.isAdShowing || !this.videoController) return;

        const isTranslationVisible =
          this.settings.subtitleTrackMode !== 'original' &&
          (this.settings.showTranslation ?? this.settings.showDualSubtitles ?? true);
        const nextPrimary = this.primaryEngine.findActiveCue(timeSec);
        const nextTranslated = isTranslationVisible
          ? this.translatedEngine.findActiveCue(timeSec)
          : null;

        if (
          this.settings.autoPauseAfterCue &&
          this.activePrimaryCue &&
          !this.videoController.isPaused() &&
          this.lastAutoPausedCueId !== this.activePrimaryCue.id &&
          timeSec >= this.activePrimaryCue.endTime - 0.05
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
          !this.hotRequestInFlight &&
          nowMs - this.lastLookaheadCheckMs > 3500
        ) {
          const cooldownExpired =
            this.translationStatus.state !== 'cooldown' ||
            (this.translationStatus.retryAt ?? 0) <= nowMs;
          if (cooldownExpired && this.hasMissingCuesNear(timeSec, 35)) {
            this.lastLookaheadCheckMs = nowMs;
            this.triggerSubtitleTranslation(timeSec);
          }
        }
      },
      onSeeked: () => {
        this.lastAutoPausedCueId = null;
        this.lastLookaheadCheckMs = 0;

        if (this.seekDebounceTimer !== null) {
          window.clearTimeout(this.seekDebounceTimer);
          this.seekDebounceTimer = null;
        }

        const isTranslationVisible =
          this.settings.enabled &&
          this.settings.subtitleTrackMode !== 'original' &&
          (this.settings.showTranslation ?? this.settings.showDualSubtitles ?? true);
        if (!isTranslationVisible || this.hasNativeTranslatedTrack) return;

        this.seekDebounceTimer = window.setTimeout(() => {
          this.seekDebounceTimer = null;
          if (this.isDestroyed) return;
          const curTime = this.videoController?.getCurrentTime() ?? 0;
          if (this.hasMissingCuesInHotWindow(curTime)) {
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
      onToggleAutoPause: () => this.handleToggleAutoPause()
    });
  }

  private attachToPlayer(): void {
    const playerEl = this.adapter.findPlayerContainer();
    if (!playerEl) return;

    if (!this.videoController) {
      this.videoController = this.createVideoController();
    }

    const videoEl = this.adapter.findVideoElement();
    if (videoEl) {
      this.videoController.attach(videoEl);
    }

    if (this.currentPlayerEl !== playerEl || !this.mountedUI || !playerEl.contains(this.mountedUI.host)) {
      this.mountedUI?.unmount();
      this.currentPlayerEl = playerEl;

      const hostId = this.adapter.id === 'youtube' ? 'yt-lang-ai-root' : 'cinelingua-ui-root';
      this.mountedUI = mountShadowUI(
        playerEl,
        {
          settings: this.settings,
          isAdShowing: this.isAdShowing,
          trackMeta: this.trackMeta,
          cueCount: this.primaryEngine.getCues().length,
          captionRateLimitedUntil: this.captionRateLimitedUntil,
          translationStatus: this.translationStatus,
          primaryCue: this.activePrimaryCue,
          translatedCue: this.activeTranslatedCue,
          altPressed: this.altPressed,
          selectedTarget: this.selectedSelection?.target ?? null,
          onUpdateSettings: (partial) => {
            void this.handleUpdateSettings(partial);
          },
          onRepeatCue: () => this.handleRepeatCue(),
          onResetPosition: () => {
            void this.handleUpdateSettings({ subtitlePosition: null });
          },
          onRetryTranslation: () => this.handleRetryTranslation(),
          onSelectTarget: (sel) => this.handleSelectTarget(sel)
        },
        hostId
      );

      this.renderUI();
    }
  }

  private syncNativeCaptions(): void {
    const shouldHide =
      this.settings.enabled &&
      !this.isAdShowing &&
      this.primaryEngine.getCues().length > 0;
    this.adapter.suppressNativeSubtitles?.(shouldHide);
  }

  private handleRepeatCue(): void {
    if (!this.videoController) return;
    const time = this.videoController.getCurrentTime();
    const cue = this.primaryEngine.findActiveCue(time);
    if (cue) {
      this.lastAutoPausedCueId = null;
      this.videoController.jumpToCue(cue);
    }
  }

  private handlePreviousCue(): boolean {
    if (!this.videoController) return false;
    const time = this.videoController.getCurrentTime();
    const prev = this.primaryEngine.getPreviousCue(time);
    if (prev) {
      this.lastAutoPausedCueId = null;
      this.videoController.jumpToCue(prev);
      return true;
    }
    return false;
  }

  private handleNextCue(): boolean {
    if (!this.videoController) return false;
    const time = this.videoController.getCurrentTime();
    const next = this.primaryEngine.getNextCue(time);
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
    void this.handleUpdateSettings({
      subtitleTrackMode: nextMode,
      showTranslation: nextMode !== 'original',
      showDualSubtitles: nextMode === 'dual'
    });
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
      targetCue.tokens.find((t) => t.isWord)?.text ??
      '';
    if (!targetWord) return false;

    void (async () => {
      let translation = targetWord;
      try {
        const res = await this.sendRuntimeQuickTranslate(
          targetWord,
          this.trackMeta?.lang ?? 'auto',
          this.settings.nativeLang
        );
        if (res.ok) {
          translation = res.data.translation;
        }
      } catch {
        // Fallback
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
    this.videoController?.clearPauseTimer();
    this.videoController?.pauseForInspection();
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

  private async handleUpdateSettings(partial: Partial<UserSettings>): Promise<void> {
    const prevNativeLang = this.settings.nativeLang;
    const prevEnabled = this.settings.enabled;
    const prevTransEnabled =
      this.settings.subtitleTrackMode !== 'original' &&
      (this.settings.showTranslation ?? this.settings.showDualSubtitles ?? true);

    this.settings = await saveSettings(partial);

    const nextTransEnabled =
      this.settings.subtitleTrackMode !== 'original' &&
      (this.settings.showTranslation ?? this.settings.showDualSubtitles ?? true);
    const nativeLangChanged = this.settings.nativeLang !== prevNativeLang;
    const translationJustEnabled =
      (!prevTransEnabled && nextTransEnabled) || (!prevEnabled && this.settings.enabled);
    const translationDisabled =
      (prevTransEnabled && !nextTransEnabled) || (prevEnabled && !this.settings.enabled);

    if (nativeLangChanged) {
      this.cancelBackgroundTranslation();
      this.clearTranslationTimers();
      this.hasNativeTranslatedTrack = false;
      this.hotRequestInFlight = false;
      this.pendingPrioritySeekTime = null;
      this.translationStatus = { state: 'idle' };
      this.primaryEngine.clearTranslations();
      this.translatedEngine.clear();
    } else if (translationDisabled) {
      this.cancelBackgroundTranslation();
      this.clearTranslationTimers();
      this.hotRequestInFlight = false;
      this.pendingPrioritySeekTime = null;
      this.translationStatus = { state: 'idle' };
    }

    if (
      (nativeLangChanged || translationJustEnabled) &&
      nextTransEnabled &&
      this.settings.enabled &&
      this.trackMeta &&
      !this.hasNativeTranslatedTrack &&
      this.trackMeta.lang !== this.settings.nativeLang
    ) {
      this.adapter.requestTranslatedTrack?.(this.settings.nativeLang);
    }
    if ((nativeLangChanged || translationJustEnabled) && nextTransEnabled && this.settings.enabled) {
      this.triggerSubtitleTranslation();
    }
    this.syncNativeCaptions();
    this.renderUI();
  }

  private async handleSaveVocabulary(params: {
    word: string;
    translation: string;
    aiExplanation: AIExplanation | null;
    cue: SubtitleCue;
    contextTranslation?: string;
  }): Promise<void> {
    const vid = this.trackMeta?.videoId || window.location.hostname;
    let screenshotBase64 = this.videoController?.captureFrame() ?? null;
    if (!screenshotBase64 && this.adapter.captureFrame && this.videoController?.getVideo()) {
      try {
        screenshotBase64 = await this.adapter.captureFrame(this.videoController.getVideo()!);
      } catch {
        // Ignore
      }
    }

    const translatedMatch =
      params.contextTranslation ||
      params.cue.translation ||
      (this.activeTranslatedCue &&
      Math.abs(this.activeTranslatedCue.startTime - params.cue.startTime) < 2
        ? this.activeTranslatedCue.text
        : this.translatedEngine.findActiveCue((params.cue.startTime + params.cue.endTime) / 2)?.text ??
          '');

    const card = createNewCard({
      word: params.word,
      lemma: params.aiExplanation?.lemma ?? params.word,
      translation: params.translation,
      aiExplanation: params.aiExplanation,
      contextSentence: params.cue.text,
      contextTranslation: translatedMatch,
      videoId: vid,
      videoTitle: document.title || (this.adapter.id === 'youtube' ? 'YouTube Video' : 'Cinema Stream'),
      timestampSec: params.cue.startTime,
      screenshotBase64,
      sourceLang: this.trackMeta?.lang ?? 'auto',
      nativeLang: this.settings.nativeLang,
      source: this.adapter.id === 'youtube' ? 'youtube' : 'cinema',
      sourceTitle: document.title || (this.adapter.id === 'youtube' ? 'YouTube' : 'Кино')
    });

    await saveVocabularyCard(card);
    this.savedWordKeys.add(this.buildSavedKey(params.word, vid, params.cue.startTime));
    this.renderUI();
  }

  private sendRuntimeQuickTranslate(
    text: string,
    sourceLang: string,
    nativeLang: string
  ): Promise<QuickTranslateResponse> {
    return new Promise((resolve, reject) => {
      const request: RuntimeRequest = {
        type: 'QUICK_TRANSLATE',
        payload: { text, sourceLang, nativeLang }
      };
      chrome.runtime.sendMessage(request, (response: QuickTranslateResponse | undefined) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!response) {
          reject(new Error('Empty response from service worker'));
          return;
        }
        resolve(response);
      });
    });
  }

  private renderUI(): void {
    if (!this.mountedUI) return;

    let popupElement = undefined;
    if (this.selectedSelection) {
      const sel = this.selectedSelection;
      const context = this.primaryEngine.getSurroundingContext(sel.cue.index ?? 0);
      const vid = this.trackMeta?.videoId || window.location.hostname;
      const isSaved = this.savedWordKeys.has(this.buildSavedKey(sel.target, vid, sel.cue.startTime));

      const initialContextTranslation =
        sel.cue.translation ||
        (this.activeTranslatedCue &&
        Math.abs(this.activeTranslatedCue.startTime - sel.cue.startTime) < 2
          ? this.activeTranslatedCue.text
          : this.translatedEngine.findActiveCue((sel.cue.startTime + sel.cue.endTime) / 2)?.text ??
            '');

      popupElement = createElement(WordPopup, {
        selection: sel,
        playerRect: this.currentPlayerEl?.getBoundingClientRect() ?? null,
        videoId: vid,
        videoTitle: document.title || 'Video',
        sourceLang: this.trackMeta?.lang ?? 'auto',
        settings: this.settings,
        prevSentence: context.prevSentence,
        nextSentence: context.nextSentence,
        contextTranslation: initialContextTranslation,
        isSaved,
        onSaveCard: async ({ word, translation, aiExplanation, contextTranslation }) => {
          await this.handleSaveVocabulary({
            word,
            translation,
            aiExplanation,
            cue: sel.cue,
            contextTranslation
          });
        },
        onClose: (allowAutoResume = true) => this.closePopupAndResume(allowAutoResume)
      });
    }

    this.mountedUI.update({
      settings: this.settings,
      isAdShowing: this.isAdShowing,
      trackMeta: this.trackMeta,
      cueCount: this.primaryEngine.getCues().length,
      captionRateLimitedUntil: this.captionRateLimitedUntil,
      translationStatus: this.translationStatus,
      primaryCue: this.activePrimaryCue,
      translatedCue: this.activeTranslatedCue,
      altPressed: this.altPressed,
      selectedTarget: this.selectedSelection?.target ?? null,
      popupElement,
      onUpdateSettings: (partial) => {
        void this.handleUpdateSettings(partial);
      },
      onRepeatCue: () => this.handleRepeatCue(),
      onResetPosition: () => {
        void this.handleUpdateSettings({ subtitlePosition: null });
      },
      onRetryTranslation: () => this.handleRetryTranslation(),
      onSelectTarget: (sel) => this.handleSelectTarget(sel)
    });
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
    const vid = videoIdOverride ?? this.trackMeta?.videoId ?? window.location.hostname;
    if (!vid || typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return;
    const req: RuntimeRequest = {
      type: 'CANCEL_FREE_TRANSLATION',
      payload: { videoId: vid }
    };
    try {
      chrome.runtime.sendMessage(req, () => {
        void chrome.runtime.lastError;
      });
    } catch {
      // Ignore invalidated context
    }
  }

  private applyTranslationStatus(status: TranslationRuntimeStatus | undefined): void {
    if (!status) return;
    if (status.state === 'cooldown' && status.retryAt && status.retryAt > Date.now()) {
      this.translationStatus = status;
      if (this.retryCooldownTimer !== null) {
        window.clearTimeout(this.retryCooldownTimer);
      }
      const waitMs = Math.max(1000, status.retryAt - Date.now() + 250);
      this.retryCooldownTimer = window.setTimeout(() => {
        this.retryCooldownTimer = null;
        if (this.isDestroyed) return;
        this.translationStatus = { state: 'translating' };
        this.renderUI();
        this.triggerSubtitleTranslation(this.videoController?.getCurrentTime() ?? 0);
      }, waitMs);
      return;
    }

    if (status.state === 'idle' || status.state === 'translating') {
      if (this.retryCooldownTimer !== null) {
        window.clearTimeout(this.retryCooldownTimer);
        this.retryCooldownTimer = null;
      }
      this.translationStatus = status;
    }
  }

  private handleRetryTranslation(): void {
    if (this.isDestroyed) return;
    if (this.retryCooldownTimer !== null) {
      window.clearTimeout(this.retryCooldownTimer);
      this.retryCooldownTimer = null;
    }
    this.translationStatus = { state: 'translating' };
    this.renderUI();
    this.triggerSubtitleTranslation(this.videoController?.getCurrentTime() ?? 0, {
      forceRetry: true
    });
  }

  private hasMissingCuesInHotWindow(timeSec: number): boolean {
    const cues = this.primaryEngine.getCues();
    if (cues.length === 0) return false;

    const anchorIdx = Math.max(0, this.primaryEngine.findCueIndexAtOrBefore(timeSec));
    const endIdx = Math.min(cues.length, anchorIdx + 16);
    for (let i = anchorIdx; i < endIdx; i++) {
      if (!isValidTranslationText(cues[i].translation)) {
        return true;
      }
    }
    return false;
  }

  private hasMissingCuesNear(timeSec: number, lookaheadSec: number): boolean {
    const cues = this.primaryEngine.getCues();
    if (cues.length === 0) return false;
    const minT = Math.max(0, timeSec - 1);
    const maxT = timeSec + lookaheadSec;
    for (let i = 0; i < cues.length; i++) {
      const c = cues[i];
      if (c.endTime < minT) continue;
      if (c.startTime > maxT) break;
      if (!isValidTranslationText(c.translation)) {
        return true;
      }
    }
    return false;
  }

  private fillRepeatedCueTranslations(): void {
    const cues = this.primaryEngine.getCues();
    const map = new Map<string, string>();
    for (const c of cues) {
      if (isValidTranslationText(c.translation)) {
        const norm = normalizeSubtitleForHash(c.text);
        if (norm && !map.has(norm)) {
          map.set(norm, c.translation);
        }
      }
    }
    if (map.size === 0) return;

    const matched: Array<{ id: string; text: string }> = [];
    for (const c of cues) {
      if (isValidTranslationText(c.translation)) continue;
      const norm = normalizeSubtitleForHash(c.text);
      const existing = norm ? map.get(norm) : undefined;
      if (existing) {
        matched.push({ id: c.id, text: existing });
      }
    }
    if (matched.length > 0) {
      this.primaryEngine.applyTranslations(matched);
      this.translatedEngine.setTranslatedCuesFromBatch(matched, this.primaryEngine.getCues());
    }
  }

  private triggerSubtitleTranslation(
    priorityTimeOverride?: number,
    options?: { forceRetry?: boolean }
  ): void {
    const isTranslationEnabled =
      this.settings.enabled &&
      this.settings.subtitleTrackMode !== 'original' &&
      (this.settings.showTranslation ?? this.settings.showDualSubtitles ?? true);
    if (!isTranslationEnabled) return;

    const primaryCues = this.primaryEngine.getCues();
    if (primaryCues.length === 0) return;

    // Native translated track provided by the platform takes precedence
    if (this.hasNativeTranslatedTrack) return;

    this.fillRepeatedCueTranslations();

    const needsTranslation = primaryCues.some((c) => !isValidTranslationText(c.translation));
    if (!needsTranslation) {
      this.applyTranslationStatus({ state: 'idle' });
      this.renderUI();
      return;
    }

    const curTime = priorityTimeOverride ?? this.videoController?.getCurrentTime() ?? 0;

    if (
      !options?.forceRetry &&
      this.translationStatus.state === 'cooldown' &&
      (this.translationStatus.retryAt ?? 0) > Date.now()
    ) {
      return;
    }

    if (this.hotRequestInFlight && !options?.forceRetry) {
      this.pendingPrioritySeekTime = curTime;
      return;
    }

    const videoId = this.trackMeta?.videoId || window.location.hostname;
    const targetLang = this.settings.nativeLang || 'ru';
    const sourceLang = this.trackMeta?.lang ?? 'auto';
    this.requestBackgroundTranslation(videoId, sourceLang, targetLang, curTime, options?.forceRetry);
  }

  private requestBackgroundTranslation(
    videoId: string,
    sourceLang: string,
    targetLang: string,
    priorityTime: number,
    forceRetry?: boolean
  ): void {
    const primaryCues = this.primaryEngine.getCues();
    if (primaryCues.length === 0) return;

    this.hotRequestInFlight = true;
    const request: RuntimeRequest = {
      type: 'FREE_TRANSLATE_CUES',
      payload: {
        videoId,
        cues: primaryCues.map((c) => ({
          id: c.id,
          text: c.text,
          startTime: c.startTime,
          endTime: c.endTime
        })),
        sourceLang,
        targetLang,
        priorityTime,
        ...(forceRetry ? { forceRetry: true } : {})
      }
    };

    chrome.runtime.sendMessage(request, (response: FreeTranslateCuesResponse | undefined) => {
      this.hotRequestInFlight = false;
      if (this.isDestroyed) return;

      if (!chrome.runtime.lastError && response && response.ok && response.data) {
        const list = response.data.translations;
        if (Array.isArray(list) && list.length > 0) {
          const validList = list.filter((item) => isValidTranslationText(item.text));
          if (validList.length > 0) {
            this.primaryEngine.applyTranslations(validList);
            this.translatedEngine.setTranslatedCuesFromBatch(
              validList,
              this.primaryEngine.getCues()
            );
            const t = this.videoController?.getCurrentTime() ?? 0;
            this.activePrimaryCue = this.primaryEngine.findActiveCue(t);
            this.activeTranslatedCue = this.translatedEngine.findActiveCue(t);
          }
        }
        this.applyTranslationStatus(response.data.status);
        this.renderUI();
      } else if (chrome.runtime.lastError) {
        this.applyTranslationStatus({
          state: 'cooldown',
          provider: 'none',
          retryAt: Date.now() + 10_000
        });
        this.renderUI();
      }

      if (this.pendingPrioritySeekTime !== null) {
        const nextSeekTime = this.pendingPrioritySeekTime;
        this.pendingPrioritySeekTime = null;
        this.triggerSubtitleTranslation(nextSeekTime);
      }
    });
  }
}

export function initContentRunner(adapter: PlatformAdapter): () => void {
  const runner = new ContentRunner(adapter);
  void runner.start();
  return () => runner.destroy();
}
