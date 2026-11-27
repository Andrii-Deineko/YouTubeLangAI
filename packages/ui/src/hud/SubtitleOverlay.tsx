import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactElement
} from 'react';
import { ArrowUpDown, GripHorizontal, Lock, Minimize2, Play, Unlock } from 'lucide-react';
import {
  DEFAULT_SUBTITLE_BOX_SIZE,
  isValidTranslationText,
  type ActiveListeningMode,
  type FontFamily,
  type FontWeight,
  type SubtitleBoxSize,
  type SubtitleCue,
  type SubtitlePosition,
  type SubtitleTrackMode,
  type TextOutline,
  type TranslationRuntimeStatus,
  type UiLanguage,
  type UserSettings,
  type WordToken
} from '@langai/contracts';
import { getUiStrings } from '../i18n/translations';
import { FONT_FAMILY_STACKS } from '../styles/themes';
import { useDraggableSubtitleBox } from './hooks/useDraggableSubtitleBox';
import { useResizableSubtitleBox } from './hooks/useResizableSubtitleBox';

const TEXT_OUTLINES: Record<
  TextOutline,
  { textShadow: string; WebkitTextStroke: string; paintOrder: string }
> = {
  none: {
    textShadow: 'none',
    WebkitTextStroke: '0px transparent',
    paintOrder: 'stroke fill'
  },
  shadow: {
    textShadow:
      'var(--ytai-text-shadow, 0 0 2px #000, -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, 0 2px 4px rgba(0,0,0,0.95))',
    WebkitTextStroke: 'var(--ytai-text-stroke, 1.5px #000000)',
    paintOrder: 'stroke fill'
  },
  outline: {
    textShadow:
      '0 0 3px #000, -1.5px -1.5px 0 #000, 1.5px -1.5px 0 #000, -1.5px 1.5px 0 #000, 1.5px 1.5px 0 #000, 0 2px 6px rgba(0,0,0,0.95)',
    WebkitTextStroke: '2.2px #000000',
    paintOrder: 'stroke fill'
  }
};

export interface WordSelectionPayload {
  target: string;
  cue: SubtitleCue;
  anchorRect: { left: number; top: number; bottom: number; width: number };
  isPhrase: boolean;
}

export interface SubtitleOverlayProps {
  primaryCue: SubtitleCue | null;
  translatedCue: SubtitleCue | null;
  translationStatus?: TranslationRuntimeStatus;
  subtitleTrackMode?: SubtitleTrackMode;
  activeListeningMode: ActiveListeningMode;
  altPressed: boolean;
  subtitleFontSize?: number;
  translationFontSize?: number;
  translationScale?: number;
  fontFamily?: FontFamily;
  fontWeight?: FontWeight;
  backdropOpacity?: number;
  textOutline?: TextOutline;
  position: SubtitlePosition | null;
  onUpdatePosition: (position: SubtitlePosition | null) => void;
  selectedTarget: string | null;
  onSelectTarget: (selection: WordSelectionPayload) => void;
  boxFixed?: boolean;
  boxSize?: SubtitleBoxSize | null;
  boxCompact?: boolean;
  autoPauseCountdown?: number | null;
  onResumeAutoPause?: () => void;
  uiLanguage?: UiLanguage;
  playerContainer?: HTMLElement | null;
  bottomOffset?: number;
  onUpdateSettings?: (partial: Partial<UserSettings>) => void;
}

interface WordTokenItemProps {
  token: WordToken;
  isSelected: boolean;
  onSelect: (e: MouseEvent<HTMLSpanElement>, token: WordToken) => void;
  onEnter: (e: React.KeyboardEvent<HTMLSpanElement>, token: WordToken) => void;
}

