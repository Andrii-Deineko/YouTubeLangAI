import { createElement } from 'react';
import {
  ISOLATED_MESSAGE_SOURCE,
  MAIN_MESSAGE_SOURCE,
  type IsolatedToMainMessage,
  type MainToIsolatedMessage,
  type QuickTranslateResponse,
  type RuntimeRequest,
  type TrackCapturedPayload
} from '../types/messages';
import { DEFAULT_SETTINGS, type UserSettings } from '../types/settings';
import type { SubtitleCue, TrackMetadata } from '../types/subtitles';
import type { AIExplanation } from '../types/vocabulary';
import { setCachedSubtitles } from '../shared/db';
import { createNewCard } from '../shared/srs';
import {
  getSettings,
  getVocabulary,
  onSettingsChanged,
  saveSettings,
  saveVocabularyCard
} from '../shared/storage';
import { getVideoContextFromUrl } from '../shared/youtube';
import { SubtitleEngine } from './SubtitleEngine';
import { VideoController } from './VideoController';
import { mountShadowUI, type MountedShadowUI } from './mountShadowUI';
import type { WordSelectionPayload } from './components/SubtitleOverlay';
import { WordPopup } from './components/WordPopup';

console.log('[YT-Lang-AI] Content script loaded');

const NATIVE_CAPTIONS_STYLE_ID = 'yt-lang-ai-hide-native-captions';

const primaryEngine = new SubtitleEngine();
const translatedEngine = new SubtitleEngine();

let settings: UserSettings = { ...DEFAULT_SETTINGS };
let currentVideoId = '';
let currentIsShorts = false;
let trackMeta: TrackMetadata | null = null;
let isAdShowing = false;
let altPressed = false;
let activePrimaryCue: SubtitleCue | null = null;
let activeTranslatedCue: SubtitleCue | null = null;
let selectedSelection: WordSelectionPayload | null = null;
let lastAutoPausedCueId: string | null = null;
let savedWordKeys = new Set<string>();

const preloadedTracksMap = new Map<string, TrackCapturedPayload>();
const preloadedTranslatedMap = new Map<string, TrackCapturedPayload>();

let mountedUI: MountedShadowUI | null = null;
let currentPlayerEl: HTMLElement | null = null;
let videoController: VideoController | null = null;
let sessionAbortController: AbortController | null = null;
let adObserver: MutationObserver | null = null;
let domObserver: MutationObserver | null = null;
let translationRequestedForVideo = '';

function postToMain(message: IsolatedToMainMessage): void {
  window.postMessage(message, '*');
}

function requestLatestTrackFromMain(): void {
  const vid = currentVideoId || getVideoIdFromUrl() || 'unknown';
  console.log('[YT-Lang-AI] Requesting latest track from MAIN world for videoId:', vid);
  postToMain({
    source: ISOLATED_MESSAGE_SOURCE,
    type: 'GET_LATEST_TRACK',
    videoId: vid,
    payload: { videoId: vid }
  });
}

function getVideoIdFromUrl(): string {
  return getVideoContextFromUrl().videoId;
}

function getVideoTitle(): string {
  const titleEl =
    document.querySelector<HTMLElement>('h1.ytd-watch-metadata yt-formatted-string') ??
    document.querySelector<HTMLElement>('ytd-reel-video-renderer[is-active] .title') ??
    document.querySelector<HTMLElement>('ytd-reel-video-renderer[is-active] h2') ??
    document.querySelector<HTMLElement>('#title h1');
  const domTitle = titleEl?.textContent?.trim();
  if (domTitle) return domTitle;
  return document.title.replace(/\s*-\s*YouTube$/, '').trim() || 'YouTube Video';
}

function buildSavedKey(word: string, videoId: string, cueStartSec: number): string {
  return `${videoId}:${word.trim().toLowerCase()}:${Math.floor(cueStartSec)}`;
}

function findPlayerContainer(): HTMLElement | null {
  if (currentIsShorts) {
    return (
      document.querySelector<HTMLElement>(
        'ytd-reel-video-renderer[is-active] #shorts-player'
      ) ??
      document.querySelector<HTMLElement>(
        'ytd-reel-video-renderer[is-active] .html5-video-player'
      )
    );
  }
  return document.querySelector<HTMLElement>('#movie_player');
}

