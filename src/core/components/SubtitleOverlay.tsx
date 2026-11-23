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
import { GripHorizontal } from 'lucide-react';
import type { ActiveListeningMode, SubtitlePosition, SubtitleScale } from '../types/settings';
import type { SubtitleCue, WordToken } from '../types/subtitles';
import { getSubtitleFontSizes } from '../styles/themes';

export interface WordSelectionPayload {
  target: string;
  cue: SubtitleCue;
  anchorRect: { left: number; top: number; bottom: number; width: number };
  isPhrase: boolean;
}

interface SubtitleOverlayProps {
  primaryCue: SubtitleCue | null;
  translatedCue: SubtitleCue | null;
  showDualSubtitles?: boolean;
  showTranslation?: boolean;
  activeListeningMode: ActiveListeningMode;
  altPressed: boolean;
  fontSize?: number;
  scale?: SubtitleScale;
  overlayOpacity?: number;
  position: SubtitlePosition | null;
  onUpdatePosition: (position: SubtitlePosition | null) => void;
  selectedTarget: string | null;
  onSelectTarget: (selection: WordSelectionPayload) => void;
}

const DRAG_THRESHOLD = 5;

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

function getPlayerContainer(node: HTMLElement | null): HTMLElement | null {
  if (!node) {
    return document.querySelector('#movie_player') ?? document.querySelector('.html5-video-player');
  }
  return (
    node.closest('#movie_player') ??
    document.querySelector('#movie_player') ??
    node.closest('.html5-video-player') ??
    document.querySelector('.html5-video-player')
  );
}

function getYouTubeChromeBottomHeight(playerEl: HTMLElement | null): number {
  if (!playerEl) return 48;
  const chromeBottom = playerEl.querySelector<HTMLElement>('.ytp-chrome-bottom');
  if (!chromeBottom) return 48;
  const rect = chromeBottom.getBoundingClientRect();
  return rect.height > 0 ? rect.height : 48;
}

function areYouTubeControlsVisible(playerEl: HTMLElement | null): boolean {
  if (!playerEl) return false;
  return !playerEl.classList.contains('ytp-autohide');
}

function getDefaultSubtitleBottom(playerEl: HTMLElement | null): number {
  const isControlsVisible = areYouTubeControlsVisible(playerEl);
  if (!isControlsVisible) {
    return 28;
  }
  const ytBottomHeight = getYouTubeChromeBottomHeight(playerEl);
  return Math.max(68, ytBottomHeight + 16);
}

