import type { ReactElement } from 'react';
import { Eye, EyeOff, Languages, PauseCircle, Power, RotateCcw } from 'lucide-react';
import type { UserSettings } from '../../types/settings';
import type { TrackMetadata } from '../../types/subtitles';

interface PlayerControlsProps {
  settings: UserSettings;
  trackMeta: TrackMetadata | null;
  cueCount: number;
  onUpdateSettings: (partial: Partial<UserSettings>) => void;
  onRepeatCue: () => void;
}

export function PlayerControls({
  settings,
  trackMeta,
  cueCount,
  onUpdateSettings,
  onRepeatCue
}: PlayerControlsProps): ReactElement {
  return (
    <div
      className="pointer-events-auto absolute right-3 top-3 z-20 flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs shadow-lg select-none transition-all"
      style={{
        backgroundColor: `rgba(var(--ytai-bg-rgb), 0.88)`,
        borderColor: 'var(--ytai-border)',
        borderWidth: '1px',
        borderStyle: 'solid',
        backdropFilter: 'blur(var(--ytai-backdrop-blur, 12px))',
        WebkitBackdropFilter: 'blur(var(--ytai-backdrop-blur, 12px))',
        color: 'var(--ytai-text-primary)'
      }}
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

          <button
            type="button"
            title="Active Listening Mode (blur subtitles, hold Alt or hover to reveal)"
            onClick={() =>
              onUpdateSettings({ activeListeningMode: !settings.activeListeningMode })
            }
            style={
              settings.activeListeningMode
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
            {settings.activeListeningMode ? (
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