function findVideoElement(playerEl: HTMLElement | null): HTMLVideoElement | null {
  if (currentIsShorts) {
    if (playerEl) {
      const v = playerEl.querySelector<HTMLVideoElement>('video');
      if (v) return v;
    }
    return document.querySelector<HTMLVideoElement>(
      'ytd-reel-video-renderer[is-active] video'
    );
  }
  if (playerEl) {
    return (
      playerEl.querySelector<HTMLVideoElement>('video.html5-main-video') ??
      playerEl.querySelector<HTMLVideoElement>('video')
    );
  }
  return (
    document.querySelector<HTMLVideoElement>('#movie_player video.html5-main-video') ??
    document.querySelector<HTMLVideoElement>('#movie_player video')
  );
}

function syncNativeCaptionsVisibility(): void {
  const shouldHide = settings.enabled && !isAdShowing && primaryEngine.getCues().length > 0;
  const existing = document.getElementById(NATIVE_CAPTIONS_STYLE_ID);

  if (shouldHide && !existing) {
    const style = document.createElement('style');
    style.id = NATIVE_CAPTIONS_STYLE_ID;
    style.textContent = '.ytp-caption-window-container { display: none !important; }';
    (document.head ?? document.documentElement).appendChild(style);
  } else if (!shouldHide && existing) {
    existing.remove();
  }
}

async function handleSaveVocabulary(params: {
  word: string;
  translation: string;
  aiExplanation: AIExplanation | null;
  cue: SubtitleCue;
}): Promise<void> {
  const vid = currentVideoId || getVideoIdFromUrl() || 'unknown';
  const screenshotBase64 = videoController?.captureFrame() ?? null;
  const translatedMatch =
    activeTranslatedCue &&
    Math.abs(activeTranslatedCue.startTime - params.cue.startTime) < 2
      ? activeTranslatedCue.text
      : translatedEngine.findActiveCue((params.cue.startTime + params.cue.endTime) / 2)?.text ??
        '';

  const card = createNewCard({
    word: params.word,
    lemma: params.aiExplanation?.lemma ?? params.word,
    translation: params.translation,
    aiExplanation: params.aiExplanation,
    contextSentence: params.cue.text,
    contextTranslation: translatedMatch,
    videoId: vid,
    videoTitle: getVideoTitle(),
    timestampSec: params.cue.startTime,
    screenshotBase64,
    sourceLang: trackMeta?.lang ?? 'auto',
    nativeLang: settings.nativeLang,
    isShorts: currentIsShorts
  });

  await saveVocabularyCard(card);
  savedWordKeys.add(buildSavedKey(params.word, vid, params.cue.startTime));
  renderUI();
}

