import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import {
  Bookmark,
  BookmarkCheck,
  Loader2,
  Sparkles,
  Volume2,
  X
} from 'lucide-react';
import type {
  AIExplainResponse,
  QuickTranslateResponse,
  RuntimeRequest
} from '../../types/messages';
import type { UserSettings } from '../../types/settings';
import type { AIExplanation, QuickTranslationResult } from '../../types/vocabulary';
import type { WordSelectionPayload } from './SubtitleOverlay';

interface WordPopupProps {
  selection: WordSelectionPayload;
  playerRect: DOMRect | null;
  videoId: string;
  videoTitle: string;
  sourceLang: string;
  settings: UserSettings;
  prevSentence: string;
  nextSentence: string;
  isSaved: boolean;
  onSaveCard: (params: {
    word: string;
    translation: string;
    aiExplanation: AIExplanation | null;
  }) => Promise<void>;
  onClose: (allowAutoResume?: boolean) => void;
}

function sendRuntimeMessage<TRes>(message: RuntimeRequest): Promise<TRes> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response: TRes | undefined) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!response) {
        reject(new Error('Empty response from background service worker'));
        return;
      }
      resolve(response);
    });
  });
}

export function speakText(text: string, langCode: string): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  try {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const voices = window.speechSynthesis.getVoices();
    const normLang = langCode.toLowerCase();
    const matchedVoice =
      voices.find((v) => v.lang.toLowerCase() === normLang) ??
      voices.find((v) => v.lang.toLowerCase().startsWith(normLang.split('-')[0] ?? normLang));
    if (matchedVoice) {
      utterance.voice = matchedVoice;
      utterance.lang = matchedVoice.lang;
    } else if (normLang && normLang !== 'unknown' && normLang !== 'auto') {
      utterance.lang = normLang;
    }
    utterance.rate = 0.95;
    window.speechSynthesis.speak(utterance);
  } catch {
    // Ignore speech synthesis errors in restricted contexts
  }
}