export function SubtitleOverlay({
  primaryCue,
  translatedCue,
  showDualSubtitles,
  showTranslation,
  activeListeningMode,
  altPressed,
  fontSize,
  scale,
  overlayOpacity,
  position,
  onUpdatePosition,
  selectedTarget,
  onSelectTarget
}: SubtitleOverlayProps): ReactElement | null {
  const [isDragging, setIsDragging] = useState(false);
  const [bottomOffset, setBottomOffset] = useState<number>(() => {
    if (typeof document === 'undefined') return 68;
    return getDefaultSubtitleBottom(document.querySelector<HTMLElement>('#movie_player'));
  });

  const containerRef = useRef<HTMLDivElement | null>(null);
  const isDraggingRef = useRef(false);
  const justFinishedDragRef = useRef(false);
  const currentDragPosRef = useRef<SubtitlePosition | null>(null);
  const dragStartRef = useRef<{
    pointerX: number;
    pointerY: number;
    boxCenterX: number;
    boxCenterY: number;
    playerWidth: number;
    playerHeight: number;
    boxWidth: number;
    boxHeight: number;
  } | null>(null);

  // Sync external position changes (e.g. reset) to container styling
  useEffect(() => {
    if (!position && containerRef.current) {
      containerRef.current.style.top = 'auto';
      containerRef.current.style.left = '50%';
      containerRef.current.style.transform = 'translateX(-50%)';
    }
  }, [position]);

  // Dynamically track YouTube controls autohide and bottom bar height with RAF throttle
  useEffect(() => {
    const playerEl = getPlayerContainer(containerRef.current);
    if (!playerEl) return;

    let rafId: number | null = null;
    const updateBottomOffset = (): void => {
      if (rafId !== null) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = null;
        const nextOffset = getDefaultSubtitleBottom(playerEl);
        setBottomOffset((prev) => (prev !== nextOffset ? nextOffset : prev));
      });
    };

    updateBottomOffset();

    const observer = new MutationObserver(() => {
      updateBottomOffset();
    });

    observer.observe(playerEl, {
      attributes: true,
      attributeFilter: ['class']
    });

    window.addEventListener('resize', updateBottomOffset);

    return () => {
      if (rafId !== null) window.cancelAnimationFrame(rafId);
      observer.disconnect();
      window.removeEventListener('resize', updateBottomOffset);
    };
  }, []);

  const isHiddenMode = activeListeningMode === 'hidden';
  const isBlurMode = activeListeningMode === 'blur';

  // In 'hidden' mode, mouse hover intentionally does NOT reveal subtitles; only Alt or active selection does.
  const isRevealedInHidden = altPressed || Boolean(selectedTarget);
  const isCardVisible = !isHiddenMode || isRevealedInHidden;

  const effectiveFontSize = fontSize ?? 20;
  const fontSizes = getSubtitleFontSizes(effectiveFontSize, scale);

  const maxPercent =
    effectiveFontSize <= 24
      ? 88
      : Math.min(94, Math.round(88 + ((effectiveFontSize - 24) / (56 - 24)) * 6));
  const maxWidth = effectiveFontSize <= 24 ? 'min(780px, 88%)' : `${maxPercent}%`;

  const dynamicPadX = Math.round(Math.max(14, effectiveFontSize * 0.75));
  const dynamicPadY = Math.round(Math.max(6, effectiveFontSize * 0.4));
  const dynamicRadius = Math.round(Math.max(12, Math.min(26, effectiveFontSize * 0.5)));

  // Recalculate bounds and clamp custom position when font size grows
  useEffect(() => {
    if (!position || isDraggingRef.current) return;
    const boxEl = containerRef.current;
    if (!boxEl) return;
    const playerEl =
      boxEl.closest('#movie_player') ??
      document.querySelector('#movie_player') ??
      boxEl.closest('.html5-video-player') ??
      document.querySelector('.html5-video-player');
    if (!playerEl) return;

    const playerRect = playerEl.getBoundingClientRect();
    const boxRect = boxEl.getBoundingClientRect();
    if (playerRect.width === 0 || playerRect.height === 0 || boxRect.width === 0) return;

    const currentCenterX = (position.xPercent / 100) * playerRect.width;
    const currentCenterY = (position.yPercent / 100) * playerRect.height;

    const minCenterX = boxRect.width / 2 + 8;
    const maxCenterX = Math.max(minCenterX, playerRect.width - boxRect.width / 2 - 8);
    const clampedX = Math.max(minCenterX, Math.min(currentCenterX, maxCenterX));

    const minCenterY = boxRect.height / 2 + 8;
    const maxCenterY = Math.max(minCenterY, playerRect.height - boxRect.height / 2 - 8);
    const clampedY = Math.max(minCenterY, Math.min(currentCenterY, maxCenterY));

    const newXPercent = (clampedX / playerRect.width) * 100;
    const newYPercent = (clampedY / playerRect.height) * 100;

    if (
      Math.abs(newXPercent - position.xPercent) > 0.5 ||
      Math.abs(newYPercent - position.yPercent) > 0.5
    ) {
      onUpdatePosition({ xPercent: newXPercent, yPercent: newYPercent });
    }
  }, [effectiveFontSize, position, onUpdatePosition]);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return;
    const boxEl = containerRef.current;
    if (!boxEl) return;

    const playerEl =
      boxEl.closest('#movie_player') ??
      document.querySelector('#movie_player') ??
      boxEl.closest('.html5-video-player') ??
      document.querySelector('.html5-video-player');
    if (!playerEl) return;

    const playerRect = playerEl.getBoundingClientRect();
    const boxRect = boxEl.getBoundingClientRect();

    const boxCenterX = boxRect.left + boxRect.width / 2 - playerRect.left;
    const boxCenterY = boxRect.top + boxRect.height / 2 - playerRect.top;

    dragStartRef.current = {
      pointerX: e.clientX,
      pointerY: e.clientY,
      boxCenterX,
      boxCenterY,
      playerWidth: playerRect.width,
      playerHeight: playerRect.height,
      boxWidth: boxRect.width,
      boxHeight: boxRect.height
    };
    isDraggingRef.current = false;
  }, []);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>): void => {
      const start = dragStartRef.current;
      if (!start) return;

      const dx = e.clientX - start.pointerX;
      const dy = e.clientY - start.pointerY;
      const dist = Math.hypot(dx, dy);

      if (!isDraggingRef.current) {
        if (dist >= DRAG_THRESHOLD) {
          isDraggingRef.current = true;
          setIsDragging(true);
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            // Ignore pointer capture errors
          }
        }
      }

      if (isDraggingRef.current) {
        e.stopPropagation();
        const newCenterX = start.boxCenterX + dx;
        const newCenterY = start.boxCenterY + dy;

        const minCenterX = start.boxWidth / 2 + 8;
        const maxCenterX = Math.max(minCenterX, start.playerWidth - start.boxWidth / 2 - 8);
        const clampedX = Math.max(minCenterX, Math.min(newCenterX, maxCenterX));

        const minCenterY = start.boxHeight / 2 + 8;
        const maxCenterY = Math.max(minCenterY, start.playerHeight - start.boxHeight / 2 - 8);
        const clampedY = Math.max(minCenterY, Math.min(newCenterY, maxCenterY));

        const xPercent = (clampedX / start.playerWidth) * 100;
        const yPercent = (clampedY / start.playerHeight) * 100;

        currentDragPosRef.current = { xPercent, yPercent };

        // Zero-rerender direct DOM update during drag
        if (containerRef.current) {
          containerRef.current.style.left = `${xPercent}%`;
          containerRef.current.style.top = `${yPercent}%`;
          containerRef.current.style.bottom = 'auto';
          containerRef.current.style.right = 'auto';
          containerRef.current.style.transform = 'translate3d(-50%, -50%, 0)';
        }
      }
    },
    []
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>): void => {
      if (!dragStartRef.current) return;

      if (isDraggingRef.current) {
        e.stopPropagation();
        e.preventDefault();
        justFinishedDragRef.current = true;
        window.setTimeout(() => {
          justFinishedDragRef.current = false;
        }, 100);

        if (currentDragPosRef.current) {
          onUpdatePosition(currentDragPosRef.current);
        }
        try {
          e.currentTarget.releasePointerCapture(e.pointerId);
        } catch {
          // Ignore
        }
      }

      currentDragPosRef.current = null;
      dragStartRef.current = null;
      isDraggingRef.current = false;
      setIsDragging(false);
    },
    [onUpdatePosition]
  );

  const handleResetPosition = (e: MouseEvent): void => {
    e.stopPropagation();
    e.preventDefault();
    if (containerRef.current) {
      containerRef.current.style.top = 'auto';
      containerRef.current.style.left = '50%';
      containerRef.current.style.transform = 'translateX(-50%)';
    }
    onUpdatePosition(null);
  };

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
    [primaryCue, onSelectTarget]
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

  if (!primaryCue) return null;

  const positionStyle: React.CSSProperties = position
    ? {
        position: 'absolute',
        left: `${position.xPercent}%`,
        top: `${position.yPercent}%`,
        bottom: 'auto',
        right: 'auto',
        transform: 'translate(-50%, -50%)',
        maxWidth
      }
    : {
        position: 'absolute',
        left: '50%',
        top: 'auto',
        right: 'auto',
        bottom: `${bottomOffset}px`,
        transform: 'translateX(-50%)',
        maxWidth
      };

  return (
    <div className="pointer-events-none absolute inset-0 z-10 overflow-visible">
      <div
        ref={containerRef}
        data-mode={activeListeningMode}
        data-alt-pressed={altPressed ? 'true' : 'false'}
        data-has-selection={Boolean(selectedTarget) ? 'true' : 'false'}
        className={`ytai-subtitle-overlay text-center shadow-2xl select-none ${
          isDragging ? '' : 'transition-[bottom,opacity] duration-200 ease-out'
        } ${
          isCardVisible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        } ${isDragging ? 'cursor-grabbing' : ''}`}
        style={{
          ...positionStyle,
          transition: isDragging
            ? 'none'
            : 'bottom 200ms cubic-bezier(0, 0, 0.2, 1), opacity 150ms ease-out',
          padding: `${dynamicPadY}px ${dynamicPadX}px`,
          borderRadius: `${dynamicRadius}px`,
          backgroundColor: `rgba(var(--ytai-bg-rgb), var(--ytai-bg-opacity, ${overlayOpacity ?? 0.85}))`,
          borderColor: 'var(--ytai-border)',
          borderWidth: '1px',
          borderStyle: 'solid',
          backdropFilter: 'blur(var(--ytai-backdrop-blur, 12px))',
          WebkitBackdropFilter: 'blur(var(--ytai-backdrop-blur, 12px))',
          textShadow: 'var(--ytai-text-shadow)'
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onMouseUp={handleMouseUp}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top bar: Drag grip handle + Mode hint */}
        <div className="mb-1 flex items-center justify-between gap-2 select-none">
          <button
            type="button"
            onDoubleClick={handleResetPosition}
            title="Перетащите для смещения · Двойной клик для сброса по центру"
            className="flex items-center gap-1 rounded px-1 py-0.5 text-slate-400 opacity-60 transition hover:bg-white/10 hover:text-white hover:opacity-100 cursor-grab active:cursor-grabbing"
            style={{ color: 'var(--ytai-text-secondary)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <GripHorizontal className="h-3.5 w-3.5" />
          </button>

          {isBlurMode && (
            <div
              className={`ytai-blur-hint text-[11px] leading-tight tracking-wide font-medium select-none transition-colors ${
                altPressed || Boolean(selectedTarget) ? 'hidden' : ''
              }`}
              style={{ color: 'var(--ytai-accent)' }}
            >
              Active Listening · Hover or hold Alt to reveal
            </div>
          )}

          {isHiddenMode && isRevealedInHidden && (
            <div
              className="text-[11px] leading-tight tracking-wide font-medium select-none transition-colors"
              style={{ color: 'var(--ytai-accent)' }}
            >
              Stealth Mode · Alt held
            </div>
          )}

          <div className="w-3.5" aria-hidden="true" />
        </div>

        {/* Primary Subtitle Line */}
        <div
          className="ytai-blur-target leading-snug font-medium select-text"
          style={{
            color: 'var(--ytai-text-primary)',
            fontSize: `${fontSizes.primary}px`,
            textShadow: 'var(--ytai-text-shadow)'
          }}
        >
          {renderedTokens}
        </div>

        {/* Translated Subtitle Line */}
        {(showTranslation ?? showDualSubtitles ?? true) &&
          Boolean(primaryCue?.translation || translatedCue?.translation || translatedCue?.text) && (
            <div
              className="ytai-blur-target mt-1 leading-snug select-none"
              style={{
                color: 'var(--ytai-text-secondary)',
                fontSize: `${fontSizes.translated}px`,
                textShadow: 'var(--ytai-text-shadow)'
              }}
            >
              {primaryCue?.translation || translatedCue?.translation || translatedCue?.text}
            </div>
          )}
      </div>
    </div>
  );
}