function sendRuntimeQuickTranslate(
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

function renderUI(): void {
  if (!mountedUI) return;

  let popupElement = undefined;
  if (selectedSelection) {
    const sel = selectedSelection;
    const context = primaryEngine.getSurroundingContext(sel.cue.index);
    const vid = currentVideoId || getVideoIdFromUrl();
    const isSaved = savedWordKeys.has(buildSavedKey(sel.target, vid, sel.cue.startTime));

    popupElement = createElement(WordPopup, {
      selection: sel,
      playerRect: currentPlayerEl?.getBoundingClientRect() ?? null,
      videoId: vid,
      videoTitle: getVideoTitle(),
      sourceLang: trackMeta?.lang ?? 'auto',
      settings,
      isShorts: currentIsShorts,
      prevSentence: context.prevSentence,
      nextSentence: context.nextSentence,
      isSaved,
      onSaveCard: async ({ word, translation, aiExplanation }) => {
        await handleSaveVocabulary({
          word,
          translation,
          aiExplanation,
          cue: sel.cue
        });
      },
      onClose: (allowAutoResume = true) => closePopupAndResume(allowAutoResume)
    });
  }

  mountedUI.update({
    settings,
    isAdShowing,
    isShorts: currentIsShorts,
    trackMeta,
    cueCount: primaryEngine.getCues().length,
    primaryCue: activePrimaryCue,
    translatedCue: activeTranslatedCue,
    altPressed,
    selectedTarget: selectedSelection?.target ?? null,
    popupElement,
    onUpdateSettings: (partial) => {
      void handleUpdateSettings(partial);
    },
    onRepeatCue: () => handleRepeatCue(),
    onSelectTarget: (selection) => handleSelectTarget(selection)
  });
}

async function handleUpdateSettings(partial: Partial<UserSettings>): Promise<void> {
  if (
    partial.autoPauseAfterCue === false ||
    partial.autoPauseResumeDelaySec === null ||
    partial.enabled === false
  ) {
    videoController?.cancelAutoResume();
  }
  settings = await saveSettings(partial);
  if (
    partial.showDualSubtitles &&
    trackMeta &&
    translatedEngine.getCues().length === 0 &&
    trackMeta.lang !== settings.nativeLang
  ) {
    requestTranslatedTrackIfNeeded();
  }
  syncNativeCaptionsVisibility();
  renderUI();
}

function requestTranslatedTrackIfNeeded(): void {
  if (!settings.enabled || !settings.showDualSubtitles) return;
  if (!trackMeta) return;
  const vid = trackMeta.videoId || currentVideoId;
  if (!vid) return;
  if (trackMeta.lang.toLowerCase() === settings.nativeLang.toLowerCase()) return;
  const key = `${vid}:${settings.nativeLang}`;
  if (translationRequestedForVideo === key) return;
  translationRequestedForVideo = key;

  postToMain({
    source: ISOLATED_MESSAGE_SOURCE,
    type: 'REQUEST_TRANSLATED_TRACK',
    payload: {
      nativeLang: settings.nativeLang,
      videoId: vid
    }
  });
}

function closePopupAndResume(allowAutoResume = true): void {
  if (!selectedSelection) return;
  selectedSelection = null;
  videoController?.resumeFromInspection(allowAutoResume);
  renderUI();
}

function handleSelectTarget(selection: WordSelectionPayload): void {
  selectedSelection = selection;
  if (settings.autoPauseOnWordClick) {
    videoController?.pauseForInspection();
  }
  renderUI();
}

function handleRepeatCue(): boolean {
  if (!videoController) return false;
  videoController.cancelAutoResume();
  const time = videoController.getCurrentTime();
  const cue =
    activePrimaryCue ??
    primaryEngine.findActiveCue(time) ??
    primaryEngine.getPreviousCue(time);
  if (cue) {
    lastAutoPausedCueId = null;
    videoController.jumpToCue(cue);
    return true;
  }
  return false;
}

function handlePreviousCue(): boolean {
  if (!videoController) return false;
  videoController.cancelAutoResume();
  const time = videoController.getCurrentTime();
  const prev = primaryEngine.getPreviousCue(time);
  if (prev) {
    lastAutoPausedCueId = null;
    videoController.jumpToCue(prev);
    return true;
  }
  return false;
}

function handleNextCue(): boolean {
  if (!videoController) return false;
  videoController.cancelAutoResume();
  const time = videoController.getCurrentTime();
  const next = primaryEngine.getNextCue(time);
  if (next) {
    lastAutoPausedCueId = null;
    videoController.jumpToCue(next);
    return true;
  }
  return false;
}

function handleQuickSaveShortcut(): boolean {
  const targetCue = selectedSelection?.cue ?? activePrimaryCue;
  if (!targetCue) return false;

  const targetWord =
    selectedSelection?.target ??
    targetCue.tokens.find((t) => t.isWord)?.text ??
    '';
  if (!targetWord) return false;

  void (async () => {
    let translation = targetWord;
    try {
      const res = await sendRuntimeQuickTranslate(
        targetWord,
        trackMeta?.lang ?? 'auto',
        settings.nativeLang
      );
      if (res.ok) {
        translation = res.data.translation;
      }
    } catch {
      // Fallback to raw targetWord if offline
    }

    await handleSaveVocabulary({
      word: targetWord,
      translation,
      aiExplanation: null,
      cue: targetCue
    });
  })();

  return true;
}

function createVideoController(): VideoController {
  return new VideoController({
    onTimeUpdate: (timeSec: number) => {
      if (!settings.enabled || isAdShowing || !videoController) return;

      const nextPrimary = primaryEngine.findActiveCue(timeSec);
      const nextTranslated = settings.showDualSubtitles
        ? translatedEngine.findActiveCue(timeSec)
        : null;

      if (
        settings.autoPauseAfterCue &&
        activePrimaryCue &&
        !videoController.isPaused() &&
        lastAutoPausedCueId !== activePrimaryCue.id &&
        timeSec >= activePrimaryCue.endTime - 0.05
      ) {
        lastAutoPausedCueId = activePrimaryCue.id;
        videoController.pauseVideo();
        if (
          typeof settings.autoPauseResumeDelaySec === 'number' &&
          settings.autoPauseResumeDelaySec > 0
        ) {
          videoController.scheduleAutoResume(settings.autoPauseResumeDelaySec);
        }
      }

      if (
        nextPrimary?.id !== activePrimaryCue?.id ||
        nextTranslated?.id !== activeTranslatedCue?.id
      ) {
        if (nextPrimary && nextPrimary.id !== activePrimaryCue?.id) {
          console.debug('[YT-Lang-AI] Active cue changed:', {
            timeSec: timeSec.toFixed(2),
            cueId: nextPrimary.id,
            text: nextPrimary.text
          });
        }
        activePrimaryCue = nextPrimary;
        activeTranslatedCue = nextTranslated;
        if (nextPrimary && nextPrimary.id !== lastAutoPausedCueId) {
          lastAutoPausedCueId = null;
        }
        renderUI();
      }
    },
    onSeeked: () => {
      lastAutoPausedCueId = null;
    },
    onLoopRewind: () => {
      lastAutoPausedCueId = null;
    },
    onRepeatCue: handleRepeatCue,
    onPreviousCue: handlePreviousCue,
    onNextCue: handleNextCue,
    onSaveActiveWord: handleQuickSaveShortcut,
    onClosePopup: () => closePopupAndResume(true),
    onAdjustFontSize: (delta: number) => {
      const current = settings.subtitleFontSize ?? 20;
      const next = Math.min(56, Math.max(14, current + delta));
      if (next !== current) {
        void handleUpdateSettings({ subtitleFontSize: next });
      }
    },
    onAltKeyChange: (pressed: boolean) => {
      if (altPressed !== pressed) {
        altPressed = pressed;
        renderUI();
      }
    },
    isPopupOpen: () => selectedSelection !== null,
    hasCues: () => primaryEngine.getCues().length > 0,
    isOverlayEnabled: () => settings.enabled,
    isAdShowing: () => isAdShowing
  });
}

function checkAdState(playerEl: HTMLElement): void {
  const nextAd =
    playerEl.classList.contains('ad-showing') ||
    playerEl.classList.contains('ad-interrupting');
  if (nextAd !== isAdShowing) {
    isAdShowing = nextAd;
    syncNativeCaptionsVisibility();
    renderUI();
  }
}

function attachToPlayer(): void {
  const playerEl = findPlayerContainer();
  if (!playerEl) {
    console.debug('[YT-Lang-AI] attachToPlayer: player container not found', {
      isShorts: currentIsShorts,
      videoId: currentVideoId
    });
    return;
  }

  const videoEl = findVideoElement(playerEl);
  if (!videoController) {
    videoController = createVideoController();
  }
  if (videoEl) {
    videoController.attach(videoEl);
  }

  const isHostDetached = !mountedUI || !playerEl.contains(mountedUI.host);
  if (currentPlayerEl !== playerEl || isHostDetached) {
    mountedUI?.unmount();
    adObserver?.disconnect();

    currentPlayerEl = playerEl;
    checkAdState(playerEl);

    adObserver = new MutationObserver(() => checkAdState(playerEl));
    adObserver.observe(playerEl, {
      attributes: true,
      attributeFilter: ['class']
    });

    mountedUI = mountShadowUI(playerEl, {
      settings,
      isAdShowing,
      isShorts: currentIsShorts,
      trackMeta,
      cueCount: primaryEngine.getCues().length,
      primaryCue: activePrimaryCue,
      translatedCue: activeTranslatedCue,
      altPressed,
      selectedTarget: selectedSelection?.target ?? null,
      onUpdateSettings: (partial) => {
        void handleUpdateSettings(partial);
      },
      onRepeatCue: handleRepeatCue,
      onSelectTarget: handleSelectTarget
    });

    const hostRect = mountedUI.host.getBoundingClientRect();
    const playerRect = playerEl.getBoundingClientRect();
    console.debug('[YT-Lang-AI] Shadow Host mounted:', {
      hostInPlayer: playerEl.contains(mountedUI.host),
      hostWidth: hostRect.width,
      hostHeight: hostRect.height,
      playerWidth: playerRect.width,
      playerHeight: playerRect.height,
      isShorts: currentIsShorts
    });
  }
}

function teardownPlayerSession(): void {
  sessionAbortController?.abort();
  sessionAbortController = null;
  adObserver?.disconnect();
  adObserver = null;
  domObserver?.disconnect();
  domObserver = null;
  videoController?.destroy();
  videoController = null;
  mountedUI?.unmount();
  mountedUI = null;
  currentPlayerEl = null;
}

function applyCapturedTrack(payload: TrackCapturedPayload): void {
  primaryEngine.loadJson3(payload.data, payload.kind);
  trackMeta = {
    videoId: payload.videoId,
    lang: payload.lang,
    tlang: payload.tlang,
    kind: payload.kind,
    isAsr: primaryEngine.getIsAsr(),
    url: payload.url
  };
  const cueCount = primaryEngine.getCues().length;
  console.log('[YT-Lang-AI] Primary track loaded into SubtitleEngine:', {
    videoId: payload.videoId,
    lang: payload.lang,
    cueCount,
    isAsr: primaryEngine.getIsAsr()
  });

  activePrimaryCue = primaryEngine.findActiveCue(videoController?.getCurrentTime() ?? 0);
  syncNativeCaptionsVisibility();
  attachToPlayer();
  renderUI();
  requestTranslatedTrackIfNeeded();
}

function applyCapturedTranslatedTrack(payload: TrackCapturedPayload): void {
  translatedEngine.loadJson3(payload.data, payload.kind);
  const cueCount = translatedEngine.getCues().length;
  console.log('[YT-Lang-AI] Translated track loaded into SubtitleEngine:', {
    videoId: payload.videoId,
    lang: payload.lang,
    cueCount
  });
  activeTranslatedCue = translatedEngine.findActiveCue(
    videoController?.getCurrentTime() ?? 0
  );
  renderUI();
}

function checkAndHandleVideoChange(): void {
  const { videoId: nextId, isShorts: nextIsShorts } = getVideoContextFromUrl();
  const playerEl = findPlayerContainer();
  const isPlayerContainerChanged = playerEl !== null && playerEl !== currentPlayerEl;

  if (nextId !== currentVideoId || nextIsShorts !== currentIsShorts) {
    currentVideoId = nextId;
    currentIsShorts = nextIsShorts;
    resetVideoState();

    if (nextId) {
      const preloaded = preloadedTracksMap.get(nextId);
      if (preloaded) {
        applyCapturedTrack(preloaded);
        const preloadedTrans = preloadedTranslatedMap.get(nextId);
        if (preloadedTrans) {
          applyCapturedTranslatedTrack(preloadedTrans);
        }
      }

      postToMain({
        source: ISOLATED_MESSAGE_SOURCE,
        type: 'NAVIGATED',
        payload: { videoId: nextId }
      });
    }

    startPlayerSession();
    requestLatestTrackFromMain();
  } else if (isPlayerContainerChanged) {
    attachToPlayer();
  }
}

function startPlayerSession(): void {
  teardownPlayerSession();
  sessionAbortController = new AbortController();
  videoController = createVideoController();
  attachToPlayer();

  const playerEl = findPlayerContainer();
  const videoEl = findVideoElement(playerEl);

  console.log('[YT-Lang-AI] Init on URL:', {
    url: window.location.href,
    videoId: currentVideoId,
    isShorts: currentIsShorts,
    hasPlayerContainer: Boolean(playerEl),
    hasVideo: Boolean(videoEl)
  });

  if (currentIsShorts) {
    domObserver = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (
          m.type === 'attributes' &&
          m.attributeName === 'is-active' &&
          m.target instanceof HTMLElement &&
          m.target.tagName.toLowerCase() === 'ytd-reel-video-renderer'
        ) {
          checkAndHandleVideoChange();
          return;
        }
      }

      const activePlayer = findPlayerContainer();
      if (activePlayer && (!mountedUI || !activePlayer.contains(mountedUI.host))) {
        attachToPlayer();
      } else if (activePlayer && videoController && !videoController.getVideo()) {
        const v = findVideoElement(activePlayer);
        if (v) videoController.attach(v);
      }
    });

    if (document.body) {
      domObserver.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['is-active']
      });
    }
  } else {
    // On /watch: strictly do NOT watch for ytd-reel-video-renderer.
    // If player or video element is not yet attached, observe childList until available.
    if (!playerEl || !videoEl) {
      domObserver = new MutationObserver(() => {
        const p = findPlayerContainer();
        const v = findVideoElement(p);
        if (p && v) {
          domObserver?.disconnect();
          domObserver = null;
          attachToPlayer();
        }
      });
      if (document.body) {
        domObserver.observe(document.body, { childList: true, subtree: true });
      }
    }
  }
}

