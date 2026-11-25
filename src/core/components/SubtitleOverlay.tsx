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
import { GripHorizontal, Lock, Unlock } from 'lucide-react';
import {
  DEFAULT_SUBTITLE_BOX_SIZE,
  type ActiveListeningMode,
  type FontFamily,
  type FontWeight,
  type SubtitleBoxSize,
  type SubtitlePosition,
  type SubtitleScale,
  type SubtitleTrackMode,
  type TextOutline,
  type UserSettings
} from '../types/settings';
import type { TranslationRuntimeStatus } from '../types/messages';
import type { SubtitleCue, WordToken } from '../types/subtitles';
import { isValidTranslationText } from '../utils/translationCache';

const FONT_FAMILIES: Record<FontFamily, string> = {
  sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  serif: "Georgia, 'Times New Roman', Cambria, serif",
  mono: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
};

const TEXT_OUTLINES: Record<TextOutline, { textShadow: string; WebkitTextStroke: string }> = {
  none: {
    textShadow: 'none',
    WebkitTextStroke: '0px transparent'
  },
  shadow: {
    textShadow: 'var(--ytai-text-shadow, 0 2px 4px rgba(0,0,0,0.8))',
    WebkitTextStroke: '0px transparent'
  },
  outline: {
    textShadow: '0 0 2px #000, 0 0 4px #000, 1px 1px 2px #000, -1px -1px 2px #000',
    WebkitTextStroke: '1px rgba(0, 0, 0, 0.9)'
  }
};

export interface WordSelectionPayload {
  target: string;
  cue: SubtitleCue;
  anchorRect: { left: number; top: number; bottom: number; width: number };
  isPhrase: boolean;
}

