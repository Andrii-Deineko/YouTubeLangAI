import { useCallback, useEffect, useRef, useState, type MouseEvent, type RefObject } from 'react';
import type { SubtitlePosition, UserSettings } from '@langai/contracts';

const DRAG_THRESHOLD = 5;

export function resolveHostPlayerContainer(
  boxEl: HTMLElement | null,
  playerContainer?: HTMLElement | null
): HTMLElement | null {
  if (playerContainer) return playerContainer;
  if (!boxEl) return null;
  const root = boxEl.getRootNode();
  if (root instanceof ShadowRoot && root.host instanceof HTMLElement && root.host.parentElement) {
    return root.host.parentElement;
  }
  return null;
}

export interface UseDraggableSubtitleBoxOptions {
  containerRef: RefObject<HTMLDivElement | null>;
  playerContainer?: HTMLElement | null;
  position: SubtitlePosition | null;
  primaryFontSize: number;
  onUpdatePosition: (position: SubtitlePosition | null) => void;
  onUpdateSettings?: (partial: Partial<UserSettings>) => void;
}

export interface UseDraggableSubtitleBoxResult {
  isDragging: boolean;
  isDraggingRef: RefObject<boolean>;
  justFinishedDragRef: RefObject<boolean>;
  handlePointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
  handlePointerMove: (e: React.PointerEvent<HTMLDivElement>) => void;
  handlePointerUp: (e: React.PointerEvent<HTMLDivElement>) => void;
  handleResetPosition: (e: MouseEvent) => void;
}

export function useDraggableSubtitleBox({
  containerRef,
  playerContainer,
  position,
  primaryFontSize,
  onUpdatePosition,
  onUpdateSettings
}: UseDraggableSubtitleBoxOptions): UseDraggableSubtitleBoxResult {
  const [isDragging, setIsDragging] = useState(false);
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

  // Sync external position reset to container styling
  useEffect(() => {
    if (!position && containerRef.current) {
      containerRef.current.style.top = 'auto';
      containerRef.current.style.left = '50%';
      containerRef.current.style.transform = 'translateX(-50%)';
    }
  }, [position, containerRef]);

  // Recalculate bounds and clamp custom position when font size grows
  useEffect(() => {
    if (!position || isDraggingRef.current) return;
    const boxEl = containerRef.current;
    if (!boxEl) return;
    const playerEl = resolveHostPlayerContainer(boxEl, playerContainer);
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
  }, [primaryFontSize, position, playerContainer, containerRef, onUpdatePosition]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>): void => {
      if (e.button !== 0) return;
      const boxEl = containerRef.current;
      if (!boxEl) return;

      const playerEl = resolveHostPlayerContainer(boxEl, playerContainer);
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
    },
    [containerRef, playerContainer]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>): void => {
      const start = dragStartRef.current;
      if (!start) return;

      const dx = e.clientX - start.pointerX;
      const dy = e.clientY - start.pointerY;
      const dist = Math.hypot(dx, dy);

      if (!isDraggingRef.current && dist >= DRAG_THRESHOLD) {
        isDraggingRef.current = true;
        setIsDragging(true);
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // Ignore pointer capture errors
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

        if (containerRef.current) {
          containerRef.current.style.left = `${xPercent}%`;
          containerRef.current.style.top = `${yPercent}%`;
          containerRef.current.style.bottom = 'auto';
          containerRef.current.style.right = 'auto';
          containerRef.current.style.transform = 'translate3d(-50%, -50%, 0)';
        }
      }
    },
    [containerRef]
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

  const handleResetPosition = useCallback(
    (e: MouseEvent): void => {
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
          subtitleBoxSize: null,
          subtitleBoxCompact: false
        });
      } else {
        onUpdatePosition(null);
      }
    },
    [containerRef, onUpdatePosition, onUpdateSettings]
  );

  return {
    isDragging,
    isDraggingRef,
    justFinishedDragRef,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handleResetPosition
  };
}
