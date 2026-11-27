import { StrictMode, type CSSProperties, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  SHADOW_HOST_ID,
  type AvailableTrackOption,
  type SubtitleCue,
  type SubtitlePosition,
  type SystemLogEntry,
  type TrackMetadata,
  type TranslationRuntimeStatus,
  type UserSettings
} from '@langai/contracts';
import {
  PlayerControls,
  SubtitleOverlay,
  type WordSelectionPayload
} from '@langai/ui';
import hudCss from '@langai/ui/styles/hud.css?inline';
import themesCss from '@langai/ui/styles/themes.css?inline';

export interface ShadowUIState {
  settings: UserSettings;
  playerContainer: HTMLElement | null;
  isAdShowing: boolean;
  controlsHidden: boolean;
  subtitleBottomOffset: number;
  serviceName?: string;
  trackMeta: TrackMetadata | null;
  availableTracks?: AvailableTrackOption[];
  systemLogs?: SystemLogEntry[];
  cueCount: number;
  captionRateLimitedUntil?: number;
  translationStatus?: TranslationRuntimeStatus;
  supportsCueSeeking?: boolean;
  primaryCue: SubtitleCue | null;
  translatedCue: SubtitleCue | null;
  altPressed: boolean;
  selectedTarget: string | null;
  popupElement?: ReactNode;
  autoPauseCountdown?: number | null;
  onResumeAutoPause?: () => void;
  onUpdateSettings: (partial: Partial<UserSettings>) => void;
  onRepeatCue: () => void;
  onResetPosition: () => void;
  onRetryTranslation?: () => void;
  onOpenSettings?: () => void;
  onSelectAvailableTrack?: (trackUrl: string) => void;
  onClearSystemLogs?: () => void;
  onSelectTarget: (selection: WordSelectionPayload) => void;
}

export interface MountedShadowUI {
  host: HTMLDivElement;
  shadowRoot: ShadowRoot;
  update: (state: ShadowUIState) => void;
  unmount: () => void;
}

function normalizeRemToPx(cssText: string): string {
  return cssText.replace(/(-?\d*\.?\d+)rem\b/g, (_match, numStr: string) => {
    const px = Number.parseFloat(numStr) * 16;
    return `${px}px`;
  });
}

function ShadowHUD({ state }: { state: ShadowUIState }): ReactNode {
  const {
    settings,
    playerContainer,
    isAdShowing,
    controlsHidden,
    subtitleBottomOffset,
    serviceName,
    trackMeta,
    availableTracks,
    systemLogs,
    cueCount,
    captionRateLimitedUntil,
    translationStatus,
    supportsCueSeeking,
    primaryCue,
    translatedCue,
    altPressed,
    selectedTarget,
    popupElement,
    autoPauseCountdown,
    onResumeAutoPause,
    onUpdateSettings,
    onRepeatCue,
    onResetPosition,
    onRetryTranslation,
    onOpenSettings,
    onSelectAvailableTrack,
    onClearSystemLogs,
    onSelectTarget
  } = state;

  const rootStyle: CSSProperties & Record<string, string> = {
    '--ytai-bg-opacity': String((settings.backdropOpacity ?? 80) / 100),
    '--langai-subtitle-bottom-offset': `${subtitleBottomOffset}px`
  };

  return (
    <div
      data-theme={settings.theme || 'midnight-glass'}
      data-controls-hidden={controlsHidden ? 'true' : 'false'}
      style={rootStyle}
      className="pointer-events-none relative h-full w-full font-sans"
    >
      <PlayerControls
        settings={settings}
        playerContainer={playerContainer}
        isControlsHidden={controlsHidden}
        adapterName={serviceName}
        trackMeta={trackMeta}
        availableTracks={availableTracks}
        systemLogs={systemLogs}
        cueCount={cueCount}
        captionRateLimitedUntil={captionRateLimitedUntil}
        translationStatus={translationStatus}
        supportsCueSeeking={supportsCueSeeking}
        altPressed={altPressed}
        hasActivePopup={Boolean(selectedTarget || popupElement)}
        onUpdateSettings={onUpdateSettings}
        onRepeatCue={onRepeatCue}
        onResetPosition={onResetPosition}
        onRetryTranslation={onRetryTranslation}
        onOpenSettings={onOpenSettings}
        onSelectAvailableTrack={onSelectAvailableTrack}
        onClearSystemLogs={onClearSystemLogs}
      />

      {settings.enabled && !isAdShowing && (
        <>
          <SubtitleOverlay
            primaryCue={primaryCue}
            translatedCue={translatedCue}
            translationStatus={translationStatus}
            subtitleTrackMode={settings.subtitleTrackMode}
            activeListeningMode={settings.activeListeningMode}
            altPressed={altPressed}
            subtitleFontSize={settings.subtitleFontSize}
            translationFontSize={settings.translationFontSize}
            translationScale={settings.translationScale}
            fontFamily={settings.fontFamily}
            fontWeight={settings.fontWeight}
            backdropOpacity={settings.backdropOpacity}
            textOutline={settings.textOutline}
            position={settings.subtitlePosition}
            playerContainer={playerContainer}
            bottomOffset={subtitleBottomOffset}
            boxFixed={settings.subtitleBoxFixed}
            boxSize={settings.subtitleBoxSize}
            boxCompact={settings.subtitleBoxCompact}
            autoPauseCountdown={autoPauseCountdown}
            onResumeAutoPause={onResumeAutoPause}
            uiLanguage={settings.uiLanguage}
            onUpdateSettings={onUpdateSettings}
            onUpdatePosition={(pos: SubtitlePosition | null) =>
              onUpdateSettings({ subtitlePosition: pos })
            }
            selectedTarget={selectedTarget}
            onSelectTarget={onSelectTarget}
          />
          {popupElement}
        </>
      )}
    </div>
  );
}