export function WordPopup({
  selection,
  playerRect,
  videoId,
  videoTitle,
  sourceLang,
  settings,
  prevSentence,
  nextSentence,
  isSaved,
  onSaveCard,
  onClose
}: WordPopupProps): ReactElement {
  const [quickLoading, setQuickLoading] = useState(true);
  const [quickError, setQuickError] = useState<string | null>(null);
  const [quickResult, setQuickResult] = useState<QuickTranslationResult | null>(null);

  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiResult, setAiResult] = useState<AIExplanation | null>(null);
  const [saving, setSaving] = useState(false);

  const activeRequestKeyRef = useRef('');
  const popupRef = useRef<HTMLDivElement | null>(null);

  const requestKey = `${videoId}:${selection.cue.id}:${selection.target}`;

  useEffect(() => {
    const controller = new AbortController();

    const handleOutsidePointerDown = (e: PointerEvent): void => {
      const path = e.composedPath();
      if (popupRef.current && path.includes(popupRef.current)) {
        return;
      }

      // Clicking inside our Shadow DOM HUD (e.g. another subtitle word or player pill)
      // is handled by those elements directly.
      const clickedInsideShadowRoot = path.some(
        (node) => node instanceof HTMLElement && node.id === 'yt-lang-ai-root'
      );
      if (clickedInsideShadowRoot) {
        return;
      }

      const clickedInsidePlayer = path.some(
        (node) =>
          node instanceof Element &&
          (node.id === 'movie_player' || node.classList.contains('html5-video-player'))
      );

      // If the user clicked on the video surface or YouTube player controls,
      // close the popup without calling video.play() so YouTube handles Play/Pause natively.
      onClose(!clickedInsidePlayer);
    };

    document.addEventListener('pointerdown', handleOutsidePointerDown, {
      capture: true,
      signal: controller.signal
    });

    return () => controller.abort();
  }, [onClose]);

  useEffect(() => {
    activeRequestKeyRef.current = requestKey;
    setQuickLoading(true);
    setQuickError(null);
    setQuickResult(null);
    setAiLoading(false);
    setAiError(null);
    setAiResult(null);

    void sendRuntimeMessage<QuickTranslateResponse>({
      type: 'QUICK_TRANSLATE',
      payload: {
        text: selection.target,
        sourceLang,
        nativeLang: settings.nativeLang
      }
    })
      .then((res) => {
        if (activeRequestKeyRef.current !== requestKey) return;
        if (res.ok) {
          setQuickResult(res.data);
        } else {
          setQuickError(res.error);
        }
      })
      .catch((err: unknown) => {
        if (activeRequestKeyRef.current !== requestKey) return;
        setQuickError(err instanceof Error ? err.message : 'Translation error');
      })
      .finally(() => {
        if (activeRequestKeyRef.current === requestKey) {
          setQuickLoading(false);
        }
      });
  }, [requestKey, selection.target, sourceLang, settings.nativeLang]);

  const handleRequestAI = useCallback(async (): Promise<void> => {
    if (aiLoading) return;
    setAiLoading(true);
    setAiError(null);

    try {
      const res = await sendRuntimeMessage<AIExplainResponse>({
        type: 'AI_EXPLAIN',
        payload: {
          videoId: videoId || 'unknown',
          cueId: selection.cue.id,
          target: selection.target,
          prevSentence,
          currentSentence: selection.cue.text,
          nextSentence,
          videoTitle,
          nativeLang: settings.nativeLang,
          llmConfig: settings.llm
        }
      });
      if (activeRequestKeyRef.current !== requestKey) return;
      if (res.ok) {
        setAiResult(res.data);
      } else {
        setAiError(res.error);
      }
    } catch (err: unknown) {
      if (activeRequestKeyRef.current !== requestKey) return;
      setAiError(err instanceof Error ? err.message : 'AI explanation failed');
    } finally {
      if (activeRequestKeyRef.current === requestKey) {
        setAiLoading(false);
      }
    }
  }, [
    aiLoading,
    nextSentence,
    prevSentence,
    requestKey,
    selection.cue.id,
    selection.cue.text,
    selection.target,
    settings.llm,
    settings.nativeLang,
    videoId,
    videoTitle
  ]);

  useEffect(() => {
    if (selection.isPhrase && settings.llm.apiKey.trim()) {
      void handleRequestAI();
    }
    // Trigger automatic AI explanation only when opening a multi-word phrase selection
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey, selection.isPhrase]);

  const handleSave = async (): Promise<void> => {
    if (saving) return;
    setSaving(true);
    try {
      const bestTranslation =
        aiResult?.contextualTranslation || quickResult?.translation || selection.target;
      await onSaveCard({
        word: selection.target,
        translation: bestTranslation,
        aiExplanation: aiResult
      });
    } finally {
      setSaving(false);
    }
  };

  // Compute safe position relative to #movie_player
  const popupWidth = 360;
  const pLeft = playerRect?.left ?? 0;
  const pTop = playerRect?.top ?? 0;
  const pWidth = playerRect?.width ?? window.innerWidth;
  const pHeight = playerRect?.height ?? window.innerHeight;

  const relCenterX = selection.anchorRect.left - pLeft;
  const clampedLeft = Math.max(
    12,
    Math.min(relCenterX - popupWidth / 2, pWidth - popupWidth - 12)
  );
  const relTop = selection.anchorRect.top - pTop;
  const bottomOffset = Math.max(80, pHeight - relTop + 12);

  return (
    <div
      ref={popupRef}
      className="pointer-events-auto absolute z-30 w-[360px] max-w-[calc(100%-24px)] rounded-2xl border border-white/15 bg-slate-950/95 p-4 text-slate-100 shadow-2xl backdrop-blur-xl"
      style={{
        left: `${clampedLeft}px`,
        bottom: `${Math.min(bottomOffset, Math.max(80, pHeight - 380))}px`,
        maxHeight: `${Math.max(240, pHeight - 96)}px`,
        overflowY: 'auto'
      }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-lg font-bold text-white">
              {selection.target}
            </h3>
            <button
              type="button"
              title="Pronounce"
              onClick={() => speakText(selection.target, quickResult?.detectedLang || sourceLang)}
              className="rounded-lg p-1 text-indigo-300 transition hover:bg-indigo-500/20 hover:text-indigo-200"
            >
              <Volume2 className="h-4 w-4" />
            </button>
          </div>
          {(aiResult?.partOfSpeech || quickResult?.partOfSpeech) && (
            <span className="mt-0.5 inline-block rounded bg-white/10 px-1.5 py-0.5 text-[11px] font-medium text-slate-300">
              {aiResult?.partOfSpeech || quickResult?.partOfSpeech}
            </span>
          )}
        </div>

        <button
          type="button"
          title="Close (Esc)"
          onClick={() => onClose(true)}
          className="rounded-lg p-1 text-slate-400 transition hover:bg-white/10 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

        {/* Level 1: Quick Translation */}
        <div className="mt-3 rounded-xl border border-white/10 bg-white/5 p-3">
          {quickLoading ? (
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-400" />
              <span>Translating...</span>
            </div>
          ) : quickError ? (
            <div className="text-xs text-rose-400">{quickError}</div>
          ) : quickResult ? (
            <div>
              <div className="text-base font-semibold text-emerald-400">
                {quickResult.translation}
              </div>
              {quickResult.alternatives.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {quickResult.alternatives.map((alt) => (
                    <span
                      key={alt}
                      className="rounded-md bg-slate-800/90 px-2 py-0.5 text-xs text-slate-300"
                    >
                      {alt}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ) : null}
        </div>

        {/* Level 2: Contextual AI Explanation */}
        <div className="mt-3">
          {!aiResult && !aiLoading && (
            <button
              type="button"
              onClick={() => void handleRequestAI()}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-3 py-2 text-xs font-semibold text-white shadow transition hover:from-indigo-500 hover:to-violet-500"
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span>AI Контекстный разбор</span>
            </button>
          )}

          {aiLoading && (
            <div className="flex items-center justify-center gap-2 rounded-xl border border-indigo-500/30 bg-indigo-500/10 px-3 py-2.5 text-xs text-indigo-200">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span>Analyzing scene context with AI...</span>
            </div>
          )}

          {aiError && (
            <div className="mt-2 break-words rounded-xl border border-rose-500/30 bg-rose-500/10 p-2.5 text-xs text-rose-300">
              {aiError}
            </div>
          )}

          {aiResult && (
            <div className="space-y-2.5 rounded-xl border border-indigo-500/25 bg-indigo-950/30 p-3 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-indigo-300">
                  AI Разбор · {aiResult.lemma}
                </span>
                <span className="rounded bg-indigo-500/20 px-1.5 py-0.5 text-[10px] text-indigo-200">
                  {aiResult.partOfSpeech}
                </span>
              </div>

              <div className="text-sm font-semibold text-white">
                {aiResult.contextualTranslation}
              </div>

              {aiResult.literalTranslation && (
                <div className="text-slate-400">
                  <span className="font-medium text-slate-300">Дословно: </span>
                  {aiResult.literalTranslation}
                </div>
              )}

              {aiResult.grammarNote && (
                <div className="text-slate-300">
                  <span className="font-medium text-indigo-300">Грамматика: </span>
                  {aiResult.grammarNote}
                </div>
              )}

              {aiResult.nuanceExplanation && (
                <div className="text-slate-300">
                  <span className="font-medium text-indigo-300">Нюанс: </span>
                  {aiResult.nuanceExplanation}
                </div>
              )}

              {aiResult.examples.length > 0 && (
                <div className="space-y-1.5 border-t border-white/10 pt-2">
                  <div className="font-medium text-slate-400">Примеры:</div>
                  {aiResult.examples.map((ex, idx) => (
                    <div key={idx} className="rounded-lg bg-black/25 p-2">
                      <div className="flex items-start justify-between gap-1.5 text-slate-100">
                        <span>{ex.source}</span>
                        <button
                          type="button"
                          onClick={() => speakText(ex.source, quickResult?.detectedLang || sourceLang)}
                          className="shrink-0 text-indigo-300 hover:text-indigo-200"
                        >
                          <Volume2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <div className="mt-0.5 text-slate-400">{ex.translation}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Save to Vocabulary Footer */}
        <div className="mt-3 flex items-center justify-between gap-2 border-t border-white/10 pt-3">
          <span className="text-[11px] text-slate-400">
            Hotkeys: S save · R repeat · Esc close
          </span>

          <button
            type="button"
            disabled={saving || quickLoading}
            onClick={() => void handleSave()}
            className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition ${
              isSaved
                ? 'bg-emerald-600/90 text-white hover:bg-emerald-500'
                : 'bg-white text-slate-950 hover:bg-slate-200 disabled:opacity-50'
            }`}
          >
            {isSaved ? (
              <>
                <BookmarkCheck className="h-3.5 w-3.5" />
                <span>Сохранено</span>
              </>
            ) : (
              <>
                <Bookmark className="h-3.5 w-3.5" />
                <span>В словарь</span>
              </>
            )}
          </button>
        </div>
      </div>
  );
}
