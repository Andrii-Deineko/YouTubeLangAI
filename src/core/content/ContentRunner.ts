import { createElement } from 'react';
import type { CapturedTrackData, PlatformAdapter } from '../../adapters/types';
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
  RuntimeRequest
} from '../types/messages';
import { mountShadowUI, type MountedShadowUI } from './mountShadowUI';
import { WordPopup } from '../components/WordPopup';
import type { WordSelectionPayload } from '../components/SubtitleOverlay';

export class ContentRunner {
  private adapter: PlatformAdapter;
  private primaryEngine = new SubtitleEngine();
  private translatedEngine = new SubtitleEngine();
  private settings: UserSettings = { ...DEFAULT_SETTINGS };
  private trackMeta: TrackMetadata | null = null;
  private translatedVideoId = '';
  private isAdShowing = false;
  private altPressed = false;
  private activePrimaryCue: SubtitleCue | null = null;
  private activeTranslatedCue: SubtitleCue | null = null;
  private selectedSelection: WordSelectionPayload | null = null;
  private lastAutoPausedCueId: string | null = null;
  private savedWordKeys = new Set<string>();
  private captionRateLimitedUntil = 0;
  private pendingLiveTrackData: CapturedTrackData | null = null;
  private pendingTranslationCueIds = new Set<string>();
  private lastTranslationWindowCenter = Number.NEGATIVE_INFINITY;

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
      const prevTranslationProvider = this.settings.translationProvider;
      const prevMyMemoryEmail = this.settings.myMemoryEmail;
      const prevDeepLApiKey = this.settings.deeplApiKey;
      const prevShowTrans =
        this.settings.subtitleTrackMode
          ? this.settings.subtitleTrackMode !== 'original'
          : (this.settings.showTranslation ?? this.settings.showDualSubtitles);
      this.settings = newSettings;
      const nextShowTrans =
        newSettings.subtitleTrackMode
          ? newSettings.subtitleTrackMode !== 'original'
          : (newSettings.showTranslation ?? newSettings.showDualSubtitles);

