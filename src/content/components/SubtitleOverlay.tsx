import { useState, type MouseEvent, type ReactElement } from 'react';
import type { SubtitleCue, WordToken } from '../../types/subtitles';

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
  activeListeningMode: boolean;
  altPressed: boolean;
  fontSize: number;
  selectedTarget: string | null;
  onSelectTarget: (selection: WordSelectionPayload) => void;
}

export function SubtitleOverlay({
  primaryCue,
  translatedCue,
  showDualSubtitles,
  activeListeningMode,
  altPressed,
  fontSize,
  selectedTarget,
  onSelectTarget
}: SubtitleOverlayProps): ReactElement | null {
  const [hovered, setHovered] = useState(false);

  if (!primaryCue) return null;

  const isBlurred = activeListeningMode && !hovered && !altPressed;

  const handleTokenClick = (e: MouseEvent<HTMLSpanElement>, token: WordToken): void => {
    e.stopPropagation();

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

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-16 z-10 flex justify-center px-4">
      <div
        className="pointer-events-auto max-w-[86%] rounded-xl border border-white/10 bg-slate-950/80 px-4 py-2.5 text-center shadow-2xl backdrop-blur-md transition-opacity"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onMouseUp={handleMouseUp}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        {activeListeningMode && isBlurred && (
          <div className="mb-1 text-[11px] leading-tight tracking-wide text-amber-300/80 select-none">
            Active Listening · Hover or hold Alt to reveal
          </div>
        )}

        <div
          className="leading-snug font-medium text-white transition-[filter] duration-150 select-text"
          style={{
            fontSize: `${fontSize}px`,
            filter: isBlurred ? 'blur(6px)' : 'blur(0px)'
          }}
        >
          {primaryCue.tokens.map((token) =>
            token.isWord ? (
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
                className={`inline rounded px-0.5 transition-colors cursor-pointer ${
                  selectedTarget &&
                  selectedTarget.toLowerCase() === token.text.toLowerCase()
                    ? 'bg-indigo-500/70 text-white'
                    : 'hover:bg-indigo-500/40 hover:text-indigo-100'
                }`}
              >
                {token.text}
              </span>
            ) : (
              <span key={token.id} className="whitespace-pre-wrap">
                {token.text}
              </span>
            )
          )}
        </div>

        {showDualSubtitles && translatedCue && (
          <div
            className="mt-1 leading-snug text-slate-300 transition-[filter] duration-150 select-none"
            style={{
              fontSize: `${Math.max(13, Math.round(fontSize * 0.76))}px`,
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
