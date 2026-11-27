import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode
} from 'react';
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
  AIExplanation,
  QuickTranslateResponse,
  QuickTranslationResult,
  RuntimeRequest,
  TranslationProvider,
  UserSettings
} from '@langai/contracts';
import { getUiStrings } from '../i18n/translations';
import { isLlmConfigured } from '../utils/llm';
import { speakText } from '../utils/tts';
import type { WordSelectionPayload } from './SubtitleOverlay';

export interface WordPopupProps {
  selection: WordSelectionPayload;
  playerContainer: HTMLElement | null;
  videoId: string;
  videoTitle: string;
  sourceLang: string;
  settings: UserSettings;
  prevSentence: string;
  nextSentence: string;
  contextTranslation?: string;
  isSaved: boolean;
  onSaveCard: (params: {
    word: string;
    translation: string;
    aiExplanation: AIExplanation | null;
    contextTranslation?: string;
  }) => Promise<void>;
  onClose: (allowAutoResume?: boolean) => void;
}

function renderHighlightedSentence(sentence: string, targetWord: string): ReactNode {
  const cleanTarget = targetWord.trim();
  if (!cleanTarget) return sentence;

  const escaped = cleanTarget.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escaped})`, 'gi');
  const parts = sentence.split(regex);

  return parts.map((part, index) => {
    if (part.toLowerCase() === cleanTarget.toLowerCase()) {
      return (
        <span
          key={index}
          className="font-semibold underline decoration-2 underline-offset-2"
          style={{ color: 'var(--ytai-accent)' }}
        >
          {part}
        </span>
      );
    }
    return part;
  });
}

function sendRuntimeMessage<TRes>(
  message: RuntimeRequest,
  reloadErrorText: string,
  emptyResponseText: string
): Promise<TRes> {
  return new Promise((resolve, reject) => {
    try {
      if (
        typeof chrome === 'undefined' ||
        !chrome.runtime?.id ||
        typeof chrome.runtime?.sendMessage !== 'function'
      ) {
        reject(new Error(reloadErrorText));
        return;
      }
      chrome.runtime.sendMessage(message, (response: TRes | undefined) => {
        const lastError = typeof chrome !== 'undefined' ? chrome.runtime?.lastError : undefined;
        if (lastError) {
          reject(new Error(lastError.message));
          return;
        }
        if (!response) {
          reject(new Error(emptyResponseText));
          return;
        }
        resolve(response);
      });
    } catch (err) {
      reject(err instanceof Error ? err : new Error(reloadErrorText));
    }
  });
}

const contentQuickTranslateCache = new Map<string, QuickTranslationResult>();
const contentInFlight = new Map<string, Promise<QuickTranslateResponse>>();

function fetchQuickTranslate(
  text: string,
  sourceLang: string,
  nativeLang: string,
  provider: TranslationProvider,
  reloadErrorText: string,
  emptyResponseText: string
): Promise<QuickTranslateResponse> {
  const cacheKey = `${provider}:${sourceLang}:${nativeLang}:${text.trim().toLowerCase()}`;
  const cached = contentQuickTranslateCache.get(cacheKey);
  if (cached) {
    return Promise.resolve({ ok: true, data: cached });
  }

  const inFlight = contentInFlight.get(cacheKey);
  if (inFlight) {
    return inFlight;
  }

  const promise = sendRuntimeMessage<QuickTranslateResponse>(
    {
      type: 'QUICK_TRANSLATE',
      payload: {
        text,
        sourceLang,
        nativeLang
      }
    },
    reloadErrorText,
    emptyResponseText
  )
    .then((res) => {
      if (res.ok && res.data.translation.trim()) {
        if (contentQuickTranslateCache.size > 200) {
          const firstKey = contentQuickTranslateCache.keys().next().value;
          if (firstKey) contentQuickTranslateCache.delete(firstKey);
        }
        contentQuickTranslateCache.set(cacheKey, res.data);
      }
      return res;
    })
    .finally(() => {
      contentInFlight.delete(cacheKey);
    });

  contentInFlight.set(cacheKey, promise);
  return promise;
}

export function WordPopup({
  selection,
  playerContainer,
  videoId,
  videoTitle,
  sourceLang,
  settings,
  prevSentence,
  nextSentence,
  contextTranslation: initialContextTranslation,
  isSaved,
  onSaveCard,
  onClose
}: WordPopupProps): ReactElement {
  const [quickLoading, setQuickLoading] = useState(true);
  const [quickError, setQuickError] = useState<string | null>(null);
  const [quickResult, setQuickResult] = useState<QuickTranslationResult | null>(null);

  const [sentenceTranslation, setSentenceTranslation] = useState<string>(
    initialContextTranslation || ''
  );
  const [sentenceLoading, setSentenceLoading] = useState<boolean>(
    !initialContextTranslation
  );

  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiResult, setAiResult] = useState<AIExplanation | null>(null);
  const [saving, setSaving] = useState(false);
  const [showExamples, setShowExamples] = useState(false);
  const t = getUiStrings(settings.uiLanguage);

  const activeRequestKeyRef = useRef('');
  const popupRef = useRef<HTMLDivElement | null>(null);

  const requestKey = `${settings.translationProvider}:${videoId}:${selection.cue.id}:${selection.target}`;
  const llmConfigured = isLlmConfigured(settings.llm);

  useEffect(() => {
    const controller = new AbortController();

    const handleOutsidePointerDown = (e: PointerEvent): void => {
      const path = e.composedPath();
      if (popupRef.current && path.includes(popupRef.current)) {
        return;
      }

      const rootNode = popupRef.current?.getRootNode();
      const shadowHost = rootNode instanceof ShadowRoot ? rootNode.host : null;
      if (shadowHost !== null && path.includes(shadowHost)) {
        return;
      }

      const resolvedContainer =
        playerContainer ?? (shadowHost instanceof HTMLElement ? shadowHost.parentElement : null);

      const clickedInsidePlayer = path.some(
        (node) =>
          (resolvedContainer !== null && node === resolvedContainer) ||
          (node instanceof Element && node.tagName === 'VIDEO')
      );

      onClose(!clickedInsidePlayer);
    };

    document.addEventListener('pointerdown', handleOutsidePointerDown, {
      capture: true,
      signal: controller.signal
    });

    return () => controller.abort();
  }, [onClose, playerContainer]);

  useEffect(() => {
    activeRequestKeyRef.current = requestKey;
    setQuickLoading(true);
    setQuickError(null);
    setQuickResult(null);
    setAiLoading(false);
    setAiError(null);
    setAiResult(null);
    setShowExamples(false);

    if (initialContextTranslation) {
      setSentenceTranslation(initialContextTranslation);
      setSentenceLoading(false);
    } else {
      setSentenceTranslation('');
      setSentenceLoading(true);
    }

    void fetchQuickTranslate(
      selection.target,
      sourceLang,
      settings.nativeLang,
      settings.translationProvider,
      t.extensionUpdatedReload,
      t.emptyWorkerResponse
    )
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
        setQuickError(err instanceof Error ? err.message : t.translationError);
      })
      .finally(() => {
        if (activeRequestKeyRef.current === requestKey) {
          setQuickLoading(false);
        }
      });

    if (!initialContextTranslation && selection.cue.text) {
      const cleanCueText = selection.cue.text.trim();
      const cleanWord = selection.target.trim();
      if (cleanCueText.toLowerCase() === cleanWord.toLowerCase()) {
        setSentenceLoading(false);
      } else {
        void fetchQuickTranslate(
          cleanCueText,
          sourceLang,
          settings.nativeLang,
          settings.translationProvider,
          t.extensionUpdatedReload,
          t.emptyWorkerResponse
        )
          .then((res) => {
            if (activeRequestKeyRef.current !== requestKey) return;
            if (res.ok && res.data.translation) {
              setSentenceTranslation(res.data.translation);
            }
          })
          .catch(() => undefined)
          .finally(() => {
            if (activeRequestKeyRef.current === requestKey) {
              setSentenceLoading(false);
            }
          });
      }
    }
  }, [
    requestKey,
    selection.target,
    selection.cue.text,
    sourceLang,
    settings.nativeLang,
    settings.translationProvider,
    initialContextTranslation,
    t.extensionUpdatedReload,
    t.emptyWorkerResponse,
    t.translationError
  ]);

  const handleOpenPopup = async (): Promise<void> => {
    try {
      await sendRuntimeMessage(
        { type: 'OPEN_EXTENSION_POPUP', payload: { tab: 'settings' } },
        t.extensionUpdatedReload,
        t.emptyWorkerResponse
      );
    } catch {
      // Ignore
    }
  };

  const handleRequestAI = useCallback(async (): Promise<void> => {
    if (aiLoading) return;
    setAiLoading(true);
    setAiError(null);

    try {
      const res = await sendRuntimeMessage<AIExplainResponse>(
        {
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
            fallbackModel: settings.fallbackModel
          }
        },
        t.extensionUpdatedReload,
        t.emptyWorkerResponse
      );
      if (activeRequestKeyRef.current !== requestKey) return;
      if (res.ok) {
        setAiResult(res.data);
      } else {
        setAiError(res.error);
      }
    } catch (err: unknown) {
      if (activeRequestKeyRef.current !== requestKey) return;
      setAiError(err instanceof Error ? err.message : t.aiExplanationFailed);
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
    settings.fallbackModel,
    settings.nativeLang,
    t.aiExplanationFailed,
    t.emptyWorkerResponse,
    t.extensionUpdatedReload,
    videoId,
    videoTitle
  ]);

  const handleRequestAIRef = useRef(handleRequestAI);
  handleRequestAIRef.current = handleRequestAI;

  useEffect(() => {
    if (selection.isPhrase && llmConfigured) {
      void handleRequestAIRef.current();
    }
  }, [requestKey, selection.isPhrase, llmConfigured]);

  const effectiveSentenceTranslation = initialContextTranslation || sentenceTranslation;

  const handleSave = async (): Promise<void> => {
    if (saving) return;
    setSaving(true);
    try {
      const bestTranslation =
        aiResult?.contextualTranslation || quickResult?.translation || selection.target;
      await onSaveCard({
        word: selection.target,
        translation: bestTranslation,
        aiExplanation: aiResult,
        contextTranslation: effectiveSentenceTranslation || undefined
      });
    } finally {
      setSaving(false);
    }
  };

  // Compute safe position relative to the passed playerContainer element
  const playerRect = playerContainer?.getBoundingClientRect() ?? null;
  const pLeft = playerRect?.left ?? 0;
  const pTop = playerRect?.top ?? 0;
  const pWidth = playerRect?.width ?? (typeof window !== 'undefined' ? window.innerWidth : 800);
  const pHeight = playerRect?.height ?? (typeof window !== 'undefined' ? window.innerHeight : 600);

  const targetWidth = pWidth >= 480 ? 420 : 380;
  const popupWidth = Math.min(targetWidth, Math.max(240, pWidth - 24));

  const relAnchorX = selection.anchorRect.left - pLeft;
  const clampedLeft = Math.max(
    12,
    Math.min(relAnchorX - popupWidth / 2, pWidth - popupWidth - 12)
  );

  const maxAllowedHeight = Math.min(340, Math.floor(pHeight * 0.55));
  const effectiveMaxHeight = Math.max(160, Math.min(maxAllowedHeight, pHeight - 24));

  const relAnchorTop = selection.anchorRect.top - pTop;
  const relAnchorBottom = selection.anchorRect.bottom - pTop;

  const spaceAbove = relAnchorTop - 12;
  const spaceBelow = pHeight - 12 - relAnchorBottom;
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
      {/* 1. Pinned Header */}
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
            title={t.pronounce}
            onClick={() => speakText(selection.target, quickResult?.detectedLang || sourceLang)}
            style={{ color: 'var(--ytai-accent)' }}
            className="rounded-lg p-1 transition hover:bg-[rgba(var(--ytai-accent-rgb),0.2)] shrink-0"
          >
            <Volume2 className="h-4 w-4" />
          </button>
          {(aiResult?.partOfSpeech || quickResult?.partOfSpeech) && (
            <span
              className="truncate rounded border px-1.5 py-0.5 text-[10px] font-medium shrink-0"
              style={{
                backgroundColor: 'var(--ytai-surface)',
                borderColor: 'var(--ytai-border)',
                color: 'var(--ytai-text-secondary)'
              }}
            >
              {aiResult?.partOfSpeech || quickResult?.partOfSpeech}
            </span>
          )}
        </div>

        <button
          type="button"
          title={t.closeEsc}
          onClick={() => onClose(true)}
          style={{ color: 'var(--ytai-text-secondary)' }}
          className="rounded-lg p-1 transition hover:bg-[rgba(var(--ytai-accent-rgb),0.15)] hover:opacity-100 shrink-0"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* 2. Scrollable Middle Body */}
      <div className="flex-1 min-h-0 overflow-y-auto space-y-2 py-2 pr-0.5">
        {/* Quick Translation & Compact Synonyms */}
        <div
          className="rounded-xl border p-2.5 text-xs"
          style={{
            backgroundColor: 'var(--ytai-surface)',
            borderColor: 'var(--ytai-border)'
          }}
        >
          {quickLoading ? (
            <div className="flex items-center gap-2" style={{ color: 'var(--ytai-text-secondary)' }}>
              <Loader2 className="h-3.5 w-3.5 animate-spin" style={{ color: 'var(--ytai-accent)' }} />
              <span>{t.translating}</span>
            </div>
          ) : quickError ? (
            <div className="text-xs text-rose-400">{quickError}</div>
          ) : quickResult ? (
            <div>
              <div className="text-sm font-semibold" style={{ color: 'var(--ytai-accent)' }}>
                {quickResult.translation}
              </div>
              {quickResult.alternatives.length > 0 && (
                <div className="mt-1.5 flex flex-wrap items-center gap-1">
                  {quickResult.alternatives.slice(0, 4).map((alt) => (
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
                  {quickResult.alternatives.length > 4 && (
                    <span
                      className="text-[10px] opacity-75"
                      style={{ color: 'var(--ytai-text-secondary)' }}
                    >
                      +{quickResult.alternatives.length - 4}
                    </span>
                  )}
                </div>
              )}
            </div>
          ) : null}
        </div>

        {/* Full Context Subtitle Block */}
        {selection.cue.text && (
          <div
            className="rounded-xl border p-2.5 text-xs transition-all duration-200"
            style={{
              backgroundColor: 'rgba(var(--ytai-bg-rgb), 0.55)',
              borderColor: 'var(--ytai-border)'
            }}
          >
            <div className="flex items-center justify-between gap-1.5">
              <span
                className="text-[10px] font-semibold uppercase tracking-wider select-none"
                style={{ color: 'var(--ytai-text-secondary)' }}
              >
                {t.subtitleContext}
              </span>
              <button
                type="button"
                title={t.pronounceSentence}
                onClick={(e) => {
                  e.stopPropagation();
                  speakText(selection.cue.text, quickResult?.detectedLang || sourceLang);
                }}
                style={{ color: 'var(--ytai-accent)' }}
                className="shrink-0 p-1 transition hover:opacity-80 rounded-md hover:bg-[rgba(var(--ytai-accent-rgb),0.15)]"
              >
                <Volume2 className="h-3.5 w-3.5" />
              </button>
            </div>

            <div
              className="mt-1 text-xs leading-relaxed"
              style={{ color: 'var(--ytai-text-primary)' }}
            >
              &ldquo;{renderHighlightedSentence(selection.cue.text, selection.target)}&rdquo;
            </div>

            {effectiveSentenceTranslation ? (
              <div
                className="mt-1.5 border-t pt-1.5 text-xs italic leading-relaxed animate-in fade-in duration-200"
                style={{
                  borderColor: 'var(--ytai-border)',
                  color: 'var(--ytai-text-secondary)'
                }}
              >
                {effectiveSentenceTranslation}
              </div>
            ) : sentenceLoading ? (
              <div
                className="mt-1.5 flex items-center gap-1.5 text-[11px]"
                style={{ color: 'var(--ytai-text-secondary)' }}
              >
                <Loader2 className="h-3 w-3 animate-spin" style={{ color: 'var(--ytai-accent)' }} />
                <span>{t.loadingContextTrans}</span>
              </div>
            ) : null}
          </div>
        )}

        {/* AI Breakdown Button & Container */}
        <div>
          {!aiResult && !aiLoading && (
            llmConfigured ? (
              <button
                type="button"
                onClick={() => void handleRequestAI()}
                style={{
                  backgroundColor: 'var(--ytai-accent)',
                  color: 'var(--ytai-accent-fg, #ffffff)'
                }}
                className="flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold shadow transition hover:opacity-90"
              >
                <Sparkles className="h-3.5 w-3.5" />
                <span>{t.aiBreakdownBtn}</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void handleOpenPopup()}
                style={{
                  backgroundColor: 'var(--ytai-surface)',
                  borderColor: 'var(--ytai-border)',
                  borderWidth: '1px',
                  borderStyle: 'solid',
                  color: 'var(--ytai-accent)'
                }}
                className="flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold shadow transition hover:opacity-90"
              >
                <Sparkles className="h-3.5 w-3.5" />
                <span>{t.connectAiBtn}</span>
              </button>
            )
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
              <span>{t.analyzingContext}</span>
            </div>
          )}

          {aiError && (
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-2.5 text-xs text-rose-200">
              <div className="break-words">
                {aiError.includes('API key is missing') ? (
                  <span>
                    <strong>{t.aiMissingKeyTitle}</strong> {t.aiMissingKeyDesc}
                  </span>
                ) : aiError.includes('503') ? (
                  <span>
                    <strong>{t.aiOverloadedTitle}</strong> {t.aiOverloadedDesc}
                  </span>
                ) : aiError.includes('429') ? (
                  <span>
                    <strong>{t.aiRateLimitTitle}</strong> {t.aiRateLimitDesc}
                  </span>
                ) : (
                  aiError
                )}
              </div>
              <div className="mt-2 flex items-center gap-2">
                {aiError.includes('API key is missing') ? (
                  <button
                    type="button"
                    onClick={() => void handleOpenPopup()}
                    style={{
                      backgroundColor: 'rgba(var(--ytai-accent-rgb), 0.25)',
                      color: 'var(--ytai-text-primary)'
                    }}
                    className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-semibold transition hover:opacity-90"
                  >
                    <Sparkles className="h-3 w-3" />
                    <span>{t.configureAi}</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void handleRequestAI()}
                    className="flex items-center gap-1.5 rounded-lg bg-rose-500/25 px-2.5 py-1 text-[11px] font-semibold text-rose-100 transition hover:bg-rose-500/40"
                  >
                    <RotateCcw className="h-3 w-3" />
                    <span>{t.retryBtn}</span>
                  </button>
                )}
              </div>
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
                  {t.aiBreakdownHeader} · {aiResult.lemma}
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

              <div
                className="text-sm font-semibold"
                style={{ color: 'var(--ytai-text-primary)' }}
              >
                {aiResult.contextualTranslation}
              </div>

              {aiResult.literalTranslation && (
                <div style={{ color: 'var(--ytai-text-secondary)' }}>
                  <span className="font-medium" style={{ color: 'var(--ytai-text-primary)' }}>
                    {t.literalLabel}{' '}
                  </span>
                  {aiResult.literalTranslation}
                </div>
              )}

              {aiResult.grammarNote && (
                <div style={{ color: 'var(--ytai-text-secondary)' }}>
                  <span className="font-medium" style={{ color: 'var(--ytai-accent)' }}>
                    {t.grammarLabel}{' '}
                  </span>
                  {aiResult.grammarNote}
                </div>
              )}

              {aiResult.nuanceExplanation && (
                <div style={{ color: 'var(--ytai-text-secondary)' }}>
                  <span className="font-medium" style={{ color: 'var(--ytai-accent)' }}>
                    {t.nuanceLabel}{' '}
                  </span>
                  {aiResult.nuanceExplanation}
                </div>
              )}

              {Boolean(aiResult.examples && aiResult.examples.length > 0) && (
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
                    <span>
                      {t.examplesLabel} ({aiResult.examples?.length ?? 0})
                    </span>
                    <ChevronDown
                      className={`h-3.5 w-3.5 transition-transform duration-200 ${
                        showExamples ? 'rotate-180' : ''
                      }`}
                    />
                  </button>

                  {showExamples && (
                    <div className="mt-1.5 space-y-1.5">
                      {aiResult.examples?.map((ex, idx) => (
                        <div
                          key={idx}
                          className="rounded-lg border p-2"
                          style={{
                            backgroundColor: 'rgba(var(--ytai-bg-rgb), 0.65)',
                            borderColor: 'var(--ytai-border)'
                          }}
                        >
                          <div
                            className="flex items-start justify-between gap-1.5"
                            style={{ color: 'var(--ytai-text-primary)' }}
                          >
                            <span>{ex.source}</span>
                            <button
                              type="button"
                              onClick={() => speakText(ex.source, quickResult?.detectedLang || sourceLang)}
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
      </div>

      {/* 3. Pinned Footer */}
      <div
        className="shrink-0 flex items-center justify-between gap-2 border-t pt-2"
        style={{ borderColor: 'var(--ytai-border)' }}
      >
        <span className="text-[10px] truncate" style={{ color: 'var(--ytai-text-secondary)' }}>
          {t.popupShortcuts}
        </span>

        <button
          type="button"
          disabled={saving || quickLoading}
          onClick={() => void handleSave()}
          style={
            isSaved
              ? {
                  backgroundColor: 'var(--ytai-accent)',
                  color: 'var(--ytai-accent-fg, #ffffff)'
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
              <span>{t.savedBtn}</span>
            </>
          ) : (
            <>
              <Bookmark className="h-3.5 w-3.5" />
              <span>{t.saveWordBtn}</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}
