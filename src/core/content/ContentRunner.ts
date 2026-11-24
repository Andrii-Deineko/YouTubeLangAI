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
import type { UserSettings } from '../types/settings';
import { DEFAULT_SETTINGS } from '../types/settings';
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
  private isAdShowing = false;
  private altPressed = false;
  private activePrimaryCue: SubtitleCue | null = null;
  private activeTranslatedCue: SubtitleCue | null = null;
  private selectedSelection: WordSelectionPayload | null = null;
  private lastAutoPausedCueId: string | null = null;
  private savedWordKeys = new Set<string>();
  private captionRateLimitedUntil = 0;

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
          batchTranslations?: Array<{ id: string; text: string }>;
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
        if (data.primaryCues) {
          this.primaryEngine.loadCues(data.primaryCues);
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
      },
      onSeeked: () => {
        this.lastAutoPausedCueId = null;
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
      isAdShowing: () => this.isAdShowing
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

    // If native translated track has cues, machine translation is not needed
    if (this.translatedEngine.getCues().length > 0) return;

    // If all primary cues already have translation, nothing to do
    const needsTranslation = primaryCues.some((c) => !c.translation);
    if (!needsTranslation) return;

    const videoId = this.trackMeta?.videoId || window.location.hostname;
    const targetLang = this.settings.nativeLang || 'ru';
    const sourceLang = this.trackMeta?.lang ?? 'auto';

    // 1. Check local cache first: free_sub_tr:${videoId}:${targetLang}
    const cacheKey = `free_sub_tr:${videoId}:${targetLang}`;
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

          const allCovered = primaryCues.every((c) => cached.translations?.[c.id]);
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
    const untranslated = primaryCues.filter((c) => !c.translation);
    if (untranslated.length === 0) return;

    const curTime = this.videoController?.getCurrentTime() ?? 0;
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
        priorityTime: curTime
      }
    };

    chrome.runtime.sendMessage(request, (response: FreeTranslateCuesResponse | undefined) => {
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
