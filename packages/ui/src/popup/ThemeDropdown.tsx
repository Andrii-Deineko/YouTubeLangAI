import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import type { ThemeId, UiLanguage } from '@langai/contracts';
import { getUiStrings } from '../i18n/translations';
import { THEMES, THEME_LIST, type ThemeDefinition } from '../styles/themes';

export interface ThemeDropdownProps {
  currentThemeId: ThemeId;
  uiLanguage?: UiLanguage;
  onSelectTheme: (themeId: ThemeId) => void;
}

function MiniPalette({ theme }: { theme: ThemeDefinition }): ReactElement {
  return (
    <div className="flex items-center -space-x-1 shrink-0" aria-hidden="true">
      <span
        className="h-3.5 w-3.5 rounded-full ring-1 ring-white/15"
        style={{ backgroundColor: `rgb(${theme.bgRgb})` }}
      />
      <span
        className="h-3.5 w-3.5 rounded-full ring-1 ring-white/15"
        style={{ backgroundColor: theme.textPrimary }}
      />
      <span
        className="h-3.5 w-3.5 rounded-full ring-1 ring-white/15"
        style={{ backgroundColor: theme.accent }}
      />
    </div>
  );
}

export function ThemeDropdown({
  currentThemeId,
  uiLanguage,
  onSelectTheme
}: ThemeDropdownProps): ReactElement {
  const [isOpen, setIsOpen] = useState(false);
  const [hoveredId, setHoveredId] = useState<ThemeId | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  const t = getUiStrings(uiLanguage);
  const currentTheme = THEMES[currentThemeId] || THEMES['midnight-glass'];

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: MouseEvent): void => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const handleSelect = (themeId: ThemeId): void => {
    onSelectTheme(themeId);
    setIsOpen(false);
  };

  return (
    <div ref={dropdownRef} className="relative w-full select-none text-xs">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((prev) => !prev)}
        style={{
          backgroundColor: 'var(--ytai-surface)',
          borderColor: isOpen ? 'var(--ytai-accent)' : 'var(--ytai-border)',
          boxShadow: isOpen
            ? '0 0 0 1px var(--ytai-accent), 0 4px 12px rgba(0, 0, 0, 0.25)'
            : undefined
        }}
        className="flex w-full items-center justify-between gap-2.5 rounded-xl border px-3 py-2 text-left transition-all duration-150 focus:outline-none"
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <MiniPalette theme={currentTheme} />
          <span className="truncate font-medium text-xs" style={{ color: currentTheme.accent }}>
            {currentTheme.name}
          </span>
          <span
            className="truncate text-[11px] opacity-75 hidden sm:inline"
            style={{ color: 'var(--ytai-text-secondary)' }}
          >
            · {currentTheme.tagline}
          </span>
        </div>

        <ChevronDown
          className={`h-4 w-4 shrink-0 transition-transform duration-200 ${
            isOpen ? 'rotate-180' : ''
          }`}
          style={{ color: 'var(--ytai-text-secondary)' }}
        />
      </button>

      {isOpen && (
        <div
          role="listbox"
          aria-label={t.colorTheme}
          style={{
            backgroundColor: 'rgb(var(--ytai-bg-rgb))',
            borderColor: 'var(--ytai-border)',
            boxShadow:
              '0 12px 32px -4px rgba(0, 0, 0, 0.75), 0 4px 12px rgba(0, 0, 0, 0.4)'
          }}
          className="absolute left-0 right-0 top-full z-50 mt-1.5 max-h-[300px] overflow-y-auto rounded-xl border p-1.5 backdrop-blur-md"
        >
          {THEME_LIST.map((th) => {
            const isSelected = th.id === currentThemeId;
            const isHovered = hoveredId === th.id;
            const isActiveState = isSelected || isHovered;

            return (
              <button
                key={th.id}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => handleSelect(th.id)}
                onMouseEnter={() => setHoveredId(th.id)}
                onMouseLeave={() => setHoveredId(null)}
                style={{
                  backgroundColor: isActiveState
                    ? `color-mix(in srgb, ${th.accent} 14%, transparent)`
                    : 'transparent',
                  borderColor: isActiveState ? th.accent : 'transparent'
                }}
                className="flex w-full items-center justify-between gap-3 rounded-lg border px-2.5 py-2 text-left transition-all duration-150"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <MiniPalette theme={th} />
                  <div className="min-w-0">
                    <div
                      className="truncate font-semibold text-xs leading-snug"
                      style={{ color: th.accent }}
                    >
                      {th.name}
                    </div>
                    <div
                      className="truncate text-xs leading-tight opacity-85"
                      style={{ color: th.textSecondary }}
                    >
                      {th.tagline}
                    </div>
                  </div>
                </div>

                {isSelected ? (
                  <Check className="h-4 w-4 shrink-0 stroke-[2.5]" style={{ color: th.accent }} />
                ) : (
                  <div className="w-4 shrink-0" />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
