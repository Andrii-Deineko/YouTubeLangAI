import { useEffect, useRef, useState, type ReactElement } from 'react';
import {
  ChevronDown,
  Eye,
  EyeOff,
  Ghost,
  Languages,
  Move,
  PauseCircle,
  Power,
  RotateCcw
} from 'lucide-react';
import type { ActiveListeningMode, ControlsScale, UserSettings } from '../../types/settings';
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

interface ScaleConfig {
  containerClass: string;
  iconBtnPadClass: string;
  powerBtnPadClass: string;
  iconSize: number;
  textClass: string;
  badgeClass: string;
  dropdownPadClass: string;
}

const SCALE_CONFIGS: Record<ControlsScale, ScaleConfig> = {
  sm: {
    containerClass: 'gap-1 px-2 py-1',
    iconBtnPadClass: 'p-1',
    powerBtnPadClass: 'px-1.5 py-0.5 text-[11px]',
    iconSize: 14,
    textClass: 'text-[10px]',
    badgeClass: 'px-1.5 py-0.5 text-[10px]',
    dropdownPadClass: 'p-1'
  },
  md: {
    containerClass: 'gap-1.5 px-2.5 py-1.5',
    iconBtnPadClass: 'p-1.5',
    powerBtnPadClass: 'px-2 py-1 text-xs',
    iconSize: 16,
    textClass: 'text-[11px]',
    badgeClass: 'px-2 py-0.5 text-[11px]',
    dropdownPadClass: 'p-1'
  },
  lg: {
    containerClass: 'gap-2 px-3 py-2',
    iconBtnPadClass: 'p-2',
    powerBtnPadClass: 'px-2.5 py-1 text-sm',
    iconSize: 20,
    textClass: 'text-xs',
    badgeClass: 'px-2.5 py-1 text-xs',
    dropdownPadClass: 'p-1.5'
  },
  xl: {
    containerClass: 'gap-2.5 px-4 py-2.5',
    iconBtnPadClass: 'p-2.5',
    powerBtnPadClass: 'px-3 py-1.5 text-base',
    iconSize: 24,
    textClass: 'text-sm',
    badgeClass: 'px-3 py-1 text-sm',
    dropdownPadClass: 'p-2'
  }
};

