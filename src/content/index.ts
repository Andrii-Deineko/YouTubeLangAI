import { createElement } from 'react';
import {
  ISOLATED_MESSAGE_SOURCE,
  MAIN_MESSAGE_SOURCE,
  type IsolatedToMainMessage,
  type MainToIsolatedMessage,
  type QuickTranslateResponse,
  type RuntimeRequest
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
import { SubtitleEngine } from './SubtitleEngine';
import { VideoController } from './VideoController';
import { mountShadowUI, type MountedShadowUI } from './mountShadowUI';
import type { WordSelectionPayload } from './components/SubtitleOverlay';
import { WordPopup } from './components/WordPopup';

const NATIVE_CAPTIONS_STYLE_ID = 'yt-lang-ai-hide-native-captions';

const primaryEngine = new SubtitleEngine();
const translatedEngine = new SubtitleEngine();

let settings: UserSettings = { ...DEFAULT_SETTINGS };
let currentVideoId = '';
let trackMeta: TrackMetadata | null = null;
let isAdShowing = false;
let altPressed = false;
let activePrimaryCue: SubtitleCue | null = null;
let activeTranslatedCue: SubtitleCue | null = null;
let selectedSelection: WordSelectionPayload | null = null;
let lastAutoPausedCueId: string | null = null;
let savedWordKeys = new Set<string>();

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

function getVideoIdFromUrl(): string {
  try {
    const url = new URL(window.location.href);
    const v = url.searchParams.get('v');
    if (v) return v;
    const match = url.pathname.match(/\/shorts\/([a-zA-Z0-9_-]+)/);
    return match?.[1] ?? '';
  } catch {
    return '';
  }
}

function getVideoTitle(): string {
  const titleEl =
    document.querySelector<HTMLElement>('h1.ytd-watch-metadata yt-formatted-string') ??
    document.querySelector<HTMLElement>('#title h1');
  const domTitle = titleEl?.textContent?.trim();
  if (domTitle) return domTitle;
  return document.title.replace(/\s*-\s*YouTube$/, '').trim() || 'YouTube Video';
}

function buildSavedKey(word: string, videoId: string, cueStartSec: number): string {
  return `${videoId}:${word.trim().toLowerCase()}:${Math.floor(cueStartSec)}`;
}

function findPlayerContainer(): HTMLElement | null {
  return (
    document.querySelector<HTMLElement>('#movie_player') ??
    document.querySelector<HTMLElement>('.html5-video-player')
  );
}

function findVideoElement(playerEl: HTMLElement | null): HTMLVideoElement | null {
  if (playerEl) {
    const v = playerEl.querySelector<HTMLVideoElement>('video.html5-main-video, video');
    if (v) return v;
  }
  return document.querySelector<HTMLVideoElement>('video.html5-main-video, video');
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
    nativeLang: settings.nativeLang
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

function handleRepeatCue(): void {
  if (!videoController) return;
  const time = videoController.getCurrentTime();
  const cue =
    activePrimaryCue ??
    primaryEngine.findActiveCue(time) ??
    primaryEngine.getPreviousCue(time);
  if (cue) {
    lastAutoPausedCueId = null;
    videoController.jumpToCue(cue);
  }
}

function handlePreviousCue(): void {
  if (!videoController) return;
  const time = videoController.getCurrentTime();
  const prev = primaryEngine.getPreviousCue(time);
  if (prev) {
    lastAutoPausedCueId = null;
    videoController.jumpToCue(prev);
  }
}

function handleNextCue(): void {
  if (!videoController) return;
  const time = videoController.getCurrentTime();
  const next = primaryEngine.getNextCue(time);
  if (next) {
    lastAutoPausedCueId = null;
    videoController.jumpToCue(next);
  }
}

async function handleQuickSaveShortcut(): Promise<void> {
  const targetCue = selectedSelection?.cue ?? activePrimaryCue;
  if (!targetCue) return;

  const targetWord =
    selectedSelection?.target ??
    targetCue.tokens.find((t) => t.isWord)?.text ??
    '';
  if (!targetWord) return;

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
      }

      if (
        nextPrimary?.id !== activePrimaryCue?.id ||
        nextTranslated?.id !== activeTranslatedCue?.id
      ) {
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
    onRepeatCue: handleRepeatCue,
    onPreviousCue: handlePreviousCue,
    onNextCue: handleNextCue,
    onSaveActiveWord: () => {
      void handleQuickSaveShortcut();
    },
    onClosePopup: () => closePopupAndResume(true),
    onAltKeyChange: (pressed: boolean) => {
      if (altPressed !== pressed) {
        altPressed = pressed;
        renderUI();
      }
    },
    isPopupOpen: () => selectedSelection !== null
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
  if (!playerEl) return;

  if (!videoController) {
    videoController = createVideoController();
  }

  const videoEl = findVideoElement(playerEl);
  videoController.attach(videoEl);

  if (currentPlayerEl !== playerEl || !mountedUI || !playerEl.contains(mountedUI.host)) {
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

function startPlayerSession(): void {
  teardownPlayerSession();
  sessionAbortController = new AbortController();
  videoController = createVideoController();
  attachToPlayer();

  domObserver = new MutationObserver(() => {
    const playerEl = findPlayerContainer();
    if (playerEl && (!mountedUI || !playerEl.contains(mountedUI.host))) {
      attachToPlayer();
    } else if (playerEl && videoController && !videoController.getVideo()) {
      const videoEl = findVideoElement(playerEl);
      if (videoEl) videoController.attach(videoEl);
    }
  });
  if (document.body) {
    domObserver.observe(document.body, { childList: true, subtree: true });
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
      currentVideoId = payload.videoId || getVideoIdFromUrl();
      primaryEngine.loadJson3(payload.data, payload.kind);
      void setCachedSubtitles(currentVideoId, payload.lang, payload.data, payload.tlang);
      trackMeta = {
        videoId: currentVideoId,
        lang: payload.lang,
        tlang: payload.tlang,
        kind: payload.kind,
        isAsr: primaryEngine.getIsAsr(),
        url: payload.url
      };
      activePrimaryCue = primaryEngine.findActiveCue(videoController?.getCurrentTime() ?? 0);
      syncNativeCaptionsVisibility();
      attachToPlayer();
      renderUI();
      requestTranslatedTrackIfNeeded();
    } else if (msg.type === 'TRANSLATED_TRACK_CAPTURED' && msg.payload) {
      const payload = msg.payload;
      const vid = payload.videoId || currentVideoId;
      translatedEngine.loadJson3(payload.data, payload.kind);
      void setCachedSubtitles(vid, payload.lang, payload.data, payload.tlang);
      activeTranslatedCue = translatedEngine.findActiveCue(
        videoController?.getCurrentTime() ?? 0
      );
      renderUI();
    }
  },
  { signal: lifecycleAbortController.signal }
);

window.addEventListener(
  'yt-navigate-finish',
  () => {
    const nextId = getVideoIdFromUrl();
    if (nextId !== currentVideoId) {
      currentVideoId = nextId;
      resetVideoState();
    }
    startPlayerSession();
    if (nextId) {
      postToMain({
        source: ISOLATED_MESSAGE_SOURCE,
        type: 'NAVIGATED',
        payload: { videoId: nextId }
      });
    }
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

  currentVideoId = getVideoIdFromUrl();
  startPlayerSession();
}

void bootstrap();
