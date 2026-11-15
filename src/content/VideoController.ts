import type { SubtitleCue } from '../types/subtitles';

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
  isPopupOpen: () => boolean;
  hasCues: () => boolean;
  isOverlayEnabled: () => boolean;
  isAdShowing: () => boolean;
}

export class VideoController {
  private video: HTMLVideoElement | null = null;
  private rafId: number | null = null;
  private wasPlayingBeforePopup = false;
  private inspecting = false;
  private resumingProgrammatically = false;
  private autoResumeTimeoutId: number | null = null;
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
      () => this.callbacks.onAltKeyChange(false),
      { signal: controller.signal }
    );
  }

  public attach(videoElement: HTMLVideoElement | null): void {
    if (this.video === videoElement && this.rafId !== null) return;

    this.stopLoop();
    this.videoAbortController?.abort();
    this.videoAbortController = null;
    this.video = videoElement;

    if (this.video) {
      const videoCtrl = new AbortController();
      this.videoAbortController = videoCtrl;

      // If user manually resumes playback while WordPopup is open, clear wasPlayingBeforePopup
      this.video.addEventListener(
        'play',
        () => {
          if (this.inspecting && !this.resumingProgrammatically) {
            this.wasPlayingBeforePopup = false;
          }
          this.cancelAutoResume();
        },
        { signal: videoCtrl.signal }
      );

      this.video.addEventListener(
        'seeked',
        () => {
          this.cancelAutoResume();
          this.callbacks.onSeeked();
        },
        { signal: videoCtrl.signal }
      );

      this.startLoop();
    }
  }

  public scheduleAutoResume(delaySec: number): void {
    this.cancelAutoResume();
    if (delaySec <= 0) return;
    this.autoResumeTimeoutId = window.setTimeout(() => {
      this.autoResumeTimeoutId = null;
      if (this.video && this.video.paused && !this.inspecting) {
        void this.video.play().catch(() => undefined);
      }
    }, delaySec * 1000);
  }

  public cancelAutoResume(): void {
    if (this.autoResumeTimeoutId !== null) {
      window.clearTimeout(this.autoResumeTimeoutId);
      this.autoResumeTimeoutId = null;
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

  public pauseForInspection(): void {
    this.cancelAutoResume();
    if (!this.video) return;
    if (!this.inspecting) {
      this.wasPlayingBeforePopup = !this.video.paused;
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
    this.cancelAutoResume();
    this.inspecting = false;
    this.wasPlayingBeforePopup = false;
    this.resumingProgrammatically = false;
  }

  public seekToAndPlay(timeSec: number): void {
    this.cancelAutoResume();
    if (!this.video) return;
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
    this.cancelAutoResume();
    this.stopLoop();
    this.videoAbortController?.abort();
    this.videoAbortController = null;
    this.windowAbortController?.abort();
    this.windowAbortController = null;
    this.resetInspectionState();
    this.video = null;
  }

  private startLoop(): void {
    const tick = (): void => {
      if (this.video) {
        this.callbacks.onTimeUpdate(this.video.currentTime);
      }
      this.rafId = window.requestAnimationFrame(tick);
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
    const path = e.composedPath();
    const target = (path[0] ?? e.target) as HTMLElement | null;
    if (target instanceof HTMLElement) {
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

    const activeEl = document.activeElement;
    if (activeEl instanceof HTMLElement) {
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
    if (this.callbacks.isAdShowing && this.callbacks.isAdShowing()) {
      return true;
    }
    const player =
      this.video?.closest?.('.html5-video-player') ??
      document.querySelector<HTMLElement>('#movie_player, .html5-video-player');
    if (
      player &&
      (player.classList.contains('ad-showing') ||
        player.classList.contains('ad-interrupting'))
    ) {
      return true;
    }
    return false;
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
    // 1. If focus is inside input, textarea, or contentEditable -> do not intercept
    if (this.isEditableEvent(e)) return;

    // 2. Allow Escape to close WordPopup even if subtitles are inactive
    if (e.code === 'Escape' && this.callbacks.isPopupOpen()) {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.callbacks.onClosePopup();
      return;
    }

    // 3. If overlay is disabled, video has no loaded subtitles (cues.length === 0), or an ad is showing -> return
    if (!this.hasActiveSubtitles()) {
      return;
    }

    if (e.key === 'Alt') {
      this.callbacks.onAltKeyChange(true);
      return;
    }

    if (e.ctrlKey || e.metaKey || e.altKey) return;

    switch (e.code) {
      case 'KeyR': {
        const handled = this.callbacks.onRepeatCue();
        if (handled !== false) {
          e.preventDefault();
          e.stopImmediatePropagation();
        }
        break;
      }
      case 'ArrowLeft':
      case 'KeyA': {
        const handled = this.callbacks.onPreviousCue();
        if (handled !== false) {
          e.preventDefault();
          e.stopImmediatePropagation();
        }
        break;
      }
      case 'ArrowRight':
      case 'KeyD': {
        const handled = this.callbacks.onNextCue();
        if (handled !== false) {
          e.preventDefault();
          e.stopImmediatePropagation();
        }
        break;
      }
      case 'Escape':
        if (this.callbacks.isPopupOpen()) {
          e.preventDefault();
          e.stopImmediatePropagation();
          this.callbacks.onClosePopup();
        }
        break;
      case 'KeyS': {
        const handled = this.callbacks.onSaveActiveWord();
        if (handled !== false) {
          e.preventDefault();
          e.stopImmediatePropagation();
        }
        break;
      }
      case 'BracketLeft': {
        if (this.callbacks.onAdjustFontSize) {
          e.preventDefault();
          e.stopImmediatePropagation();
          this.callbacks.onAdjustFontSize(-2);
        }
        break;
      }
      case 'BracketRight': {
        if (this.callbacks.onAdjustFontSize) {
          e.preventDefault();
          e.stopImmediatePropagation();
          this.callbacks.onAdjustFontSize(+2);
        }
        break;
      }
      default:
        break;
    }
  }

  private handleKeyUp(e: KeyboardEvent): void {
    if (e.key === 'Alt') {
      this.callbacks.onAltKeyChange(false);
    }
  }
}
