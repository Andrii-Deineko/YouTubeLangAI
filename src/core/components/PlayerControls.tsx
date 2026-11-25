import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement
} from 'react';
import {
  Captions,
  Eye,
  Ghost,
  Languages,
  Layers,
  Lock,
  Minus,
  Move,
  PauseCircle,
  Plus,
  Power,
  RotateCcw,
  Sparkles,
  Type
} from 'lucide-react';
import {
  DEFAULT_SUBTITLE_BOX_SIZE,
  type ActiveListeningMode,
  type ControlsScale,
  type SubtitleTrackMode,
  type UserSettings
} from '../types/settings';
import type { TranslationRuntimeStatus } from '../types/messages';
import type { TrackMetadata } from '../types/subtitles';

interface PlayerControlsProps {
  settings: UserSettings;
  trackMeta: TrackMetadata | null;
  cueCount: number;
  captionRateLimitedUntil?: number;
  translationStatus?: TranslationRuntimeStatus;
  altPressed?: boolean;
  hasActivePopup?: boolean;
  onUpdateSettings: (partial: Partial<UserSettings>) => void;
  onRepeatCue: () => void;
  onResetPosition?: () => void;
  onRetryTranslation?: () => void;
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

const TRACK_MODES: Array<{
  id: SubtitleTrackMode;
  label: string;
  description: string;
  icon: typeof Languages;
}> = [
  {
    id: 'dual',
    label: 'Двойные субтитры',
    description: 'Оригинальный текст и перевод второй строкой',
    icon: Layers
  },
  {
    id: 'translation',
    label: 'Только перевод',
    description: 'Только переведённая строка (оригинал по Alt для разбора слов)',
    icon: Languages
  },
  {
    id: 'original',
    label: 'Только оригинал',
    description: 'Только оригинальная дорожка без перевода',
    icon: Captions
  }
];

export function PlayerControls({
  settings,
  trackMeta,
  cueCount,
  captionRateLimitedUntil,
  translationStatus,
  altPressed,
  hasActivePopup,
  onUpdateSettings,
  onRepeatCue,
  onResetPosition,
  onRetryTranslation
}: PlayerControlsProps): ReactElement {
  const [isHovered, setIsHovered] = useState(false);
  const [isYtAutohide, setIsYtAutohide] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isTrackMenuOpen, setIsTrackMenuOpen] = useState(false);
  const [hoveredTrackModeId, setHoveredTrackModeId] = useState<SubtitleTrackMode | null>(null);
  const [isModeMenuOpen, setIsModeMenuOpen] = useState(false);
  const [hoveredModeId, setHoveredModeId] = useState<ActiveListeningMode | null>(null);
  const [isTimerMenuOpen, setIsTimerMenuOpen] = useState(false);
  const [customTimerInput, setCustomTimerInput] = useState('');
  const [isFontMenuOpen, setIsFontMenuOpen] = useState(false);
  const [fontPopoverLayout, setFontPopoverLayout] = useState<{
    offsetX: number | null;
    maxHeight: number | null;
  }>({ offsetX: null, maxHeight: null });
  const [cooldownSecLeft, setCooldownSecLeft] = useState(0);

  useEffect(() => {
    const retryAt = translationStatus?.retryAt ?? 0;
    if (translationStatus?.state !== 'cooldown' || retryAt <= Date.now()) {
      setCooldownSecLeft(0);
      return;
    }

    const updateRemaining = (): void => {
      const diff = Math.max(0, Math.ceil((retryAt - Date.now()) / 1000));
      setCooldownSecLeft(diff);
    };
    updateRemaining();
    const id = window.setInterval(updateRemaining, 1000);
    return () => window.clearInterval(id);
  }, [translationStatus?.state, translationStatus?.retryAt]);

  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const trackMenuRef = useRef<HTMLDivElement | null>(null);
  const modeMenuRef = useRef<HTMLDivElement | null>(null);
  const timerMenuRef = useRef<HTMLDivElement | null>(null);
  const fontMenuRef = useRef<HTMLDivElement | null>(null);
  const trackLeaveTimeoutRef = useRef<number | null>(null);
  const modeLeaveTimeoutRef = useRef<number | null>(null);
  const timerLeaveTimeoutRef = useRef<number | null>(null);
  const fontLeaveTimeoutRef = useRef<number | null>(null);

