import { useEffect, useState, type ReactElement } from 'react';
import { Eye, EyeOff, Ghost, Languages, Move, PauseCircle, Power, RotateCcw } from 'lucide-react';
import type { ActiveListeningMode, UserSettings } from '../../types/settings';
import type { TrackMetadata } from '../../types/subtitles';

interface PlayerControlsProps {
  settings: UserSettings;
  trackMeta: TrackMetadata | null;
  cueCount: number;
  altPressed?: boolean;
  hasActivePopup?: boolean;
  onUpdateSettings: (partial: Partial<UserSettings>) => void;
  onRepeatCue: () => void;
  onResetPosition?: () => void;
}

export function PlayerControls({
  settings,
  trackMeta,
  cueCount,
  altPressed,
  hasActivePopup,
  onUpdateSettings,
  onRepeatCue,
  onResetPosition
}: PlayerControlsProps): ReactElement {
  const [isHovered, setIsHovered] = useState(false);
  const [isYtAutohide, setIsYtAutohide] = useState(false);
  const [isPaused, setIsPaused] = useState(false);

  useEffect(() => {
    const playerEl =
      document.querySelector<HTMLElement>('#movie_player') ??
      document.querySelector<HTMLElement>('.html5-video-player');
    const videoEl =
      playerEl?.querySelector<HTMLVideoElement>('video') ??
      document.querySelector<HTMLVideoElement>('video');

    const updateStates = (): void => {
      if (playerEl) {
        setIsYtAutohide(playerEl.classList.contains('ytp-autohide'));
      }
      if (videoEl) {
        setIsPaused(videoEl.paused);
      }
    };

    updateStates();

    let observer: MutationObserver | null = null;
    if (playerEl) {
      observer = new MutationObserver((mutations) => {
        for (const m of mutations) {
          if (m.type === 'attributes' && m.attributeName === 'class') {
            setIsYtAutohide(playerEl.classList.contains('ytp-autohide'));
            break;
          }
        }
      });
      observer.observe(playerEl, { attributes: true, attributeFilter: ['class'] });
    }

    const onPlay = (): void => setIsPaused(false);
    const onPause = (): void => setIsPaused(true);

    videoEl?.addEventListener('play', onPlay);
    videoEl?.addEventListener('pause', onPause);

    return () => {
      observer?.disconnect();
      videoEl?.removeEventListener('play', onPlay);
      videoEl?.removeEventListener('pause', onPause);
    };
  }, []);

  const shouldAutoHide = settings.autoHideControls ?? true;
  const isVisible =
    !shouldAutoHide ||
    isPaused ||
    !isYtAutohide ||
    isHovered ||
    Boolean(altPressed) ||
    Boolean(hasActivePopup);

  const currentFontSize = settings.subtitleFontSize ?? 20;

  const handleDecreaseFontSize = (): void => {
    const next = Math.max(14, currentFontSize - 4);
    onUpdateSettings({ subtitleFontSize: next });
  };

  const handleIncreaseFontSize = (): void => {
    const next = Math.min(56, currentFontSize + 4);
    onUpdateSettings({ subtitleFontSize: next });
  };

  const handleToggleTvPreset = (): void => {
    const next = currentFontSize >= 44 ? 20 : 48;
    onUpdateSettings({ subtitleFontSize: next });
  };

  const cycleListeningMode = (): void => {
    const current = settings.activeListeningMode || 'off';
    const next: ActiveListeningMode =
      current === 'off' ? 'blur' : current === 'blur' ? 'hidden' : 'off';
    onUpdateSettings({ activeListeningMode: next });
  };

  const getListeningModeTitle = (): string => {
    switch (settings.activeListeningMode) {
      case 'blur':
        return 'Active Listening: Blur (Hover or hold Alt to reveal. Click for Stealth mode)';
      case 'hidden':
        return 'Stealth Mode: Hidden (Hold Alt to reveal subtitles. Click to turn off)';
      default:
        return 'Subtitles: Visible (Click to enable Active Listening blur)';
    }
  };

  return (
    <div
      className={`absolute right-3 top-3 z-20 flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs shadow-lg select-none transition-opacity duration-300 ${
        isVisible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
      }`}
      style={{
        backgroundColor: `rgba(var(--ytai-bg-rgb), 0.88)`,
        borderColor: 'var(--ytai-border)',
        borderWidth: '1px',
        borderStyle: 'solid',
        backdropFilter: 'blur(var(--ytai-backdrop-blur, 12px))',
        WebkitBackdropFilter: 'blur(var(--ytai-backdrop-blur, 12px))',
        color: 'var(--ytai-text-primary)'
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        title={settings.enabled ? 'Disable YouTube Lang AI' : 'Enable YouTube Lang AI'}
        onClick={() => onUpdateSettings({ enabled: !settings.enabled })}
        style={
          settings.enabled
            ? {
                backgroundColor: 'var(--ytai-accent)',
                color: '#ffffff'
              }
            : {
                backgroundColor: 'var(--ytai-surface)',
                color: 'var(--ytai-text-secondary)'
              }
        }
        className="flex items-center gap-1 rounded-full px-2 py-1 font-medium transition hover:opacity-90 shadow-sm"
      >
        <Power className="h-3.5 w-3.5" />
        <span>Lang AI</span>
      </button>

      {settings.enabled && (
        <>
          <button
            type="button"
            title="Toggle Dual Subtitles"
            onClick={() =>
              onUpdateSettings({ showDualSubtitles: !settings.showDualSubtitles })
            }
            style={
              settings.showDualSubtitles
                ? {
                    backgroundColor: 'var(--ytai-accent)',
                    color: '#ffffff'
                  }
                : {
                    color: 'var(--ytai-text-secondary)'
                  }
            }
            className="rounded-full p-1.5 transition hover:bg-[rgba(var(--ytai-accent-rgb),0.2)]"
          >
            <Languages className="h-3.5 w-3.5" />
          </button>

          {/* 3-way Active Listening / Stealth Mode Cycler */}
          <button
            type="button"
            title={getListeningModeTitle()}
            onClick={cycleListeningMode}
            style={
              settings.activeListeningMode !== 'off'
                ? {
                    backgroundColor: 'var(--ytai-accent)',
                    color: '#ffffff'
                  }
                : {
                    color: 'var(--ytai-text-secondary)'
                  }
            }
            className="rounded-full p-1.5 transition hover:bg-[rgba(var(--ytai-accent-rgb),0.2)]"
          >
            {settings.activeListeningMode === 'hidden' ? (
              <Ghost className="h-3.5 w-3.5" />
            ) : settings.activeListeningMode === 'blur' ? (
              <EyeOff className="h-3.5 w-3.5" />
            ) : (
              <Eye className="h-3.5 w-3.5" />
            )}
          </button>

          <button
            type="button"
            title="Auto-pause at end of each subtitle cue"
            onClick={() =>
              onUpdateSettings({ autoPauseAfterCue: !settings.autoPauseAfterCue })
            }
            style={
              settings.autoPauseAfterCue
                ? {
                    backgroundColor: 'var(--ytai-accent)',
                    color: '#ffffff'
                  }
                : {
                    color: 'var(--ytai-text-secondary)'
                  }
            }
            className="rounded-full p-1.5 transition hover:bg-[rgba(var(--ytai-accent-rgb),0.2)]"
          >
            <PauseCircle className="h-3.5 w-3.5" />
          </button>

          <button
            type="button"
            title="Repeat current subtitle (R)"
            onClick={onRepeatCue}
            style={{ color: 'var(--ytai-text-secondary)' }}
            className="rounded-full p-1.5 transition hover:bg-[rgba(var(--ytai-accent-rgb),0.2)] hover:text-white"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>

          {/* Quick Subtitle Font Sizing Group (A- / size / A+) */}
          <div
            className="flex items-center rounded-full border px-1 py-0.5"
            style={{
              backgroundColor: 'var(--ytai-surface)',
              borderColor: 'var(--ytai-border)'
            }}
          >
            <button
              type="button"
              title="Уменьшить субтитры (хоткей: [)"
              onClick={handleDecreaseFontSize}
              disabled={currentFontSize <= 14}
              className="rounded-full px-1.5 py-0.5 text-[11px] font-semibold transition hover:bg-white/10 hover:text-white disabled:opacity-40"
              style={{ color: 'var(--ytai-text-secondary)' }}
            >
              A-
            </button>
            <button
              type="button"
              onClick={handleToggleTvPreset}
              className="px-1 text-[11px] font-bold tracking-tight transition hover:opacity-80"
              style={{ color: 'var(--ytai-accent)' }}
              title={`Размер шрифта: ${currentFontSize}px (кликните для переключения Standard / TV)`}
            >
              {currentFontSize}
            </button>
            <button
              type="button"
              title="Увеличить субтитры (хоткей: ])"
              onClick={handleIncreaseFontSize}
              disabled={currentFontSize >= 56}
              className="rounded-full px-1.5 py-0.5 text-[11px] font-semibold transition hover:bg-white/10 hover:text-white disabled:opacity-40"
              style={{ color: 'var(--ytai-text-secondary)' }}
            >
              A+
            </button>
          </div>

          {/* Reset position button (shown only when position has been customized) */}
          {settings.subtitlePosition && onResetPosition && (
            <button
              type="button"
              title="Reset subtitle position to default (center bottom)"
              onClick={onResetPosition}
              style={{ color: 'var(--ytai-accent)' }}
              className="rounded-full p-1.5 transition hover:bg-[rgba(var(--ytai-accent-rgb),0.2)] hover:text-white"
            >
              <Move className="h-3.5 w-3.5" />
            </button>
          )}

          {trackMeta && (
            <span
              className="ml-0.5 rounded-full px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide border"
              style={{
                backgroundColor: 'var(--ytai-surface)',
                borderColor: 'var(--ytai-border)',
                color: 'var(--ytai-text-secondary)'
              }}
            >
              {trackMeta.lang}
              {trackMeta.isAsr ? ' · ASR' : ''}
              {cueCount > 0 ? ` · ${cueCount}` : ''}
            </span>
          )}
        </>
      )}
    </div>
  );
}
