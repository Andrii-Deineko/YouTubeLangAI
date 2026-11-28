import {
  DEFAULT_KEYBINDINGS,
  type KeybindingsMap,
  type SubtitleCue
} from '@langai/contracts';
import {
  isHoldKeybindRelease,
  matchesHoldKeybind,
  matchesTapKeybind
} from '../utils/keybinds';

export interface VideoControllerCallbacks {
  onTimeUpdate: (currentTimeSec: number) => void;
  onSeeked: () => void;
  onRepeatCue: () => boolean | void;
  onPreviousCue: () => boolean | void;
  onNextCue: () => boolean | void;
  onSaveActiveWord: () => boolean | void;
  onClosePopup: () => void;
  onAltKeyChange: (pressed: boolean) => void;
  onAdjustFontSize?: (delta: number) => void;
  shouldPauseOnAltHold?: () => boolean;
  isPopupOpen: () => boolean;
  hasCues: () => boolean;
  isOverlayEnabled: () => boolean;
  isAdShowing: () => boolean;
  getKeybindings?: () => KeybindingsMap;
  onCycleSubtitleMode?: () => void;
  onCycleTrackMode?: () => void;
  onToggleAutoPause?: () => void;
  onPauseTimerTick?: (remainingSec: number | null) => void;
}

export class VideoController {
  private video: HTMLVideoElement | null = null;
  private rafId: number | null = null;
  private wasPlayingBeforePopup = false;
  private inspecting = false;
  private resumingProgrammatically = false;
  private pausedByAlt = false;
  private isHoldingKey = false;
  private pauseTimerTimeoutId: number | null = null;
  private pauseTimerIntervalId: number | null = null;
  private lastReportedCountdown: number | null = null;
  private callbacks: VideoControllerCallbacks;
  private windowAbortController: AbortController | null = null;
  private videoAbortController: AbortController | null = null;

  constructor(callbacks: VideoControllerCallbacks) {
    this.callbacks = callbacks;
    this.bindWindowListeners();
  }

  private bindWindowListeners(): void {
    this.windowAbortController?.abort();
    const controller = new AbortController();
    this.windowAbortController = controller;

    window.addEventListener(
      'keydown',
      (e: KeyboardEvent) => this.handleKeyDown(e),
      { capture: true, signal: controller.signal }
    );
    window.addEventListener(
      'keyup',
      (e: KeyboardEvent) => this.handleKeyUp(e),
      { capture: true, signal: controller.signal }
    );
    window.addEventListener(
      'blur',
      () => {
        if (this.isHoldingKey) {
          this.isHoldingKey = false;
          this.callbacks.onAltKeyChange(false);
          this.handleAltRelease();
        }
      },
      { signal: controller.signal }
    );
    if (typeof document !== 'undefined') {
      document.addEventListener(
        'visibilitychange',
        () => {
          if (document.hidden) {
            this.stopLoop();
          } else {
            this.syncLoopState();
          }
        },
        { signal: controller.signal }
      );
    }
  }

