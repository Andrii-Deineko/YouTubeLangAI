import { StrictMode, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import coreCss from '../styles/index.css?inline';
import type { UserSettings } from '../types/settings';
import type { SubtitleCue, TrackMetadata } from '../types/subtitles';
import { PlayerControls } from '../components/PlayerControls';
import { SubtitleOverlay, type WordSelectionPayload } from '../components/SubtitleOverlay';

export interface ShadowUIState {
  settings: UserSettings;
  isAdShowing: boolean;
  trackMeta: TrackMetadata | null;
  cueCount: number;
  captionRateLimitedUntil?: number;
  primaryCue: SubtitleCue | null;
  translatedCue: SubtitleCue | null;
  altPressed: boolean;
  selectedTarget: string | null;
  popupElement?: ReactNode;
  onUpdateSettings: (partial: Partial<UserSettings>) => void;
  onRepeatCue: () => void;
  onResetPosition: () => void;
  onSelectTarget: (selection: WordSelectionPayload) => void;
}

export interface MountedShadowUI {
  host: HTMLDivElement;
  shadowRoot: ShadowRoot;
  update: (state: ShadowUIState) => void;
  unmount: () => void;
}

function normalizeRemToPx(cssText: string): string {
  // YouTube and some cinema video sites set html { font-size: 10px }, shrinking rem-based utilities
  return cssText.replace(/(-?\d*\.?\d+)rem\b/g, (_match, numStr: string) => {
    const px = Number.parseFloat(numStr) * 16;
    return `${px}px`;
  });
}

function ShadowHUD({ state }: { state: ShadowUIState }): ReactNode {
  const {
    settings,
    isAdShowing,
    trackMeta,
    cueCount,
    captionRateLimitedUntil,
    primaryCue,
    translatedCue,
    altPressed,
    selectedTarget,
    popupElement,
    onUpdateSettings,
    onRepeatCue,
    onResetPosition,
    onSelectTarget
  } = state;

  return (
    <div
      data-theme={settings.theme || 'midnight-glass'}
      style={
        {
          '--ytai-bg-opacity': String(settings.overlayOpacity ?? 0.85)
        } as React.CSSProperties
      }
      className="pointer-events-none relative h-full w-full font-sans"
    >
      <PlayerControls
        settings={settings}
        trackMeta={trackMeta}
        cueCount={cueCount}
        captionRateLimitedUntil={captionRateLimitedUntil}
        altPressed={altPressed}
        hasActivePopup={Boolean(selectedTarget || popupElement)}
        onUpdateSettings={onUpdateSettings}
        onRepeatCue={onRepeatCue}
        onResetPosition={onResetPosition}
      />

      {settings.enabled && !isAdShowing && (
        <>
          <SubtitleOverlay
            primaryCue={primaryCue}
            translatedCue={translatedCue}
            showDualSubtitles={settings.showDualSubtitles}
            showTranslation={settings.showTranslation}
            activeListeningMode={settings.activeListeningMode}
            altPressed={altPressed}
            fontSize={settings.subtitleFontSize}
            scale={settings.subtitleScale}
            overlayOpacity={settings.overlayOpacity}
            position={settings.subtitlePosition}
            onUpdatePosition={(pos) => onUpdateSettings({ subtitlePosition: pos })}
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
  hostId: string = 'dual-subtitles-root'
): MountedShadowUI {
  const existing = playerContainer.querySelector(`#${hostId}`) || playerContainer.querySelector('#yt-lang-ai-root');
  if (existing) {
    existing.remove();
  }

  const host = document.createElement('div');
  host.id = hostId;
  host.style.cssText =
    'position: absolute; inset: 0; pointer-events: none; z-index: 60; overflow: visible;';
  host.setAttribute('data-theme', initialState.settings.theme || 'midnight-glass');
  host.style.setProperty(
    '--ytai-bg-opacity',
    String(initialState.settings.overlayOpacity ?? 0.85)
  );

  const shadowRoot = host.attachShadow({ mode: 'open' });

  const styleEl = document.createElement('style');
  styleEl.textContent = normalizeRemToPx(coreCss);
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
      host.style.setProperty(
        '--ytai-bg-opacity',
        String(nextState.settings.overlayOpacity ?? 0.85)
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
