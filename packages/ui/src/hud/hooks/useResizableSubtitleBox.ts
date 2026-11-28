import { useCallback, useEffect, useRef, useState, type MouseEvent, type RefObject } from 'react';
import {
  DEFAULT_SUBTITLE_BOX_SIZE,
  type SubtitleBoxSize,
  type SubtitlePosition,
  type UserSettings
} from '@langai/contracts';
import { resolveHostPlayerContainer } from './useDraggableSubtitleBox';

export type ResizeHandle =
  | 'top'
  | 'bottom'
  | 'left'
  | 'right'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'
  | null;

export interface UseResizableSubtitleBoxOptions {
  containerRef: RefObject<HTMLDivElement | null>;
  contentInnerRef: RefObject<HTMLDivElement | null>;
  playerContainer?: HTMLElement | null;
  boxFixed: boolean;
  boxSize: SubtitleBoxSize | null;
  boxCompact: boolean;
  position: SubtitlePosition | null;
  onUpdatePosition: (position: SubtitlePosition | null) => void;
  onUpdateSettings?: (partial: Partial<UserSettings>) => void;
}

export interface UseResizableSubtitleBoxResult {
  isResizing: boolean;
  hoveredHandle: ResizeHandle;
  setHoveredHandle: React.Dispatch<React.SetStateAction<ResizeHandle>>;
  isCompactMode: boolean;
  compactFontScale: number;
  compactFontScaleRef: RefObject<number>;
  setCompactFontScale: React.Dispatch<React.SetStateAction<number>>;
  detentProgress: number;
  isContentOverflowing: boolean;
  setIsContentOverflowing: React.Dispatch<React.SetStateAction<boolean>>;
  handleResizeStart: (handle: ResizeHandle, e: React.PointerEvent<HTMLDivElement>) => void;
  handleToggleFixed: (e: MouseEvent<HTMLButtonElement>) => void;
}

