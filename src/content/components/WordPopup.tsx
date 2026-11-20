import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import {
  Bookmark,
  BookmarkCheck,
  ChevronDown,
  Loader2,
  RotateCcw,
  Sparkles,
  Volume2,
  X
} from 'lucide-react';
import type {
  AIExplainResponse,
  FreeTranslateWordResponse,
  FreeTranslateWordResult,
  RuntimeRequest
} from '../../types/messages';
import type { UserSettings } from '../../types/settings';
import type { AIExplanation } from '../../types/vocabulary';
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
  const [freeLoading, setFreeLoading] = useState(true);
  const [freeError, setFreeError] = useState<string | null>(null);
  const [freeResult, setFreeResult] = useState<FreeTranslateWordResult | null>(null);

  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiResult, setAiResult] = useState<AIExplanation | null>(null);
  const [saving, setSaving] = useState(false);
  const [showExamples, setShowExamples] = useState(false);

  const activeRequestKeyRef = useRef('');
  const popupRef = useRef<HTMLDivElement | null>(null);

  const isLocalOllama = Boolean(
    settings.llm.baseUrl &&
      (settings.llm.baseUrl.includes('11434') ||
        settings.llm.baseUrl.includes('localhost') ||
        settings.llm.baseUrl.includes('127.0.0.1'))
  );
  const isLLMConfigured = Boolean(
    isLocalOllama || (settings.llm.apiKey && settings.llm.apiKey.trim().length > 0)
  );

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
    setFreeLoading(true);
    setFreeError(null);
    setFreeResult(null);
    setAiLoading(false);
    setAiError(null);
    setAiResult(null);
    setShowExamples(false);

    // 1. Immediately request fast free translation (<150ms)
    void sendRuntimeMessage<FreeTranslateWordResponse>({
      type: 'FREE_TRANSLATE_WORD',
      payload: {
        word: selection.target,
        sentence: selection.cue.text,
        sourceLang,
        targetLang: settings.nativeLang
      }
    })
      .then((res) => {
        if (activeRequestKeyRef.current !== requestKey) return;
        if (res.ok) {
          setFreeResult(res.data);
        } else {
          setFreeError(res.error);
        }
      })
      .catch((err: unknown) => {
        if (activeRequestKeyRef.current !== requestKey) return;
        setFreeError(err instanceof Error ? err.message : 'Translation error');
      })
      .finally(() => {
        if (activeRequestKeyRef.current === requestKey) {
          setFreeLoading(false);
        }
      });
  }, [requestKey, selection.cue.text, selection.target, settings.nativeLang, sourceLang]);

  const handleRequestAI = useCallback(async (): Promise<void> => {
    if (aiLoading) return;
    if (!isLLMConfigured) {
      void sendRuntimeMessage({ type: 'OPEN_OPTIONS' });
      return;
    }
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
          llmConfig: settings.llm,
          fallbackModel: settings.fallbackModel
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
    isLLMConfigured,
    nextSentence,
    prevSentence,
    requestKey,
    selection.cue.id,
    selection.cue.text,
    selection.target,
    settings.fallbackModel,
    settings.llm,
    settings.nativeLang,
    videoId,
    videoTitle
  ]);

  useEffect(() => {
    if (selection.isPhrase && isLLMConfigured) {
      void handleRequestAI();
    }
    // Trigger automatic AI explanation only when opening a multi-word phrase selection and LLM is configured
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey, selection.isPhrase, isLLMConfigured]);

  const handleSave = async (): Promise<void> => {
    if (saving) return;
    setSaving(true);
    try {
      const bestTranslation =
        aiResult?.contextualTranslation || freeResult?.translation || selection.target;
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
  const pLeft = playerRect?.left ?? 0;
  const pTop = playerRect?.top ?? 0;
  const pWidth = playerRect?.width ?? window.innerWidth;
  const pHeight = playerRect?.height ?? window.innerHeight;

  const targetWidth = pWidth >= 480 ? 420 : 380;
  const popupWidth = Math.min(targetWidth, pWidth - 24);

  const relAnchorX = selection.anchorRect.left - pLeft;
  const clampedLeft = Math.max(
    12,
    Math.min(relAnchorX - popupWidth / 2, pWidth - popupWidth - 12)
  );

  // Rigid max height: min(340px, 55% of player height)
  const maxAllowedHeight = Math.min(340, Math.floor(pHeight * 0.55));
  const effectiveMaxHeight = Math.max(160, Math.min(maxAllowedHeight, pHeight - 24));

  const relAnchorTop = selection.anchorRect.top - pTop;
  const relAnchorBottom = selection.anchorRect.bottom - pTop;

  const spaceAbove = relAnchorTop - 12;
  const spaceBelow = pHeight - 12 - relAnchorBottom;

  // Flip below subtitles if space above is too tight (< 180px) and there's more space below
  const placeBelow = spaceAbove < 180 && spaceBelow > spaceAbove;

  let verticalPositionStyle: React.CSSProperties;
  if (placeBelow) {
    const availableH = Math.max(140, Math.min(effectiveMaxHeight, spaceBelow));
    verticalPositionStyle = {
      top: `${Math.max(12, relAnchorBottom + 8)}px`,
      maxHeight: `${availableH}px`
    };
  } else {
    const availableH = Math.max(140, Math.min(effectiveMaxHeight, spaceAbove));
    const bottomOffset = Math.max(12, pHeight - relAnchorTop + 8);
    verticalPositionStyle = {
      bottom: `${bottomOffset}px`,
      maxHeight: `${availableH}px`
    };
  }

  return (
    <div
      ref={popupRef}
      className="pointer-events-auto absolute z-30 flex flex-col overflow-hidden w-[380px] sm:w-[420px] max-w-[calc(100%-24px)] rounded-2xl p-3 sm:p-3.5 shadow-2xl transition-all"
      style={{
        backgroundColor: 'rgba(var(--ytai-bg-rgb), 0.96)',
        borderColor: 'var(--ytai-border)',
        borderWidth: '1px',
        borderStyle: 'solid',
        backdropFilter: 'blur(var(--ytai-backdrop-blur, 16px))',
        WebkitBackdropFilter: 'blur(var(--ytai-backdrop-blur, 16px))',
        color: 'var(--ytai-text-primary)',
        left: `${clampedLeft}px`,
        ...verticalPositionStyle
      }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* 1. Pinned Header (shrink-0) */}
      <div
        className="shrink-0 flex items-center justify-between gap-2 border-b pb-2"
        style={{ borderColor: 'var(--ytai-border)' }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <h3
            className="truncate text-base sm:text-lg font-bold"
            style={{ color: 'var(--ytai-text-primary)' }}
          >
            {selection.target}
          </h3>
          <button
            type="button"
            title="Pronounce"
            onClick={() => speakText(selection.target, freeResult?.detectedLang || sourceLang)}
            style={{ color: 'var(--ytai-accent)' }}
            className="rounded-lg p-1 transition hover:bg-[rgba(var(--ytai-accent-rgb),0.2)] shrink-0"
          >
            <Volume2 className="h-4 w-4" />
          </button>
          {(aiResult?.partOfSpeech || freeResult?.partOfSpeech) && (
            <span
              className="truncate rounded border px-1.5 py-0.5 text-[10px] font-medium shrink-0"
              style={{
                backgroundColor: 'var(--ytai-surface)',
                borderColor: 'var(--ytai-border)',
                color: 'var(--ytai-text-secondary)'
              }}
            >
              {aiResult?.partOfSpeech || freeResult?.partOfSpeech}
            </span>
          )}
        </div>

        <button
          type="button"
          title="Close (Esc)"
          onClick={() => onClose(true)}
          style={{ color: 'var(--ytai-text-secondary)' }}
          className="rounded-lg p-1 transition hover:bg-[rgba(var(--ytai-accent-rgb),0.15)] hover:text-white shrink-0"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* 2. Scrollable Middle Body (flex-1 min-h-0 overflow-y-auto) */}
      <div className="flex-1 min-h-0 overflow-y-auto space-y-2 py-2 pr-0.5">
        {/* Word Translation & Synonyms Chips */}
        <div
          className="rounded-xl border p-2.5 text-xs"
          style={{
            backgroundColor: 'var(--ytai-surface)',
            borderColor: 'var(--ytai-border)'
          }}
        >
          {freeLoading ? (
            <div className="flex items-center gap-2" style={{ color: 'var(--ytai-text-secondary)' }}>
              <Loader2 className="h-3.5 w-3.5 animate-spin" style={{ color: 'var(--ytai-accent)' }} />
              <span>Translating...</span>
            </div>
          ) : freeError ? (
            <div className="text-xs text-rose-400">{freeError}</div>
          ) : freeResult ? (
            <div>
              <div className="text-sm font-semibold" style={{ color: 'var(--ytai-accent)' }}>
                {freeResult.translation}
              </div>
              {freeResult.alternatives.length > 0 && (
                <div className="mt-1.5 flex flex-wrap items-center gap-1">
                  {freeResult.alternatives.slice(0, 4).map((alt) => (
                    <span
                      key={alt}
                      className="rounded-md border px-1.5 py-0.5 text-[11px]"
                      style={{
                        backgroundColor: 'rgba(var(--ytai-bg-rgb), 0.75)',
                        borderColor: 'var(--ytai-border)',
                        color: 'var(--ytai-text-secondary)'
                      }}
                    >
                      {alt}
                    </span>
                  ))}
                  {freeResult.alternatives.length > 4 && (
                    <span
                      className="text-[10px] opacity-75"
                      style={{ color: 'var(--ytai-text-secondary)' }}
                    >
                      +{freeResult.alternatives.length - 4}
                    </span>
                  )}
                </div>
              )}
            </div>
          ) : null}
        </div>

        {/* Current Sentence Context with neat italic translation */}
        {selection.cue.text && (
          <div
            className="rounded-xl border p-2.5 text-xs"
            style={{
              backgroundColor: 'rgba(var(--ytai-bg-rgb), 0.55)',
              borderColor: 'var(--ytai-border)'
            }}
          >
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Контекст субтитра
            </div>
            <div className="mt-1 text-xs text-white/95 leading-relaxed">
              &ldquo;{selection.cue.text}&rdquo;
            </div>
            {freeResult?.sentenceTranslation ? (
              <div
                className="mt-1.5 text-xs italic leading-relaxed"
                style={{ color: 'var(--ytai-text-secondary)' }}
              >
                {freeResult.sentenceTranslation}
              </div>
            ) : freeLoading ? (
              <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-slate-400">
                <Loader2 className="h-3 w-3 animate-spin" />
                <span>Загрузка перевода контекста...</span>
              </div>
            ) : null}
          </div>
        )}

        {/* AI Breakdown or Zero-Config Promotion Banner */}
        {isLLMConfigured ? (
          <div>
            {!aiResult && !aiLoading && (
              <button
                type="button"
                onClick={() => void handleRequestAI()}
                style={{
                  backgroundColor: 'var(--ytai-accent)',
                  color: '#ffffff'
                }}
                className="flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold shadow transition hover:opacity-90"
              >
                <Sparkles className="h-3.5 w-3.5" />
                <span>AI Контекстный разбор</span>
              </button>
            )}

            {aiLoading && (
              <div
                className="flex items-center justify-center gap-2 rounded-xl border p-2.5 text-xs"
                style={{
                  backgroundColor: 'rgba(var(--ytai-accent-rgb), 0.1)',
                  borderColor: 'rgba(var(--ytai-accent-rgb), 0.3)',
                  color: 'var(--ytai-accent)'
                }}
              >
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>Analyzing scene context with AI...</span>
              </div>
            )}

            {aiError && (
              <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-2.5 text-xs text-rose-200">
                <div className="break-words">
                  {aiError.includes('503') ? (
                    <span>
                      <strong>Сервер модели временно перегружен (503).</strong> Попробуйте ещё раз через несколько секунд.
                    </span>
                  ) : aiError.includes('429') ? (
                    <span>
                      <strong>Превышен лимит запросов (429).</strong> Подождите немного и повторите попытку.
                    </span>
                  ) : (
                    aiError
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => void handleRequestAI()}
                  className="mt-2 flex items-center gap-1.5 rounded-lg bg-rose-500/25 px-2.5 py-1 text-[11px] font-semibold text-rose-100 transition hover:bg-rose-500/40"
                >
                  <RotateCcw className="h-3 w-3" />
                  <span>Повторить</span>
                </button>
              </div>
            )}

            {aiResult && (
              <div
                className="space-y-2 rounded-xl border p-2.5 text-xs"
                style={{
                  backgroundColor: 'var(--ytai-surface)',
                  borderColor: 'var(--ytai-border)'
                }}
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-xs" style={{ color: 'var(--ytai-accent)' }}>
                    AI Разбор · {aiResult.lemma}
                  </span>
                  <span
                    className="rounded px-1.5 py-0.5 text-[10px]"
                    style={{
                      backgroundColor: 'rgba(var(--ytai-accent-rgb), 0.2)',
                      color: 'var(--ytai-accent)'
                    }}
                  >
                    {aiResult.partOfSpeech}
                  </span>
                </div>

                <div className="text-sm font-semibold text-white">
                  {aiResult.contextualTranslation}
                </div>

                {aiResult.literalTranslation && (
                  <div style={{ color: 'var(--ytai-text-secondary)' }}>
                    <span className="font-medium text-white">Дословно: </span>
                    {aiResult.literalTranslation}
                  </div>
                )}

                {aiResult.grammarNote && (
                  <div style={{ color: 'var(--ytai-text-secondary)' }}>
                    <span className="font-medium" style={{ color: 'var(--ytai-accent)' }}>
                      Грамматика:{' '}
                    </span>
                    {aiResult.grammarNote}
                  </div>
                )}

                {aiResult.nuanceExplanation && (
                  <div style={{ color: 'var(--ytai-text-secondary)' }}>
                    <span className="font-medium" style={{ color: 'var(--ytai-accent)' }}>
                      Нюанс:{' '}
                    </span>
                    {aiResult.nuanceExplanation}
                  </div>
                )}

                {/* Collapsible Examples Accordion */}
                {aiResult.examples.length > 0 && (
                  <div
                    className="border-t pt-1.5"
                    style={{ borderColor: 'var(--ytai-border)' }}
                  >
                    <button
                      type="button"
                      onClick={() => setShowExamples((prev) => !prev)}
                      className="flex w-full items-center justify-between py-1 text-left font-medium transition hover:opacity-80"
                      style={{ color: 'var(--ytai-text-secondary)' }}
                    >
                      <span>Примеры ({aiResult.examples.length})</span>
                      <ChevronDown
                        className={`h-3.5 w-3.5 transition-transform duration-200 ${
                          showExamples ? 'rotate-180' : ''
                        }`}
                      />
                    </button>

                    {showExamples && (
                      <div className="mt-1.5 space-y-1.5">
                        {aiResult.examples.map((ex, idx) => (
                          <div
                            key={idx}
                            className="rounded-lg border p-2"
                            style={{
                              backgroundColor: 'rgba(var(--ytai-bg-rgb), 0.65)',
                              borderColor: 'var(--ytai-border)'
                            }}
                          >
                            <div className="flex items-start justify-between gap-1.5 text-white">
                              <span>{ex.source}</span>
                              <button
                                type="button"
                                onClick={() => speakText(ex.source, freeResult?.detectedLang || sourceLang)}
                                style={{ color: 'var(--ytai-accent)' }}
                                className="shrink-0 transition hover:opacity-80"
                              >
                                <Volume2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                            <div className="mt-0.5 text-[11px]" style={{ color: 'var(--ytai-text-secondary)' }}>
                              {ex.translation}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          /* Zero-Config Mode Banner */
          <div
            className="rounded-xl border p-2.5 text-xs shadow-sm"
            style={{
              backgroundColor: 'var(--ytai-surface)',
              borderColor: 'var(--ytai-border)'
            }}
          >
            <div className="flex items-start gap-2.5">
              <Sparkles className="h-4 w-4 shrink-0 text-amber-400 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-white/95 text-xs">
                  ✨ Хотите разбор грамматики и нюансов контекста?
                </div>
                <div className="mt-0.5 text-[11px] leading-relaxed" style={{ color: 'var(--ytai-text-secondary)' }}>
                  Подключите бесплатный ключ Gemini или локальную Ollama без лимитов
                </div>
                <button
                  type="button"
                  onClick={() => void sendRuntimeMessage({ type: 'OPEN_OPTIONS' })}
                  className="mt-2 flex items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-white transition hover:opacity-90 shadow-sm"
                  style={{ backgroundColor: 'var(--ytai-accent)' }}
                >
                  <Sparkles className="h-3 w-3" />
                  <span>Подключить AI (Gemini / Ollama)</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 3. Pinned Footer (shrink-0) */}
      <div
        className="shrink-0 flex items-center justify-between gap-2 border-t pt-2"
        style={{ borderColor: 'var(--ytai-border)' }}
      >
        <span className="text-[10px] truncate" style={{ color: 'var(--ytai-text-secondary)' }}>
          S сохранить · R повтор · Esc
        </span>

        <button
          type="button"
          disabled={saving || freeLoading}
          onClick={() => void handleSave()}
          style={
            isSaved
              ? {
                  backgroundColor: 'var(--ytai-accent)',
                  color: '#ffffff'
                }
              : {
                  backgroundColor: 'var(--ytai-text-primary)',
                  color: 'rgb(var(--ytai-bg-rgb))'
                }
          }
          className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition hover:opacity-90 disabled:opacity-50 shrink-0 shadow-sm"
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
