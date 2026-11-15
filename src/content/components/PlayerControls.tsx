import { useEffect, useRef, useState, type CSSProperties, type ReactElement } from 'react';
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
import type {
  ActiveListeningMode,
  ControlsScale,
  UserSettings
} from '../../types/settings';
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

interface ScaleStyle {
  containerPad: string;
  containerGap: string;
  iconClass: string;
  chevronClass: string;
  textClass: string;
  buttonPad: string;
  powerBtnPad: string;
  fontGroupPad: string;
  fontBtnPad: string;
  badgeOffset: string;
  badgeText: string;
  metaText: string;
  dropdownWidth: string;
  dropdownItemPad: string;
  dropdownTitleText: string;
  dropdownDescText: string;
}

const SCALE_STYLES: Record<ControlsScale, ScaleStyle> = {
  sm: {
    containerPad: 'px-2 py-1',
    containerGap: 'gap-1',
    iconClass: 'h-[13px] w-[13px]',
    chevronClass: 'h-2.5 w-2.5',
    textClass: 'text-[11px]',
    buttonPad: 'p-1',
    powerBtnPad: 'px-1.5 py-0.5',
    fontGroupPad: 'px-1 py-0.5',
    fontBtnPad: 'px-1 py-0.5 text-[10px]',
    badgeOffset: '-bottom-1 -right-1',
    badgeText: 'text-[8px]',
    metaText: 'text-[10px] px-1.5 py-0.5',
    dropdownWidth: 'w-64',
    dropdownItemPad: 'p-1.5',
    dropdownTitleText: 'text-[11px]',
    dropdownDescText: 'text-[10px]'
  },
  md: {
    containerPad: 'px-2.5 py-1.5',
    containerGap: 'gap-1.5',
    iconClass: 'h-3.5 w-3.5',
    chevronClass: 'h-3 w-3',
    textClass: 'text-xs',
    buttonPad: 'p-1.5',
    powerBtnPad: 'px-2 py-1',
    fontGroupPad: 'px-1 py-0.5',
    fontBtnPad: 'px-1.5 py-0.5 text-[11px]',
    badgeOffset: '-bottom-1.5 -right-1.5',
    badgeText: 'text-[9px]',
    metaText: 'text-[11px] px-2 py-0.5',
    dropdownWidth: 'w-72',
    dropdownItemPad: 'p-2',
    dropdownTitleText: 'text-xs',
    dropdownDescText: 'text-[11px]'
  },
  lg: {
    containerPad: 'px-3.5 py-2',
    containerGap: 'gap-2',
    iconClass: 'h-[19px] w-[19px]',
    chevronClass: 'h-3.5 w-3.5',
    textClass: 'text-sm',
    buttonPad: 'p-2',
    powerBtnPad: 'px-2.5 py-1.5',
    fontGroupPad: 'px-1.5 py-0.5',
    fontBtnPad: 'px-2 py-0.5 text-xs',
    badgeOffset: '-bottom-1.5 -right-1.5',
    badgeText: 'text-[10px]',
    metaText: 'text-xs px-2.5 py-1',
    dropdownWidth: 'w-80',
    dropdownItemPad: 'p-2.5',
    dropdownTitleText: 'text-sm',
    dropdownDescText: 'text-xs'
  },
  tv: {
    containerPad: 'px-4 py-2.5',
    containerGap: 'gap-2.5',
    iconClass: 'h-6 w-6',
    chevronClass: 'h-4 w-4',
    textClass: 'text-base',
    buttonPad: 'p-2.5',
    powerBtnPad: 'px-3.5 py-2',
    fontGroupPad: 'px-2 py-1',
    fontBtnPad: 'px-2.5 py-1 text-sm',
    badgeOffset: '-bottom-2 -right-2',
    badgeText: 'text-xs',
    metaText: 'text-sm px-3 py-1',
    dropdownWidth: 'w-96',
    dropdownItemPad: 'p-3',
    dropdownTitleText: 'text-base',
    dropdownDescText: 'text-sm'
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
    description: 'Субтитры всегда видны на экране.',
    icon: Eye
  },
  {
    id: 'blur',
    label: 'Active Listening (Размытие)',
    description: 'Текст размыт, проявляется при наведении или удержании Alt.',
    icon: EyeOff
  },
  {
    id: 'hidden',
    label: 'Скрытый режим (Stealth)',
    description: 'Субтитры полностью скрыты и видны только при удержании Alt.',
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

  // Close mode dropdown on click outside or Escape
  useEffect(() => {
    if (!isModeMenuOpen) return;

    const handlePointerDownOutside = (e: MouseEvent | PointerEvent): void => {
      if (modeMenuRef.current && !modeMenuRef.current.contains(e.target as Node)) {
        setIsModeMenuOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setIsModeMenuOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDownOutside, true);
    window.addEventListener('keydown', handleKeyDown, true);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDownOutside, true);
      window.removeEventListener('keydown', handleKeyDown, true);
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

  const controlsScale: ControlsScale = settings.controlsScale ?? 'md';
  const scaleStyle = SCALE_STYLES[controlsScale] ?? SCALE_STYLES.md;

  const currentFontSize = settings.subtitleFontSize ?? 20;

  const handleDecreaseFontSize = (): void => {
    const next = Math.max(14, currentFontSize - 4);
    onUpdateSettings({
      subtitleFontSize: next,
      subtitleScale:
        next >= 44 ? 'tv' : next >= 32 ? 'xl' : next >= 24 ? 'lg' : next >= 18 ? 'md' : 'sm'
    });
  };

  const handleIncreaseFontSize = (): void => {
    const next = Math.min(56, currentFontSize + 4);
    onUpdateSettings({
      subtitleFontSize: next,
      subtitleScale:
        next >= 44 ? 'tv' : next >= 32 ? 'xl' : next >= 24 ? 'lg' : next >= 18 ? 'md' : 'sm'
    });
  };

  const handleToggleTvPreset = (): void => {
    const next = currentFontSize >= 44 ? 20 : 48;
    onUpdateSettings({
      subtitleFontSize: next,
      subtitleScale: next >= 44 ? 'tv' : 'md'
    });
  };

  const currentMode = settings.activeListeningMode || 'off';
  const ActiveModeIcon =
    currentMode === 'hidden' ? Ghost : currentMode === 'blur' ? EyeOff : Eye;

  // Contrast protection for transparent/minimal themes or low overlayOpacity
  const isHighContrast =
    settings.theme === 'cinema-transparent' ||
    (settings.overlayOpacity ?? 0.85) < 0.75;

  const containerStyle: CSSProperties = isHighContrast
    ? {
        backgroundColor: 'rgba(15, 17, 23, 0.78)',
        borderColor: 'rgba(255, 255, 255, 0.18)',
        borderWidth: '1px',
        borderStyle: 'solid',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        boxShadow: '0 4px 16px rgba(0, 0, 0, 0.45)',
        color: '#F8FAFC'
      }
    : {
        backgroundColor: 'rgba(var(--ytai-bg-rgb), 0.88)',
        borderColor: 'var(--ytai-border)',
        borderWidth: '1px',
        borderStyle: 'solid',
        backdropFilter: 'blur(var(--ytai-backdrop-blur, 12px))',
        WebkitBackdropFilter: 'blur(var(--ytai-backdrop-blur, 12px))',
        boxShadow: '0 4px 16px rgba(0, 0, 0, 0.35)',
        color: 'var(--ytai-text-primary)'
      };

  const secondaryColor = isHighContrast ? '#F8FAFC' : 'var(--ytai-text-secondary)';
  const surfaceBg = isHighContrast ? 'rgba(30, 41, 59, 0.75)' : 'var(--ytai-surface)';
  const surfaceBorder = isHighContrast ? 'rgba(255, 255, 255, 0.18)' : 'var(--ytai-border)';

  return (
    <div
      className={`absolute right-3 top-3 z-20 flex items-center ${scaleStyle.containerGap} rounded-full ${scaleStyle.containerPad} ${scaleStyle.textClass} shadow-lg select-none transition-opacity duration-300 ${
        isVisible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
      }`}
      style={containerStyle}
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
                backgroundColor: surfaceBg,
                color: secondaryColor
              }
        }
        className={`flex items-center gap-1 rounded-full ${scaleStyle.powerBtnPad} font-medium transition hover:opacity-90 shadow-sm`}
      >
        <Power className={scaleStyle.iconClass} />
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
                    color: secondaryColor
                  }
            }
            className={`rounded-full ${scaleStyle.buttonPad} transition hover:bg-[rgba(var(--ytai-accent-rgb),0.2)]`}
          >
            <Languages className={scaleStyle.iconClass} />
          </button>

          {/* Listening Mode Dropdown Trigger & Popover */}
          <div className="relative" ref={modeMenuRef}>
            <button
              type="button"
              title="Режим отображения субтитров (кликните для выбора)"
              onClick={(e) => {
                e.stopPropagation();
                setIsModeMenuOpen((prev) => !prev);
              }}
              style={
                currentMode !== 'off' || isModeMenuOpen
                  ? {
                      backgroundColor: 'var(--ytai-accent)',
                      color: '#ffffff'
                    }
                  : {
                      color: secondaryColor
                    }
              }
              className={`flex items-center rounded-full ${scaleStyle.buttonPad} transition hover:bg-[rgba(var(--ytai-accent-rgb),0.2)]`}
            >
              <ActiveModeIcon className={scaleStyle.iconClass} />
              <ChevronDown
                className={`${scaleStyle.chevronClass} ml-0.5 transition-transform duration-200 ${
                  isModeMenuOpen ? 'rotate-180' : ''
                }`}
              />
            </button>

            {isModeMenuOpen && (
              <div
                className={`absolute right-0 top-full mt-2 z-30 flex flex-col gap-1 rounded-2xl p-1.5 shadow-2xl transition-all select-none ${scaleStyle.dropdownWidth}`}
                style={{
                  backgroundColor: 'rgba(15, 17, 23, 0.95)',
                  backdropFilter: 'blur(16px)',
                  WebkitBackdropFilter: 'blur(16px)',
                  borderColor: 'rgba(255, 255, 255, 0.18)',
                  borderWidth: '1px',
                  borderStyle: 'solid',
                  boxShadow: '0 12px 32px rgba(0, 0, 0, 0.65)',
                  color: '#F8FAFC'
                }}
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Режим отображения субтитров
                </div>
                {LISTENING_MODES.map((mode) => {
                  const isSelected = currentMode === mode.id;
                  const Icon = mode.icon;
                  return (
                    <button
                      key={mode.id}
                      type="button"
                      title={`${mode.label}: ${mode.description}`}
                      onClick={() => {
                        onUpdateSettings({ activeListeningMode: mode.id });
                        setIsModeMenuOpen(false);
                      }}
                      className={`group flex items-start gap-2.5 rounded-xl ${scaleStyle.dropdownItemPad} text-left transition ${
                        isSelected
                          ? 'bg-white/15 shadow-sm'
                          : 'hover:bg-white/10 active:bg-white/20'
                      }`}
                      style={
                        isSelected
                          ? {
                              border: '1px solid rgba(var(--ytai-accent-rgb), 0.45)',
                              backgroundColor: 'rgba(var(--ytai-accent-rgb), 0.18)'
                            }
                          : undefined
                      }
                    >
                      <div
                        className={`mt-0.5 rounded-lg p-1 transition ${
                          isSelected ? 'text-white' : 'text-slate-300 group-hover:text-white'
                        }`}
                        style={
                          isSelected ? { backgroundColor: 'var(--ytai-accent)' } : undefined
                        }
                      >
                        <Icon className={scaleStyle.iconClass} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-1">
                          <span
                            className={`font-semibold ${scaleStyle.dropdownTitleText} ${
                              isSelected
                                ? 'text-white'
                                : 'text-slate-200 group-hover:text-white'
                            }`}
                            style={isSelected ? { color: 'var(--ytai-accent)' } : undefined}
                          >
                            {mode.label}
                          </span>
                          {isSelected && (
                            <span
                              className="h-1.5 w-1.5 rounded-full shrink-0"
                              style={{ backgroundColor: 'var(--ytai-accent)' }}
                            />
                          )}
                        </div>
                        <p
                          className={`mt-0.5 leading-snug text-slate-300 ${scaleStyle.dropdownDescText}`}
                        >
                          {mode.description}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Auto-pause Button with Auto-Resume Delay Badge */}
          <button
            type="button"
            title={
              settings.autoPauseAfterCue
                ? (settings.autoPauseResumeDelaySec ?? 0) > 0
                  ? `Auto-pause after each cue (resumes in ${settings.autoPauseResumeDelaySec}s)`
                  : 'Auto-pause after each cue (manual resume)'
                : 'Auto-pause after each subtitle cue'
            }
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
                    color: secondaryColor
                  }
            }
            className={`relative rounded-full ${scaleStyle.buttonPad} transition hover:bg-[rgba(var(--ytai-accent-rgb),0.2)]`}
          >
            <PauseCircle className={scaleStyle.iconClass} />
            {settings.autoPauseAfterCue && (settings.autoPauseResumeDelaySec ?? 0) > 0 && (
              <span
                className={`absolute ${scaleStyle.badgeOffset} rounded-full px-1 font-bold leading-tight select-none shadow-md ${scaleStyle.badgeText}`}
                style={{
                  backgroundColor: '#0F172A',
                  color: '#F8FAFC',
                  border: '1px solid rgba(255, 255, 255, 0.35)',
                  boxShadow: '0 2px 6px rgba(0, 0, 0, 0.6)'
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
            style={{ color: secondaryColor }}
            className={`rounded-full ${scaleStyle.buttonPad} transition hover:bg-[rgba(var(--ytai-accent-rgb),0.2)] hover:text-white`}
          >
            <RotateCcw className={scaleStyle.iconClass} />
          </button>

          {/* Quick Subtitle Font Sizing Group (A- / size / A+) */}
          <div
            className={`flex items-center rounded-full border ${scaleStyle.fontGroupPad}`}
            style={{
              backgroundColor: surfaceBg,
              borderColor: surfaceBorder
            }}
          >
            <button
              type="button"
              title="Уменьшить субтитры (хоткей: [)"
              onClick={handleDecreaseFontSize}
              disabled={currentFontSize <= 14}
              className={`rounded-full ${scaleStyle.fontBtnPad} font-semibold transition hover:bg-white/10 hover:text-white disabled:opacity-40`}
              style={{ color: secondaryColor }}
            >
              A-
            </button>
            <button
              type="button"
              onClick={handleToggleTvPreset}
              className={`px-1 font-bold tracking-tight transition hover:opacity-80 ${scaleStyle.fontBtnPad}`}
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
              className={`rounded-full ${scaleStyle.fontBtnPad} font-semibold transition hover:bg-white/10 hover:text-white disabled:opacity-40`}
              style={{ color: secondaryColor }}
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
              className={`rounded-full ${scaleStyle.buttonPad} transition hover:bg-[rgba(var(--ytai-accent-rgb),0.2)] hover:text-white`}
            >
              <Move className={scaleStyle.iconClass} />
            </button>
          )}

          {trackMeta && (
            <span
              className={`ml-0.5 rounded-full font-medium uppercase tracking-wide border ${scaleStyle.metaText}`}
              style={{
                backgroundColor: surfaceBg,
                borderColor: surfaceBorder,
                color: secondaryColor
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
