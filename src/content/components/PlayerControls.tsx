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
      className="pointer-events-auto absolute right-3 top-3 z-20 flex items-center gap-1.5 rounded-full border border-white/15 bg-slate-950/80 px-2.5 py-1.5 text-xs text-slate-100 shadow-lg backdrop-blur-md select-none"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        title={settings.enabled ? 'Disable YouTube Lang AI' : 'Enable YouTube Lang AI'}
        onClick={() => onUpdateSettings({ enabled: !settings.enabled })}
        className={`flex items-center gap-1 rounded-full px-2 py-1 font-medium transition ${
          settings.enabled
            ? 'bg-indigo-600 text-white hover:bg-indigo-500'
            : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200'
        }`}
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
            className={`rounded-full p-1.5 transition ${
              settings.showDualSubtitles
                ? 'bg-emerald-600/90 text-white hover:bg-emerald-500'
                : 'text-slate-300 hover:bg-white/10'
            }`}
          >
            <Languages className="h-3.5 w-3.5" />
          </button>

          <button
            type="button"
            title="Active Listening Mode (blur subtitles, hold Alt or hover to reveal)"
            onClick={() =>
              onUpdateSettings({ activeListeningMode: !settings.activeListeningMode })
            }
            className={`rounded-full p-1.5 transition ${
              settings.activeListeningMode
                ? 'bg-amber-500/90 text-slate-950 hover:bg-amber-400'
                : 'text-slate-300 hover:bg-white/10'
            }`}
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
            className={`rounded-full p-1.5 transition ${
              settings.autoPauseAfterCue
                ? 'bg-violet-600 text-white hover:bg-violet-500'
                : 'text-slate-300 hover:bg-white/10'
            }`}
          >
            <PauseCircle className="h-3.5 w-3.5" />
          </button>

          <button
            type="button"
            title="Repeat current subtitle (R)"
            onClick={onRepeatCue}
            className="rounded-full p-1.5 text-slate-300 transition hover:bg-white/10 hover:text-white"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>

          {trackMeta && (
            <span className="ml-0.5 rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-slate-300">
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