function resetVideoState(): void {
  primaryEngine.clear();
  translatedEngine.clear();
  trackMeta = null;
  activePrimaryCue = null;
  activeTranslatedCue = null;
  selectedSelection = null;
  lastAutoPausedCueId = null;
  translationRequestedForVideo = '';
  videoController?.cancelAutoResume();
  videoController?.resetInspectionState();
  syncNativeCaptionsVisibility();
  renderUI();
}

const lifecycleAbortController = new AbortController();

window.addEventListener(
  'message',
  (event: MessageEvent<unknown>) => {
    if (event.source !== window) return;
    if (typeof event.data !== 'object' || event.data === null) return;

    const msg = event.data as Partial<MainToIsolatedMessage>;
    if (msg.source !== MAIN_MESSAGE_SOURCE) return;

    if (msg.type === 'TRACK_CAPTURED' && msg.payload) {
      const payload = msg.payload;
      console.log('[YT-Lang-AI] ISOLATED received TRACK_CAPTURED:', {
        payloadVideoId: payload.videoId,
        currentVideoId,
        cuesInPayload: payload.data.events?.length ?? 0
      });

      preloadedTracksMap.set(payload.videoId, payload);
      void setCachedSubtitles(payload.videoId, payload.lang, payload.data, payload.tlang);

      const isMatchingVideo =
        !currentVideoId ||
        payload.videoId === 'unknown' ||
        payload.videoId === currentVideoId;

      if (isMatchingVideo) {
        if (!currentVideoId && payload.videoId !== 'unknown') {
          currentVideoId = payload.videoId;
        }
        applyCapturedTrack(payload);
      }
    } else if (msg.type === 'TRANSLATED_TRACK_CAPTURED' && msg.payload) {
      const payload = msg.payload;
      console.log('[YT-Lang-AI] ISOLATED received TRANSLATED_TRACK_CAPTURED:', {
        payloadVideoId: payload.videoId,
        currentVideoId,
        cuesInPayload: payload.data.events?.length ?? 0
      });

      preloadedTranslatedMap.set(payload.videoId, payload);
      void setCachedSubtitles(payload.videoId, payload.lang, payload.data, payload.tlang);

      const isMatchingVideo =
        !currentVideoId ||
        payload.videoId === 'unknown' ||
        payload.videoId === currentVideoId;

      if (isMatchingVideo) {
        applyCapturedTranslatedTrack(payload);
      }
    }
  },
  { signal: lifecycleAbortController.signal }
);