  public attach(videoElement: HTMLVideoElement | null): void {
    if (this.video === videoElement) {
      this.syncLoopState();
      return;
    }

    this.stopLoop();
    this.clearPauseTimer();
    this.videoAbortController?.abort();
    this.videoAbortController = null;
    this.video = videoElement;

    if (this.video) {
      const videoCtrl = new AbortController();
      this.videoAbortController = videoCtrl;
      const attachedVideo = this.video;

      // If user manually resumes playback while WordPopup is open, clear wasPlayingBeforePopup
      attachedVideo.addEventListener(
        'play',
        () => {
          this.clearPauseTimer();
          if (this.inspecting && !this.resumingProgrammatically) {
            this.wasPlayingBeforePopup = false;
          }
          this.syncLoopState();
        },
        { signal: videoCtrl.signal }
      );

      attachedVideo.addEventListener(
        'playing',
        () => {
          this.syncLoopState();
        },
        { signal: videoCtrl.signal }
      );

      attachedVideo.addEventListener(
        'pause',
        () => {
          this.stopLoop();
        },
        { signal: videoCtrl.signal }
      );

      attachedVideo.addEventListener(
        'ended',
        () => {
          this.stopLoop();
        },
        { signal: videoCtrl.signal }
      );

      attachedVideo.addEventListener(
        'seeking',
        () => {
          this.clearPauseTimer();
        },
        { signal: videoCtrl.signal }
      );

      attachedVideo.addEventListener(
        'seeked',
        () => {
          this.callbacks.onTimeUpdate(attachedVideo.currentTime);
          this.callbacks.onSeeked();
          this.syncLoopState();
        },
        { signal: videoCtrl.signal }
      );

      attachedVideo.addEventListener(
        'timeupdate',
        () => {
          if (
            attachedVideo.paused ||
            attachedVideo.ended ||
            (typeof document !== 'undefined' && document.hidden)
          ) {
            this.callbacks.onTimeUpdate(attachedVideo.currentTime);
          }
        },
        { signal: videoCtrl.signal }
      );

      this.callbacks.onTimeUpdate(attachedVideo.currentTime);
      this.syncLoopState();
    }
  }

  public getVideo(): HTMLVideoElement | null {
    return this.video;
  }

  public getCurrentTime(): number {
    return this.video ? this.video.currentTime : 0;
  }

  public isPaused(): boolean {
    return this.video ? this.video.paused : true;
  }

  public isLoopRunning(): boolean {
    return this.rafId !== null;
  }

  public pauseForInspection(): void {
    const hadActivePauseTimer = this.pauseTimerIntervalId !== null;
    this.pausedByAlt = false;
    this.clearPauseTimer();
    if (!this.video) return;
    if (!this.inspecting) {
      this.wasPlayingBeforePopup = !this.video.paused || hadActivePauseTimer;
      this.inspecting = true;
    }
    if (!this.video.paused) {
      this.video.pause();
    }
  }

  public resumeFromInspection(allowAutoResume = true): void {
    const shouldResume =
      allowAutoResume && this.inspecting && this.wasPlayingBeforePopup;
    this.inspecting = false;
    this.wasPlayingBeforePopup = false;
    this.pausedByAlt = false;

    if (shouldResume && this.video && this.video.paused) {
      this.resumingProgrammatically = true;
      void this.video
        .play()
        .catch(() => undefined)
        .finally(() => {
          this.resumingProgrammatically = false;
        });
    }
  }

  public resetInspectionState(): void {
    this.inspecting = false;
    this.wasPlayingBeforePopup = false;
    this.resumingProgrammatically = false;
    this.pausedByAlt = false;
    this.clearPauseTimer();
  }

  public isInspectionPaused(): boolean {
    return this.inspecting;
  }

  public seekToAndPlay(timeSec: number): void {
    if (!this.video) return;
    this.clearPauseTimer();
    this.video.currentTime = Math.max(0, timeSec);
    if (this.video.paused) {
      void this.video.play().catch(() => undefined);
    }
  }

  public pauseVideo(): void {
    if (this.video && !this.video.paused) {
      this.video.pause();
    }
  }

  public schedulePauseTimer(seconds: number): void {
    this.clearPauseTimer();
    if (seconds <= 0 || !this.video) return;

    const formatRemaining = (ms: number): number => {
      if (ms <= 0) return 0;
      if (ms < 10_000) {
        return Math.max(0.1, Math.ceil(ms / 100) / 10);
      }
      return Math.max(1, Math.ceil(ms / 1000));
    };

    const deadlineMs = Date.now() + Math.round(seconds * 1000);
    const initialSec = formatRemaining(seconds * 1000);
    this.lastReportedCountdown = initialSec;
    this.callbacks.onPauseTimerTick?.(initialSec);

    const checkTick = (): void => {
      const remainingMs = deadlineMs - Date.now();
      if (remainingMs > 0) {
        const nextSec = formatRemaining(remainingMs);
        if (nextSec !== this.lastReportedCountdown) {
          this.lastReportedCountdown = nextSec;
          this.callbacks.onPauseTimerTick?.(nextSec);
        }
        return;
      }

      this.clearPauseTimer();
      if (
        this.video &&
        this.video.paused &&
        !this.inspecting &&
        !this.pausedByAlt &&
        !this.callbacks.isPopupOpen()
      ) {
        this.resumingProgrammatically = true;
        void this.video
          .play()
          .catch(() => undefined)
          .finally(() => {
            this.resumingProgrammatically = false;
          });
      }
    };

    this.pauseTimerIntervalId = window.setInterval(checkTick, 100);
  }