export function useResizableSubtitleBox({
  containerRef,
  contentInnerRef,
  playerContainer,
  boxFixed,
  boxSize,
  boxCompact,
  position,
  onUpdatePosition,
  onUpdateSettings
}: UseResizableSubtitleBoxOptions): UseResizableSubtitleBoxResult {
  const [isResizing, setIsResizing] = useState(false);
  const [hoveredHandle, setHoveredHandle] = useState<ResizeHandle>(null);
  const [isCompactMode, setIsCompactMode] = useState(boxCompact);
  const [compactFontScale, setCompactFontScale] = useState(1);
  const [detentProgress, setDetentProgress] = useState(0);
  const [isContentOverflowing, setIsContentOverflowing] = useState(false);

  const isCompactModeRef = useRef(boxCompact);
  const compactFontScaleRef = useRef(1);
  const detentRafRef = useRef<number | null>(null);
  const detentStartMsRef = useRef<number | null>(null);
  const latestDesiredSizeRef = useRef<{
    width: number;
    height: number;
    left: number;
    top: number;
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
    thresholdWidth: number;
    thresholdHeight: number;
    hasCustomPosition: boolean;
  } | null>(null);

  const currentResizedSizeRef = useRef<SubtitleBoxSize | null>(null);
  const currentResizedPosRef = useRef<SubtitlePosition | null>(null);

  useEffect(() => {
    if (!isResizing) {
      const compact = Boolean(boxCompact && boxFixed);
      isCompactModeRef.current = compact;
      setIsCompactMode(compact);
      if (!compact) {
        compactFontScaleRef.current = 1;
        setCompactFontScale(1);
        setIsContentOverflowing(false);
      }
    }
  }, [boxCompact, boxFixed, isResizing]);

  useEffect(() => {
    if (!boxFixed && containerRef.current) {
      containerRef.current.style.width = 'auto';
      containerRef.current.style.height = 'auto';
    }
  }, [boxFixed, boxSize, containerRef]);

  // Window-level capture listener during resize for 60fps dragging with detent barrier
  useEffect(() => {
    if (!isResizing) return;

    const DETENT_HOLD_MS = 550;
    const ABS_MIN_WIDTH = 160;
    const ABS_MIN_HEIGHT = 36;

    const cancelDetent = (): void => {
      if (detentRafRef.current !== null) {
        window.cancelAnimationFrame(detentRafRef.current);
        detentRafRef.current = null;
      }
      detentStartMsRef.current = null;
      setDetentProgress(0);
    };

    const applyBoxGeometry = (
      width: number,
      height: number,
      left: number,
      top: number,
      start: NonNullable<typeof resizeStartRef.current>
    ): void => {
      const rW = Math.round(width);
      const rH = Math.round(height);
      currentResizedSizeRef.current = { width: rW, height: rH };

      const boxEl = containerRef.current;
      if (!boxEl) return;
      boxEl.style.width = `${rW}px`;
      boxEl.style.height = `${rH}px`;

      if (start.handle?.includes('left') || start.handle?.includes('top') || start.hasCustomPosition) {
        const centerX = left + rW / 2;
        const centerY = top + rH / 2;
        const xPercent = (centerX / start.playerRect.width) * 100;
        const yPercent = (centerY / start.playerRect.height) * 100;
        currentResizedPosRef.current = { xPercent, yPercent };

        boxEl.style.left = `${xPercent}%`;
        boxEl.style.top = `${yPercent}%`;
        boxEl.style.bottom = 'auto';
        boxEl.style.right = 'auto';
        boxEl.style.transform = 'translate3d(-50%, -50%, 0)';
      }

      if (isCompactModeRef.current && contentInnerRef.current) {
        const availableH = Math.max(18, rH - 30);
        const naturalH =
          contentInnerRef.current.scrollHeight / Math.max(0.4, compactFontScaleRef.current);
        const nextScale =
          naturalH > availableH + 2
            ? Math.max(0.45, Math.min(1, availableH / naturalH))
            : 1;
        if (Math.abs(nextScale - compactFontScaleRef.current) > 0.03) {
          compactFontScaleRef.current = nextScale;
          setCompactFontScale(nextScale);
        }
      }
    };

    const startDetentProgress = (start: NonNullable<typeof resizeStartRef.current>): void => {
      if (detentStartMsRef.current !== null) return;
      detentStartMsRef.current = performance.now();

      const tickDetent = (now: number): void => {
        if (!resizeStartRef.current || isCompactModeRef.current || detentStartMsRef.current === null) {
          cancelDetent();
          return;
        }
        const elapsed = now - detentStartMsRef.current;
        const progress = Math.min(1, elapsed / DETENT_HOLD_MS);
        setDetentProgress(progress);

        if (progress >= 1) {
          cancelDetent();
          isCompactModeRef.current = true;
          setIsCompactMode(true);
          const desired = latestDesiredSizeRef.current;
          if (desired) {
            applyBoxGeometry(desired.width, desired.height, desired.left, desired.top, start);
          }
          return;
        }
        detentRafRef.current = window.requestAnimationFrame(tickDetent);
      };

      detentRafRef.current = window.requestAnimationFrame(tickDetent);
    };

    const onPointerMove = (e: PointerEvent): void => {
      const start = resizeStartRef.current;
      if (!start) return;
      e.stopPropagation();
      e.preventDefault();

      const dx = e.clientX - start.pointerX;
      const dy = e.clientY - start.pointerY;

      const maxWidth = Math.max(start.thresholdWidth, start.playerRect.width - 16);
      const maxHeight = Math.max(start.thresholdHeight, start.playerRect.height - 16);
      const h = start.handle;

      let rawWidth = start.initialWidth;
      let rawHeight = start.initialHeight;

      if (h === 'right' || h === 'top-right' || h === 'bottom-right') {
        rawWidth = Math.max(ABS_MIN_WIDTH, Math.min(maxWidth, start.initialWidth + dx));
      } else if (h === 'left' || h === 'top-left' || h === 'bottom-left') {
        rawWidth = Math.max(ABS_MIN_WIDTH, Math.min(maxWidth, start.initialWidth - dx));
      }

      if (h === 'bottom' || h === 'bottom-left' || h === 'bottom-right') {
        rawHeight = Math.max(ABS_MIN_HEIGHT, Math.min(maxHeight, start.initialHeight + dy));
      } else if (h === 'top' || h === 'top-left' || h === 'top-right') {
        rawHeight = Math.max(ABS_MIN_HEIGHT, Math.min(maxHeight, start.initialHeight - dy));
      }

      const rawLeft =
        h === 'left' || h === 'top-left' || h === 'bottom-left'
          ? start.initialLeft + (start.initialWidth - rawWidth)
          : start.initialLeft;
      const rawTop =
        h === 'top' || h === 'top-left' || h === 'top-right'
          ? start.initialTop + (start.initialHeight - rawHeight)
          : start.initialTop;

      latestDesiredSizeRef.current = {
        width: rawWidth,
        height: rawHeight,
        left: rawLeft,
        top: rawTop
      };

      const pushingBelowThreshold =
        rawHeight < start.thresholdHeight - 2 || rawWidth < start.thresholdWidth - 2;

      if (!isCompactModeRef.current) {
        if (pushingBelowThreshold) {
          const heldWidth = Math.max(start.thresholdWidth, rawWidth);
          const heldHeight = Math.max(start.thresholdHeight, rawHeight);
          const heldLeft =
            h === 'left' || h === 'top-left' || h === 'bottom-left'
              ? start.initialLeft + (start.initialWidth - heldWidth)
              : start.initialLeft;
          const heldTop =
            h === 'top' || h === 'top-left' || h === 'top-right'
              ? start.initialTop + (start.initialHeight - heldHeight)
              : start.initialTop;

          applyBoxGeometry(heldWidth, heldHeight, heldLeft, heldTop, start);
          startDetentProgress(start);
        } else {
          cancelDetent();
          applyBoxGeometry(rawWidth, rawHeight, rawLeft, rawTop, start);
        }
      } else {
        if (
          rawWidth >= start.thresholdWidth + 6 &&
          rawHeight >= start.thresholdHeight + 6
        ) {
          isCompactModeRef.current = false;
          setIsCompactMode(false);
          compactFontScaleRef.current = 1;
          setCompactFontScale(1);
          setIsContentOverflowing(false);
        }
        applyBoxGeometry(rawWidth, rawHeight, rawLeft, rawTop, start);
      }
    };

    const onPointerUp = (e: PointerEvent): void => {
      if (!resizeStartRef.current) return;
      e.stopPropagation();
      e.preventDefault();

      cancelDetent();
      const finalSize = currentResizedSizeRef.current;
      const finalPos = currentResizedPosRef.current;
      const finalCompact = isCompactModeRef.current;

      resizeStartRef.current = null;
      latestDesiredSizeRef.current = null;
      if (containerRef.current && !finalCompact) {
        containerRef.current.style.height = '';
      }
      setIsResizing(false);
      setHoveredHandle(null);

      if (finalSize) {
        if (onUpdateSettings) {
          onUpdateSettings({
            subtitleBoxSize: finalSize,
            subtitleBoxFixed: true,
            subtitleBoxCompact: finalCompact,
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
      cancelDetent();
      window.removeEventListener('pointermove', onPointerMove, { capture: true });
      window.removeEventListener('pointerup', onPointerUp, { capture: true });
      window.removeEventListener('pointercancel', onPointerUp, { capture: true });
    };
  }, [isResizing, containerRef, contentInnerRef, onUpdateSettings, onUpdatePosition]);

  const handleResizeStart = useCallback(
    (handle: ResizeHandle, e: React.PointerEvent<HTMLDivElement>): void => {
      e.stopPropagation();
      e.preventDefault();
      if (e.button !== 0) return;

      const boxEl = containerRef.current;
      if (!boxEl) return;
      const playerEl = resolveHostPlayerContainer(boxEl, playerContainer);
      if (!playerEl) return;

      const playerRect = playerEl.getBoundingClientRect();
      const boxRect = boxEl.getBoundingClientRect();

      const innerNaturalH = contentInnerRef.current
        ? contentInnerRef.current.scrollHeight / Math.max(0.4, compactFontScaleRef.current)
        : 48;
      const thresholdHeight = Math.max(68, Math.min(180, Math.ceil(innerNaturalH + 40)));
      const thresholdWidth = 260;

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
        thresholdWidth,
        thresholdHeight,
        hasCustomPosition: Boolean(position)
      };

      currentResizedSizeRef.current = {
        width: Math.round(boxRect.width),
        height: Math.round(boxRect.height)
      };

      setIsResizing(true);
    },
    [containerRef, contentInnerRef, playerContainer, position]
  );

  const handleToggleFixed = useCallback(
    (e: MouseEvent<HTMLButtonElement>): void => {
      e.stopPropagation();
      const nextFixed = !boxFixed;
      const updates: Partial<UserSettings> = {
        subtitleBoxFixed: nextFixed,
        ...(nextFixed ? {} : { subtitleBoxCompact: false })
      };
      if (nextFixed && !boxSize) {
        updates.subtitleBoxSize = DEFAULT_SUBTITLE_BOX_SIZE;
      }
      onUpdateSettings?.(updates);
    },
    [boxFixed, boxSize, onUpdateSettings]
  );

  return {
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
  };
}
