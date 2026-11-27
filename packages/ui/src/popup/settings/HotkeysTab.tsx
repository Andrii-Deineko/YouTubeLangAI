import { useEffect, useRef, useState, type ReactElement } from 'react';
import { AlertTriangle, RotateCcw, X } from 'lucide-react';
import {
  DEFAULT_KEYBINDINGS,
  type KeybindAction,
  type KeybindingsMap,
  type KeybindValue,
  type UserSettings
} from '@langai/contracts';
import { getUiStrings } from '../../i18n/translations';
import {
  findKeybindConflict,
  formatKeybind,
  getKeybindActionLabels
} from '../../utils/keybinds';
import {
  innerCardStyle,
  mutedTextStyle,
  primaryTextStyle,
  sectionCardStyle
} from './styles';

export interface HotkeysTabProps {
  settings: UserSettings;
  onUpdateSettings: (partial: Partial<UserSettings>) => Promise<void>;
}

export function HotkeysTab({ settings, onUpdateSettings }: HotkeysTabProps): ReactElement {
  const t = getUiStrings(settings.uiLanguage);
  const keybindLabels = getKeybindActionLabels(settings.uiLanguage);
  const [recordingAction, setRecordingAction] = useState<KeybindAction | null>(null);
  const pendingModifierRef = useRef<string | null>(null);
  const currentKeybindings = settings.keybindings ?? DEFAULT_KEYBINDINGS;

  useEffect(() => {
    if (!recordingAction) return;

    const handleKeyDown = (e: KeyboardEvent): void => {
      e.preventDefault();
      e.stopPropagation();

      if (e.code === 'Escape') {
        pendingModifierRef.current = null;
        setRecordingAction(null);
        return;
      }

      const isModifier =
        e.code === 'AltLeft' ||
        e.code === 'AltRight' ||
        e.code === 'ShiftLeft' ||
        e.code === 'ShiftRight' ||
        e.code === 'ControlLeft' ||
        e.code === 'ControlRight' ||
        e.code === 'MetaLeft' ||
        e.code === 'MetaRight';

      if (isModifier) {
        pendingModifierRef.current = e.code;
        return;
      }

      pendingModifierRef.current = null;
      const newBind: KeybindValue = {
        code: e.code,
        ...(e.ctrlKey ? { ctrl: true } : {}),
        ...(e.altKey ? { alt: true } : {}),
        ...(e.shiftKey ? { shift: true } : {})
      };

      const nextKeybindings: KeybindingsMap = {
        ...currentKeybindings,
        [recordingAction]: newBind
      };
      setRecordingAction(null);
      void onUpdateSettings({ keybindings: nextKeybindings });
    };

    const handleKeyUp = (e: KeyboardEvent): void => {
      e.preventDefault();
      e.stopPropagation();

      if (pendingModifierRef.current && e.code === pendingModifierRef.current) {
        const singleModifierCode = pendingModifierRef.current;
        pendingModifierRef.current = null;
        const newBind: KeybindValue = { code: singleModifierCode };
        const nextKeybindings: KeybindingsMap = {
          ...currentKeybindings,
          [recordingAction]: newBind
        };
        setRecordingAction(null);
        void onUpdateSettings({ keybindings: nextKeybindings });
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('keyup', handleKeyUp, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('keyup', handleKeyUp, true);
      pendingModifierRef.current = null;
    };
  }, [recordingAction, currentKeybindings, onUpdateSettings]);

  return (
    <section className="space-y-2 rounded-2xl border p-3" style={sectionCardStyle}>
      <div className="flex items-center justify-between">
        <span
          className="text-[0.6875rem] font-semibold uppercase tracking-wider"
          style={mutedTextStyle}
        >
          {t.hotkeysTitle}
        </span>
        <button
          type="button"
          onClick={() => void onUpdateSettings({ keybindings: DEFAULT_KEYBINDINGS })}
          title={t.hotkeysResetTitle}
          className="ytai-ghost-btn flex items-center gap-1 rounded-lg px-2 py-1 text-[0.6875rem] transition cursor-pointer"
        >
          <RotateCcw className="h-3 w-3" />
          <span>{t.resetBtn}</span>
        </button>
      </div>

      <div className="space-y-1.5">
        {(Object.keys(DEFAULT_KEYBINDINGS) as KeybindAction[]).map((action) => {
          const meta = keybindLabels[action];
          const bind = currentKeybindings[action];
          const isRecording = recordingAction === action;
          const conflictAction = findKeybindConflict(action, bind, currentKeybindings);

          return (
            <div
              key={action}
              className="flex items-center justify-between gap-2 rounded-xl border px-2.5 py-2 transition-colors"
              style={innerCardStyle}
            >
              <div className="flex min-w-0 flex-col pr-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs font-medium" style={primaryTextStyle}>
                    {meta.title}
                  </span>
                  {conflictAction && (
                    <span className="flex items-center gap-0.5 rounded border border-amber-500/30 bg-amber-500/20 px-1.5 py-0.5 text-[0.625rem] font-semibold text-amber-300">
                      <AlertTriangle className="h-2.5 w-2.5" />
                      {t.keyConflict}
                    </span>
                  )}
                </div>
                <span className="line-clamp-1 text-[0.625rem]" style={mutedTextStyle}>
                  {meta.description}
                </span>
              </div>

              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => setRecordingAction(isRecording ? null : action)}
                  className={`min-w-[5.25rem] rounded-lg border px-2 py-1 text-center font-mono text-[0.6875rem] font-medium transition cursor-pointer ${
                    isRecording
                      ? 'animate-pulse'
                      : bind
                        ? 'ytai-control-btn'
                        : 'border-dashed hover:bg-[rgba(var(--ytai-accent-rgb),0.12)]'
                  }`}
                  style={
                    isRecording
                      ? {
                          borderColor: 'var(--ytai-accent)',
                          backgroundColor: 'rgba(var(--ytai-accent-rgb), 0.2)',
                          color: 'var(--ytai-accent)'
                        }
                      : bind
                        ? { borderColor: 'var(--ytai-border)' }
                        : {
                            borderColor: 'var(--ytai-border)',
                            color: 'var(--ytai-text-muted, var(--ytai-text-secondary))'
                          }
                  }
                >
                  {isRecording ? t.pressKey : formatKeybind(bind, settings.uiLanguage)}
                </button>

                {bind && (
                  <button
                    type="button"
                    onClick={() => {
                      const nextKeybindings: KeybindingsMap = {
                        ...currentKeybindings,
                        [action]: null
                      };
                      void onUpdateSettings({ keybindings: nextKeybindings });
                    }}
                    title={t.clearHotkey}
                    className="ytai-ghost-btn rounded-md p-1 transition cursor-pointer"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