export function mountShadowUI(
  playerContainer: HTMLElement,
  initialState: ShadowUIState,
  hostId: string = SHADOW_HOST_ID
): MountedShadowUI {
  const existing =
    playerContainer.querySelector(`#${hostId}`) ||
    playerContainer.querySelector(`#${SHADOW_HOST_ID}`);
  if (existing) {
    existing.remove();
  }

  const host = document.createElement('div');
  host.id = hostId;
  host.style.cssText =
    'position: absolute; inset: 0; pointer-events: none; z-index: 60; overflow: visible;';
  host.setAttribute('data-theme', initialState.settings.theme || 'midnight-glass');
  host.setAttribute('data-controls-hidden', initialState.controlsHidden ? 'true' : 'false');
  host.style.setProperty(
    '--ytai-bg-opacity',
    String((initialState.settings.backdropOpacity ?? 80) / 100)
  );
  host.style.setProperty(
    '--langai-subtitle-bottom-offset',
    `${initialState.subtitleBottomOffset}px`
  );

  const shadowRoot = host.attachShadow({ mode: 'open' });

  const styleEl = document.createElement('style');
  styleEl.textContent = normalizeRemToPx(`${themesCss}\n${hudCss}`);
  shadowRoot.appendChild(styleEl);

  const mountEl = document.createElement('div');
  mountEl.id = `${hostId}-mount`;
  mountEl.style.cssText = 'position: relative; width: 100%; height: 100%; pointer-events: none;';
  shadowRoot.appendChild(mountEl);

  playerContainer.appendChild(host);

  const root: Root = createRoot(mountEl);
  root.render(
    <StrictMode>
      <ShadowHUD state={initialState} />
    </StrictMode>
  );

  return {
    host,
    shadowRoot,
    update(nextState: ShadowUIState): void {
      host.setAttribute('data-theme', nextState.settings.theme || 'midnight-glass');
      host.setAttribute('data-controls-hidden', nextState.controlsHidden ? 'true' : 'false');
      host.style.setProperty(
        '--ytai-bg-opacity',
        String((nextState.settings.backdropOpacity ?? 80) / 100)
      );
      host.style.setProperty(
        '--langai-subtitle-bottom-offset',
        `${nextState.subtitleBottomOffset}px`
      );
      root.render(
        <StrictMode>
          <ShadowHUD state={nextState} />
        </StrictMode>
      );
    },
    unmount(): void {
      root.unmount();
      host.remove();
    }
  };
}
