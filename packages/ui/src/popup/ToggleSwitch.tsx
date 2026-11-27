import type { ReactElement } from 'react';

export interface ToggleSwitchProps {
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
  activeBg?: string;
  activeKnob?: string;
}

export function ToggleSwitch({
  checked,
  disabled = false,
  onChange,
  activeBg = 'var(--ytai-accent)',
  activeKnob = 'var(--ytai-accent-fg, #09090b)'
}: ToggleSwitchProps): ReactElement {
  return (
    <label
      className={`relative inline-flex items-center ${
        disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
      />
      <span
        className="relative inline-flex shrink-0 items-center rounded-full border transition-colors"
        style={{
          width: '36px',
          height: '20px',
          padding: '2px',
          boxSizing: 'border-box',
          backgroundColor: checked ? activeBg : 'var(--ytai-control-track)',
          borderColor: 'var(--ytai-border)'
        }}
      >
        <span
          className="inline-block rounded-full shadow-sm transition-transform duration-150"
          style={{
            width: '14px',
            height: '14px',
            transform: checked ? 'translateX(16px)' : 'translateX(0px)',
            backgroundColor: checked ? activeKnob : 'var(--ytai-text-primary)'
          }}
        />
      </span>
    </label>
  );
}
