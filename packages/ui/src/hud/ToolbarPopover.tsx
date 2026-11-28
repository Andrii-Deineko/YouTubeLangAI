import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type RefObject
} from 'react';
import { resolveHostPlayerContainer } from './hooks/useDraggableSubtitleBox';

export interface PopoverLayout {
  offsetX: number | null;
  maxHeight: number | null;
}

export interface ToolbarPopoverProps {
  isOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
  popoverWidth: number;
  closeDelayMs?: number;
  preventHoverClose?: boolean;
  toolbarRef: RefObject<HTMLDivElement | null>;
  playerContainer?: HTMLElement | null;
  layoutDeps?: readonly unknown[];
  trigger: ReactNode;
  children: (layout: PopoverLayout) => ReactNode;
}

export function ToolbarPopover({
  isOpen,
  onOpen,
  onClose,
  popoverWidth,
  closeDelayMs = 160,
  preventHoverClose = false,
  toolbarRef,
  playerContainer,
  layoutDeps = [],
  trigger,
  children
}: ToolbarPopoverProps): ReactElement {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const leaveTimeoutRef = useRef<number | null>(null);
  const [layout, setLayout] = useState<PopoverLayout>({ offsetX: null, maxHeight: null });

  const clearLeaveTimeout = useCallback((): void => {
    if (leaveTimeoutRef.current !== null) {
      window.clearTimeout(leaveTimeoutRef.current);
      leaveTimeoutRef.current = null;
    }
  }, []);

  const updateLayout = useCallback((): void => {
    const btnWrap = wrapRef.current;
    const toolbarEl = toolbarRef.current;
    if (!btnWrap || !toolbarEl) {
      setLayout({ offsetX: null, maxHeight: null });
      return;
    }

    const btnRect = btnWrap.getBoundingClientRect();
    const toolbarRect = toolbarEl.getBoundingClientRect();
    const playerEl = resolveHostPlayerContainer(toolbarEl, playerContainer) ?? toolbarEl.parentElement;
    const playerRect = playerEl ? playerEl.getBoundingClientRect() : null;

    const minLeft = Math.max(8, (playerRect?.left ?? 0) + 8);
    const maxRight = Math.min(
      window.innerWidth - 8,
      playerRect ? playerRect.right - 8 : window.innerWidth - 8
    );
    const maxBottom = Math.min(
      window.innerHeight,
      playerRect ? playerRect.bottom : window.innerHeight
    );

    const availableHeight = Math.round(maxBottom - btnRect.bottom - 10);
    const maxHeight = Math.max(180, availableHeight);

    const btnCenter = btnRect.left + btnRect.width / 2;
    const centeredLeft = btnCenter - popoverWidth / 2;
    const centeredRight = btnCenter + popoverWidth / 2;

    let offsetX: number | null = null;
    if (centeredLeft < minLeft || centeredRight > maxRight) {
      const targetRight = Math.min(toolbarRect.right, maxRight);
      const preferredLeft =
        centeredRight > maxRight ? targetRight - popoverWidth : minLeft;
      const clampedLeft = Math.max(
        minLeft,
        Math.min(preferredLeft, maxRight - popoverWidth)
      );
      offsetX = Math.round(clampedLeft - btnRect.left);
    }

    setLayout({ offsetX, maxHeight });
  }, [playerContainer, popoverWidth, toolbarRef]);

  const layoutKey = layoutDeps.map((d) => String(d ?? '')).join('|');

  useLayoutEffect(() => {
    if (!isOpen) return;
    updateLayout();
    window.addEventListener('resize', updateLayout);
    return () => {
      window.removeEventListener('resize', updateLayout);
    };
  }, [isOpen, updateLayout, layoutKey]);

  useEffect(() => {
    if (!isOpen) return;

    const handleDocumentClick = (e: MouseEvent): void => {
      const path = e.composedPath();
      if (wrapRef.current && !path.includes(wrapRef.current)) {
        clearLeaveTimeout();
        onClose();
      }
    };

    const handleDocumentKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        clearLeaveTimeout();
        onClose();
      }
    };

    document.addEventListener('mousedown', handleDocumentClick);
    document.addEventListener('keydown', handleDocumentKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleDocumentClick);
      document.removeEventListener('keydown', handleDocumentKeyDown);
    };
  }, [clearLeaveTimeout, isOpen, onClose]);

  useEffect(() => clearLeaveTimeout, [clearLeaveTimeout]);

  const handleMouseEnter = (): void => {
    clearLeaveTimeout();
    onOpen();
  };

  const handleMouseLeave = (): void => {
    if (preventHoverClose) return;
    clearLeaveTimeout();
    leaveTimeoutRef.current = window.setTimeout(() => {
      leaveTimeoutRef.current = null;
      onClose();
    }, closeDelayMs);
  };

  return (
    <div
      ref={wrapRef}
      className="relative inline-flex items-center justify-center"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {trigger}
      {isOpen && (
        <div
          className={`absolute top-full pt-1.5 z-50 select-none animate-in fade-in duration-150 ${
            layout.offsetX === null ? 'left-1/2 -translate-x-1/2' : ''
          }`}
          style={
            layout.offsetX !== null
              ? { left: `${layout.offsetX}px`, right: 'auto' }
              : undefined
          }
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          {children(layout)}
        </div>
      )}
    </div>
  );
}