  public resumeAutoPause(): void {
    this.clearPauseTimer();
    if (this.video && this.video.paused) {
      this.resumingProgrammatically = true;
      void this.video
        .play()
        .catch(() => undefined)
        .finally(() => {
          this.resumingProgrammatically = false;
        });
    }
  }

  public clearPauseTimer(): void {
    if (this.pauseTimerTimeoutId !== null) {
      window.clearTimeout(this.pauseTimerTimeoutId);
      this.pauseTimerTimeoutId = null;
    }
    if (this.pauseTimerIntervalId !== null) {
      window.clearInterval(this.pauseTimerIntervalId);
      this.pauseTimerIntervalId = null;
    }
    if (this.lastReportedCountdown !== null) {
      this.lastReportedCountdown = null;
      this.callbacks.onPauseTimerTick?.(null);
    }
  }

  public jumpToCue(cue: SubtitleCue | null): void {
    if (!cue) return;
    this.seekToAndPlay(cue.startTime);
  }

  public captureFrame(): string | null {
    const video = this.video;
    if (!video || video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) {
      return null;
    }

    try {
      const canvas = document.createElement('canvas');
      canvas.width = 320;
      canvas.height = 180;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(video, 0, 0, 320, 180);
      return canvas.toDataURL('image/webp', 0.75);
    } catch {
      // SecurityError when video source is DRM-protected or cross-origin tainted
      return null;
    }
  }

  public destroy(): void {
    this.stopLoop();
    this.videoAbortController?.abort();
    this.videoAbortController = null;
    this.windowAbortController?.abort();
    this.windowAbortController = null;
    this.resetInspectionState();
    this.video = null;
  }

  private shouldRunLoop(): boolean {
    if (!this.video) return false;
    if (this.video.paused || this.video.ended) return false;
    if (typeof document !== 'undefined' && document.hidden) return false;
    return true;
  }

  private syncLoopState(): void {
    if (this.shouldRunLoop()) {
      this.startLoop();
    } else {
      this.stopLoop();
    }
  }

  private startLoop(): void {
    if (this.rafId !== null || !this.shouldRunLoop()) return;
    const tick = (): void => {
      this.rafId = null;
      if (!this.shouldRunLoop() || !this.video) {
        return;
      }
      this.callbacks.onTimeUpdate(this.video.currentTime);
      if (this.shouldRunLoop()) {
        this.rafId = window.requestAnimationFrame(tick);
      }
    };
    this.rafId = window.requestAnimationFrame(tick);
  }

  private stopLoop(): void {
    if (this.rafId !== null) {
      window.cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private isEditableEvent(e: KeyboardEvent): boolean {
    const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
    const target = (path[0] ?? e.target) as HTMLElement | null;
    if (typeof HTMLElement !== 'undefined' && target instanceof HTMLElement) {
      const tagName = target.tagName;
      if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') {
        return true;
      }
      if (target.isContentEditable) {
        return true;
      }
      if (target.closest('[contenteditable="true"], input, textarea, select')) {
        return true;
      }
    }

    const activeEl = typeof document !== 'undefined' ? document.activeElement : null;
    if (typeof HTMLElement !== 'undefined' && activeEl instanceof HTMLElement) {
      const tagName = activeEl.tagName;
      if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') {
        return true;
      }
      if (activeEl.isContentEditable) {
        return true;
      }
      if (activeEl.closest('[contenteditable="true"], input, textarea, select')) {
        return true;
      }
    }

    return false;
  }

