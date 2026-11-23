import { useEffect, useRef, useState, type ReactElement } from 'react';
import {
  ChevronDown,
  Eye,
  Ghost,
  Languages,
  Move,
  PauseCircle,
  Power,
  RotateCcw,
  Sparkles,
  Timer
} from 'lucide-react';
import type { ActiveListeningMode, ControlsScale, UserSettings } from '../types/settings';
import type { TrackMetadata } from '../types/subtitles';

interface PlayerControlsProps {
  settings: UserSettings;
  trackMeta: TrackMetadata | null;
  cueCount: number;
  captionRateLimitedUntil?: number;
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
    dropdownPadClass: 'p-1.5'
  },
  lg: {
    containerClass: 'gap-2 px-3 py-2',
    iconBtnPadClass: 'p-2',
    powerBtnPadClass: 'px-2.5 py-1 text-sm',
    iconSize: 20,
    textClass: 'text-xs',
    badgeClass: 'px-2.5 py-1 text-xs',
    dropdownPadClass: 'p-2'
  },
  xl: {
    containerClass: 'gap-2.5 px-4 py-2.5',
    iconBtnPadClass: 'p-2.5',
    powerBtnPadClass: 'px-3 py-1.5 text-base',
    iconSize: 24,
    textClass: 'text-sm',
    badgeClass: 'px-3 py-1 text-sm',
    dropdownPadClass: 'p-2.5'
  }
};

const LISTENING_MODES: Array<{
  id: ActiveListeningMode;
  label: string;
  description: string;
  icon: typeof Eye;
}> = [
  {
    id: 'off',
    label: 'Обычный режим',
    description: 'Субтитры всегда отображаются на экране.',
    icon: Eye
  },
  {
    id: 'blur',
    label: 'Active Listening (Размытие)',
    description:
      'Текст размыт для тренировки слуха; проявляется при наведении мыши или удержании Alt.',
    icon: Sparkles
  },
  {
    id: 'hidden',
    label: 'Stealth-режим (Только по Alt)',
    description:
      'Субтитры полностью скрыты и появляются только пока зажата клавиша Alt.',
    icon: Ghost
  }
];

