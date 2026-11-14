import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactElement
} from 'react';
import { GripHorizontal } from 'lucide-react';
import type { ActiveListeningMode, SubtitlePosition, SubtitleScale } from '../../types/settings';
import type { SubtitleCue, WordToken } from '../../types/subtitles';
import { getSubtitleFontSizes } from '../../shared/themes';

export interface WordSelectionPayload {
  target: string;
  cue: SubtitleCue;
  anchorRect: { left: number; top: number; bottom: number; width: number };
  isPhrase: boolean;
}

interface SubtitleOverlayProps {
  primaryCue: SubtitleCue | null;
  translatedCue: SubtitleCue | null;
  showDualSubtitles: boolean;
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

export function SubtitleOverlay({
  primaryCue,
  translatedCue,
  showDualSubtitles,
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
  const [hovered, setHovered] = useState(false);
  const [livePosition, setLivePosition] = useState<SubtitlePosition | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const isDraggingRef = useRef(false);
  const justFinishedDragRef = useRef(false);
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

  // Sync external position changes (e.g. reset) to livePosition
  useEffect(() => {
    setLivePosition(null);
  }, [position]);

  const effectivePosition = livePosition ?? position;

  const isHiddenMode = activeListeningMode === 'hidden';
  const isBlurMode = activeListeningMode === 'blur';

  // In 'hidden' mode, mouse hover intentionally does NOT reveal subtitles; only Alt or active selection does.
  const isRevealedInHidden = altPressed || Boolean(selectedTarget);
  const isCardVisible = !isHiddenMode || isRevealedInHidden;

  const isRevealedInBlur = hovered || altPressed || Boolean(selectedTarget);
  const isBlurred = isBlurMode && !isRevealedInBlur;

  const fontSizes = getSubtitleFontSizes(scale, fontSize);

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

        setLivePosition({ xPercent, yPercent });
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

        if (livePosition) {
          onUpdatePosition(livePosition);
        }
        try {
          e.currentTarget.releasePointerCapture(e.pointerId);
        } catch {
          // Ignore
        }
      }

      dragStartRef.current = null;
      isDraggingRef.current = false;
      setIsDragging(false);
    },
    [livePosition, onUpdatePosition]
  );

  const handleResetPosition = (e: MouseEvent): void => {
    e.stopPropagation();
    e.preventDefault();
    setLivePosition(null);
    onUpdatePosition(null);
  };

  if (!primaryCue) return null;

  const handleTokenClick = (e: MouseEvent<HTMLSpanElement>, token: WordToken): void => {
    e.stopPropagation();
    if (isDraggingRef.current || isDragging || justFinishedDragRef.current) {
      return;
    }

    const selection = window.getSelection();
    const selectedText = selection?.toString().trim() ?? '';
    if (selectedText.length > 0 && selectedText.includes(' ')) {
      return;
    }

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
  };

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
    if (!selectedText || !selectedText.includes(' ')) return;

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

  const positionStyle: React.CSSProperties = effectivePosition
    ? {
        position: 'absolute',
        left: `${effectivePosition.xPercent}%`,
        top: `${effectivePosition.yPercent}%`,
        transform: 'translate(-50%, -50%)',
        maxWidth: '86%'
      }
    : {
        position: 'absolute',
        left: '50%',
        bottom: '4rem',
        transform: 'translateX(-50%)',
        maxWidth: '86%'
      };

  return (
    <div className="pointer-events-none absolute inset-0 z-10 overflow-visible">
      <div
        ref={containerRef}
        className={`rounded-xl px-4 py-2 text-center shadow-2xl select-none transition-opacity duration-150 ${
          isCardVisible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        } ${isDragging ? 'cursor-grabbing' : ''}`}
        style={{
          ...positionStyle,
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
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
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

          {isBlurMode && isBlurred && (
            <div
              className="text-[11px] leading-tight tracking-wide font-medium select-none transition-colors"
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
          className="leading-snug font-medium transition-[filter] duration-150 select-text"
          style={{
            color: 'var(--ytai-text-primary)',
            fontSize: `${fontSizes.primary}px`,
            textShadow: 'var(--ytai-text-shadow)',
            filter: isBlurred ? 'blur(6px)' : 'blur(0px)'
          }}
        >
          {primaryCue.tokens.map((token) => {
            const isSelected =
              Boolean(selectedTarget) &&
              selectedTarget?.toLowerCase() === token.text.toLowerCase();

            return token.isWord ? (
              <span
                key={token.id}
                role="button"
                tabIndex={0}
                onClick={(e) => handleTokenClick(e, token)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    e.stopPropagation();
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
            ) : (
              <span key={token.id} className="whitespace-pre-wrap">
                {token.text}
              </span>
            );
          })}
        </div>

        {/* Translated Subtitle Line */}
        {showDualSubtitles && translatedCue && (
          <div
            className="mt-1 leading-snug transition-[filter] duration-150 select-none"
            style={{
              color: 'var(--ytai-text-secondary)',
              fontSize: `${fontSizes.translated}px`,
              textShadow: 'var(--ytai-text-shadow)',
              filter: isBlurred ? 'blur(5px)' : 'blur(0px)'
            }}
          >
            {translatedCue.text}
          </div>
        )}
      </div>
    </div>
  );
}