const LISTENING_MODES: Array<{
  id: ActiveListeningMode;
  label: string;
  sublabel: string;
  description: string;
  hotkey?: string;
  icon: typeof Eye;
}> = [
  {
    id: 'off',
    label: 'Обычный режим',
    sublabel: 'Всегда видны',
    description: 'Субтитры постоянно отображаются на экране',
    icon: Eye
  },
  {
    id: 'blur',
    label: 'Active Listening',
    sublabel: 'Размытие',
    description: 'Субтитры размыты. Наведите курсор или зажмите Alt для показа',
    hotkey: 'Hover / Alt',
    icon: EyeOff
  },
  {
    id: 'hidden',
    label: 'Stealth-режим',
    sublabel: 'Только по Alt',
    description: 'Субтитры полностью скрыты. Удерживайте Alt для просмотра',
    hotkey: 'Alt',
    icon: Ghost
  }
];

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
  const [isModeMenuOpen, setIsModeMenuOpen] = useState(false);
  const [hoveredModeId, setHoveredModeId] = useState<ActiveListeningMode | null>(null);
  const modeMenuRef = useRef<HTMLDivElement | null>(null);

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

  useEffect(() => {
    if (!isModeMenuOpen) return;

    const handleDocumentClick = (e: MouseEvent): void => {
      const path = e.composedPath();
      if (modeMenuRef.current && !path.includes(modeMenuRef.current)) {
        setIsModeMenuOpen(false);
        setHoveredModeId(null);
      }
    };

    const handleDocumentKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setIsModeMenuOpen(false);
        setHoveredModeId(null);
      }
    };

    document.addEventListener('mousedown', handleDocumentClick);
    document.addEventListener('keydown', handleDocumentKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleDocumentClick);
      document.removeEventListener('keydown', handleDocumentKeyDown);
    };
  }, [isModeMenuOpen]);

  const shouldAutoHide = settings.autoHideControls ?? true;
  const isVisible =
    !shouldAutoHide ||
    isPaused ||
    !isYtAutohide ||
    isHovered ||
    isModeMenuOpen ||
    Boolean(altPressed) ||
    Boolean(hasActivePopup);

  const scale = SCALE_CONFIGS[settings.controlsScale || 'md'] || SCALE_CONFIGS.md;
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

  const activeStyle: React.CSSProperties = {
    backgroundColor: 'var(--ytai-accent)',
    color: 'var(--ytai-accent-fg, #ffffff)'
  };

  const inactiveStyle: React.CSSProperties = {
    color: 'var(--ytai-text-secondary)'
  };

  return (
    <div
      className={`absolute right-3 top-3 z-20 flex items-center rounded-full shadow-lg select-none transition-opacity duration-300 ${scale.containerClass} ${
        isVisible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
      }`}
      style={{
        backgroundColor: 'rgba(15, 17, 23, 0.78)',
        borderColor: 'rgba(255, 255, 255, 0.14)',
        borderWidth: '1px',
        borderStyle: 'solid',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
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
            ? activeStyle
            : {
                backgroundColor: 'var(--ytai-surface)',
                color: 'var(--ytai-text-secondary)'
              }
        }
        className={`flex items-center gap-1 rounded-full ${scale.powerBtnPadClass} font-medium transition hover:opacity-90 shadow-sm`}
      >
        <Power size={scale.iconSize} />
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
            style={settings.showDualSubtitles ? activeStyle : inactiveStyle}
            className={`rounded-full ${scale.iconBtnPadClass} transition hover:bg-[rgba(var(--ytai-accent-rgb),0.2)]`}
          >
            <Languages size={scale.iconSize} />
          </button>

          {/* 3-way Subtitle Listening Mode Dropdown */}
          <div className="relative" ref={modeMenuRef}>
            <button
              type="button"
              title="Режим восприятия субтитров (кликните для выбора)"
              onClick={() => {
                setIsModeMenuOpen((prev) => !prev);
                setHoveredModeId(null);
              }}
              style={settings.activeListeningMode !== 'off' ? activeStyle : inactiveStyle}
              className={`flex items-center gap-0.5 rounded-full ${scale.iconBtnPadClass} transition hover:bg-[rgba(var(--ytai-accent-rgb),0.2)]`}
            >
              {settings.activeListeningMode === 'hidden' ? (
                <Ghost size={scale.iconSize} />
              ) : settings.activeListeningMode === 'blur' ? (
                <EyeOff size={scale.iconSize} />
              ) : (
                <Eye size={scale.iconSize} />
              )}
              <ChevronDown size={Math.max(10, scale.iconSize - 4)} className="opacity-70" />
            </button>

            {isModeMenuOpen && (
              <div
                className={`absolute right-0 top-full mt-1.5 z-30 flex items-center gap-1 rounded-2xl border ${scale.dropdownPadClass} shadow-2xl backdrop-blur-md select-none`}
                style={{
                  backgroundColor: 'rgba(15, 17, 23, 0.95)',
                  borderColor: 'rgba(255, 255, 255, 0.16)'
                }}
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
              >
                {LISTENING_MODES.map((mode) => {
                  const Icon = mode.icon;
                  const isActive = settings.activeListeningMode === mode.id;
                  return (
                    <button
                      key={mode.id}
                      type="button"
                      onClick={() => {
                        onUpdateSettings({ activeListeningMode: mode.id });
                        setIsModeMenuOpen(false);
                        setHoveredModeId(null);
                      }}
                      onMouseEnter={() => setHoveredModeId(mode.id)}
                      onMouseLeave={() =>
                        setHoveredModeId((prev) => (prev === mode.id ? null : prev))
                      }
                      style={isActive ? activeStyle : inactiveStyle}
                      className={`flex items-center justify-center rounded-xl ${scale.iconBtnPadClass} transition hover:bg-white/10`}
                    >
                      <Icon size={scale.iconSize} />
                    </button>
                  );
                })}

                {/* Rich Tooltip on Hover */}
                {(() => {
                  const hoveredMode = LISTENING_MODES.find((m) => m.id === hoveredModeId);
                  if (!hoveredMode) return null;
                  return (
                    <div
                      className="absolute right-0 top-full mt-2 w-64 rounded-xl border p-2.5 text-xs shadow-2xl backdrop-blur-md pointer-events-none z-40"
                      style={{
                        backgroundColor: 'rgba(15, 17, 23, 0.96)',
                        borderColor: 'rgba(255, 255, 255, 0.16)',
                        color: 'var(--ytai-text-primary)'
                      }}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-white">{hoveredMode.label}</span>
                        {hoveredMode.hotkey && (
                          <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-mono text-slate-300">
                            {hoveredMode.hotkey}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-[11px] leading-relaxed text-slate-300">
                        {hoveredMode.description}
                      </p>
                    </div>
                  );
                })()}
              </div>
            )}
          </div>

          {/* Auto-pause Cue with Optional Resume Delay Indicator */}
          <button
            type="button"
            title={
              settings.autoPauseAfterCue
                ? settings.autoPauseResumeDelaySec
                  ? `Автопауза субтитров (автовозобновление через ${settings.autoPauseResumeDelaySec}с)`
                  : 'Автопауза в конце субтитров (возобновление вручную)'
                : 'Включить автопаузу в конце субтитров'
            }
            onClick={() =>
              onUpdateSettings({ autoPauseAfterCue: !settings.autoPauseAfterCue })
            }
            style={settings.autoPauseAfterCue ? activeStyle : inactiveStyle}
            className={`flex items-center gap-1 rounded-full ${scale.iconBtnPadClass} transition hover:bg-[rgba(var(--ytai-accent-rgb),0.2)]`}
          >
            <PauseCircle size={scale.iconSize} />
            {settings.autoPauseAfterCue && settings.autoPauseResumeDelaySec && (
              <span
                className="rounded-full px-1 py-0.2 text-[10px] font-bold tracking-tight"
                style={{
                  backgroundColor: 'rgba(0, 0, 0, 0.25)',
                  color: 'inherit'
                }}
              >
                {settings.autoPauseResumeDelaySec}s
              </span>
            )}
          </button>

          <button
            type="button"
            title="Repeat current subtitle (R)"
            onClick={onRepeatCue}
            style={inactiveStyle}
            className={`rounded-full ${scale.iconBtnPadClass} transition hover:bg-[rgba(var(--ytai-accent-rgb),0.2)] hover:text-white`}
          >
            <RotateCcw size={scale.iconSize} />
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
              className={`rounded-full px-1.5 py-0.5 ${scale.textClass} font-semibold transition hover:bg-white/10 hover:text-white disabled:opacity-40`}
              style={inactiveStyle}
            >
              A-
            </button>
            <button
              type="button"
              onClick={handleToggleTvPreset}
              className={`px-1 ${scale.textClass} font-bold tracking-tight transition hover:opacity-80`}
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
              className={`rounded-full px-1.5 py-0.5 ${scale.textClass} font-semibold transition hover:bg-white/10 hover:text-white disabled:opacity-40`}
              style={inactiveStyle}
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
              className={`rounded-full ${scale.iconBtnPadClass} transition hover:bg-[rgba(var(--ytai-accent-rgb),0.2)] hover:text-white`}
            >
              <Move size={scale.iconSize} />
            </button>
          )}

          {trackMeta && (
            <span
              className={`ml-0.5 rounded-full ${scale.badgeClass} font-medium uppercase tracking-wide border`}
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