export function PlayerControls({
  settings,
  trackMeta,
  cueCount,
  captionRateLimitedUntil,
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
  const [isTimerMenuOpen, setIsTimerMenuOpen] = useState(false);
  const [customTimerInput, setCustomTimerInput] = useState('');

  const modeMenuRef = useRef<HTMLDivElement | null>(null);
  const timerMenuRef = useRef<HTMLDivElement | null>(null);
  const modeLeaveTimeoutRef = useRef<number | null>(null);
  const timerLeaveTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (modeLeaveTimeoutRef.current !== null) {
        window.clearTimeout(modeLeaveTimeoutRef.current);
      }
      if (timerLeaveTimeoutRef.current !== null) {
        window.clearTimeout(timerLeaveTimeoutRef.current);
      }
    };
  }, []);

  const handleModeMouseEnter = (): void => {
    if (modeLeaveTimeoutRef.current !== null) {
      window.clearTimeout(modeLeaveTimeoutRef.current);
      modeLeaveTimeoutRef.current = null;
    }
    setIsModeMenuOpen(true);
  };

  const handleModeMouseLeave = (): void => {
    if (modeLeaveTimeoutRef.current !== null) {
      window.clearTimeout(modeLeaveTimeoutRef.current);
    }
    modeLeaveTimeoutRef.current = window.setTimeout(() => {
      setIsModeMenuOpen(false);
      setHoveredModeId(null);
      modeLeaveTimeoutRef.current = null;
    }, 150);
  };

  const handleTimerMouseEnter = (): void => {
    if (timerLeaveTimeoutRef.current !== null) {
      window.clearTimeout(timerLeaveTimeoutRef.current);
      timerLeaveTimeoutRef.current = null;
    }
    setIsTimerMenuOpen(true);
  };

  const handleTimerMouseLeave = (): void => {
    if (timerLeaveTimeoutRef.current !== null) {
      window.clearTimeout(timerLeaveTimeoutRef.current);
    }
    timerLeaveTimeoutRef.current = window.setTimeout(() => {
      setIsTimerMenuOpen(false);
      timerLeaveTimeoutRef.current = null;
    }, 150);
  };

  const handleCustomTimerSubmit = (): void => {
    const val = parseInt(customTimerInput.trim(), 10);
    if (!isNaN(val) && val >= 1 && val <= 300) {
      onUpdateSettings({ pauseTimerSeconds: val, autoPauseAfterCue: true });
      setIsTimerMenuOpen(false);
      setCustomTimerInput('');
    }
  };

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
    if (!isModeMenuOpen && !isTimerMenuOpen) return;

    const handleDocumentClick = (e: MouseEvent): void => {
      const path = e.composedPath();
      if (modeMenuRef.current && !path.includes(modeMenuRef.current)) {
        setIsModeMenuOpen(false);
        setHoveredModeId(null);
      }
      if (timerMenuRef.current && !path.includes(timerMenuRef.current)) {
        setIsTimerMenuOpen(false);
      }
    };

    const handleDocumentKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setIsModeMenuOpen(false);
        setIsTimerMenuOpen(false);
        setHoveredModeId(null);
      }
    };

    document.addEventListener('mousedown', handleDocumentClick);
    document.addEventListener('keydown', handleDocumentKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleDocumentClick);
      document.removeEventListener('keydown', handleDocumentKeyDown);
    };
  }, [isModeMenuOpen, isTimerMenuOpen]);

  const shouldAutoHide = settings.autoHideControls ?? true;
  const isVisible =
    !shouldAutoHide ||
    isPaused ||
    !isYtAutohide ||
    isHovered ||
    isModeMenuOpen ||
    isTimerMenuOpen ||
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

  const cycleListeningMode = (e: React.MouseEvent): void => {
    e.stopPropagation();
    const current = settings.activeListeningMode || 'off';
    const next: ActiveListeningMode =
      current === 'off' ? 'blur' : current === 'blur' ? 'hidden' : 'off';
    onUpdateSettings({ activeListeningMode: next });
  };

  const getListeningModeTitle = (): string => {
    switch (settings.activeListeningMode) {
      case 'blur':
        return 'Active Listening: Размытие (Клик — переключить на Stealth)';
      case 'hidden':
        return 'Stealth-режим: Скрыто до Alt (Клик — выключить)';
      default:
        return 'Обычный режим: Субтитры видны (Клик — включить Active Listening)';
    }
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

      {Boolean(captionRateLimitedUntil && captionRateLimitedUntil > Date.now()) && (
        <span
          title="YouTube HTTP 429: Лимит запросов. Кэш активен, повторные запросы приостановлены."
          className="rounded-full bg-amber-500/25 px-2 py-0.5 text-[10px] font-bold text-amber-300 border border-amber-500/40 select-none animate-pulse"
        >
          429
        </span>
      )}

      {settings.enabled && (
        <>
          <button
            type="button"
            title="Toggle Dual Subtitles"
            onClick={() => {
              const nextVal = !(settings.showTranslation ?? settings.showDualSubtitles);
              onUpdateSettings({ showTranslation: nextVal, showDualSubtitles: nextVal });
            }}
            style={(settings.showTranslation ?? settings.showDualSubtitles) ? activeStyle : inactiveStyle}
            className={`rounded-full ${scale.iconBtnPadClass} transition hover:bg-[rgba(var(--ytai-accent-rgb),0.2)]`}
          >
            <Languages size={scale.iconSize} />
          </button>

          {/* Split-button: Subtitle Perception Mode (Icon click = cycle, Hover = dropdown) */}
          <div
            className="relative"
            ref={modeMenuRef}
            onMouseEnter={handleModeMouseEnter}
            onMouseLeave={handleModeMouseLeave}
          >
            <div
              className="flex items-center rounded-full transition"
              style={
                settings.activeListeningMode !== 'off'
                  ? activeStyle
                  : {
                      backgroundColor: 'transparent',
                      color: 'var(--ytai-text-secondary)'
                    }
              }
            >
              {/* Left clickable zone: Mode icon (instant circular cycle) */}
              <button
                type="button"
                title={getListeningModeTitle()}
                onClick={cycleListeningMode}
                className={`flex items-center justify-center rounded-l-full ${scale.iconBtnPadClass} transition hover:opacity-80`}
              >
                {settings.activeListeningMode === 'hidden' ? (
                  <Ghost size={scale.iconSize} />
                ) : settings.activeListeningMode === 'blur' ? (
                  <Sparkles size={scale.iconSize} />
                ) : (
                  <Eye size={scale.iconSize} />
                )}
              </button>

              <span
                className="h-3 w-[1px] opacity-25"
                style={{
                  backgroundColor:
                    settings.activeListeningMode !== 'off'
                      ? 'currentColor'
                      : 'var(--ytai-border, rgba(255,255,255,0.2))'
                }}
              />

              {/* Right clickable zone: ChevronDown (toggle dropdown menu) */}
              <button
                type="button"
                title="Выбрать режим субтитров..."
                onClick={(e) => {
                  e.stopPropagation();
                  setIsModeMenuOpen((prev) => !prev);
                  setHoveredModeId(null);
                }}
                className="flex items-center justify-center rounded-r-full px-1 py-1 transition hover:opacity-80"
              >
                <ChevronDown
                  size={Math.max(10, scale.iconSize - 4)}
                  className={`transition-transform duration-200 ${
                    isModeMenuOpen ? 'rotate-180 opacity-100' : 'opacity-70'
                  }`}
                />
              </button>
            </div>

            {/* Dropdown Menu: STRICTLY 3 icons with rich hover tooltips */}
            {isModeMenuOpen && (
              <div
                className={`absolute right-0 top-full mt-1.5 z-30 flex items-center gap-1.5 rounded-2xl border ${scale.dropdownPadClass} shadow-2xl backdrop-blur-md select-none`}
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

                {/* Rich Hover Tooltip */}
                {(() => {
                  const hoveredMode = LISTENING_MODES.find((m) => m.id === hoveredModeId);
                  if (!hoveredMode) return null;
                  return (
                    <div
                      className="absolute right-0 top-full mt-2 w-64 rounded-xl border p-2.5 text-xs shadow-2xl backdrop-blur-md pointer-events-none z-50 select-none animate-in fade-in duration-150"
                      style={{
                        backgroundColor: 'rgba(15, 17, 23, 0.96)',
                        borderColor: 'rgba(255, 255, 255, 0.16)',
                        color: 'var(--ytai-text-primary)'
                      }}
                    >
                      <div className="font-semibold text-white">
                        {hoveredMode.label}
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

          <button
            type="button"
            title="Auto-pause at end of each subtitle cue"
            onClick={() =>
              onUpdateSettings({ autoPauseAfterCue: !settings.autoPauseAfterCue })
            }
            style={settings.autoPauseAfterCue ? activeStyle : inactiveStyle}
            className={`rounded-full ${scale.iconBtnPadClass} transition hover:bg-[rgba(var(--ytai-accent-rgb),0.2)]`}
          >
            <PauseCircle size={scale.iconSize} />
          </button>

          {/* Pause Timer Control (Hover dropdown) */}
          <div
            className="relative"
            ref={timerMenuRef}
            onMouseEnter={handleTimerMouseEnter}
            onMouseLeave={handleTimerMouseLeave}
          >
            <button
              type="button"
              title={
                settings.pauseTimerSeconds > 0
                  ? `Таймер автопаузы: ${settings.pauseTimerSeconds}с (наведите для выбора)`
                  : 'Таймер автопаузы (наведите для выбора)'
              }
              onClick={() => {
                if (settings.pauseTimerSeconds > 0) {
                  onUpdateSettings({ pauseTimerSeconds: 0 });
                } else {
                  onUpdateSettings({ pauseTimerSeconds: 3, autoPauseAfterCue: true });
                }
              }}
              style={settings.pauseTimerSeconds > 0 ? activeStyle : inactiveStyle}
              className={`flex items-center gap-1 rounded-full ${scale.iconBtnPadClass} transition hover:bg-[rgba(var(--ytai-accent-rgb),0.2)]`}
            >
              <Timer size={scale.iconSize} />
              {settings.pauseTimerSeconds > 0 && (
                <span className="font-mono text-[10px] font-bold leading-none tracking-tight pr-0.5">
                  {settings.pauseTimerSeconds}с
                </span>
              )}
            </button>

            {isTimerMenuOpen && (
              <div
                className={`absolute right-0 top-full mt-1.5 z-30 w-44 rounded-2xl border ${scale.dropdownPadClass} p-2 shadow-2xl backdrop-blur-md select-none`}
                style={{
                  backgroundColor: 'rgba(15, 17, 23, 0.96)',
                  borderColor: 'rgba(255, 255, 255, 0.16)',
                  color: 'var(--ytai-text-primary)'
                }}
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Снятие автопаузы
                </div>

                <div className="space-y-0.5">
                  {[
                    { label: 'Выкл', sec: 0 },
                    { label: '3 сек', sec: 3 },
                    { label: '5 сек', sec: 5 },
                    { label: '10 сек', sec: 10 }
                  ].map((opt) => {
                    const isSelected = (settings.pauseTimerSeconds ?? 0) === opt.sec;
                    return (
                      <button
                        key={opt.label}
                        type="button"
                        onClick={() => {
                          onUpdateSettings({
                            pauseTimerSeconds: opt.sec,
                            ...(opt.sec > 0 ? { autoPauseAfterCue: true } : {})
                          });
                          setIsTimerMenuOpen(false);
                        }}
                        className="flex w-full items-center justify-between rounded-lg px-2 py-1 text-xs transition hover:bg-white/10"
                        style={
                          isSelected
                            ? { color: 'var(--ytai-accent)', fontWeight: 600 }
                            : { color: 'var(--ytai-text-primary)' }
                        }
                      >
                        <span>{opt.label}</span>
                        {isSelected && <span className="text-[10px] font-bold">✓</span>}
                      </button>
                    );
                  })}
                </div>

                {/* Custom duration option */}
                <div className="mt-1.5 border-t border-white/10 pt-1.5">
                  <div className="mb-1 px-2 text-[10px] text-slate-400">Свой вариант:</div>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleCustomTimerSubmit();
                    }}
                    className="flex items-center gap-1 px-1"
                  >
                    <input
                      type="number"
                      min={1}
                      max={300}
                      placeholder="сек"
                      value={customTimerInput}
                      onChange={(e) => setCustomTimerInput(e.target.value)}
                      onKeyDown={(e) => e.stopPropagation()}
                      onKeyUp={(e) => e.stopPropagation()}
                      onKeyPress={(e) => e.stopPropagation()}
                      className="w-16 rounded-lg border border-white/10 bg-slate-900/90 px-2 py-1 text-xs text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
                    />
                    <button
                      type="submit"
                      className="rounded-lg px-2.5 py-1 text-xs font-semibold text-white transition hover:opacity-90"
                      style={{ backgroundColor: 'var(--ytai-accent)' }}
                    >
                      OK
                    </button>
                  </form>
                </div>
              </div>
            )}
          </div>

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