interface SubtitleOverlayProps {
  primaryCue: SubtitleCue | null;
  translatedCue: SubtitleCue | null;
  translationStatus?: TranslationRuntimeStatus;
  showDualSubtitles?: boolean;
  showTranslation?: boolean;
  subtitleTrackMode?: SubtitleTrackMode;
  activeListeningMode: ActiveListeningMode;
  altPressed: boolean;
  fontSize?: number;
  translationScale?: number;
  fontFamily?: FontFamily;
  fontWeight?: FontWeight;
  backdropOpacity?: number;
  textOutline?: TextOutline;
  scale?: SubtitleScale;
  overlayOpacity?: number;
  position: SubtitlePosition | null;
  onUpdatePosition: (position: SubtitlePosition | null) => void;
  selectedTarget: string | null;
  onSelectTarget: (selection: WordSelectionPayload) => void;
  boxFixed?: boolean;
  boxSize?: SubtitleBoxSize | null;
  onUpdateSettings?: (partial: Partial<UserSettings>) => void;
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

type ResizeHandle =
  | 'top'
  | 'bottom'
  | 'left'
  | 'right'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'
  | null;

export function SubtitleOverlay({
  primaryCue,
  translatedCue,
  translationStatus,
  showDualSubtitles,
  showTranslation,
  subtitleTrackMode,
  activeListeningMode,
  altPressed,
  fontSize,
  translationScale,
  fontFamily,
  fontWeight,
  backdropOpacity,
  textOutline,
  scale,
  overlayOpacity,
  position,
  onUpdatePosition,
  selectedTarget,
  onSelectTarget,
  boxFixed = false,
  boxSize = null,
  onUpdateSettings
}: SubtitleOverlayProps): ReactElement | null {
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [hoveredHandle, setHoveredHandle] = useState<ResizeHandle>(null);
  const [isBoxHovered, setIsBoxHovered] = useState(false);

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

  const resizeStartRef = useRef<{
    handle: ResizeHandle;
    pointerX: number;
    pointerY: number;
    playerRect: DOMRect;
    boxRect: DOMRect;
    initialWidth: number;
    initialHeight: number;
    initialLeft: number;
    initialTop: number;
    hasCustomPosition: boolean;
  } | null>(null);

  const currentResizedSizeRef = useRef<SubtitleBoxSize | null>(null);
  const currentResizedPosRef = useRef<SubtitlePosition | null>(null);

  // Sync external position & size changes (e.g. reset) to container styling
  useEffect(() => {
    if (!position && containerRef.current) {
      containerRef.current.style.top = 'auto';
      containerRef.current.style.left = '50%';
      containerRef.current.style.transform = 'translateX(-50%)';
    }
  }, [position]);

  useEffect(() => {
    if (!boxFixed && containerRef.current) {
      containerRef.current.style.width = 'auto';
      containerRef.current.style.height = 'auto';
    }
  }, [boxFixed, boxSize]);

  // Window-level capture listener during resize for 100% reliable 60fps dragging
  useEffect(() => {
    if (!isResizing) return;

    const onPointerMove = (e: PointerEvent): void => {
      const start = resizeStartRef.current;
      if (!start) return;
      e.stopPropagation();
      e.preventDefault();

      const dx = e.clientX - start.pointerX;
      const dy = e.clientY - start.pointerY;

      let newWidth = start.initialWidth;
      let newHeight = start.initialHeight;
      let newLeft = start.initialLeft;
      let newTop = start.initialTop;

      const minWidth = 260;
      const minHeight = 56;
      const maxWidth = Math.max(minWidth, start.playerRect.width - 16);
      const maxHeight = Math.max(minHeight, start.playerRect.height - 16);

      const h = start.handle;

      if (h === 'right' || h === 'top-right' || h === 'bottom-right') {
        newWidth = Math.max(minWidth, Math.min(maxWidth, start.initialWidth + dx));
      } else if (h === 'left' || h === 'top-left' || h === 'bottom-left') {
        newWidth = Math.max(minWidth, Math.min(maxWidth, start.initialWidth - dx));
        newLeft = start.initialLeft + (start.initialWidth - newWidth);
      }

      if (h === 'bottom' || h === 'bottom-left' || h === 'bottom-right') {
        newHeight = Math.max(minHeight, Math.min(maxHeight, start.initialHeight + dy));
      } else if (h === 'top' || h === 'top-left' || h === 'top-right') {
        newHeight = Math.max(minHeight, Math.min(maxHeight, start.initialHeight - dy));
        newTop = start.initialTop + (start.initialHeight - newHeight);
      }

      currentResizedSizeRef.current = {
        width: Math.round(newWidth),
        height: Math.round(newHeight)
      };

      const boxEl = containerRef.current;
      if (boxEl) {
        boxEl.style.width = `${Math.round(newWidth)}px`;
        boxEl.style.height = `${Math.round(newHeight)}px`;

        if (h?.includes('left') || h?.includes('top') || start.hasCustomPosition) {
          const centerX = newLeft + newWidth / 2;
          const centerY = newTop + newHeight / 2;
          const xPercent = (centerX / start.playerRect.width) * 100;
          const yPercent = (centerY / start.playerRect.height) * 100;
          currentResizedPosRef.current = { xPercent, yPercent };

          boxEl.style.left = `${xPercent}%`;
          boxEl.style.top = `${yPercent}%`;
          boxEl.style.bottom = 'auto';
          boxEl.style.right = 'auto';
          boxEl.style.transform = 'translate3d(-50%, -50%, 0)';
        }
      }
    };

    const onPointerUp = (e: PointerEvent): void => {
      if (!resizeStartRef.current) return;
      e.stopPropagation();
      e.preventDefault();

      const finalSize = currentResizedSizeRef.current;
      const finalPos = currentResizedPosRef.current;

      resizeStartRef.current = null;
      setIsResizing(false);
      setHoveredHandle(null);

      if (finalSize) {
        if (onUpdateSettings) {
          onUpdateSettings({
            subtitleBoxSize: finalSize,
            subtitleBoxFixed: true,
            ...(finalPos ? { subtitlePosition: finalPos } : {})
          });
        } else if (onUpdatePosition && finalPos) {
          onUpdatePosition(finalPos);
        }
      }
    };

    window.addEventListener('pointermove', onPointerMove, { capture: true });
    window.addEventListener('pointerup', onPointerUp, { capture: true });
    window.addEventListener('pointercancel', onPointerUp, { capture: true });

    return () => {
      window.removeEventListener('pointermove', onPointerMove, { capture: true });
      window.removeEventListener('pointerup', onPointerUp, { capture: true });
      window.removeEventListener('pointercancel', onPointerUp, { capture: true });
    };
  }, [isResizing, onUpdateSettings, onUpdatePosition]);

  const handleResizeStart = useCallback(
    (handle: ResizeHandle, e: React.PointerEvent<HTMLDivElement>): void => {
      e.stopPropagation();
      e.preventDefault();
      if (e.button !== 0) return;

      const boxEl = containerRef.current;
      if (!boxEl) return;
      const playerEl = getPlayerContainer(boxEl);
      if (!playerEl) return;

      const playerRect = playerEl.getBoundingClientRect();
      const boxRect = boxEl.getBoundingClientRect();

      resizeStartRef.current = {
        handle,
        pointerX: e.clientX,
        pointerY: e.clientY,
        playerRect,
        boxRect,
        initialWidth: boxRect.width,
        initialHeight: boxRect.height,
        initialLeft: boxRect.left - playerRect.left,
        initialTop: boxRect.top - playerRect.top,
        hasCustomPosition: Boolean(position)
      };

      currentResizedSizeRef.current = {
        width: Math.round(boxRect.width),
        height: Math.round(boxRect.height)
      };

      setIsResizing(true);
    },
    [position]
  );

  const handleToggleFixed = useCallback(
    (e: MouseEvent<HTMLButtonElement>): void => {
      e.stopPropagation();
      const nextFixed = !boxFixed;
      const updates: Partial<UserSettings> = { subtitleBoxFixed: nextFixed };
      if (nextFixed && !boxSize) {
        updates.subtitleBoxSize = DEFAULT_SUBTITLE_BOX_SIZE;
      }
      onUpdateSettings?.(updates);
    },
    [boxFixed, boxSize, onUpdateSettings]
  );

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

  const effectiveTrackMode: SubtitleTrackMode =
    subtitleTrackMode ??
    (showTranslation ?? showDualSubtitles ?? true ? 'dual' : 'original');

  const isTranslationOnly = effectiveTrackMode === 'translation';
  const isOriginalOnly = effectiveTrackMode === 'original';
  const isAltRevealed = altPressed || Boolean(selectedTarget);

  // In 'hidden' mode, mouse hover intentionally does NOT reveal subtitles; only Alt or active selection does.
  const isRevealedInHidden = altPressed || Boolean(selectedTarget);
  const isCardVisible = !isHiddenMode || isRevealedInHidden;

  let primaryFontSize = Math.min(56, Math.max(12, fontSize ?? 20));
  if (scale === 'tv') {
    primaryFontSize = Math.max(primaryFontSize, 40);
  } else if (scale === 'xl') {
    primaryFontSize = Math.max(primaryFontSize, 28);
  }
  const effectiveTranslationScale = translationScale ?? 0.85;
  const translatedFontSize = isTranslationOnly
    ? primaryFontSize
    : Math.max(10, Math.round(primaryFontSize * effectiveTranslationScale));

  const textTypographyStyle: React.CSSProperties = {
    fontFamily: FONT_FAMILIES[fontFamily ?? 'sans'] || FONT_FAMILIES.sans,
    fontWeight: fontWeight === 'bold' ? 700 : 500,
    ...(TEXT_OUTLINES[textOutline ?? 'shadow'] || TEXT_OUTLINES.shadow)
  };

  const bgAlpha = (backdropOpacity ?? (overlayOpacity !== undefined ? Math.round(overlayOpacity * 100) : 80)) / 100;

  const maxWidth = 'min(860px, 84%)';

  const dynamicPadX = Math.round(Math.max(14, primaryFontSize * 0.75));
  const dynamicPadY = Math.round(Math.max(6, primaryFontSize * 0.4));
  const dynamicRadius = Math.round(Math.max(12, Math.min(26, primaryFontSize * 0.5)));

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
  }, [primaryFontSize, position, onUpdatePosition]);

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
      containerRef.current.style.width = 'auto';
      containerRef.current.style.height = 'auto';
    }
    if (onUpdateSettings) {
      onUpdateSettings({
        subtitlePosition: null,
        subtitleBoxFixed: false,
        subtitleBoxSize: null
      });
    } else {
      onUpdatePosition(null);
    }
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

  const hasCue = Boolean(primaryCue || translatedCue);
  if (!hasCue && !boxFixed) return null;

  const defaultFixedSize = DEFAULT_SUBTITLE_BOX_SIZE;
  const effectiveWidth = boxSize?.width ?? defaultFixedSize.width;
  const effectiveHeight = boxSize?.height ?? defaultFixedSize.height;

  const positionStyle: React.CSSProperties = position
    ? {
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
  const showResizeFrame = isBoxHovered || isDragging || isResizing || hoveredHandle !== null;
  const candidateTranslation =
    primaryCue?.translation || translatedCue?.translation || translatedCue?.text;
  const validTranslation = isValidTranslationText(candidateTranslation)
    ? candidateTranslation
    : null;
  const isTranslationCooldown =
    !isOriginalOnly &&
    Boolean(primaryCue) &&
    !validTranslation &&
    (translationStatus?.state === 'cooldown' || translationStatus?.state === 'error');
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
        data-has-selection={Boolean(selectedTarget) ? 'true' : 'false'}
        className={`ytai-subtitle-overlay text-center shadow-2xl select-none relative ${
          isDraggingOrResizing ? '' : 'transition-[bottom,opacity] duration-200 ease-out'
        } ${
          isCardVisible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        } ${isDragging ? 'cursor-grabbing' : ''}`}
        style={{
          ...positionStyle,
          ...(boxFixed
            ? {
                width: `min(${effectiveWidth}px, calc(100% - 16px))`,
                height: `min(${effectiveHeight}px, calc(100% - 16px))`,
                display: 'flex',
                flexDirection: 'column',
                boxSizing: 'border-box'
              }
            : {
                maxWidth
              }),
          transition: isDraggingOrResizing
            ? 'none'
            : 'bottom 200ms cubic-bezier(0, 0, 0.2, 1), opacity 150ms ease-out',
          padding: `${dynamicPadY}px ${dynamicPadX}px`,
          borderRadius: `${dynamicRadius}px`,
          backgroundColor:
            bgAlpha <= 0
              ? 'transparent'
              : `rgba(var(--ytai-bg-rgb), ${bgAlpha})`,
          borderColor:
            bgAlpha <= 0
              ? 'transparent'
              : 'var(--ytai-border)',
          borderWidth: '1px',
          borderStyle: 'solid',
          backdropFilter: bgAlpha <= 0 ? 'none' : 'blur(var(--ytai-backdrop-blur, 12px))',
          WebkitBackdropFilter: bgAlpha <= 0 ? 'none' : 'blur(var(--ytai-backdrop-blur, 12px))',
          boxShadow:
            bgAlpha <= 0
              ? 'none'
              : undefined
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
              title="Перетащите для смещения · Двойной клик для сброса по центру"
              className="flex items-center gap-1 rounded px-1 py-0.5 text-slate-400 opacity-60 transition hover:bg-white/10 hover:text-white hover:opacity-100 cursor-grab active:cursor-grabbing"
              style={{ color: 'var(--ytai-text-secondary)' }}
              onClick={(e) => e.stopPropagation()}
            >
              <GripHorizontal className="h-3.5 w-3.5" />
            </button>

            <button
              type="button"
              onClick={handleToggleFixed}
              title={
                boxFixed
                  ? 'Статичное окно включено (клик — переключить на адаптивный размер)'
                  : 'Адаптивный размер (клик — зафиксировать размер окна)'
              }
              className="flex items-center gap-1 rounded px-1 py-0.5 text-slate-400 opacity-60 transition hover:bg-white/10 hover:text-white hover:opacity-100 cursor-pointer"
              style={{ color: boxFixed ? 'var(--ytai-accent)' : 'var(--ytai-text-secondary)' }}
            >
              {boxFixed ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
            </button>
          </div>

          {isTranslationOnly && isAltRevealed && (
            <div
              className="text-[11px] leading-tight tracking-wide font-medium select-none transition-colors"
              style={{ color: 'var(--ytai-accent)' }}
            >
              Оригинал (Alt) · Кликните слово для сохранения
            </div>
          )}

          {!isTranslationOnly && isBlurMode && (
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

          {!hasModeHint && isTranslationCooldown && (
            <div className="text-[11px] leading-tight text-slate-400 opacity-75 select-none">
              Повтор перевода…
            </div>
          )}

          <div className="w-8" aria-hidden="true" />
        </div>

        {/* Subtitle Content (Centered in fixed mode without flex top-clipping) */}
        <div
          className={`w-full text-center ${
            boxFixed
              ? 'flex-1 flex flex-col items-center overflow-hidden min-h-0'
              : ''
          }`}
        >
          <div className={`w-full flex flex-col items-center ${boxFixed ? 'my-auto' : ''}`}>
            {/* Primary Original Line: shown in dual mode, original mode, or when revealed by Alt/selection in translation-only mode */}
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

            {/* Translation Line: shown in dual mode and translation-only mode */}
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
                      marginTop: (primaryCue && (!isTranslationOnly || isAltRevealed)) ? '4px' : '0px',
                      ...textTypographyStyle
                    }}
                  >
                    {validTranslation}
                  </div>
                ) : primaryCue && isTranslationOnly ? (
                  <div
                    className={`select-none text-slate-400 text-center ${
                      isTranslationCooldown
                        ? 'opacity-70 text-xs'
                        : 'opacity-60 animate-pulse tracking-widest'
                    }`}
                    style={{
                      fontSize: isTranslationCooldown ? '12px' : `${translatedFontSize}px`,
                      lineHeight: 1.22,
                      marginTop: (primaryCue && (!isTranslationOnly || isAltRevealed)) ? '4px' : '0px',
                      ...textTypographyStyle
                    }}
                  >
                    {isTranslationCooldown ? 'Повтор перевода…' : '···'}
                  </div>
                ) : null}
              </>
            )}
          </div>
        </div>

        {/* HUD Resize Frame (visible on hover, drag, or resize) */}
        <div
          className={`pointer-events-none absolute inset-0 transition-opacity duration-200 ${
            showResizeFrame ? 'opacity-100' : 'opacity-0'
          }`}
          style={{
            borderRadius: `${dynamicRadius}px`,
            border: '1px solid color-mix(in srgb, var(--ytai-accent) 35%, transparent)'
          }}
        >
          {/* Active edge highlights */}
          {hoveredHandle === 'top' && (
            <div className="absolute -top-[1px] left-3 right-3 h-[2px] bg-[var(--ytai-accent)] shadow-[0_0_8px_var(--ytai-accent)]" />
          )}
          {hoveredHandle === 'bottom' && (
            <div className="absolute -bottom-[1px] left-3 right-3 h-[2px] bg-[var(--ytai-accent)] shadow-[0_0_8px_var(--ytai-accent)]" />
          )}
          {hoveredHandle === 'left' && (
            <div className="absolute -left-[1px] top-3 bottom-3 w-[2px] bg-[var(--ytai-accent)] shadow-[0_0_8px_var(--ytai-accent)]" />
          )}
          {hoveredHandle === 'right' && (
            <div className="absolute -right-[1px] top-3 bottom-3 w-[2px] bg-[var(--ytai-accent)] shadow-[0_0_8px_var(--ytai-accent)]" />
          )}

          {/* 4 Thick Accent Corners (L-shaped brackets) */}
          <div
            className={`absolute -top-[1px] -left-[1px] w-[14px] h-[14px] transition-transform duration-150 ${
              hoveredHandle === 'top-left' ? 'scale-110' : ''
            }`}
            style={{
              borderTop: '2.5px solid var(--ytai-accent)',
              borderLeft: '2.5px solid var(--ytai-accent)',
              borderTopLeftRadius: `${dynamicRadius}px`,
              filter: hoveredHandle === 'top-left' ? 'drop-shadow(0 0 4px var(--ytai-accent))' : undefined
            }}
          />
          <div
            className={`absolute -top-[1px] -right-[1px] w-[14px] h-[14px] transition-transform duration-150 ${
              hoveredHandle === 'top-right' ? 'scale-110' : ''
            }`}
            style={{
              borderTop: '2.5px solid var(--ytai-accent)',
              borderRight: '2.5px solid var(--ytai-accent)',
              borderTopRightRadius: `${dynamicRadius}px`,
              filter: hoveredHandle === 'top-right' ? 'drop-shadow(0 0 4px var(--ytai-accent))' : undefined
            }}
          />
          <div
            className={`absolute -bottom-[1px] -left-[1px] w-[14px] h-[14px] transition-transform duration-150 ${
              hoveredHandle === 'bottom-left' ? 'scale-110' : ''
            }`}
            style={{
              borderBottom: '2.5px solid var(--ytai-accent)',
              borderLeft: '2.5px solid var(--ytai-accent)',
              borderBottomLeftRadius: `${dynamicRadius}px`,
              filter: hoveredHandle === 'bottom-left' ? 'drop-shadow(0 0 4px var(--ytai-accent))' : undefined
            }}
          />
          <div
            className={`absolute -bottom-[1px] -right-[1px] w-[14px] h-[14px] transition-transform duration-150 ${
              hoveredHandle === 'bottom-right' ? 'scale-110' : ''
            }`}
            style={{
              borderBottom: '2.5px solid var(--ytai-accent)',
              borderRight: '2.5px solid var(--ytai-accent)',
              borderBottomRightRadius: `${dynamicRadius}px`,
              filter: hoveredHandle === 'bottom-right' ? 'drop-shadow(0 0 4px var(--ytai-accent))' : undefined
            }}
          />
        </div>

        {/* Interactive Resize Handles (Edges and Corners) */}
        <div
          className="absolute -top-1 left-3 right-3 h-2 cursor-ns-resize z-20"
          onPointerDown={(e) => handleResizeStart('top', e)}
          onMouseEnter={() => setHoveredHandle('top')}
          onMouseLeave={() => setHoveredHandle((h) => (h === 'top' ? null : h))}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        />
        <div
          className="absolute -bottom-1 left-3 right-3 h-2 cursor-ns-resize z-20"
          onPointerDown={(e) => handleResizeStart('bottom', e)}
          onMouseEnter={() => setHoveredHandle('bottom')}
          onMouseLeave={() => setHoveredHandle((h) => (h === 'bottom' ? null : h))}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        />
        <div
          className="absolute -left-1 top-3 bottom-3 w-2 cursor-ew-resize z-20"
          onPointerDown={(e) => handleResizeStart('left', e)}
          onMouseEnter={() => setHoveredHandle('left')}
          onMouseLeave={() => setHoveredHandle((h) => (h === 'left' ? null : h))}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        />
        <div
          className="absolute -right-1 top-3 bottom-3 w-2 cursor-ew-resize z-20"
          onPointerDown={(e) => handleResizeStart('right', e)}
          onMouseEnter={() => setHoveredHandle('right')}
          onMouseLeave={() => setHoveredHandle((h) => (h === 'right' ? null : h))}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        />

        {/* 4 Corner handles */}
        <div
          className="absolute -top-1.5 -left-1.5 w-3.5 h-3.5 cursor-nwse-resize z-21"
          onPointerDown={(e) => handleResizeStart('top-left', e)}
          onMouseEnter={() => setHoveredHandle('top-left')}
          onMouseLeave={() => setHoveredHandle((h) => (h === 'top-left' ? null : h))}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        />
        <div
          className="absolute -top-1.5 -right-1.5 w-3.5 h-3.5 cursor-nesw-resize z-21"
          onPointerDown={(e) => handleResizeStart('top-right', e)}
          onMouseEnter={() => setHoveredHandle('top-right')}
          onMouseLeave={() => setHoveredHandle((h) => (h === 'top-right' ? null : h))}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        />
        <div
          className="absolute -bottom-1.5 -left-1.5 w-3.5 h-3.5 cursor-nesw-resize z-21"
          onPointerDown={(e) => handleResizeStart('bottom-left', e)}
          onMouseEnter={() => setHoveredHandle('bottom-left')}
          onMouseLeave={() => setHoveredHandle((h) => (h === 'bottom-left' ? null : h))}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        />
        <div
          className="absolute -bottom-1.5 -right-1.5 w-3.5 h-3.5 cursor-nwse-resize z-21"
          onPointerDown={(e) => handleResizeStart('bottom-right', e)}
          onMouseEnter={() => setHoveredHandle('bottom-right')}
          onMouseLeave={() => setHoveredHandle((h) => (h === 'bottom-right' ? null : h))}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        />
      </div>
    </div>
  );
}