const WordTokenItem = memo(function WordTokenItem({
  token,
  isSelected,
  onSelect,
  onEnter
}: WordTokenItemProps): ReactElement {
  if (!token.isWord) {
    return <span className="whitespace-pre-wrap">{token.text}</span>;
  }

  return (
    <span
      role="button"
      tabIndex={0}
      onClick={(e) => onSelect(e, token)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          onEnter(e, token);
        }
      }}
      style={
        isSelected
          ? {
              backgroundColor: 'rgba(var(--ytai-accent-rgb), 0.75)',
              color: '#ffffff'
            }
          : undefined
      }
      className={`inline rounded px-0.5 transition-colors cursor-pointer ${
        isSelected ? '' : 'hover:bg-[rgba(var(--ytai-accent-rgb),0.35)]'
      }`}
    >
      {token.text}
    </span>
  );
});

export function SubtitleOverlay({
  primaryCue,
  translatedCue,
  translationStatus,
  subtitleTrackMode = 'dual',
  activeListeningMode,
  altPressed,
  subtitleFontSize,
  translationFontSize,
  translationScale,
  fontFamily,
  fontWeight,
  backdropOpacity,
  textOutline,
  position,
  onUpdatePosition,
  selectedTarget,
  onSelectTarget,
  boxFixed = false,
  boxSize = null,
  boxCompact = false,
  autoPauseCountdown = null,
  onResumeAutoPause,
  uiLanguage = 'en',
  playerContainer,
  bottomOffset = 48,
  onUpdateSettings
}: SubtitleOverlayProps): ReactElement | null {
  const t = getUiStrings(uiLanguage);
  const [isBoxHovered, setIsBoxHovered] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const contentViewportRef = useRef<HTMLDivElement | null>(null);
  const contentInnerRef = useRef<HTMLDivElement | null>(null);
  const manualScrolledRef = useRef(false);
  const isBoxHoveredRef = useRef(false);
  isBoxHoveredRef.current = isBoxHovered;

  const {
    isResizing,
    hoveredHandle,
    setHoveredHandle,
    isCompactMode,
    compactFontScale,
    compactFontScaleRef,
    setCompactFontScale,
    detentProgress,
    isContentOverflowing,
    setIsContentOverflowing,
    handleResizeStart,
    handleToggleFixed
  } = useResizableSubtitleBox({
    containerRef,
    contentInnerRef,
    playerContainer,
    boxFixed,
    boxSize,
    boxCompact,
    position,
    onUpdatePosition,
    onUpdateSettings
  });

  const basePrimaryFontSize = Math.min(56, Math.max(12, subtitleFontSize ?? 20));
  const primaryFontSize = isCompactMode
    ? Math.max(10, Math.round(basePrimaryFontSize * compactFontScale))
    : basePrimaryFontSize;
  const effectiveTranslationScale = translationScale ?? 0.85;
  const baseTranslatedFontSize = Math.min(
    48,
    Math.max(12, translationFontSize ?? Math.round(basePrimaryFontSize * effectiveTranslationScale))
  );
  const translatedFontSize = isCompactMode
    ? Math.max(9, Math.round(baseTranslatedFontSize * compactFontScale))
    : baseTranslatedFontSize;

  const {
    isDragging,
    isDraggingRef,
    justFinishedDragRef,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handleResetPosition
  } = useDraggableSubtitleBox({
    containerRef,
    playerContainer,
    position,
    primaryFontSize,
    onUpdatePosition,
    onUpdateSettings
  });

  const hasCue = Boolean(primaryCue || translatedCue);
  const hasActiveCountdown =
    typeof autoPauseCountdown === 'number' && autoPauseCountdown > 0;

  const isHiddenMode = activeListeningMode === 'hidden';
  const isBlurMode = activeListeningMode === 'blur';
  const isTranslationOnly = subtitleTrackMode === 'translation';
  const isOriginalOnly = subtitleTrackMode === 'original';
  const isAltRevealed = altPressed || Boolean(selectedTarget);

  const isRevealedInHidden = altPressed || Boolean(selectedTarget);
  const isCardVisible = !isHiddenMode || isRevealedInHidden;

  const textTypographyStyle: React.CSSProperties = {
    fontFamily: FONT_FAMILY_STACKS[fontFamily ?? 'sans'] || FONT_FAMILY_STACKS.sans,
    fontWeight: fontWeight === 'bold' ? 700 : 500,
    ...(TEXT_OUTLINES[textOutline ?? 'shadow'] || TEXT_OUTLINES.shadow)
  };

  const bgAlpha = Math.max(0, Math.min(100, backdropOpacity ?? 80)) / 100;
  const maxWidth = 'min(860px, 84%)';
  const dynamicPadX = Math.round(Math.max(14, primaryFontSize * 0.75));
  const dynamicPadY = Math.round(Math.max(6, primaryFontSize * 0.4));
  const dynamicRadius = Math.round(Math.max(12, Math.min(26, primaryFontSize * 0.5)));

  const handleTokenClick = useCallback(
    (e: MouseEvent<HTMLSpanElement>, token: WordToken): void => {
      e.stopPropagation();
      if (isDraggingRef.current || justFinishedDragRef.current) {
        return;
      }

      const selection = window.getSelection();
      const selectedText = selection?.toString().trim() ?? '';
      if (selectedText.length > 0 && selectedText.includes(' ')) {
        return;
      }

      if (!primaryCue) return;
      const rect = e.currentTarget.getBoundingClientRect();
      onSelectTarget({
        target: token.text,
        cue: primaryCue,
        anchorRect: {
          left: rect.left + rect.width / 2,
          top: rect.top,
          bottom: rect.bottom,
          width: rect.width
        },
        isPhrase: false
      });
    },
    [isDraggingRef, justFinishedDragRef, primaryCue, onSelectTarget]
  );

  const handleTokenEnter = useCallback(
    (e: React.KeyboardEvent<HTMLSpanElement>, token: WordToken): void => {
      e.preventDefault();
      e.stopPropagation();
      if (!primaryCue) return;
      const rect = e.currentTarget.getBoundingClientRect();
      onSelectTarget({
        target: token.text,
        cue: primaryCue,
        anchorRect: {
          left: rect.left + rect.width / 2,
          top: rect.top,
          bottom: rect.bottom,
          width: rect.width
        },
        isPhrase: false
      });
    },
    [primaryCue, onSelectTarget]
  );

  const handleMouseUp = (e: MouseEvent<HTMLDivElement>): void => {
    e.stopPropagation();
    if (isDraggingRef.current || isDragging || justFinishedDragRef.current) {
      return;
    }

    const rootNode = e.currentTarget.getRootNode();
    let selection: Selection | null = null;
    if (rootNode instanceof ShadowRoot) {
      const shadowWithSelection = rootNode as ShadowRoot & {
        getSelection?: () => Selection | null;
      };
      if (typeof shadowWithSelection.getSelection === 'function') {
        selection = shadowWithSelection.getSelection();
      }
    }
    if (!selection) {
      selection = window.getSelection();
    }

    const selectedText = selection?.toString().replace(/\s+/g, ' ').trim() ?? '';
    if (!selectedText || !selectedText.includes(' ') || !primaryCue) return;

    const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
    const rect = range?.getBoundingClientRect() ?? e.currentTarget.getBoundingClientRect();

    onSelectTarget({
      target: selectedText,
      cue: primaryCue,
      anchorRect: {
        left: rect.left + rect.width / 2,
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width
      },
      isPhrase: true
    });
  };

  const renderedTokens = useMemo(() => {
    if (!primaryCue) return null;
    return primaryCue.tokens.map((token) => {
      const isSelected =
        Boolean(selectedTarget) &&
        selectedTarget?.toLowerCase() === token.text.toLowerCase();

      return (
        <WordTokenItem
          key={token.id}
          token={token}
          isSelected={isSelected}
          onSelect={handleTokenClick}
          onEnter={handleTokenEnter}
        />
      );
    });
  }, [primaryCue, selectedTarget, handleTokenClick, handleTokenEnter]);

  // Auto-scale font inside compact mode & detect overflow
  useEffect(() => {
    if (!boxFixed || !isCompactMode || isResizing || !hasCue) {
      if (!isCompactMode) {
        compactFontScaleRef.current = 1;
        setCompactFontScale(1);
        setIsContentOverflowing(false);
      }
      return;
    }

    const rafId = window.requestAnimationFrame(() => {
      const vp = contentViewportRef.current;
      const inner = contentInnerRef.current;
      if (!vp || !inner) return;

      const availH = vp.clientHeight;
      if (availH <= 0) return;

      const minReadableScale = Math.max(0.45, 10 / Math.max(12, basePrimaryFontSize));
      const naturalH = inner.scrollHeight / Math.max(0.4, compactFontScaleRef.current);
      const desiredScale =
        naturalH > availH + 2
          ? Math.max(minReadableScale, Math.min(1, availH / naturalH))
          : 1;

      if (Math.abs(desiredScale - compactFontScaleRef.current) > 0.03) {
        compactFontScaleRef.current = desiredScale;
        setCompactFontScale(desiredScale);
      }

      window.requestAnimationFrame(() => {
        const vpAfter = contentViewportRef.current;
        if (!vpAfter) return;
        setIsContentOverflowing(vpAfter.scrollHeight > vpAfter.clientHeight + 3);
      });
    });

    return () => window.cancelAnimationFrame(rafId);
  }, [
    boxFixed,
    isCompactMode,
    isResizing,
    hasCue,
    boxSize?.width,
    boxSize?.height,
    primaryCue?.id,
    primaryCue?.translation,
    translatedCue?.text,
    basePrimaryFontSize,
    compactFontScaleRef,
    setCompactFontScale,
    setIsContentOverflowing
  ]);

  // Gentle auto-scroll fallback if text exceeds box height (pauses on hover/wheel)
  useEffect(() => {
    const viewport = contentViewportRef.current;
    if (!viewport) return;
    viewport.scrollTop = 0;
    manualScrolledRef.current = false;

    if (!boxFixed || isResizing || !hasCue) return;

    let rafId: number | null = null;
    const startTimer = window.setTimeout(() => {
      const vp = contentViewportRef.current;
      if (!vp || isBoxHoveredRef.current || manualScrolledRef.current) return;
      const overflowPx = vp.scrollHeight - vp.clientHeight;
      if (overflowPx <= 4) return;

      const cueDurationMs = primaryCue
        ? Math.max(1500, Math.min(4000, (primaryCue.endTime - primaryCue.startTime) * 1000 - 900))
        : 2200;
      const startTime = performance.now();

      const step = (now: number): void => {
        if (!contentViewportRef.current || isBoxHoveredRef.current || manualScrolledRef.current) {
          return;
        }
        const progress = Math.min(1, (now - startTime) / cueDurationMs);
        contentViewportRef.current.scrollTop = Math.round(overflowPx * progress);
        if (progress < 1) {
          rafId = window.requestAnimationFrame(step);
        }
      };

      rafId = window.requestAnimationFrame(step);
    }, 650);

    return () => {
      window.clearTimeout(startTimer);
      if (rafId !== null) window.cancelAnimationFrame(rafId);
    };
  }, [
    primaryCue,
    translatedCue?.text,
    boxFixed,
    isCompactMode,
    compactFontScale,
    isResizing,
    hasCue
  ]);

  if (!hasCue && !boxFixed && !hasActiveCountdown && !isDragging && !isResizing) return null;

  const defaultFixedSize = DEFAULT_SUBTITLE_BOX_SIZE;
  const effectiveWidth = boxSize?.width ?? defaultFixedSize.width;
  const effectiveHeight = boxSize?.height ?? defaultFixedSize.height;

  const positionStyle: React.CSSProperties = position
    ? boxFixed && !isCompactMode && !isDragging && !isResizing
      ? {
          position: 'absolute',
          left: `${position.xPercent}%`,
          top: 'auto',
          right: 'auto',
          bottom: `max(8px, calc(${100 - position.yPercent}% - ${Math.round(effectiveHeight / 2)}px))`,
          transform: 'translateX(-50%)'
        }
      : {
          position: 'absolute',
          left: `${position.xPercent}%`,
          top: `${position.yPercent}%`,
          bottom: 'auto',
          right: 'auto',
          transform: 'translate(-50%, -50%)'
        }
    : {
        position: 'absolute',
        left: '50%',
        top: 'auto',
        right: 'auto',
        bottom: `${bottomOffset}px`,
        transform: 'translateX(-50%)'
      };

  const isDraggingOrResizing = isDragging || isResizing;
  const isResizeHovered = isResizing || hoveredHandle !== null;
  const showResizeFrame = isBoxHovered || isDragging || isResizeHovered;
  const candidateTranslation =
    primaryCue?.translation || translatedCue?.translation || translatedCue?.text;
  const validTranslation = isValidTranslationText(candidateTranslation)
    ? candidateTranslation
    : null;
  const isTranslationCooldown =
    !isOriginalOnly &&
    Boolean(primaryCue) &&
    !validTranslation &&
    translationStatus?.state === 'cooldown';
  const hasModeHint =
    (isTranslationOnly && isAltRevealed) ||
    (!isTranslationOnly && isBlurMode && !(altPressed || Boolean(selectedTarget))) ||
    (isHiddenMode && isRevealedInHidden);

  return (
    <div className="pointer-events-none absolute inset-0 z-10 overflow-visible">
      <div
        ref={containerRef}
        data-mode={activeListeningMode}
        data-alt-pressed={altPressed ? 'true' : 'false'}
        data-has-selection={selectedTarget ? 'true' : 'false'}
        className={`ytai-subtitle-overlay text-center shadow-2xl select-none relative ${
          isDraggingOrResizing ? '' : 'transition-[bottom,opacity] duration-200 ease-out'
        } ${
          isCardVisible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        } ${isDragging ? 'cursor-grabbing' : ''}`}
        style={{
          ...positionStyle,
          ...(boxFixed
            ? isResizing || isCompactMode
              ? {
                  width: `min(${effectiveWidth}px, calc(100% - 16px))`,
                  height: `min(${effectiveHeight}px, calc(100% - 16px))`,
                  display: 'flex',
                  flexDirection: 'column',
                  boxSizing: 'border-box'
                }
              : {
                  width: `min(${effectiveWidth}px, calc(100% - 16px))`,
                  minHeight: `min(${effectiveHeight}px, calc(100% - 16px))`,
                  height: 'auto',
                  maxHeight: `min(max(${effectiveHeight}px, 46%), calc(100% - 24px))`,
                  display: 'flex',
                  flexDirection: 'column',
                  boxSizing: 'border-box'
                }
            : {
                maxWidth
              }),
          transition: isDraggingOrResizing
            ? 'none'
            : 'min-height 180ms ease-out, max-height 180ms ease-out, bottom 200ms cubic-bezier(0, 0, 0.2, 1), opacity 150ms ease-out',
          padding: `${dynamicPadY}px ${dynamicPadX}px`,
          borderRadius: `${dynamicRadius}px`,
          backgroundColor:
            bgAlpha <= 0
              ? 'transparent'
              : `rgba(var(--ytai-bg-rgb), ${bgAlpha})`,
          borderColor: bgAlpha <= 0 ? 'transparent' : 'var(--ytai-border)',
          borderWidth: '1px',
          borderStyle: 'solid',
          backdropFilter: bgAlpha <= 0 ? 'none' : 'blur(var(--ytai-backdrop-blur, 12px))',
          WebkitBackdropFilter: bgAlpha <= 0 ? 'none' : 'blur(var(--ytai-backdrop-blur, 12px))',
          boxShadow: bgAlpha <= 0 ? 'none' : undefined
        }}
        onMouseEnter={() => setIsBoxHovered(true)}
        onMouseLeave={() => {
          setIsBoxHovered(false);
          setHoveredHandle(null);
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onMouseUp={handleMouseUp}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top bar: Drag grip handle + Lock button + Mode hint */}
        <div className="mb-1 flex items-center justify-between gap-2 select-none flex-shrink-0 w-full">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onDoubleClick={handleResetPosition}
              title={t.dragTooltip}
              className="flex items-center gap-1 rounded px-1 py-0.5 opacity-60 transition hover:bg-[rgba(var(--ytai-accent-rgb),0.18)] hover:opacity-100 cursor-grab active:cursor-grabbing"
              style={{ color: 'var(--ytai-text-secondary)' }}
              onClick={(e) => e.stopPropagation()}
            >
              <GripHorizontal className="h-3.5 w-3.5" />
            </button>

            <button
              type="button"
              onClick={handleToggleFixed}
              title={boxFixed ? t.lockOnTooltip : t.lockOffTooltip}
              className="flex items-center gap-1 rounded px-1 py-0.5 opacity-60 transition hover:bg-[rgba(var(--ytai-accent-rgb),0.18)] hover:opacity-100 cursor-pointer"
              style={{ color: boxFixed ? 'var(--ytai-accent)' : 'var(--ytai-text-secondary)' }}
            >
              {boxFixed ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
            </button>

            {hasActiveCountdown && autoPauseCountdown !== null && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onResumeAutoPause?.();
                }}
                title={t.resumeNowTitle}
                className="flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10.5px] font-bold leading-none transition hover:opacity-90 cursor-pointer animate-in fade-in duration-150"
                style={{
                  backgroundColor: 'rgba(var(--ytai-accent-rgb), 0.24)',
                  borderColor: 'var(--ytai-accent)',
                  color: 'var(--ytai-accent)',
                  boxShadow: '0 0 10px rgba(var(--ytai-accent-rgb), 0.38)'
                }}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse" />
                <span>
                  {autoPauseCountdown < 10
                    ? autoPauseCountdown.toFixed(1)
                    : Math.round(autoPauseCountdown)}
                  {t.secShort}
                </span>
                <Play className="h-2.5 w-2.5 fill-current" />
              </button>
            )}

            {boxFixed && isCompactMode && (
              <span
                title={isContentOverflowing ? t.overflowBadgeTitle : t.compactBadgeTitle}
                className="flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 font-mono text-[9.5px] font-semibold leading-none select-none"
                style={
                  isContentOverflowing
                    ? {
                        backgroundColor: 'rgba(var(--ytai-accent-rgb), 0.24)',
                        borderColor: 'var(--ytai-accent)',
                        color: 'var(--ytai-accent)'
                      }
                    : {
                        backgroundColor: 'var(--ytai-control-bg)',
                        borderColor: 'var(--ytai-border)',
                        color: 'var(--ytai-text-secondary)'
                      }
                }
              >
                {isContentOverflowing ? (
                  <ArrowUpDown className="h-2.5 w-2.5" />
                ) : (
                  <Minimize2 className="h-2.5 w-2.5" />
                )}
                <span>{Math.round(compactFontScale * 100)}%</span>
              </span>
            )}
          </div>

          {detentProgress > 0 && (
            <div
              className="text-[10.5px] leading-tight tracking-wide font-semibold select-none"
              style={{ color: 'var(--ytai-accent)' }}
            >
              {t.detentPullHint}
            </div>
          )}

          {detentProgress === 0 && isTranslationOnly && isAltRevealed && (
            <div
              className="text-[11px] leading-tight tracking-wide font-medium select-none transition-colors"
              style={{ color: 'var(--ytai-accent)' }}
            >
              {t.altOriginalHint}
            </div>
          )}

          {!isTranslationOnly && isBlurMode && (
            <div
              className={`ytai-blur-hint text-[11px] leading-tight tracking-wide font-medium select-none transition-colors ${
                altPressed || selectedTarget ? 'hidden' : ''
              }`}
              style={{ color: 'var(--ytai-accent)' }}
            >
              {t.blurHint}
            </div>
          )}

          {isHiddenMode && isRevealedInHidden && (
            <div
              className="text-[11px] leading-tight tracking-wide font-medium select-none transition-colors"
              style={{ color: 'var(--ytai-accent)' }}
            >
              {t.stealthHint}
            </div>
          )}

          {!hasModeHint && isTranslationCooldown && (
            <div
              className="text-[11px] leading-tight opacity-75 select-none"
              style={{ color: 'var(--ytai-text-muted, var(--ytai-text-secondary))' }}
            >
              {t.retryingTranslation}
            </div>
          )}

          <div className="w-8" aria-hidden="true" />
        </div>

        {/* Subtitle Content */}
        <div
          ref={contentViewportRef}
          onWheel={(e) => {
            if (boxFixed) {
              manualScrolledRef.current = true;
              e.stopPropagation();
            }
          }}
          className={`w-full text-center ${
            boxFixed ? 'flex-1 flex flex-col items-center overflow-y-auto min-h-0' : ''
          }`}
          style={
            boxFixed
              ? {
                  scrollbarWidth: 'thin',
                  scrollbarColor: 'var(--ytai-border) transparent'
                }
              : undefined
          }
        >
          <div
            ref={contentInnerRef}
            className={`w-full flex flex-col items-center ${boxFixed ? 'my-auto' : ''}`}
          >
            {primaryCue && (!isTranslationOnly || isAltRevealed) && (
              <div
                className={`ytai-blur-target select-text ${
                  isTranslationOnly ? 'opacity-90' : ''
                }`}
                style={{
                  color: 'var(--ytai-text-primary)',
                  fontSize: `${isTranslationOnly ? Math.max(12, Math.round(primaryFontSize * 0.9)) : primaryFontSize}px`,
                  lineHeight: 1.25,
                  ...textTypographyStyle
                }}
              >
                {renderedTokens}
              </div>
            )}

            {!isOriginalOnly && (
              <>
                {validTranslation ? (
                  <div
                    className={`ytai-blur-target select-none ${
                      isTranslationOnly ? 'font-medium' : ''
                    }`}
                    style={{
                      color: isTranslationOnly
                        ? 'var(--ytai-text-primary)'
                        : 'var(--ytai-text-secondary)',
                      fontSize: `${translatedFontSize}px`,
                      lineHeight: 1.22,
                      marginTop: primaryCue && (!isTranslationOnly || isAltRevealed) ? '4px' : '0px',
                      ...textTypographyStyle
                    }}
                  >
                    {validTranslation}
                  </div>
                ) : primaryCue && isTranslationOnly ? (
                  <div
                    className={`select-none text-center ${
                      isTranslationCooldown
                        ? 'opacity-70 text-xs'
                        : 'opacity-60 animate-pulse tracking-widest'
                    }`}
                    style={{
                      color: 'var(--ytai-text-muted, var(--ytai-text-secondary))',
                      fontSize: isTranslationCooldown ? '12px' : `${translatedFontSize}px`,
                      lineHeight: 1.22,
                      marginTop: primaryCue && (!isTranslationOnly || isAltRevealed) ? '4px' : '0px',
                      ...textTypographyStyle
                    }}
                  >
                    {isTranslationCooldown ? t.retryingTranslation : '···'}
                  </div>
                ) : null}
              </>
            )}
          </div>
        </div>

        {/* Perimeter Detent Progress Bar */}
        {detentProgress > 0 && (
          <svg
            className="pointer-events-none absolute inset-0 h-full w-full overflow-visible z-30"
            aria-hidden="true"
          >
            <rect
              x="1"
              y="1"
              width="calc(100% - 2px)"
              height="calc(100% - 2px)"
              rx={dynamicRadius}
              ry={dynamicRadius}
              fill="none"
              stroke="var(--ytai-accent)"
              strokeWidth="2.5"
              pathLength={100}
              strokeDasharray={100}
              strokeDashoffset={Math.max(0, 100 - detentProgress * 100)}
              style={{
                filter: 'drop-shadow(0 0 6px var(--ytai-accent))'
              }}
            />
          </svg>
        )}

        {/* HUD Resize Frame */}
        <div
          className={`pointer-events-none absolute inset-0 transition-[opacity,border-color] duration-200 ${
            showResizeFrame ? 'opacity-100' : 'opacity-0'
          }`}
          style={{
            borderRadius: `${dynamicRadius}px`,
            border: `1px solid color-mix(in srgb, var(--ytai-accent) ${isResizeHovered ? 50 : 35}%, transparent)`
          }}
        >
          {[
            {
              key: 'top-left',
              posClass: '-top-[1px] -left-[1px]',
              style: {
                borderTop: '2.5px solid var(--ytai-accent)',
                borderLeft: '2.5px solid var(--ytai-accent)',
                borderTopLeftRadius: `${dynamicRadius}px`
              }
            },
            {
              key: 'top-right',
              posClass: '-top-[1px] -right-[1px]',
              style: {
                borderTop: '2.5px solid var(--ytai-accent)',
                borderRight: '2.5px solid var(--ytai-accent)',
                borderTopRightRadius: `${dynamicRadius}px`
              }
            },
            {
              key: 'bottom-left',
              posClass: '-bottom-[1px] -left-[1px]',
              style: {
                borderBottom: '2.5px solid var(--ytai-accent)',
                borderLeft: '2.5px solid var(--ytai-accent)',
                borderBottomLeftRadius: `${dynamicRadius}px`
              }
            },
            {
              key: 'bottom-right',
              posClass: '-bottom-[1px] -right-[1px]',
              style: {
                borderBottom: '2.5px solid var(--ytai-accent)',
                borderRight: '2.5px solid var(--ytai-accent)',
                borderBottomRightRadius: `${dynamicRadius}px`
              }
            }
          ].map((corner) => (
            <div
              key={corner.key}
              className={`absolute ${corner.posClass} w-[14px] h-[14px] transition-[filter] duration-150`}
              style={{
                ...corner.style,
                filter: isResizeHovered
                  ? 'drop-shadow(0 0 5px var(--ytai-accent))'
                  : 'drop-shadow(0 0 3px color-mix(in srgb, var(--ytai-accent) 45%, transparent))'
              }}
            />
          ))}
        </div>

        {/* Interactive Resize Handles (Edges and Corners) */}
        {(
          [
            { handle: 'top', cls: '-top-1 left-3 right-3 h-2 cursor-ns-resize z-20' },
            { handle: 'bottom', cls: '-bottom-1 left-3 right-3 h-2 cursor-ns-resize z-20' },
            { handle: 'left', cls: '-left-1 top-3 bottom-3 w-2 cursor-ew-resize z-20' },
            { handle: 'right', cls: '-right-1 top-3 bottom-3 w-2 cursor-ew-resize z-20' },
            { handle: 'top-left', cls: '-top-1.5 -left-1.5 w-3.5 h-3.5 cursor-nwse-resize z-21' },
            { handle: 'top-right', cls: '-top-1.5 -right-1.5 w-3.5 h-3.5 cursor-nesw-resize z-21' },
            { handle: 'bottom-left', cls: '-bottom-1.5 -left-1.5 w-3.5 h-3.5 cursor-nesw-resize z-21' },
            { handle: 'bottom-right', cls: '-bottom-1.5 -right-1.5 w-3.5 h-3.5 cursor-nwse-resize z-21' }
          ] as const
        ).map(({ handle, cls }) => (
          <div
            key={handle}
            className={`absolute ${cls}`}
            onPointerDown={(e) => handleResizeStart(handle, e)}
            onMouseEnter={() => setHoveredHandle(handle)}
            onMouseLeave={() => setHoveredHandle((h) => (h === handle ? null : h))}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          />
        ))}
      </div>
    </div>
  );
}
