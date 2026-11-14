import { StrictMode, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import tailwindCss from '../app/index.css?inline';
import type { UserSettings } from '../types/settings';
import type { SubtitleCue, TrackMetadata } from '../types/subtitles';
import { PlayerControls } from './components/PlayerControls';
import { SubtitleOverlay, type WordSelectionPayload } from './components/SubtitleOverlay';

export interface ShadowUIState {
  settings: UserSettings;
  isAdShowing: boolean;
  trackMeta: TrackMetadata | null;
  cueCount: number;
  primaryCue: SubtitleCue | null;
  translatedCue: SubtitleCue | null;
  altPressed: boolean;
  selectedTarget: string | null;
  popupElement?: ReactNode;
  onUpdateSettings: (partial: Partial<UserSettings>) => void;
  onRepeatCue: () => void;
  onSelectTarget: (selection: WordSelectionPayload) => void;
}

export interface MountedShadowUI {
  host: HTMLDivElement;
  shadowRoot: ShadowRoot;
  update: (state: ShadowUIState) => void;
  unmount: () => void;
}

function normalizeRemToPx(cssText: string): string {
  // YouTube sets html { font-size: 10px }, which shrinks rem-based Tailwind utilities inside Shadow DOM.
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
    primaryCue,
    translatedCue,
    altPressed,
    selectedTarget,
    popupElement,
    onUpdateSettings,
    onRepeatCue,
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
        altPressed={altPressed}
        hasActivePopup={Boolean(selectedTarget || popupElement)}
        onUpdateSettings={onUpdateSettings}
        onRepeatCue={onRepeatCue}
        onResetPosition={() => onUpdateSettings({ subtitlePosition: null })}
      />

      {settings.enabled && !isAdShowing && (
        <>
          <SubtitleOverlay
            primaryCue={primaryCue}
            translatedCue={translatedCue}
            showDualSubtitles={settings.showDualSubtitles}
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
  initialState: ShadowUIState
): MountedShadowUI {
  const existing = playerContainer.querySelector('#yt-lang-ai-root');
  if (existing) {
    existing.remove();
  }

  const host = document.createElement('div');
  host.id = 'yt-lang-ai-root';
  host.style.cssText =
    'position: absolute; inset: 0; pointer-events: none; z-index: 60; overflow: visible;';
  host.setAttribute('data-theme', initialState.settings.theme || 'midnight-glass');
  host.style.setProperty(
    '--ytai-bg-opacity',
    String(initialState.settings.overlayOpacity ?? 0.85)
  );

  const shadowRoot = host.attachShadow({ mode: 'open' });

  const styleEl = document.createElement('style');
  styleEl.textContent = normalizeRemToPx(tailwindCss);
  shadowRoot.appendChild(styleEl);

  const mountEl = document.createElement('div');
  mountEl.id = 'yt-lang-ai-mount';
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