  private isAdPlaying(): boolean {
    return Boolean(this.callbacks.isAdShowing?.());
  }

  private hasActiveSubtitles(): boolean {
    if (this.callbacks.isOverlayEnabled && !this.callbacks.isOverlayEnabled()) {
      return false;
    }
    if (this.isAdPlaying()) {
      return false;
    }
    if (this.callbacks.hasCues && !this.callbacks.hasCues()) {
      return false;
    }
    return true;
  }

  private handleKeyDown(e: KeyboardEvent): void {
    if (e.repeat) return;
    if (this.isEditableEvent(e)) return;

    if (e.code === 'Escape' && this.callbacks.isPopupOpen()) {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.callbacks.onClosePopup();
      return;
    }

    const keybindings = this.callbacks.getKeybindings
      ? this.callbacks.getKeybindings()
      : DEFAULT_KEYBINDINGS;

    const holdBind = keybindings.holdPeekAndPause;
    if (holdBind && matchesHoldKeybind(e, holdBind)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.isHoldingKey = true;
      this.callbacks.onAltKeyChange(true);

      const isOverlay = this.callbacks.isOverlayEnabled ? this.callbacks.isOverlayEnabled() : true;
      if (!isOverlay || this.isAdPlaying()) {
        return;
      }

      const shouldPause = this.callbacks.shouldPauseOnAltHold
        ? this.callbacks.shouldPauseOnAltHold()
        : true;

      if (shouldPause && this.video && !this.video.paused && !this.video.ended) {
        this.pausedByAlt = true;
        this.video.pause();
      } else {
        this.pausedByAlt = false;
      }
      return;
    }

    if (!this.hasActiveSubtitles()) {
      return;
    }

    if (keybindings.repeatCue && matchesTapKeybind(e, keybindings.repeatCue)) {
      const handled = this.callbacks.onRepeatCue();
      if (handled !== false) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
      return;
    }

    if (keybindings.prevCue && matchesTapKeybind(e, keybindings.prevCue)) {
      const handled = this.callbacks.onPreviousCue();
      if (handled !== false) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
      return;
    }

    if (keybindings.nextCue && matchesTapKeybind(e, keybindings.nextCue)) {
      const handled = this.callbacks.onNextCue();
      if (handled !== false) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
      return;
    }

    if (keybindings.cycleSubtitleMode && matchesTapKeybind(e, keybindings.cycleSubtitleMode)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.callbacks.onCycleSubtitleMode?.();
      return;
    }

    if (keybindings.cycleTrackMode && matchesTapKeybind(e, keybindings.cycleTrackMode)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.callbacks.onCycleTrackMode?.();
      return;
    }

    if (keybindings.toggleAutoPause && matchesTapKeybind(e, keybindings.toggleAutoPause)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.callbacks.onToggleAutoPause?.();
      return;
    }

    if (keybindings.quickSaveCard && matchesTapKeybind(e, keybindings.quickSaveCard)) {
      const handled = this.callbacks.onSaveActiveWord();
      if (handled !== false) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    }
  }

  private handleKeyUp(e: KeyboardEvent): void {
    const keybindings = this.callbacks.getKeybindings
      ? this.callbacks.getKeybindings()
      : DEFAULT_KEYBINDINGS;
    const holdBind = keybindings.holdPeekAndPause;
    if (this.isHoldingKey && holdBind && isHoldKeybindRelease(e, holdBind)) {
      this.isHoldingKey = false;
      this.callbacks.onAltKeyChange(false);
      this.handleAltRelease();
    }
  }

  private handleAltRelease(): void {
    if (this.pausedByAlt) {
      const isPopupOpen = this.inspecting || this.callbacks.isPopupOpen();
      if (!isPopupOpen && this.video && this.video.paused) {
        this.resumingProgrammatically = true;
        void this.video
          .play()
          .catch(() => undefined)
          .finally(() => {
            this.resumingProgrammatically = false;
          });
      }
      this.pausedByAlt = false;
    }
  }
}
