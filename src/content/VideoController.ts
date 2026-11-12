import type { SubtitleCue } from '../types/subtitles';

export interface VideoControllerCallbacks {
  onTimeUpdate: (currentTimeSec: number) => void;
  onSeeked: () => void;
  onRepeatCue: () => void;
  onPreviousCue: () => void;
  onNextCue: () => void;
  onSaveActiveWord: () => void;
  onClosePopup: () => void;
  onAltKeyChange: (pressed: boolean) => void;
  isPopupOpen: () => boolean;
}

export class VideoController {
  private video: HTMLVideoElement | null = null;
  private rafId: number | null = null;
  private wasPlayingBeforePopup = false;
  private inspecting = false;
  private resumingProgrammatically = false;
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
        },
        { signal: videoCtrl.signal }
      );

      this.video.addEventListener(
        'seeked',
        () => {
          this.callbacks.onSeeked();
        },
        { signal: videoCtrl.signal }
      );

      this.startLoop();
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
    this.inspecting = false;
    this.wasPlayingBeforePopup = false;
    this.resumingProgrammatically = false;
  }

  public seekToAndPlay(timeSec: number): void {
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
    if (!target || !(target instanceof HTMLElement)) return false;

    const tagName = target.tagName;
    if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') {
      return true;
    }
    if (target.isContentEditable) {
      return true;
    }
    return Boolean(target.closest('[contenteditable="true"], input, textarea'));
  }

  private handleKeyDown(e: KeyboardEvent): void {
    if (this.isEditableEvent(e)) return;

    if (e.key === 'Alt') {
      this.callbacks.onAltKeyChange(true);
      return;
    }

    if (e.ctrlKey || e.metaKey || e.altKey) return;

    switch (e.code) {
      case 'KeyR':
        e.preventDefault();
        e.stopImmediatePropagation();
        this.callbacks.onRepeatCue();
        break;
      case 'ArrowLeft':
      case 'KeyA':
        e.preventDefault();
        e.stopImmediatePropagation();
        this.callbacks.onPreviousCue();
        break;
      case 'ArrowRight':
      case 'KeyD':
        e.preventDefault();
        e.stopImmediatePropagation();
        this.callbacks.onNextCue();
        break;
      case 'Escape':
        if (this.callbacks.isPopupOpen()) {
          e.preventDefault();
          e.stopImmediatePropagation();
          this.callbacks.onClosePopup();
        }
        break;
      case 'KeyS':
        e.preventDefault();
        e.stopImmediatePropagation();
        this.callbacks.onSaveActiveWord();
        break;
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