  const updateFontPopoverPosition = useCallback((): void => {
    const btnWrap = fontMenuRef.current;
    const toolbarEl = toolbarRef.current;
    if (!btnWrap || !toolbarEl) {
      setFontPopoverLayout({ offsetX: null, maxHeight: null });
      return;
    }

    const POPOVER_WIDTH = 296;
    const btnRect = btnWrap.getBoundingClientRect();
    const toolbarRect = toolbarEl.getBoundingClientRect();
    const playerEl =
      toolbarEl.closest<HTMLElement>('#movie_player, .html5-video-player') ??
      toolbarEl.parentElement;
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
    const maxHeight = Math.max(200, availableHeight);

    const btnCenter = btnRect.left + btnRect.width / 2;
    const centeredLeft = btnCenter - POPOVER_WIDTH / 2;
    const centeredRight = btnCenter + POPOVER_WIDTH / 2;

    let offsetX: number | null = null;
    if (centeredLeft < minLeft || centeredRight > maxRight) {
      const targetRight = Math.min(toolbarRect.right, maxRight);
      const preferredLeft =
        centeredRight > maxRight ? targetRight - POPOVER_WIDTH : minLeft;
      const clampedLeft = Math.max(
        minLeft,
        Math.min(preferredLeft, maxRight - POPOVER_WIDTH)
      );
      offsetX = Math.round(clampedLeft - btnRect.left);
    }

    setFontPopoverLayout({ offsetX, maxHeight });
  }, []);

  useLayoutEffect(() => {
    if (!isFontMenuOpen) return;
    updateFontPopoverPosition();
    window.addEventListener('resize', updateFontPopoverPosition);
    return () => {
      window.removeEventListener('resize', updateFontPopoverPosition);
    };
  }, [
    isFontMenuOpen,
    trackMeta,
    cueCount,
    settings.subtitlePosition,
    settings.subtitleBoxSize,
    settings.subtitleBoxFixed,
    settings.controlsScale,
    updateFontPopoverPosition
  ]);