      if (
        newSettings.nativeLang !== prevNativeLang ||
        newSettings.translationProvider !== prevTranslationProvider ||
        newSettings.myMemoryEmail !== prevMyMemoryEmail ||
        newSettings.deeplApiKey !== prevDeepLApiKey
      ) {
        this.pendingTranslationCueIds.clear();
        this.lastTranslationWindowCenter = Number.NEGATIVE_INFINITY;
        this.primaryEngine.clearTranslations();
        this.translatedEngine.clear();
        this.triggerSubtitleTranslation();
      } else if (!prevShowTrans && nextShowTrans) {
        this.triggerSubtitleTranslation();
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
          batchTranslations?: Array<{ id: string; text: string; errorProvider?: string }>;
        };
      };
      if (msg.type === 'FREE_TRANSLATE_CUES_BATCH' && msg.payload) {
        const vid = this.trackMeta?.videoId || window.location.hostname;
        const targetVid = msg.payload.videoId;
        if (
          targetVid === vid ||
          (vid && targetVid && (targetVid.includes(vid) || vid.includes(targetVid)))
        ) {
          if (
            Array.isArray(msg.payload.batchTranslations) &&
            msg.payload.batchTranslations.length > 0
          ) {
            this.primaryEngine.applyTranslations(msg.payload.batchTranslations);
            this.translatedEngine.setTranslatedCuesFromBatch(
              msg.payload.batchTranslations,
              this.primaryEngine.getCues()
            );
            const curTime = this.videoController?.getCurrentTime() ?? 0;
            this.activePrimaryCue = this.primaryEngine.findActiveCue(curTime);
            this.activeTranslatedCue = this.translatedEngine.findActiveCue(curTime);
            this.renderUI();
          }
        }
      }
    };
    if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
      chrome.runtime.onMessage.addListener(this.runtimeMessageListener);
    }

    this.adapterTeardown = this.adapter.init({
      onTracksLoaded: (data) => {
        this.handleTracksLoaded(data);
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
    };
    window.addEventListener('yt-navigate-finish', this.navFinishListener);
  }

  destroy(): void {
    this.isDestroyed = true;
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

  private handleTracksLoaded(data: CapturedTrackData): void {
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

  private applyTrackData(data: CapturedTrackData): void {
    if (data.primaryCues) {
      const nextVideoId = data.primaryMeta?.videoId ?? '';
      if (nextVideoId && nextVideoId !== this.translatedVideoId) {
        this.translatedVideoId = nextVideoId;
        this.pendingTranslationCueIds.clear();
        this.lastTranslationWindowCenter = Number.NEGATIVE_INFINITY;
        this.translatedEngine.clear();
        this.activeTranslatedCue = null;
      }

      const preservedTranslations = this.primaryEngine
        .getCues()
        .filter((cue) => Boolean(cue.translation))
        .map((cue) => ({ id: cue.id, text: cue.translation ?? '' }));
      this.primaryEngine.loadCues(data.primaryCues);
      this.primaryEngine.applyTranslations(preservedTranslations);
      this.trackMeta = data.primaryMeta ?? null;
      this.activePrimaryCue = this.primaryEngine.findActiveCue(
        this.videoController?.getCurrentTime() ?? 0
      );
    }
    if (data.translatedCues) {
      this.translatedEngine.loadCues(data.translatedCues);
      this.activeTranslatedCue = this.translatedEngine.findActiveCue(
        this.videoController?.getCurrentTime() ?? 0
      );
    } else if (data.primaryCues) {
      // Netflix emits an empty caption to close the current cue. The primary cue
      // timing changes there, but no new translation batch is produced — sync the
      // generated translations so they disappear together with the original line.
      this.translatedEngine.syncGeneratedCueTimings(this.primaryEngine.getCues());
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
    if (!data.skipTranslation) {
      this.triggerSubtitleTranslation();
    }
  }

  private createVideoController(): VideoController {
    return new VideoController({
      onTimeUpdate: (timeSec: number) => {
        if (!this.settings.enabled || this.isAdShowing || !this.videoController) return;

        if (this.pendingLiveTrackData && !this.videoController.isPaused()) {
          const pending = this.pendingLiveTrackData;
          this.pendingLiveTrackData = null;
          this.applyTrackData(pending);
        }

        const isTranslationVisible =
          this.settings.subtitleTrackMode !== 'original' &&
          (this.settings.showTranslation ?? this.settings.showDualSubtitles ?? true);
        const nextPrimary = this.primaryEngine.findActiveCue(timeSec);
        // Match by cue id instead of time: a time-based search can land on the
        // previous cue (or on a native track with slightly shifted timings) and
        // make the translation line jump or flicker when a new replica starts.
        const generatedCue = nextPrimary
          ? this.translatedEngine.getGeneratedCue(nextPrimary.id)
          : null;
        const nextTranslated = isTranslationVisible
          ? generatedCue ??
            (nextPrimary && this.translatedEngine.hasNativeCues()
              ? this.translatedEngine.findActiveCue(timeSec)
              : null)
          : null;

        if (
          this.settings.autoPauseAfterCue &&
          this.adapter.id !== 'netflix' &&
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

        if (
          isTranslationVisible &&
          this.trackMeta &&
          !this.translatedEngine.hasNativeCues() &&
          Math.abs(timeSec - this.lastTranslationWindowCenter) >= 60
        ) {
          this.lastTranslationWindowCenter = timeSec;
          this.requestBackgroundTranslation(
            this.trackMeta?.videoId || window.location.hostname,
            this.trackMeta?.lang ?? 'auto',
            this.settings.nativeLang || 'ru'
          );
        }
      },
      onSeeked: () => {
        this.lastAutoPausedCueId = null;
        this.pendingLiveTrackData = null;
        this.lastTranslationWindowCenter = Number.NEGATIVE_INFINITY;
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
          supportsCueSeeking: this.adapter.supportsCueSeeking !== false,
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
    if (this.adapter.supportsCueSeeking === false) return;
    if (!this.videoController) return;
    const time = this.videoController.getCurrentTime();
    const cue = this.primaryEngine.findActiveCue(time);
    if (cue) {
      this.lastAutoPausedCueId = null;
      this.videoController.jumpToCue(cue);
    }
  }

  private handlePreviousCue(): boolean {
    if (this.adapter.supportsCueSeeking === false) return false;
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
    if (this.adapter.supportsCueSeeking === false) return false;
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
        if (
          res.ok &&
          !res.data.translationUnavailable &&
          Boolean(res.data.translation.trim())
        ) {
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
    this.settings = await saveSettings(partial);
    const isTransEnabled =
      this.settings.subtitleTrackMode !== 'original' &&
      (this.settings.showTranslation ?? this.settings.showDualSubtitles ?? true);
    if (
      isTransEnabled &&
      this.trackMeta &&
      this.translatedEngine.getCues().length === 0 &&
      this.trackMeta.lang !== this.settings.nativeLang
    ) {
      this.adapter.requestTranslatedTrack?.(this.settings.nativeLang);
    }
    if (isTransEnabled) {
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
      supportsCueSeeking: this.adapter.supportsCueSeeking !== false,
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
      onSelectTarget: (sel) => this.handleSelectTarget(sel)
    });
  }

  private triggerSubtitleTranslation(): void {
    const isTranslationEnabled =
      this.settings.subtitleTrackMode !== 'original' &&
      (this.settings.showTranslation ?? this.settings.showDualSubtitles ?? true);
    if (!isTranslationEnabled) return;

    const primaryCues = this.primaryEngine.getCues();
    if (primaryCues.length === 0) return;

    // Only a real native translated track makes machine translation unnecessary.
    // Generated cues use the `tr-` prefix — without this distinction Netflix stops
    // translating after the very first batch, because translatedEngine is never
    // empty again once those generated cues were added.
    if (this.translatedEngine.hasNativeCues()) return;

    // If all primary cues already have translation, nothing to do
    const needsTranslation = primaryCues.some((c) => !c.translation);
    if (!needsTranslation) return;

    const videoId = this.trackMeta?.videoId || window.location.hostname;
    const targetLang = this.settings.nativeLang || 'ru';
    const sourceLang = this.trackMeta?.lang ?? 'auto';

    // 1. Check local cache first: free_sub_tr:${videoId}:${targetLang}
    const cacheKey = `free_sub_tr:${this.settings.translationProvider}:${videoId}:${targetLang}`;
    if (typeof chrome !== 'undefined' && chrome.storage?.local && videoId && videoId !== 'unknown') {
      chrome.storage.local.get(cacheKey, (res) => {
        if (this.isDestroyed) return;
        const cached = res?.[cacheKey] as
          | { savedAt?: number; translations?: Record<string, string> }
          | undefined;

        if (cached && cached.translations) {
          const batch = Object.entries(cached.translations).map(([id, text]) => ({ id, text }));
          if (batch.length > 0) {
            this.primaryEngine.applyTranslations(batch);
            this.translatedEngine.setTranslatedCuesFromBatch(batch, this.primaryEngine.getCues());
            const curTime = this.videoController?.getCurrentTime() ?? 0;
            this.activePrimaryCue = this.primaryEngine.findActiveCue(curTime);
            this.activeTranslatedCue = this.translatedEngine.findActiveCue(curTime);
            this.renderUI();
          }

          // Netflix keeps appending cues while this async storage read is pending,
          // so check against the current cue set instead of the captured one.
          const currentCues = this.primaryEngine.getCues();
          const allCovered = currentCues.every((c) => cached.translations?.[c.id]);
          if (allCovered) return;
        }

        // 2. Request background translation for missing cues
        this.requestBackgroundTranslation(videoId, sourceLang, targetLang);
      });
    } else {
      this.requestBackgroundTranslation(videoId, sourceLang, targetLang);
    }
  }

  private requestBackgroundTranslation(
    videoId: string,
    sourceLang: string,
    targetLang: string
  ): void {
    const primaryCues = this.primaryEngine.getCues();
    const currentTime = this.videoController?.getCurrentTime() ?? 0;
    const windowStart = Math.max(0, currentTime - 30);
    const windowEnd = currentTime + 180;
    const untranslated = primaryCues
      .filter(
        (cue) =>
          !cue.translation &&
          !this.pendingTranslationCueIds.has(cue.id) &&
          cue.endTime >= windowStart &&
          cue.startTime <= windowEnd
      )
      .slice(0, 50);
    if (untranslated.length === 0) return;

    for (const cue of untranslated) this.pendingTranslationCueIds.add(cue.id);
    const request: RuntimeRequest = {
      type: 'FREE_TRANSLATE_CUES',
      payload: {
        videoId,
        // Only ask for cues that still need a translation. Re-sending every cue on
        // each Netflix caption change produced repeated progress batches and
        // unnecessary MyMemory requests.
        cues: untranslated.map((c) => ({
          id: c.id,
          text: c.text,
          startTime: c.startTime,
          endTime: c.endTime
        })),
        sourceLang,
        targetLang,
        priorityTime: currentTime
      }
    };

    chrome.runtime.sendMessage(request, (response: FreeTranslateCuesResponse | undefined) => {
      for (const cue of untranslated) this.pendingTranslationCueIds.delete(cue.id);
      if (this.isDestroyed || chrome.runtime.lastError || !response || !response.ok) return;
      if (Array.isArray(response.data) && response.data.length > 0) {
        this.primaryEngine.applyTranslations(response.data);
        this.translatedEngine.setTranslatedCuesFromBatch(response.data, this.primaryEngine.getCues());
        const t = this.videoController?.getCurrentTime() ?? 0;
        this.activePrimaryCue = this.primaryEngine.findActiveCue(t);
        this.activeTranslatedCue = this.translatedEngine.findActiveCue(t);
        this.renderUI();
      }
    });
  }
}

export function initContentRunner(adapter: PlatformAdapter): () => void {
  const runner = new ContentRunner(adapter);
  void runner.start();
  return () => runner.destroy();
}
