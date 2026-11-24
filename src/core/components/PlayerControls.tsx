import { useEffect, useRef, useState, type ReactElement } from 'react';
import {
  Eye,
  Ghost,
  Languages,
  Minus,
  Move,
  PauseCircle,
  Plus,
  Power,
  RotateCcw,
  Sparkles,
  Type
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
  const [isFontMenuOpen, setIsFontMenuOpen] = useState(false);

  const modeMenuRef = useRef<HTMLDivElement | null>(null);
  const timerMenuRef = useRef<HTMLDivElement | null>(null);
  const fontMenuRef = useRef<HTMLDivElement | null>(null);
  const modeLeaveTimeoutRef = useRef<number | null>(null);
  const timerLeaveTimeoutRef = useRef<number | null>(null);
  const fontLeaveTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (modeLeaveTimeoutRef.current !== null) {
        window.clearTimeout(modeLeaveTimeoutRef.current);
      }
      if (timerLeaveTimeoutRef.current !== null) {
        window.clearTimeout(timerLeaveTimeoutRef.current);
      }
      if (fontLeaveTimeoutRef.current !== null) {
        window.clearTimeout(fontLeaveTimeoutRef.current);
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

  const handleFontMouseEnter = (): void => {
    if (fontLeaveTimeoutRef.current !== null) {
      window.clearTimeout(fontLeaveTimeoutRef.current);
      fontLeaveTimeoutRef.current = null;
    }
    setIsFontMenuOpen(true);
  };

  const handleFontMouseLeave = (): void => {
    if (fontLeaveTimeoutRef.current !== null) {
      window.clearTimeout(fontLeaveTimeoutRef.current);
    }
    fontLeaveTimeoutRef.current = window.setTimeout(() => {
      setIsFontMenuOpen(false);
      fontLeaveTimeoutRef.current = null;
    }, 180);
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
    if (!isModeMenuOpen && !isTimerMenuOpen && !isFontMenuOpen) return;

    const handleDocumentClick = (e: MouseEvent): void => {
      const path = e.composedPath();
      if (modeMenuRef.current && !path.includes(modeMenuRef.current)) {
        setIsModeMenuOpen(false);
        setHoveredModeId(null);
      }
      if (timerMenuRef.current && !path.includes(timerMenuRef.current)) {
        setIsTimerMenuOpen(false);
      }
      if (fontMenuRef.current && !path.includes(fontMenuRef.current)) {
        setIsFontMenuOpen(false);
      }
    };

    const handleDocumentKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setIsModeMenuOpen(false);
        setIsTimerMenuOpen(false);
        setIsFontMenuOpen(false);
        setHoveredModeId(null);
      }
    };

    document.addEventListener('mousedown', handleDocumentClick);
    document.addEventListener('keydown', handleDocumentKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleDocumentClick);
      document.removeEventListener('keydown', handleDocumentKeyDown);
    };
  }, [isModeMenuOpen, isTimerMenuOpen, isFontMenuOpen]);

  const shouldAutoHide = settings.autoHideControls ?? true;
  const isVisible =
    !shouldAutoHide ||
    isPaused ||
    !isYtAutohide ||
    isHovered ||
    isModeMenuOpen ||
    isTimerMenuOpen ||
    isFontMenuOpen ||
    Boolean(altPressed) ||
    Boolean(hasActivePopup);

  const scale = SCALE_CONFIGS[settings.controlsScale || 'md'] || SCALE_CONFIGS.md;
  const currentFontSize = settings.subtitleFontSize ?? 20;

  const handleDecreaseFontSize = (e?: React.MouseEvent): void => {
    e?.stopPropagation();
    const next = Math.max(12, currentFontSize - 2);
    onUpdateSettings({ subtitleFontSize: next });
  };

  const handleIncreaseFontSize = (e?: React.MouseEvent): void => {
    e?.stopPropagation();
    const next = Math.min(56, currentFontSize + 2);
    onUpdateSettings({ subtitleFontSize: next });
  };

  const handleResetFontSize = (e?: React.MouseEvent): void => {
    e?.stopPropagation();
    onUpdateSettings({ subtitleFontSize: 20 });
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

          {/* Subtitle Perception Mode (Icon click = cycle, Hover = dropdown) */}
          <div
            className="relative"
            ref={modeMenuRef}
            onMouseEnter={handleModeMouseEnter}
            onMouseLeave={handleModeMouseLeave}
          >
            <button
              type="button"
              title={getListeningModeTitle()}
              onClick={cycleListeningMode}
              style={
                settings.activeListeningMode !== 'off'
                  ? activeStyle
                  : inactiveStyle
              }
              className={`flex items-center justify-center rounded-full ${scale.iconBtnPadClass} transition hover:bg-[rgba(var(--ytai-accent-rgb),0.2)]`}
            >
              {settings.activeListeningMode === 'hidden' ? (
                <Ghost size={scale.iconSize} />
              ) : settings.activeListeningMode === 'blur' ? (
                <Sparkles size={scale.iconSize} />
              ) : (
                <Eye size={scale.iconSize} />
              )}
            </button>

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

          {/* Auto-pause toggle (click) + Pause Timer dropdown (hover) */}
          <div
            className="relative"
            ref={timerMenuRef}
            onMouseEnter={handleTimerMouseEnter}
            onMouseLeave={handleTimerMouseLeave}
          >
            <button
              type="button"
              title={
                settings.autoPauseAfterCue
                  ? settings.pauseTimerSeconds > 0
                    ? `Автопауза субтитров включена с возобновлением через ${settings.pauseTimerSeconds}с (клик — выключить, наведите для таймера)`
                    : 'Автопауза субтитров включена (клик — выключить, наведите для таймера)'
                  : 'Автопауза в конце субтитров (клик — включить, наведите для таймера)'
              }
              onClick={() =>
                onUpdateSettings({ autoPauseAfterCue: !settings.autoPauseAfterCue })
              }
              style={settings.autoPauseAfterCue ? activeStyle : inactiveStyle}
              className={`flex items-center gap-1 rounded-full ${scale.iconBtnPadClass} transition hover:bg-[rgba(var(--ytai-accent-rgb),0.2)]`}
            >
              <PauseCircle size={scale.iconSize} />
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

          {/* Subtitle Font Sizing Popover (Single compact button + hover popover) */}
          <div
            className="relative inline-flex items-center"
            ref={fontMenuRef}
            onMouseEnter={handleFontMouseEnter}
            onMouseLeave={handleFontMouseLeave}
          >
            <button
              type="button"
              title={`Размер шрифта субтитров: ${currentFontSize}px (наведите для настройки)`}
              onClick={() => setIsFontMenuOpen((prev) => !prev)}
              style={isFontMenuOpen ? activeStyle : inactiveStyle}
              className={`flex items-center justify-center rounded-full ${scale.iconBtnPadClass} transition hover:bg-[rgba(var(--ytai-accent-rgb),0.2)] hover:text-white`}
            >
              <Type size={scale.iconSize} />
            </button>

            {isFontMenuOpen && (
              <div
                className="absolute right-0 top-full pt-1.5 z-30 select-none animate-in fade-in duration-150"
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                onMouseEnter={handleFontMouseEnter}
                onMouseLeave={handleFontMouseLeave}
              >
                <div
                  className={`flex items-center gap-1 rounded-2xl border ${scale.dropdownPadClass} px-2 py-1 shadow-2xl backdrop-blur-md whitespace-nowrap`}
                  style={{
                    backgroundColor: 'rgba(15, 17, 23, 0.96)',
                    borderColor: 'rgba(255, 255, 255, 0.16)',
                    color: 'var(--ytai-text-primary)'
                  }}
                >
                  <button
                    type="button"
                    title="Уменьшить шрифт (-2px, хоткей [)"
                    disabled={currentFontSize <= 12}
                    onClick={handleDecreaseFontSize}
                    style={inactiveStyle}
                    className={`flex items-center justify-center rounded-xl p-1 transition hover:bg-white/10 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent`}
                  >
                    <Minus size={Math.max(12, scale.iconSize - 2)} />
                  </button>

                  <button
                    type="button"
                    title="Текущий размер шрифта (двойной клик — сбросить на 20px)"
                    onDoubleClick={handleResetFontSize}
                    className={`px-1.5 py-0.5 font-mono ${scale.textClass} font-bold tracking-tight rounded transition hover:opacity-80 cursor-pointer`}
                    style={{ color: 'var(--ytai-accent)' }}
                  >
                    {currentFontSize}px
                  </button>

                  <button
                    type="button"
                    title="Увеличить шрифт (+2px, хоткей ])"
                    disabled={currentFontSize >= 56}
                    onClick={handleIncreaseFontSize}
                    style={inactiveStyle}
                    className={`flex items-center justify-center rounded-xl p-1 transition hover:bg-white/10 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent`}
                  >
                    <Plus size={Math.max(12, scale.iconSize - 2)} />
                  </button>
                </div>
              </div>
            )}
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