  useEffect(() => {
    return () => {
      if (trackLeaveTimeoutRef.current !== null) {
        window.clearTimeout(trackLeaveTimeoutRef.current);
      }
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

  const clearAllLeaveTimeouts = (): void => {
    if (trackLeaveTimeoutRef.current !== null) {
      window.clearTimeout(trackLeaveTimeoutRef.current);
      trackLeaveTimeoutRef.current = null;
    }
    if (modeLeaveTimeoutRef.current !== null) {
      window.clearTimeout(modeLeaveTimeoutRef.current);
      modeLeaveTimeoutRef.current = null;
    }
    if (timerLeaveTimeoutRef.current !== null) {
      window.clearTimeout(timerLeaveTimeoutRef.current);
      timerLeaveTimeoutRef.current = null;
    }
    if (fontLeaveTimeoutRef.current !== null) {
      window.clearTimeout(fontLeaveTimeoutRef.current);
      fontLeaveTimeoutRef.current = null;
    }
  };

  const openMenuExclusive = (target: 'track' | 'mode' | 'timer' | 'font'): void => {
    clearAllLeaveTimeouts();
    if (target !== 'track') {
      setIsTrackMenuOpen(false);
      setHoveredTrackModeId(null);
    }
    if (target !== 'mode') {
      setIsModeMenuOpen(false);
      setHoveredModeId(null);
    }
    if (target !== 'timer') {
      setIsTimerMenuOpen(false);
    }
    if (target !== 'font') {
      setIsFontMenuOpen(false);
    }

    if (target === 'track') setIsTrackMenuOpen(true);
    if (target === 'mode') setIsModeMenuOpen(true);
    if (target === 'timer') setIsTimerMenuOpen(true);
    if (target === 'font') setIsFontMenuOpen(true);
  };

  const handleTrackMouseEnter = (): void => {
    openMenuExclusive('track');
  };

  const handleTrackMouseLeave = (): void => {
    if (trackLeaveTimeoutRef.current !== null) {
      window.clearTimeout(trackLeaveTimeoutRef.current);
    }
    trackLeaveTimeoutRef.current = window.setTimeout(() => {
      setIsTrackMenuOpen(false);
      setHoveredTrackModeId(null);
      trackLeaveTimeoutRef.current = null;
    }, 150);
  };

  const handleModeMouseEnter = (): void => {
    openMenuExclusive('mode');
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
    openMenuExclusive('timer');
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
    openMenuExclusive('font');
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
    if (!isTrackMenuOpen && !isModeMenuOpen && !isTimerMenuOpen && !isFontMenuOpen) return;

    const handleDocumentClick = (e: MouseEvent): void => {
      const path = e.composedPath();
      if (trackMenuRef.current && !path.includes(trackMenuRef.current)) {
        setIsTrackMenuOpen(false);
        setHoveredTrackModeId(null);
      }
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
        setIsTrackMenuOpen(false);
        setHoveredTrackModeId(null);
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
  }, [isTrackMenuOpen, isModeMenuOpen, isTimerMenuOpen, isFontMenuOpen]);

  const shouldAutoHide = settings.autoHideControls ?? true;
  const isVisible =
    !shouldAutoHide ||
    isPaused ||
    !isYtAutohide ||
    isHovered ||
    isTrackMenuOpen ||
    isModeMenuOpen ||
    isTimerMenuOpen ||
    isFontMenuOpen ||
    Boolean(altPressed) ||
    Boolean(hasActivePopup);

  const scale = SCALE_CONFIGS[settings.controlsScale || 'md'] || SCALE_CONFIGS.md;
  const currentFontSize = settings.fontSize ?? settings.subtitleFontSize ?? 20;
  const currentTranslationScale = settings.translationScale ?? 0.85;
  const currentFontFamily = settings.fontFamily ?? 'sans';
  const currentFontWeight = settings.fontWeight ?? 'normal';
  const currentTextOutline = settings.textOutline ?? 'shadow';
  const currentBackdropOpacity =
    settings.backdropOpacity ??
    (settings.overlayOpacity !== undefined ? Math.round(settings.overlayOpacity * 100) : 80);

  const handleDecreaseFontSize = (e?: React.MouseEvent): void => {
    e?.stopPropagation();
    const next = Math.max(12, currentFontSize - 2);
    onUpdateSettings({ fontSize: next, subtitleFontSize: next });
  };

  const handleIncreaseFontSize = (e?: React.MouseEvent): void => {
    e?.stopPropagation();
    const next = Math.min(56, currentFontSize + 2);
    onUpdateSettings({ fontSize: next, subtitleFontSize: next });
  };

  const handleResetFontSize = (e?: React.MouseEvent): void => {
    e?.stopPropagation();
    onUpdateSettings({ fontSize: 20, subtitleFontSize: 20 });
  };

  const handleResetTypographyStyle = (e?: React.MouseEvent): void => {
    e?.stopPropagation();
    onUpdateSettings({
      fontSize: 20,
      subtitleFontSize: 20,
      translationScale: 0.85,
      fontFamily: 'sans',
      fontWeight: 'normal',
      backdropOpacity: 80,
      overlayOpacity: 0.8,
      textOutline: 'shadow'
    });
  };

  const currentTrackMode: SubtitleTrackMode =
    settings.subtitleTrackMode ||
    (settings.showTranslation === false ? 'original' : 'dual');

  const cycleTrackMode = (e: React.MouseEvent): void => {
    e.stopPropagation();
    const nextMode: SubtitleTrackMode =
      currentTrackMode === 'dual'
        ? 'translation'
        : currentTrackMode === 'translation'
          ? 'original'
          : 'dual';
    onUpdateSettings({ subtitleTrackMode: nextMode });
  };

  const getTrackModeTitle = (): string => {
    switch (currentTrackMode) {
      case 'dual':
        return 'Двойные субтитры (Оригинал + Перевод) · Клик: только перевод';
      case 'translation':
        return 'Только перевод (Оригинал по Alt) · Клик: только оригинал';
      case 'original':
        return 'Только оригинал · Клик: двойные субтитры';
    }
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
      ref={toolbarRef}
      className={`absolute right-3 top-3 z-50 flex items-center rounded-full shadow-lg select-none transition-opacity duration-300 ${scale.containerClass} ${
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

      {settings.enabled &&
        currentTrackMode !== 'original' &&
        translationStatus?.state === 'cooldown' && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRetryTranslation?.();
            }}
            title={
              cooldownSecLeft > 0
                ? `Временный лимит сети переводчика · автоповтор через ${cooldownSecLeft}с (клик — повторить сейчас)`
                : 'Перевод временно недоступен · клик — повторить'
            }
            className="flex items-center gap-1 rounded-full bg-slate-800/80 px-2 py-0.5 text-[10px] font-medium text-slate-300 border border-white/15 hover:bg-white/10 hover:text-white transition select-none cursor-pointer"
          >
            <RotateCcw size={10} className="opacity-80" />
            <span>{cooldownSecLeft > 0 ? `${cooldownSecLeft}с` : 'Повтор'}</span>
          </button>
        )}

      {settings.enabled && (
        <>
          {/* Subtitle Track Mode (文A button: click = cycle, hover = 3-icon menu) */}
          <div
            className="relative inline-flex items-center justify-center"
            ref={trackMenuRef}
            onMouseEnter={handleTrackMouseEnter}
            onMouseLeave={handleTrackMouseLeave}
          >
            <button
              type="button"
              title={isTrackMenuOpen ? undefined : getTrackModeTitle()}
              onClick={cycleTrackMode}
              style={currentTrackMode !== 'original' ? activeStyle : inactiveStyle}
              className={`flex items-center justify-center rounded-full ${scale.iconBtnPadClass} transition hover:bg-[rgba(var(--ytai-accent-rgb),0.2)]`}
            >
              <Languages size={scale.iconSize} />
            </button>

            {/* Dropdown Menu: centered directly under trigger with unbroken hover bridge */}
            {isTrackMenuOpen && (
              <div
                className="absolute left-1/2 -translate-x-1/2 top-full pt-1.5 z-50 select-none animate-in fade-in duration-150"
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <div
                  className={`relative flex items-center gap-1.5 rounded-2xl border ${scale.dropdownPadClass} shadow-2xl backdrop-blur-md`}
                  style={{
                    backgroundColor: 'rgba(15, 17, 23, 0.95)',
                    borderColor: 'rgba(255, 255, 255, 0.16)'
                  }}
                >
                  {TRACK_MODES.map((mode) => {
                    const Icon = mode.icon;
                    const isActive = currentTrackMode === mode.id;
                    return (
                      <button
                        key={mode.id}
                        type="button"
                        onClick={() => {
                          onUpdateSettings({ subtitleTrackMode: mode.id });
                          setIsTrackMenuOpen(false);
                          setHoveredTrackModeId(null);
                        }}
                        onMouseEnter={() => setHoveredTrackModeId(mode.id)}
                        onMouseLeave={() =>
                          setHoveredTrackModeId((prev) => (prev === mode.id ? null : prev))
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
                    const hovered = TRACK_MODES.find((m) => m.id === hoveredTrackModeId);
                    if (!hovered) return null;
                    return (
                      <div
                        className="absolute left-1/2 -translate-x-1/2 top-full mt-2 w-60 rounded-xl border p-2.5 text-xs shadow-2xl backdrop-blur-md pointer-events-none z-[60] select-none animate-in fade-in duration-150"
                        style={{
                          backgroundColor: 'rgba(15, 17, 23, 0.96)',
                          borderColor: 'rgba(255, 255, 255, 0.16)',
                          color: 'var(--ytai-text-primary)'
                        }}
                      >
                        <div className="font-semibold text-white">
                          {hovered.label}
                        </div>
                        <p className="mt-1 text-[11px] leading-relaxed text-slate-300">
                          {hovered.description}
                        </p>
                      </div>
                    );
                  })()}
                </div>
              </div>
            )}
          </div>

          {/* Subtitle Perception Mode (Icon click = cycle, Hover = dropdown) */}
          <div
            className="relative inline-flex items-center justify-center"
            ref={modeMenuRef}
            onMouseEnter={handleModeMouseEnter}
            onMouseLeave={handleModeMouseLeave}
          >
            <button
              type="button"
              title={isModeMenuOpen ? undefined : getListeningModeTitle()}
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

            {/* Dropdown Menu: centered directly under trigger with unbroken hover bridge */}
            {isModeMenuOpen && (
              <div
                className="absolute left-1/2 -translate-x-1/2 top-full pt-1.5 z-50 select-none animate-in fade-in duration-150"
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <div
                  className={`relative flex items-center gap-1.5 rounded-2xl border ${scale.dropdownPadClass} shadow-2xl backdrop-blur-md`}
                  style={{
                    backgroundColor: 'rgba(15, 17, 23, 0.95)',
                    borderColor: 'rgba(255, 255, 255, 0.16)'
                  }}
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
                        className="absolute left-1/2 -translate-x-1/2 top-full mt-2 w-60 rounded-xl border p-2.5 text-xs shadow-2xl backdrop-blur-md pointer-events-none z-[60] select-none animate-in fade-in duration-150"
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
              </div>
            )}
          </div>

          {/* Auto-pause toggle (click) + Pause Timer dropdown (hover) */}
          <div
            className="relative inline-flex items-center justify-center"
            ref={timerMenuRef}
            onMouseEnter={handleTimerMouseEnter}
            onMouseLeave={handleTimerMouseLeave}
          >
            <button
              type="button"
              title={
                isTimerMenuOpen
                  ? undefined
                  : settings.autoPauseAfterCue
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
                className="absolute left-1/2 -translate-x-1/2 top-full pt-1.5 z-50 select-none animate-in fade-in duration-150"
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <div
                  className={`w-44 rounded-2xl border ${scale.dropdownPadClass} p-2 shadow-2xl backdrop-blur-md`}
                  style={{
                    backgroundColor: 'rgba(15, 17, 23, 0.96)',
                    borderColor: 'rgba(255, 255, 255, 0.16)',
                    color: 'var(--ytai-text-primary)'
                  }}
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
            className="relative inline-flex items-center justify-center"
            ref={fontMenuRef}
            onMouseEnter={handleFontMouseEnter}
            onMouseLeave={handleFontMouseLeave}
          >
            <button
              type="button"
              title={
                isFontMenuOpen
                  ? undefined
                  : `Шрифт и стиль субтитров: ${currentFontSize}px (наведите для настройки)`
              }
              onClick={() => setIsFontMenuOpen((prev) => !prev)}
              style={isFontMenuOpen ? activeStyle : inactiveStyle}
              className={`flex items-center justify-center rounded-full ${scale.iconBtnPadClass} transition hover:bg-[rgba(var(--ytai-accent-rgb),0.2)] hover:text-white`}
            >
              <Type size={scale.iconSize} />
            </button>

            {isFontMenuOpen && (
              <div
                className={`absolute top-full pt-1.5 z-50 select-none animate-in fade-in duration-150 ${
                  fontPopoverLayout.offsetX === null ? 'left-1/2 -translate-x-1/2' : ''
                }`}
                style={
                  fontPopoverLayout.offsetX !== null
                    ? { left: `${fontPopoverLayout.offsetX}px`, right: 'auto' }
                    : undefined
                }
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
              >
                <div
                  className="w-[296px] rounded-2xl border p-3 shadow-2xl backdrop-blur-md flex flex-col gap-2.5 text-xs"
                  style={{
                    backgroundColor: 'rgba(15, 17, 23, 0.96)',
                    borderColor: 'rgba(255, 255, 255, 0.16)',
                    color: 'var(--ytai-text-primary)',
                    maxHeight:
                      fontPopoverLayout.maxHeight !== null
                        ? `${fontPopoverLayout.maxHeight}px`
                        : undefined,
                    overflowY: 'auto',
                    scrollbarWidth: 'thin',
                    scrollbarColor: 'rgba(255, 255, 255, 0.22) transparent'
                  }}
                >
                  {/* Section 1: Subtitle font size */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                        Размер субтитров
                      </span>
                      <button
                        type="button"
                        title="Кликните для сброса на 20px"
                        onClick={handleResetFontSize}
                        className="font-mono text-xs font-bold px-1.5 py-0.5 rounded transition hover:opacity-80"
                        style={{ color: 'var(--ytai-accent)' }}
                      >
                        {currentFontSize}px
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        title="Уменьшить шрифт (-2px, хоткей [)"
                        disabled={currentFontSize <= 12}
                        onClick={handleDecreaseFontSize}
                        className="flex h-6 w-6 items-center justify-center rounded-lg bg-white/5 transition hover:bg-white/10 hover:text-white disabled:opacity-30 disabled:hover:bg-white/5"
                      >
                        <Minus size={12} />
                      </button>
                      <input
                        type="range"
                        min={12}
                        max={56}
                        step={1}
                        value={currentFontSize}
                        onChange={(e) => {
                          const val = Number(e.target.value);
                          onUpdateSettings({ fontSize: val, subtitleFontSize: val });
                        }}
                        className="h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-slate-700 accent-indigo-400"
                      />
                      <button
                        type="button"
                        title="Увеличить шрифт (+2px, хоткей ])"
                        disabled={currentFontSize >= 56}
                        onClick={handleIncreaseFontSize}
                        className="flex h-6 w-6 items-center justify-center rounded-lg bg-white/5 transition hover:bg-white/10 hover:text-white disabled:opacity-30 disabled:hover:bg-white/5"
                      >
                        <Plus size={12} />
                      </button>
                    </div>
                  </div>

                  {/* Section 2: Translation size */}
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
                      Размер перевода
                    </div>
                    <div className="grid grid-cols-4 gap-1">
                      {[
                        { scale: 0.75, label: '75%' },
                        { scale: 0.85, label: '85%' },
                        { scale: 1.0, label: '100%' },
                        { scale: 1.15, label: '115%' }
                      ].map(({ scale: s, label }) => {
                        const isActive = Math.abs(currentTranslationScale - s) < 0.01;
                        return (
                          <button
                            key={s}
                            type="button"
                            onClick={() => onUpdateSettings({ translationScale: s })}
                            className={`rounded-lg h-7 flex items-center justify-center text-center font-mono text-[11.5px] font-medium transition ${
                              isActive
                                ? 'text-white shadow-sm'
                                : 'bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white'
                            }`}
                            style={isActive ? { backgroundColor: 'var(--ytai-accent)' } : undefined}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Section 3: Font family */}
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
                      Шрифт
                    </div>
                    <div className="grid grid-cols-3 gap-1">
                      {[
                        { id: 'sans' as const, label: 'Sans', fontClass: 'font-sans' },
                        { id: 'serif' as const, label: 'Serif', fontClass: 'font-serif' },
                        { id: 'mono' as const, label: 'Mono', fontClass: 'font-mono' }
                      ].map(({ id, label, fontClass }) => {
                        const isActive = currentFontFamily === id;
                        return (
                          <button
                            key={id}
                            type="button"
                            onClick={() => onUpdateSettings({ fontFamily: id })}
                            className={`rounded-lg h-7 flex items-center justify-center text-center text-[11.5px] font-medium transition ${fontClass} ${
                              isActive
                                ? 'text-white shadow-sm'
                                : 'bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white'
                            }`}
                            style={isActive ? { backgroundColor: 'var(--ytai-accent)' } : undefined}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Section 4: Font weight and Outline */}
                  <div className="grid grid-cols-[minmax(0,112px)_1fr] gap-1.5">
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
                        Начертание
                      </div>
                      <div className="grid grid-cols-2 gap-1">
                        {[
                          { id: 'normal' as const, label: 'Обычный' },
                          { id: 'bold' as const, label: 'Жирный' }
                        ].map(({ id, label }) => {
                          const isActive = currentFontWeight === id;
                          return (
                            <button
                              key={id}
                              type="button"
                              onClick={() => onUpdateSettings({ fontWeight: id })}
                              className={`rounded-lg h-7 flex items-center justify-center px-1 text-center text-[11.5px] font-medium whitespace-nowrap transition ${
                                isActive
                                  ? 'text-white shadow-sm'
                                  : 'bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white'
                              }`}
                              style={isActive ? { backgroundColor: 'var(--ytai-accent)' } : undefined}
                            >
                              {label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
                        Обводка
                      </div>
                      <div className="grid grid-cols-3 gap-1">
                        {[
                          { id: 'none' as const, label: 'Нет' },
                          { id: 'shadow' as const, label: 'Тень' },
                          { id: 'outline' as const, label: 'Контур' }
                        ].map(({ id, label }) => {
                          const isActive = currentTextOutline === id;
                          return (
                            <button
                              key={id}
                              type="button"
                              onClick={() => onUpdateSettings({ textOutline: id })}
                              className={`rounded-lg h-7 flex items-center justify-center px-1 text-center text-[11.5px] font-medium whitespace-nowrap transition ${
                                isActive
                                  ? 'text-white shadow-sm'
                                  : 'bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white'
                              }`}
                              style={isActive ? { backgroundColor: 'var(--ytai-accent)' } : undefined}
                            >
                              {label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {/* Section 5: Backdrop Opacity */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                        Подложка
                      </span>
                      <span className="font-mono text-xs font-bold text-slate-300">
                        {currentBackdropOpacity}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={5}
                      value={currentBackdropOpacity}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        onUpdateSettings({ backdropOpacity: val, overlayOpacity: val / 100 });
                      }}
                      className="h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-slate-700 accent-indigo-400"
                    />
                  </div>

                  {/* Section 6: Static subtitle box toggle */}
                  <div className="flex items-center justify-between pt-1 border-t border-white/10">
                    <div className="flex items-center gap-1.5">
                      <Lock
                        size={12}
                        className={settings.subtitleBoxFixed ? 'text-indigo-400' : 'text-slate-400'}
                      />
                      <span className="text-[11px] font-semibold text-slate-300">
                        Статичное окно
                      </span>
                    </div>
                    <button
                      type="button"
                      title={settings.subtitleBoxFixed ? 'Выключить статичное окно' : 'Включить статичное окно'}
                      onClick={() => {
                        const next = !settings.subtitleBoxFixed;
                        onUpdateSettings({
                          subtitleBoxFixed: next,
                          ...(next && !settings.subtitleBoxSize
                            ? { subtitleBoxSize: DEFAULT_SUBTITLE_BOX_SIZE }
                            : {})
                        });
                      }}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors cursor-pointer ${
                        settings.subtitleBoxFixed ? 'bg-indigo-600' : 'bg-slate-700'
                      }`}
                    >
                      <span
                        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                          settings.subtitleBoxFixed ? 'translate-x-4.5' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </div>

                  {/* Footer: Reset actions */}
                  <div className="pt-1.5 border-t border-white/10 grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      title="Сбросить размер и позицию субтитров"
                      onClick={() => {
                        onUpdateSettings({
                          subtitleBoxFixed: false,
                          subtitleBoxSize: null,
                          subtitlePosition: null
                        });
                        onResetPosition?.();
                      }}
                      className="flex items-center justify-center gap-1 rounded-lg h-7 px-1.5 text-center text-[11px] font-medium whitespace-nowrap text-slate-400 transition hover:bg-white/5 hover:text-white"
                    >
                      <Move size={11} />
                      <span>Сбросить размер</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleResetTypographyStyle}
                      className="flex items-center justify-center gap-1 rounded-lg h-7 px-1.5 text-center text-[11px] font-medium whitespace-nowrap text-slate-400 transition hover:bg-white/5 hover:text-white"
                    >
                      <RotateCcw size={11} />
                      <span>Сбросить стиль</span>
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Reset position & box button (shown when position or box size has been customized) */}
          {(settings.subtitlePosition || settings.subtitleBoxSize || settings.subtitleBoxFixed) && onResetPosition && (
            <button
              type="button"
              title="Reset subtitle size and position to default"
              onClick={() => {
                onUpdateSettings({
                  subtitleBoxFixed: false,
                  subtitleBoxSize: null,
                  subtitlePosition: null
                });
                onResetPosition();
              }}
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