requestLatestTrackFromMain();

window.addEventListener(
  'yt-navigate-finish',
  () => {
    checkAndHandleVideoChange();
  },
  { signal: lifecycleAbortController.signal }
);

window.addEventListener(
  'popstate',
  () => {
    checkAndHandleVideoChange();
  },
  { signal: lifecycleAbortController.signal }
);

async function bootstrap(): Promise<void> {
  const [loadedSettings, vocab] = await Promise.all([getSettings(), getVocabulary()]);
  settings = loadedSettings;
  savedWordKeys = new Set(
    vocab.map((c) => buildSavedKey(c.word, c.videoId, c.timestampSec))
  );

  onSettingsChanged((nextSettings) => {
    const prevDual = settings.showDualSubtitles;
    const prevLang = settings.nativeLang;
    settings = nextSettings;
    if (
      (nextSettings.showDualSubtitles && !prevDual) ||
      nextSettings.nativeLang !== prevLang
    ) {
      translatedEngine.clear();
      translationRequestedForVideo = '';
      requestTranslatedTrackIfNeeded();
    }
    syncNativeCaptionsVisibility();
    renderUI();
  });

  const ctx = getVideoContextFromUrl();
  currentVideoId = ctx.videoId;
  currentIsShorts = ctx.isShorts;
  startPlayerSession();
  requestLatestTrackFromMain();
}

void bootstrap();
