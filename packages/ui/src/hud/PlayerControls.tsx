import {
  useEffect,
  useRef,
  useState,
  type ReactElement
} from 'react';
import {
  Captions,
  Check,
  ChevronLeft,
  ChevronRight,
  Eye,
  Ghost,
  Languages,
  Layers,
  MousePointerClick,
  Move,
  PauseCircle,
  Power,
  RotateCcw,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Timer,
  TimerOff,
  Trash2,
  Type
} from 'lucide-react';
import type {
  ActiveListeningMode,
  AvailableTrackOption,
  ControlsScale,
  SubtitleTrackMode,
  SystemLogEntry,
  TrackMetadata,
  TranslationRuntimeStatus,
  UserSettings
} from '@langai/contracts';
import { getUiStrings } from '../i18n/translations';
import {
  LANGUAGE_OPTIONS,
  SOURCE_LANGUAGE_OPTIONS,
  formatShortLangCode,
  getLanguageLabel,
  isSameBaseLang,
  resolveLanguagePair
} from '../utils/languages';
import { ToolbarPopover } from './ToolbarPopover';
import { resolveHostPlayerContainer } from './hooks/useDraggableSubtitleBox';

export interface PlayerControlsProps {
  settings: UserSettings;
  playerContainer?: HTMLElement | null;
  isControlsHidden?: boolean;
  adapterName?: string;
  trackMeta: TrackMetadata | null;
  availableTracks?: AvailableTrackOption[];
  systemLogs?: SystemLogEntry[];
  cueCount: number;
  captionRateLimitedUntil?: number;
  translationStatus?: TranslationRuntimeStatus;
  supportsCueSeeking?: boolean;
  altPressed?: boolean;
  hasActivePopup?: boolean;
  onUpdateSettings: (partial: Partial<UserSettings>) => void;
  onRepeatCue: () => void;
  onResetPosition?: () => void;
  onRetryTranslation?: () => void;
  onOpenSettings?: () => void;
  onSelectAvailableTrack?: (trackUrl: string) => void;
  onClearSystemLogs?: () => void;
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

type OpenPopoverId = 'none' | 'track' | 'mode' | 'timer' | 'font' | 'system';

export function PlayerControls({
  settings,
  playerContainer,
  isControlsHidden,
  adapterName,
  trackMeta,
  availableTracks,
  systemLogs,
  cueCount,
  captionRateLimitedUntil,
  translationStatus,
  supportsCueSeeking = true,
  altPressed,
  hasActivePopup,
  onUpdateSettings,
  onRepeatCue,
  onResetPosition,
  onRetryTranslation,
  onOpenSettings,
  onSelectAvailableTrack,
  onClearSystemLogs
}: PlayerControlsProps): ReactElement {
  const [isHovered, setIsHovered] = useState(false);
  const [fallbackIdle, setFallbackIdle] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [openMenu, setOpenMenu] = useState<OpenPopoverId>('none');

  const [hoveredTrackModeId, setHoveredTrackModeId] = useState<SubtitleTrackMode | null>(null);
  const [langDropdown, setLangDropdown] = useState<'none' | 'source' | 'target'>('none');
  const [hoveredModeId, setHoveredModeId] = useState<ActiveListeningMode | null>(null);
  const [hoveredTimerHint, setHoveredTimerHint] = useState<{
    title: string;
    description: string;
  } | null>(null);
  const [customTimerInput, setCustomTimerInput] = useState('');
  const [isCustomTimerFocused, setIsCustomTimerFocused] = useState(false);
  const [hoveredFontHint, setHoveredFontHint] = useState<{
    title: string;
    description: string;
  } | null>(null);
  const [cooldownSecLeft, setCooldownSecLeft] = useState(0);

  const toolbarRef = useRef<HTMLDivElement | null>(null);

  const langPair = resolveLanguagePair(settings, trackMeta?.lang);
  const { effectiveSource, effectiveTarget, isReversed, isSmartSwitched } = langPair;
  const t = getUiStrings(settings.uiLanguage);

  const listeningModes = [
    { id: 'off' as const, label: t.listenNormal, description: t.listenNormalDesc, icon: Eye },
    { id: 'blur' as const, label: t.listenBlur, description: t.listenBlurDesc, icon: Sparkles },
    { id: 'hidden' as const, label: t.listenStealth, description: t.listenStealthDesc, icon: Ghost }
  ];

  const trackModes = [
    { id: 'dual' as const, label: t.trackDual, description: t.trackDualDesc, icon: Layers },
    {
      id: 'translation' as const,
      label: t.trackTransOnly,
      description: t.trackTransOnlyDesc,
      icon: Languages
    },
    { id: 'original' as const, label: t.trackOrigOnly, description: t.trackOrigOnlyDesc, icon: Captions }
  ];

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

  const openMenuExclusive = (target: Exclude<OpenPopoverId, 'none'>): void => {
    if (target !== 'track') {
      setHoveredTrackModeId(null);
      setLangDropdown('none');
    }
    if (target !== 'mode') {
      setHoveredModeId(null);
    }
    if (target !== 'timer') {
      setHoveredTimerHint(null);
      setIsCustomTimerFocused(false);
    }
    if (target !== 'font') {
      setHoveredFontHint(null);
    }
    setOpenMenu(target);
  };

  const closeMenu = (target: Exclude<OpenPopoverId, 'none'>): void => {
    setOpenMenu((prev) => (prev === target ? 'none' : prev));
    if (target === 'track') {
      setHoveredTrackModeId(null);
      setLangDropdown('none');
    } else if (target === 'mode') {
      setHoveredModeId(null);
    } else if (target === 'timer') {
      setHoveredTimerHint(null);
      setIsCustomTimerFocused(false);
    } else if (target === 'font') {
      setHoveredFontHint(null);
    }
  };

  const handleSwapLanguages = (e: React.MouseEvent): void => {
    e.stopPropagation();
    setLangDropdown('none');
    onUpdateSettings({ reversePair: !isReversed });
  };

  const handleSelectSource = (code: string): void => {
    if (code === 'auto') {
      onUpdateSettings({ sourceLang: 'auto', reversePair: false });
    } else if (isSameBaseLang(code, effectiveTarget)) {
      const fallbackTarget =
        effectiveSource !== 'auto' && !isSameBaseLang(effectiveSource, code)
          ? effectiveSource
          : undefined;
      if (isReversed) {
        onUpdateSettings({
          sourceLang: code,
          ...(fallbackTarget ? { nativeLang: fallbackTarget } : {}),
          reversePair: false
        });
      } else if (isSameBaseLang(settings.nativeLang, code)) {
        onUpdateSettings({
          sourceLang: code,
          ...(fallbackTarget ? { secondaryLang: fallbackTarget } : {}),
          reversePair: false
        });
      } else {
        onUpdateSettings({ sourceLang: code, reversePair: false });
      }
    } else if (isReversed) {
      onUpdateSettings({
        sourceLang: code,
        nativeLang: effectiveTarget,
        reversePair: false
      });
    } else {
      onUpdateSettings({ sourceLang: code, reversePair: false });
    }
    setLangDropdown('none');
  };

  const handleSelectTarget = (code: string): void => {
    if (isSameBaseLang(code, effectiveSource)) {
      onUpdateSettings({
        sourceLang: effectiveTarget,
        nativeLang: code,
        reversePair: false
      });
    } else if (isReversed) {
      onUpdateSettings({
        sourceLang: effectiveSource,
        nativeLang: code,
        reversePair: false
      });
    } else if (isSmartSwitched && !isSameBaseLang(code, settings.nativeLang)) {
      onUpdateSettings({
        secondaryLang: code,
        reversePair: false
      });
    } else {
      onUpdateSettings({
        nativeLang: code,
        reversePair: false
      });
    }
    setLangDropdown('none');
  };

  const handleCustomTimerSubmit = (): void => {
    const raw = customTimerInput.trim().replace(',', '.');
    const val = Number.parseFloat(raw);
    if (!Number.isNaN(val) && val >= 0.5 && val <= 300) {
      const rounded = Math.round(val * 10) / 10;
      onUpdateSettings({ pauseTimerSeconds: rounded, autoPauseAfterCue: true });
      setOpenMenu('none');
      setCustomTimerInput('');
    }
  };

  // Observe video play/pause and fallback pointer idle when isControlsHidden is not provided
  useEffect(() => {
    const playerEl = resolveHostPlayerContainer(toolbarRef.current, playerContainer);
    const findVideo = (): HTMLVideoElement | null =>
      playerEl?.querySelector<HTMLVideoElement>('video') ??
      (typeof document !== 'undefined' ? document.querySelector<HTMLVideoElement>('video') : null);

    let currentVideo = findVideo();
    let idleTimerId: number | null = null;

    const scheduleIdleHide = (): void => {
      if (isControlsHidden !== undefined) return;
      if (idleTimerId !== null) {
        window.clearTimeout(idleTimerId);
      }
      setFallbackIdle(false);
      if (currentVideo && !currentVideo.paused) {
        idleTimerId = window.setTimeout(() => {
          setFallbackIdle(true);
        }, 3000);
      }
    };

    const onPlay = (): void => {
      setIsPaused(false);
      scheduleIdleHide();
    };
    const onPause = (): void => {
      setIsPaused(true);
      if (idleTimerId !== null) {
        window.clearTimeout(idleTimerId);
        idleTimerId = null;
      }
      setFallbackIdle(false);
    };

    const bindVideo = (nextVideo: HTMLVideoElement | null): void => {
      if (currentVideo) {
        currentVideo.removeEventListener('play', onPlay);
        currentVideo.removeEventListener('pause', onPause);
      }
      currentVideo = nextVideo;
      if (currentVideo) {
        setIsPaused(currentVideo.paused);
        currentVideo.addEventListener('play', onPlay);
        currentVideo.addEventListener('pause', onPause);
      }
    };

    bindVideo(currentVideo);
    scheduleIdleHide();

    let observer: MutationObserver | null = null;
    if (playerEl) {
      observer = new MutationObserver(() => {
        const v = findVideo();
        if (v !== currentVideo) {
          bindVideo(v);
        }
      });
      observer.observe(playerEl, { childList: true, subtree: true });
    }

    const onActivity = (): void => {
      scheduleIdleHide();
    };
    if (isControlsHidden === undefined) {
      playerEl?.addEventListener('pointermove', onActivity, { passive: true });
      playerEl?.addEventListener('pointerdown', onActivity, { passive: true });
    }

    return () => {
      observer?.disconnect();
      if (idleTimerId !== null) {
        window.clearTimeout(idleTimerId);
      }
      if (isControlsHidden === undefined) {
        playerEl?.removeEventListener('pointermove', onActivity);
        playerEl?.removeEventListener('pointerdown', onActivity);
      }
      if (currentVideo) {
        currentVideo.removeEventListener('play', onPlay);
        currentVideo.removeEventListener('pause', onPause);
      }
    };
  }, [playerContainer, isControlsHidden]);

  const effectiveAutohide = isControlsHidden !== undefined ? isControlsHidden : fallbackIdle;
  const shouldAutoHide = settings.autoHideControls ?? true;
  const isVisible =
    !shouldAutoHide ||
    isPaused ||
    !effectiveAutohide ||
    isHovered ||
    openMenu !== 'none' ||
    langDropdown !== 'none' ||
    Boolean(altPressed) ||
    Boolean(hasActivePopup);

  const scale = SCALE_CONFIGS[settings.controlsScale || 'md'] || SCALE_CONFIGS.md;
  const currentFontSize = settings.subtitleFontSize ?? 20;
  const currentTranslationFontSize =
    settings.translationFontSize ??
    Math.max(12, Math.min(48, Math.round(currentFontSize * (settings.translationScale ?? 0.85))));

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

  const handleDecreaseTranslationSize = (e?: React.MouseEvent): void => {
    e?.stopPropagation();
    const next = Math.max(12, currentTranslationFontSize - 2);
    onUpdateSettings({ translationFontSize: next });
  };

  const handleIncreaseTranslationSize = (e?: React.MouseEvent): void => {
    e?.stopPropagation();
    const next = Math.min(48, currentTranslationFontSize + 2);
    onUpdateSettings({ translationFontSize: next });
  };

  const handleResetTranslationSize = (e?: React.MouseEvent): void => {
    e?.stopPropagation();
    onUpdateSettings({ translationFontSize: 17 });
  };

  const currentTrackMode: SubtitleTrackMode = settings.subtitleTrackMode || 'dual';

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
        return t.trackDualTooltip;
      case 'translation':
        return t.trackTransOnlyTooltip;
      case 'original':
        return t.trackOrigOnlyTooltip;
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
        return t.listenBlurTooltip;
      case 'hidden':
        return t.listenStealthTooltip;
      default:
        return t.listenNormalTooltip;
    }
  };

  const activeStyle: React.CSSProperties = {
    backgroundColor: 'var(--ytai-accent)',
    color: 'var(--ytai-accent-fg, #ffffff)'
  };

  const inactiveStyle: React.CSSProperties = {
    color: 'var(--ytai-text-secondary)'
  };

  const popoverSurfaceStyle: React.CSSProperties = {
    backgroundColor: 'rgba(var(--ytai-bg-rgb), 0.96)',
    borderColor: 'var(--ytai-border)',
    color: 'var(--ytai-text-primary)',
    backdropFilter: 'blur(var(--ytai-backdrop-blur, 12px))',
    WebkitBackdropFilter: 'blur(var(--ytai-backdrop-blur, 12px))'
  };

  const tooltipSurfaceStyle: React.CSSProperties = {
    backgroundColor: 'rgba(var(--ytai-bg-rgb), 0.97)',
    borderColor: 'var(--ytai-border)',
    color: 'var(--ytai-text-primary)',
    backdropFilter: 'blur(var(--ytai-backdrop-blur, 12px))',
    WebkitBackdropFilter: 'blur(var(--ytai-backdrop-blur, 12px))'
  };

  const mutedTextStyle: React.CSSProperties = {
    color: 'var(--ytai-text-muted, var(--ytai-text-secondary))'
  };

  const dividerStyle: React.CSSProperties = {
    borderColor: 'var(--ytai-border)'
  };

  return (
    <div
      className="pointer-events-none absolute right-3 top-3 z-50 flex max-w-[calc(100%-24px)] flex-col items-end gap-2 select-none"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onMouseUp={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
    >
      <div
        ref={toolbarRef}
        className={`flex max-w-full flex-wrap items-center justify-end rounded-3xl shadow-lg select-none transition-opacity duration-300 ${scale.containerClass} ${
          isVisible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        style={{
          backgroundColor: 'rgba(var(--ytai-bg-rgb), 0.9)',
          borderColor: 'var(--ytai-border)',
          borderWidth: '1px',
          borderStyle: 'solid',
          backdropFilter: 'blur(var(--ytai-backdrop-blur, 12px))',
          WebkitBackdropFilter: 'blur(var(--ytai-backdrop-blur, 12px))',
          color: 'var(--ytai-text-primary)'
        }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <button
          type="button"
          title={settings.enabled ? t.disableExt : t.enableExt}
          onClick={() => onUpdateSettings({ enabled: !settings.enabled })}
          style={
            settings.enabled
              ? activeStyle
              : {
                  backgroundColor: 'var(--ytai-surface)',
                  color: 'var(--ytai-text-secondary)'
                }
          }
          className={`flex shrink-0 whitespace-nowrap items-center gap-1 rounded-full ${scale.powerBtnPadClass} font-medium transition hover:opacity-90 shadow-sm`}
        >
          <Power size={scale.iconSize} />
          <span>Lang AI</span>
        </button>

        {Boolean(captionRateLimitedUntil && captionRateLimitedUntil > Date.now()) && (
          <span
            title={t.captionRateLimitedTooltip}
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
                  ? t.translationCooldownTooltip(cooldownSecLeft)
                  : t.translationUnavailableTooltip
              }
              style={{
                backgroundColor: 'var(--ytai-surface)',
                borderColor: 'var(--ytai-border)',
                color: 'var(--ytai-text-primary)'
              }}
              className="flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium transition hover:opacity-90 select-none cursor-pointer"
            >
              <RotateCcw size={10} className="opacity-80" />
              <span>{cooldownSecLeft > 0 ? `${cooldownSecLeft}${t.secShort}` : t.retryNow}</span>
            </button>
          )}

        {settings.enabled && (
          <>
            {/* 1. Subtitle Track Mode & Language Pair Popover */}
            <ToolbarPopover
              isOpen={openMenu === 'track'}
              onOpen={() => openMenuExclusive('track')}
              onClose={() => closeMenu('track')}
              popoverWidth={langDropdown !== 'none' ? 228 : 186}
              closeDelayMs={180}
              preventHoverClose={langDropdown !== 'none'}
              toolbarRef={toolbarRef}
              playerContainer={playerContainer}
              layoutDeps={[langDropdown, settings.controlsScale]}
              trigger={
                <button
                  type="button"
                  title={openMenu === 'track' ? undefined : getTrackModeTitle()}
                  onClick={cycleTrackMode}
                  style={currentTrackMode !== 'original' ? activeStyle : inactiveStyle}
                  className={`flex items-center justify-center rounded-full ${scale.iconBtnPadClass} transition hover:bg-[rgba(var(--ytai-accent-rgb),0.2)]`}
                >
                  <Languages size={scale.iconSize} />
                </button>
              }
            >
              {(layout) => (
                <div
                  className="relative flex flex-col gap-1.5 rounded-2xl border p-2 shadow-2xl"
                  style={popoverSurfaceStyle}
                >
                  <div className="flex items-center justify-center gap-1.5">
                    {trackModes.map((mode) => {
                      const Icon = mode.icon;
                      const isActive = currentTrackMode === mode.id;
                      return (
                        <button
                          key={mode.id}
                          type="button"
                          onClick={() => {
                            onUpdateSettings({ subtitleTrackMode: mode.id });
                            closeMenu('track');
                          }}
                          onMouseEnter={() => setHoveredTrackModeId(mode.id)}
                          onMouseLeave={() =>
                            setHoveredTrackModeId((prev) => (prev === mode.id ? null : prev))
                          }
                          style={isActive ? activeStyle : inactiveStyle}
                          className={`flex items-center justify-center rounded-xl ${scale.iconBtnPadClass} transition hover:bg-[rgba(var(--ytai-accent-rgb),0.18)]`}
                        >
                          <Icon size={scale.iconSize} />
                        </button>
                      );
                    })}
                  </div>

                  <div className="border-t pt-1.5" style={dividerStyle}>
                    <div
                      className="flex items-center justify-center gap-0.5 rounded-xl border px-1.5 py-1 text-[11px] font-bold uppercase tracking-wide whitespace-nowrap"
                      style={{
                        backgroundColor: 'var(--ytai-surface)',
                        borderColor:
                          isSmartSwitched || isReversed
                            ? 'var(--ytai-accent)'
                            : 'var(--ytai-border)',
                        color: 'var(--ytai-text-secondary)'
                      }}
                      title={t.translationDirectionTooltip(
                        formatShortLangCode(effectiveSource),
                        formatShortLangCode(effectiveTarget)
                      )}
                    >
                      <button
                        type="button"
                        title={t.sourceLangSelectTooltip(getLanguageLabel(effectiveSource))}
                        onClick={(e) => {
                          e.stopPropagation();
                          setHoveredTrackModeId(null);
                          setLangDropdown((prev) => (prev === 'source' ? 'none' : 'source'));
                        }}
                        className="rounded-lg px-1.5 py-0.5 uppercase transition hover:bg-[rgba(var(--ytai-accent-rgb),0.18)] cursor-pointer"
                        style={
                          langDropdown === 'source'
                            ? activeStyle
                            : { color: 'var(--ytai-accent)' }
                        }
                      >
                        [{formatShortLangCode(effectiveSource)}]
                      </button>

                      <button
                        type="button"
                        title={t.reverseTranslationTooltip(
                          formatShortLangCode(effectiveSource),
                          formatShortLangCode(effectiveTarget)
                        )}
                        onClick={handleSwapLanguages}
                        className={`rounded-lg px-1.5 py-0.5 leading-none transition hover:scale-110 active:scale-90 hover:bg-[rgba(var(--ytai-accent-rgb),0.18)] cursor-pointer ${
                          isReversed ? 'rotate-180' : ''
                        }`}
                        style={{
                          color: isReversed ? 'var(--ytai-accent)' : 'var(--ytai-text-primary)'
                        }}
                      >
                        ⇄
                      </button>

                      <button
                        type="button"
                        title={t.targetLangSelectTooltip(
                          getLanguageLabel(effectiveTarget),
                          isSmartSwitched
                        )}
                        onClick={(e) => {
                          e.stopPropagation();
                          setHoveredTrackModeId(null);
                          setLangDropdown((prev) => (prev === 'target' ? 'none' : 'target'));
                        }}
                        className="rounded-lg px-1.5 py-0.5 uppercase transition hover:bg-[rgba(var(--ytai-accent-rgb),0.18)] cursor-pointer"
                        style={
                          langDropdown === 'target'
                            ? activeStyle
                            : { color: 'var(--ytai-accent)' }
                        }
                      >
                        [{formatShortLangCode(effectiveTarget)}]
                      </button>
                    </div>
                  </div>

                  {langDropdown !== 'none' && (
                    <div
                      className="w-[212px] border-t pt-1.5 flex flex-col gap-1"
                      style={dividerStyle}
                    >
                      <div
                        className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
                        style={mutedTextStyle}
                      >
                        {langDropdown === 'source' ? t.sourceLangHeader : t.targetLangHeader}
                      </div>
                      <div
                        className="flex flex-col gap-0.5 overflow-y-auto pr-0.5"
                        style={{
                          maxHeight:
                            layout.maxHeight !== null
                              ? `${Math.max(120, Math.min(220, layout.maxHeight - 120))}px`
                              : '200px',
                          scrollbarWidth: 'thin',
                          scrollbarColor: 'var(--ytai-border) transparent'
                        }}
                      >
                        {(langDropdown === 'source'
                          ? SOURCE_LANGUAGE_OPTIONS
                          : LANGUAGE_OPTIONS
                        ).map((opt) => {
                          const isActive =
                            langDropdown === 'source'
                              ? opt.code === 'auto'
                                ? (settings.sourceLang || 'auto') === 'auto' && !isReversed
                                : effectiveSource.toLowerCase() === opt.code.toLowerCase()
                              : effectiveTarget.toLowerCase() === opt.code.toLowerCase();
                          return (
                            <button
                              key={opt.code}
                              type="button"
                              onClick={() =>
                                langDropdown === 'source'
                                  ? handleSelectSource(opt.code)
                                  : handleSelectTarget(opt.code)
                              }
                              style={
                                isActive
                                  ? activeStyle
                                  : { color: 'var(--ytai-text-primary)' }
                              }
                              className={`flex items-center justify-between rounded-xl px-2.5 py-1.5 text-left text-xs transition ${
                                isActive
                                  ? 'font-semibold shadow-sm'
                                  : 'hover:bg-[rgba(var(--ytai-accent-rgb),0.16)]'
                              }`}
                            >
                              <span className="truncate mr-1.5">{opt.label}</span>
                              <span className="font-mono text-[10px] uppercase opacity-75 shrink-0">
                                {opt.code}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {langDropdown === 'none' &&
                    (() => {
                      const hovered = trackModes.find((m) => m.id === hoveredTrackModeId);
                      if (!hovered) return null;
                      return (
                        <div
                          className="absolute left-1/2 -translate-x-1/2 top-full mt-2 w-60 rounded-xl border p-2.5 text-xs shadow-2xl pointer-events-none z-[60] select-none animate-in fade-in duration-150"
                          style={tooltipSurfaceStyle}
                        >
                          <div className="font-semibold" style={{ color: 'var(--ytai-text-primary)' }}>
                            {hovered.label}
                          </div>
                          <p className="mt-1 text-[11px] leading-relaxed" style={mutedTextStyle}>
                            {hovered.description}
                          </p>
                        </div>
                      );
                    })()}
                </div>
              )}
            </ToolbarPopover>

            {/* 2. Subtitle Perception Mode Popover */}
            <ToolbarPopover
              isOpen={openMenu === 'mode'}
              onOpen={() => openMenuExclusive('mode')}
              onClose={() => closeMenu('mode')}
              popoverWidth={160}
              closeDelayMs={150}
              toolbarRef={toolbarRef}
              playerContainer={playerContainer}
              layoutDeps={[settings.controlsScale]}
              trigger={
                <button
                  type="button"
                  title={openMenu === 'mode' ? undefined : getListeningModeTitle()}
                  onClick={cycleListeningMode}
                  style={settings.activeListeningMode !== 'off' ? activeStyle : inactiveStyle}
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
              }
            >
              {() => (
                <div
                  className={`relative flex items-center gap-1.5 rounded-2xl border ${scale.dropdownPadClass} shadow-2xl`}
                  style={popoverSurfaceStyle}
                >
                  {listeningModes.map((mode) => {
                    const Icon = mode.icon;
                    const isActive = settings.activeListeningMode === mode.id;
                    return (
                      <button
                        key={mode.id}
                        type="button"
                        onClick={() => {
                          onUpdateSettings({ activeListeningMode: mode.id });
                          closeMenu('mode');
                        }}
                        onMouseEnter={() => setHoveredModeId(mode.id)}
                        onMouseLeave={() =>
                          setHoveredModeId((prev) => (prev === mode.id ? null : prev))
                        }
                        style={isActive ? activeStyle : inactiveStyle}
                        className={`flex items-center justify-center rounded-xl ${scale.iconBtnPadClass} transition hover:bg-[rgba(var(--ytai-accent-rgb),0.18)]`}
                      >
                        <Icon size={scale.iconSize} />
                      </button>
                    );
                  })}

                  {(() => {
                    const hoveredMode = listeningModes.find((m) => m.id === hoveredModeId);
                    if (!hoveredMode) return null;
                    return (
                      <div
                        className="absolute left-1/2 -translate-x-1/2 top-full mt-2 w-60 rounded-xl border p-2.5 text-xs shadow-2xl pointer-events-none z-[60] select-none animate-in fade-in duration-150"
                        style={tooltipSurfaceStyle}
                      >
                        <div className="font-semibold" style={{ color: 'var(--ytai-text-primary)' }}>
                          {hoveredMode.label}
                        </div>
                        <p className="mt-1 text-[11px] leading-relaxed" style={mutedTextStyle}>
                          {hoveredMode.description}
                        </p>
                      </div>
                    );
                  })()}
                </div>
              )}
            </ToolbarPopover>

            {/* 3. Auto-pause & Pause Timer Popover */}
            <ToolbarPopover
              isOpen={openMenu === 'timer'}
              onOpen={() => openMenuExclusive('timer')}
              onClose={() => closeMenu('timer')}
              popoverWidth={260}
              closeDelayMs={160}
              preventHoverClose={isCustomTimerFocused}
              toolbarRef={toolbarRef}
              playerContainer={playerContainer}
              layoutDeps={[settings.controlsScale, trackMeta, cueCount]}
              trigger={
                <button
                  type="button"
                  title={
                    openMenu === 'timer'
                      ? undefined
                      : settings.autoPauseAfterCue
                        ? settings.pauseTimerSeconds > 0
                          ? t.autoPauseTimerOnTooltip(settings.pauseTimerSeconds)
                          : t.autoPauseOnTooltip
                        : t.autoPauseOffTooltip
                  }
                  onClick={() =>
                    onUpdateSettings({ autoPauseAfterCue: !settings.autoPauseAfterCue })
                  }
                  style={settings.autoPauseAfterCue ? activeStyle : inactiveStyle}
                  className={`flex items-center gap-1 rounded-full ${scale.iconBtnPadClass} transition hover:bg-[rgba(var(--ytai-accent-rgb),0.2)]`}
                >
                  <PauseCircle size={scale.iconSize} />
                  {settings.autoPauseAfterCue && settings.pauseTimerSeconds > 0 && (
                    <span className="font-mono text-[10px] font-bold leading-none tracking-tight pr-0.5">
                      {settings.pauseTimerSeconds}
                      {t.secShort}
                    </span>
                  )}
                </button>
              }
            >
              {() => (
                <div
                  className="relative flex flex-col gap-1.5 rounded-2xl border p-2 shadow-2xl"
                  style={popoverSurfaceStyle}
                >
                  <div className="flex items-center justify-center gap-1">
                    {[
                      {
                        id: 'off' as const,
                        autoPause: false,
                        sec: 0,
                        label: t.offLabel,
                        title: t.timerOffTitle,
                        description: t.timerOffDesc
                      },
                      {
                        id: 'manual' as const,
                        autoPause: true,
                        sec: 0,
                        label: t.pauseManualLabel,
                        title: t.timerManualTitle,
                        description: t.timerManualDesc
                      },
                      {
                        id: '1.5' as const,
                        autoPause: true,
                        sec: 1.5,
                        label: `1.5${t.secShort}`,
                        title: t.timerSecTitle(1.5),
                        description: t.timerSecDesc(1.5)
                      },
                      {
                        id: '3' as const,
                        autoPause: true,
                        sec: 3,
                        label: `3${t.secShort}`,
                        title: t.timerSecTitle(3),
                        description: t.timerSecDesc(3)
                      },
                      {
                        id: '5' as const,
                        autoPause: true,
                        sec: 5,
                        label: `5${t.secShort}`,
                        title: t.timerSecTitle(5),
                        description: t.timerSecDesc(5)
                      }
                    ].map((opt) => {
                      const isSelected = opt.autoPause
                        ? Boolean(settings.autoPauseAfterCue) &&
                          Math.abs((settings.pauseTimerSeconds ?? 0) - opt.sec) < 0.05
                        : !settings.autoPauseAfterCue;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => {
                            onUpdateSettings({
                              autoPauseAfterCue: opt.autoPause,
                              ...(opt.autoPause ? { pauseTimerSeconds: opt.sec } : {})
                            });
                            closeMenu('timer');
                          }}
                          onMouseEnter={() =>
                            setHoveredTimerHint({
                              title: opt.title,
                              description: opt.description
                            })
                          }
                          onMouseLeave={() => setHoveredTimerHint(null)}
                          style={isSelected ? activeStyle : inactiveStyle}
                          className={`flex items-center justify-center gap-0.5 rounded-xl px-2 py-1.5 transition hover:bg-[rgba(var(--ytai-accent-rgb),0.18)] ${
                            isSelected ? 'shadow-sm' : ''
                          }`}
                        >
                          {opt.id === 'off' ? (
                            <TimerOff size={Math.max(13, scale.iconSize - 1)} />
                          ) : opt.id === 'manual' ? (
                            <PauseCircle size={Math.max(13, scale.iconSize - 1)} />
                          ) : (
                            <>
                              <Timer size={11} className="shrink-0 opacity-85" />
                              <span className="font-mono text-[11px] font-bold leading-none whitespace-nowrap">
                                {opt.label}
                              </span>
                            </>
                          )}
                        </button>
                      );
                    })}
                  </div>

                  <div
                    className="flex items-center justify-between gap-1.5 border-t pt-1.5"
                    style={dividerStyle}
                  >
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        handleCustomTimerSubmit();
                        setIsCustomTimerFocused(false);
                        setHoveredTimerHint(null);
                      }}
                      className="flex items-center gap-1"
                      onMouseEnter={() =>
                        setHoveredTimerHint({
                          title: t.timerCustomTitle,
                          description: t.timerCustomDesc
                        })
                      }
                      onMouseLeave={() => setHoveredTimerHint(null)}
                    >
                      <input
                        type="number"
                        min={0.5}
                        max={300}
                        step={0.5}
                        placeholder={t.secWord}
                        value={customTimerInput}
                        onFocus={() => setIsCustomTimerFocused(true)}
                        onBlur={() => setIsCustomTimerFocused(false)}
                        onChange={(e) => setCustomTimerInput(e.target.value)}
                        onKeyDown={(e) => e.stopPropagation()}
                        onKeyUp={(e) => e.stopPropagation()}
                        onKeyPress={(e) => e.stopPropagation()}
                        className="ytai-input w-[72px] rounded-xl border px-2 py-1 text-[11px] font-mono"
                      />
                      <button
                        type="submit"
                        disabled={!customTimerInput.trim()}
                        style={customTimerInput.trim() ? activeStyle : undefined}
                        className={`flex h-7 w-7 items-center justify-center rounded-xl transition disabled:opacity-40 ${
                          customTimerInput.trim() ? 'shadow-sm hover:opacity-90' : 'ytai-control-btn'
                        }`}
                      >
                        <Check size={13} />
                      </button>
                    </form>

                    <div className="h-4 w-px shrink-0" style={{ backgroundColor: 'var(--ytai-border)' }} />

                    <button
                      type="button"
                      onClick={() =>
                        onUpdateSettings({
                          autoPauseOnWordClick: !(settings.autoPauseOnWordClick ?? true)
                        })
                      }
                      onMouseEnter={() =>
                        setHoveredTimerHint({
                          title: t.wordClickPauseTitle(settings.autoPauseOnWordClick ?? true),
                          description:
                            (settings.autoPauseOnWordClick ?? true)
                              ? t.wordClickPauseOnDesc
                              : t.wordClickPauseOffDesc
                        })
                      }
                      onMouseLeave={() => setHoveredTimerHint(null)}
                      style={(settings.autoPauseOnWordClick ?? true) ? activeStyle : inactiveStyle}
                      className="flex h-7 w-8 shrink-0 items-center justify-center rounded-xl transition hover:bg-[rgba(var(--ytai-accent-rgb),0.18)] cursor-pointer"
                    >
                      <MousePointerClick size={15} />
                    </button>
                  </div>

                  {hoveredTimerHint && (
                    <div
                      className="absolute left-1/2 -translate-x-1/2 top-full mt-2 w-60 rounded-xl border p-2.5 text-xs shadow-2xl pointer-events-none z-[60] select-none animate-in fade-in duration-150"
                      style={tooltipSurfaceStyle}
                    >
                      <div className="font-semibold" style={{ color: 'var(--ytai-text-primary)' }}>
                        {hoveredTimerHint.title}
                      </div>
                      <p className="mt-1 text-[11px] leading-relaxed" style={mutedTextStyle}>
                        {hoveredTimerHint.description}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </ToolbarPopover>

            {supportsCueSeeking && (
              <button
                type="button"
                title={t.repeatCueTooltip}
                onClick={onRepeatCue}
                style={inactiveStyle}
                className={`rounded-full ${scale.iconBtnPadClass} transition hover:bg-[rgba(var(--ytai-accent-rgb),0.2)]`}
              >
                <RotateCcw size={scale.iconSize} />
              </button>
            )}

            {/* 4. Subtitle Font Sizing Popover */}
            <ToolbarPopover
              isOpen={openMenu === 'font'}
              onOpen={() => openMenuExclusive('font')}
              onClose={() => closeMenu('font')}
              popoverWidth={134}
              closeDelayMs={180}
              toolbarRef={toolbarRef}
              playerContainer={playerContainer}
              layoutDeps={[
                trackMeta,
                cueCount,
                settings.subtitlePosition,
                settings.subtitleBoxSize,
                settings.subtitleBoxFixed,
                settings.controlsScale
              ]}
              trigger={
                <button
                  type="button"
                  title={openMenu === 'font' ? undefined : t.fontStyleTooltip(currentFontSize)}
                  onClick={() =>
                    openMenu === 'font' ? closeMenu('font') : openMenuExclusive('font')
                  }
                  style={openMenu === 'font' ? activeStyle : inactiveStyle}
                  className={`flex items-center justify-center rounded-full ${scale.iconBtnPadClass} transition hover:bg-[rgba(var(--ytai-accent-rgb),0.2)]`}
                >
                  <Type size={scale.iconSize} />
                </button>
              }
            >
              {() => (
                <div
                  className="relative flex flex-col gap-1.5 rounded-2xl border px-2 py-1.5 shadow-2xl"
                  style={popoverSurfaceStyle}
                >
                  <div
                    className="flex flex-col items-center gap-1"
                    onMouseEnter={() =>
                      setHoveredFontHint({
                        title: `${t.primaryTrackTitle} · ${currentFontSize}px`,
                        description: t.primaryTrackHint
                      })
                    }
                    onMouseLeave={() => setHoveredFontHint(null)}
                  >
                    <span
                      className="text-[9.5px] font-medium tracking-wider leading-none"
                      style={{ color: 'var(--ytai-accent)' }}
                    >
                      {t.primaryTrackTitle}
                    </span>
                    <div className="flex items-center justify-center gap-1">
                      <button
                        type="button"
                        disabled={currentFontSize <= 12}
                        onClick={handleDecreaseFontSize}
                        style={inactiveStyle}
                        className="flex h-6 w-6 items-center justify-center rounded-lg transition hover:bg-[rgba(var(--ytai-accent-rgb),0.18)] disabled:opacity-30 cursor-pointer"
                      >
                        <ChevronLeft size={13} />
                      </button>

                      <button
                        type="button"
                        onClick={handleResetFontSize}
                        style={{
                          backgroundColor: 'var(--ytai-surface)',
                          borderColor: 'var(--ytai-border)',
                          color: 'var(--ytai-text-primary)'
                        }}
                        className="flex min-w-[40px] items-center justify-center rounded-full border px-2 py-0.5 font-mono text-[13px] font-bold leading-tight transition hover:opacity-85 cursor-pointer"
                      >
                        {currentFontSize}
                      </button>

                      <button
                        type="button"
                        disabled={currentFontSize >= 56}
                        onClick={handleIncreaseFontSize}
                        style={inactiveStyle}
                        className="flex h-6 w-6 items-center justify-center rounded-lg transition hover:bg-[rgba(var(--ytai-accent-rgb),0.18)] disabled:opacity-30 cursor-pointer"
                      >
                        <ChevronRight size={13} />
                      </button>
                    </div>
                  </div>

                  <div
                    className="flex flex-col items-center gap-1 border-t pt-1.5"
                    style={dividerStyle}
                    onMouseEnter={() =>
                      setHoveredFontHint({
                        title: `${t.transTrackTitle} · ${currentTranslationFontSize}px`,
                        description: t.transTrackHint
                      })
                    }
                    onMouseLeave={() => setHoveredFontHint(null)}
                  >
                    <span
                      className="text-[9.5px] font-medium tracking-wider leading-none opacity-85"
                      style={{ color: 'var(--ytai-text-primary)' }}
                    >
                      {t.transTrackTitle}
                    </span>
                    <div className="flex items-center justify-center gap-1">
                      <button
                        type="button"
                        disabled={currentTranslationFontSize <= 12}
                        onClick={handleDecreaseTranslationSize}
                        style={inactiveStyle}
                        className="flex h-6 w-6 items-center justify-center rounded-lg transition hover:bg-[rgba(var(--ytai-accent-rgb),0.18)] disabled:opacity-30 cursor-pointer"
                      >
                        <ChevronLeft size={13} />
                      </button>

                      <button
                        type="button"
                        onClick={handleResetTranslationSize}
                        style={{
                          backgroundColor: 'var(--ytai-surface)',
                          borderColor: 'var(--ytai-border)',
                          color: 'var(--ytai-text-secondary)'
                        }}
                        className="flex min-w-[40px] items-center justify-center rounded-full border px-2 py-0.5 font-mono text-[13px] font-bold leading-tight transition hover:opacity-85 cursor-pointer"
                      >
                        {currentTranslationFontSize}
                      </button>

                      <button
                        type="button"
                        disabled={currentTranslationFontSize >= 48}
                        onClick={handleIncreaseTranslationSize}
                        style={inactiveStyle}
                        className="flex h-6 w-6 items-center justify-center rounded-lg transition hover:bg-[rgba(var(--ytai-accent-rgb),0.18)] disabled:opacity-30 cursor-pointer"
                      >
                        <ChevronRight size={13} />
                      </button>
                    </div>
                  </div>

                  {hoveredFontHint && (
                    <div
                      className="absolute left-1/2 -translate-x-1/2 top-full mt-2 w-56 rounded-xl border p-2.5 text-xs shadow-2xl pointer-events-none z-[60] select-none animate-in fade-in duration-150"
                      style={tooltipSurfaceStyle}
                    >
                      <div className="font-semibold" style={{ color: 'var(--ytai-text-primary)' }}>
                        {hoveredFontHint.title}
                      </div>
                      <p className="mt-1 text-[11px] leading-relaxed" style={mutedTextStyle}>
                        {hoveredFontHint.description}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </ToolbarPopover>

            {(settings.subtitlePosition ||
              settings.subtitleBoxSize ||
              settings.subtitleBoxFixed) &&
              onResetPosition && (
                <button
                  type="button"
                  title={t.resetSizePosTooltip}
                  onClick={() => {
                    onUpdateSettings({
                      subtitleBoxFixed: false,
                      subtitleBoxSize: null,
                      subtitleBoxCompact: false,
                      subtitlePosition: null
                    });
                    onResetPosition();
                  }}
                  style={{ color: 'var(--ytai-accent)' }}
                  className={`rounded-full ${scale.iconBtnPadClass} transition hover:bg-[rgba(var(--ytai-accent-rgb),0.2)]`}
                >
                  <Move size={scale.iconSize} />
                </button>
              )}
          </>
        )}

        {/* 5. System Gear Popover (Strictly English technical panel) */}
        <ToolbarPopover
          isOpen={openMenu === 'system'}
          onOpen={() => openMenuExclusive('system')}
          onClose={() => closeMenu('system')}
          popoverWidth={284}
          closeDelayMs={180}
          toolbarRef={toolbarRef}
          playerContainer={playerContainer}
          layoutDeps={[settings.controlsScale, settings.showSystemLogs]}
          trigger={
            <button
              type="button"
              title={openMenu === 'system' ? undefined : t.systemMenuTooltip}
              onClick={(e) => {
                e.stopPropagation();
                onOpenSettings?.();
              }}
              style={openMenu === 'system' ? activeStyle : inactiveStyle}
              className={`flex items-center justify-center rounded-full ${scale.iconBtnPadClass} transition hover:bg-[rgba(var(--ytai-accent-rgb),0.2)] cursor-pointer`}
            >
              <Settings size={scale.iconSize} />
            </button>
          }
        >
          {(layout) => (
            <div
              className="w-[288px] rounded-2xl border p-3 shadow-2xl flex flex-col gap-2.5 text-xs"
              style={{
                ...popoverSurfaceStyle,
                maxHeight: layout.maxHeight !== null ? `${layout.maxHeight}px` : undefined,
                overflowY: 'auto',
                scrollbarWidth: 'thin',
                scrollbarColor: 'var(--ytai-border) transparent'
              }}
            >
              <div className="flex items-center justify-between gap-2">
                <span
                  className="text-[11px] font-semibold uppercase tracking-wider"
                  style={mutedTextStyle}
                >
                  System Info
                </span>
                {onOpenSettings && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenSettings();
                      closeMenu('system');
                    }}
                    style={activeStyle}
                    className="flex items-center gap-1 rounded-xl px-2.5 py-1 text-[11px] font-semibold shadow-sm transition hover:opacity-90 cursor-pointer"
                  >
                    <SlidersHorizontal size={11} />
                    <span>Settings</span>
                  </button>
                )}
              </div>

              <div
                className="rounded-xl border p-2.5 space-y-1.5 text-[11px]"
                style={{
                  backgroundColor: 'var(--ytai-surface)',
                  borderColor: 'var(--ytai-border)'
                }}
              >
                {adapterName && (
                  <div className="flex items-center justify-between gap-2">
                    <span style={mutedTextStyle}>Module</span>
                    <span
                      className="truncate font-medium max-w-[168px]"
                      style={{ color: 'var(--ytai-text-primary)' }}
                      title={adapterName}
                    >
                      {adapterName}
                    </span>
                  </div>
                )}

                <div className="flex items-center justify-between gap-2">
                  <span style={mutedTextStyle}>Track</span>
                  <span
                    className="truncate font-semibold max-w-[168px]"
                    style={{ color: trackMeta ? 'var(--ytai-accent)' : 'var(--ytai-text-muted)' }}
                    title={trackMeta?.label || trackMeta?.lang || 'Not detected'}
                  >
                    {trackMeta
                      ? `${getLanguageLabel(trackMeta.lang || effectiveSource)} (${(
                          trackMeta.lang || effectiveSource
                        ).toUpperCase()})`
                      : 'Not detected'}
                  </span>
                </div>

                {trackMeta && (
                  <>
                    <div className="flex items-center justify-between gap-2">
                      <span style={mutedTextStyle}>Type</span>
                      <span style={{ color: 'var(--ytai-text-primary)' }}>
                        {trackMeta.isAsr ? 'Auto captions (ASR)' : 'Author subtitles'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span style={mutedTextStyle}>Cues loaded</span>
                      <span className="font-mono font-semibold" style={{ color: 'var(--ytai-text-primary)' }}>
                        {cueCount}
                      </span>
                    </div>
                  </>
                )}

                <div className="flex items-center justify-between gap-2">
                  <span style={mutedTextStyle}>Translation</span>
                  <span className="font-mono text-[10.5px]" style={{ color: 'var(--ytai-text-primary)' }}>
                    [{formatShortLangCode(effectiveSource)}] → [{formatShortLangCode(effectiveTarget)}]
                    {' · '}
                    {translationStatus?.state === 'translating'
                      ? 'translating...'
                      : translationStatus?.state === 'cooldown'
                        ? `cooldown ${cooldownSecLeft}s`
                        : 'ready'}
                  </span>
                </div>
              </div>

              {availableTracks && availableTracks.length > 1 && onSelectAvailableTrack && (
                <div className="border-t pt-2 space-y-1.5" style={dividerStyle}>
                  <div
                    className="text-[10px] font-semibold uppercase tracking-wider"
                    style={mutedTextStyle}
                  >
                    Player Tracks ({availableTracks.length})
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {availableTracks.map((tr) => (
                      <button
                        key={tr.url}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectAvailableTrack(tr.url);
                        }}
                        style={tr.active ? activeStyle : undefined}
                        className={`rounded-lg px-2 py-1 text-[11px] font-medium transition cursor-pointer ${
                          tr.active ? 'font-semibold shadow-sm' : 'ytai-control-btn'
                        }`}
                      >
                        {tr.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="border-t pt-2 space-y-1.5" style={dividerStyle}>
                <div className="flex items-center justify-between gap-2">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={settings.showSystemLogs ?? true}
                      onChange={(e) => onUpdateSettings({ showSystemLogs: e.target.checked })}
                      className="h-3.5 w-3.5 rounded cursor-pointer"
                      style={{ accentColor: 'var(--ytai-accent)' }}
                    />
                    <span
                      className="text-[11px] font-medium"
                      style={{ color: 'var(--ytai-text-primary)' }}
                    >
                      Log Console
                    </span>
                  </label>

                  {(settings.showSystemLogs ?? true) &&
                    systemLogs &&
                    systemLogs.length > 0 &&
                    onClearSystemLogs && (
                      <button
                        type="button"
                        title="Clear logs"
                        onClick={(e) => {
                          e.stopPropagation();
                          onClearSystemLogs();
                        }}
                        className="ytai-ghost-btn flex items-center gap-1 rounded-lg px-1.5 py-0.5 text-[10px] transition cursor-pointer"
                      >
                        <Trash2 size={10} />
                        <span>Clear</span>
                      </button>
                    )}
                </div>

                {(settings.showSystemLogs ?? true) && (
                  <div
                    className="max-h-36 overflow-y-auto rounded-xl border p-2 font-mono text-[10px] leading-relaxed space-y-1 select-text"
                    style={{
                      backgroundColor: 'rgba(var(--ytai-bg-rgb), 0.72)',
                      borderColor: 'var(--ytai-border)',
                      scrollbarWidth: 'thin',
                      scrollbarColor: 'var(--ytai-border) transparent'
                    }}
                  >
                    {systemLogs && systemLogs.length > 0 ? (
                      [...systemLogs].reverse().map((entry) => (
                        <div key={entry.id} className="flex items-start gap-1.5 break-words">
                          <span className="shrink-0 opacity-60" style={mutedTextStyle}>
                            {entry.time}
                          </span>
                          <span
                            className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full"
                            style={{
                              backgroundColor:
                                entry.level === 'error'
                                  ? '#fb7185'
                                  : entry.level === 'warn'
                                    ? '#fbbf24'
                                    : 'var(--ytai-accent)'
                            }}
                          />
                          <span style={{ color: 'var(--ytai-text-primary)' }}>
                            {entry.message}
                          </span>
                        </div>
                      ))
                    ) : (
                      <div className="italic opacity-70" style={mutedTextStyle}>
                        No events yet...
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </ToolbarPopover>
      </div>
    </div>
  );
}
