import type { CSSProperties, ReactElement } from 'react';
import { Lock, Minus, Plus, RotateCcw } from 'lucide-react';
import {
  DEFAULT_SUBTITLE_BOX_SIZE,
  type FontFamily,
  type UserSettings
} from '@langai/contracts';
import { getUiStrings } from '../../i18n/translations';
import {
  FONT_FAMILY_OPTIONS,
  FONT_FAMILY_STACKS,
  THEMES,
  THEME_LIST
} from '../../styles/themes';
import { MarqueeText } from '../MarqueeText';
import { ToggleSwitch } from '../ToggleSwitch';
import {
  activePillStyle,
  innerCardStyle,
  mutedTextStyle,
  primaryTextStyle,
  sectionCardStyle,
  segmentedTrackStyle
} from './styles';

export interface StyleTabProps {
  settings: UserSettings;
  onUpdateSettings: (partial: Partial<UserSettings>) => Promise<void>;
}

export function StyleTab({ settings, onUpdateSettings }: StyleTabProps): ReactElement {
  const t = getUiStrings(settings.uiLanguage);
  const currentTheme = THEMES[settings.theme] || THEMES['midnight-glass'];
  const currentFontSize = settings.subtitleFontSize ?? 20;
  const currentTransFontSize =
    settings.translationFontSize ??
    Math.max(12, Math.min(48, Math.round(currentFontSize * (settings.translationScale ?? 0.85))));
  const currentBackdropOpacity = settings.backdropOpacity ?? 80;
  const currentFontFamily = settings.fontFamily ?? 'sans';
  const currentFontWeight = settings.fontWeight ?? 'normal';
  const currentTextOutline = settings.textOutline ?? 'shadow';

  const previewOutlineStyle: CSSProperties =
    currentTextOutline === 'none'
      ? { textShadow: 'none', WebkitTextStroke: '0px transparent' }
      : currentTextOutline === 'outline'
        ? {
            textShadow: '0 1px 4px rgba(0,0,0,0.95)',
            WebkitTextStroke: '1px #000000',
            paintOrder: 'stroke fill'
          }
        : {
            textShadow: currentTheme.textShadow
          };

  return (
    <>
      {/* Live Preview Screen */}
      <div
        className="relative flex flex-col items-center justify-center overflow-hidden rounded-2xl border px-3 py-4"
        style={{
          borderColor: 'var(--ytai-border)',
          minHeight: '5.75rem',
          background:
            'radial-gradient(circle at 22% 28%, rgba(var(--ytai-accent-rgb), 0.16), transparent 52%), linear-gradient(180deg, #11131a 0%, #090a0e 100%)'
        }}
      >
        <span className="absolute left-2.5 top-2 font-mono text-[0.5625rem] uppercase tracking-wider text-white/55">
          {t.livePreviewLabel}
        </span>
        <span
          className="absolute right-2.5 top-2 rounded-full border px-1.5 py-0.5 font-mono text-[0.5625rem]"
          style={{
            backgroundColor: 'var(--ytai-control-bg)',
            borderColor: 'var(--ytai-border)',
            color: currentTheme.accent
          }}
        >
          {currentTheme.name}
        </span>
        <div
          className="mt-3 max-w-[96%] rounded-xl border px-3 py-1.5 text-center transition-all"
          style={{
            backgroundColor: `rgba(${currentTheme.bgRgb}, ${(currentBackdropOpacity / 100).toFixed(2)})`,
            borderColor: currentBackdropOpacity > 8 ? currentTheme.border : 'transparent',
            backdropFilter:
              currentBackdropOpacity > 8 ? `blur(${currentTheme.backdropBlur})` : 'none',
            WebkitBackdropFilter:
              currentBackdropOpacity > 8 ? `blur(${currentTheme.backdropBlur})` : 'none',
            fontFamily: FONT_FAMILY_STACKS[currentFontFamily],
            fontWeight: currentFontWeight === 'bold' ? 700 : 500
          }}
        >
          <div
            className="leading-snug"
            style={{
              color: currentTheme.textPrimary,
              fontSize: `${Math.min(22, Math.max(11, Math.round(currentFontSize * 0.72)))}px`,
              ...previewOutlineStyle
            }}
          >
            {currentTheme.previewOriginal}
          </div>
          <div
            className="mt-0.5 leading-snug opacity-95"
            style={{
              color: currentTheme.textSecondary,
              fontSize: `${Math.min(18, Math.max(10, Math.round(currentTransFontSize * 0.72)))}px`,
              ...previewOutlineStyle
            }}
          >
            {currentTheme.previewTranslation}
          </div>
        </div>
      </div>

      {/* Color Theme 2x3 Visual Swatch Grid */}
      <section className="space-y-2 rounded-2xl border p-3" style={sectionCardStyle}>
        <div
          className="text-[0.6875rem] font-semibold uppercase tracking-wider"
          style={mutedTextStyle}
        >
          {t.colorTheme}
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {THEME_LIST.map((meta) => {
            const active = (settings.theme || 'midnight-glass') === meta.id;
            return (
              <button
                key={meta.id}
                type="button"
                title={meta.tagline}
                onClick={() => void onUpdateSettings({ theme: meta.id })}
                className="ytai-marquee-btn flex min-w-0 items-center gap-1.5 rounded-xl border px-2 py-1.5 text-left transition cursor-pointer hover:opacity-90"
                style={{
                  backgroundColor: `rgb(${meta.bgRgb})`,
                  borderColor: active ? 'var(--ytai-accent)' : meta.border,
                  boxShadow: active ? '0 0 0 1px var(--ytai-accent)' : 'none'
                }}
              >
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: meta.accent }}
                />
                <MarqueeText className="text-[0.625rem] font-semibold">
                  <span style={{ color: meta.textPrimary }}>{meta.name}</span>
                </MarqueeText>
              </button>
            );
          })}
        </div>
      </section>

      {/* Independent Track Sizes (px) */}
      <section className="space-y-2 rounded-2xl border p-3" style={sectionCardStyle}>
        <div
          className="text-[0.6875rem] font-semibold uppercase tracking-wider"
          style={mutedTextStyle}
        >
          {t.trackSizesTitle}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div
            className="flex items-center justify-between gap-1 rounded-xl border px-2 py-1.5"
            style={innerCardStyle}
          >
            <span className="truncate text-[0.6875rem] font-medium" style={primaryTextStyle}>
              {t.primaryTrackTitle}
            </span>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                disabled={currentFontSize <= 12}
                onClick={() => {
                  const next = Math.max(12, currentFontSize - 2);
                  void onUpdateSettings({ subtitleFontSize: next });
                }}
                className="ytai-control-btn flex h-6 w-6 items-center justify-center rounded-lg transition disabled:opacity-30 cursor-pointer"
              >
                <Minus className="h-3 w-3" />
              </button>
              <button
                type="button"
                title={t.resetTo20px}
                onClick={() => void onUpdateSettings({ subtitleFontSize: 20 })}
                className="w-7 text-center font-mono text-[0.6875rem] font-bold cursor-pointer hover:opacity-80"
                style={{ color: 'var(--ytai-accent)' }}
              >
                {currentFontSize}
              </button>
              <button
                type="button"
                disabled={currentFontSize >= 56}
                onClick={() => {
                  const next = Math.min(56, currentFontSize + 2);
                  void onUpdateSettings({ subtitleFontSize: next });
                }}
                className="ytai-control-btn flex h-6 w-6 items-center justify-center rounded-lg transition disabled:opacity-30 cursor-pointer"
              >
                <Plus className="h-3 w-3" />
              </button>
            </div>
          </div>

          <div
            className="flex items-center justify-between gap-1 rounded-xl border px-2 py-1.5"
            style={innerCardStyle}
          >
            <span className="truncate text-[0.6875rem] font-medium" style={mutedTextStyle}>
              {t.transTrackTitle}
            </span>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                disabled={currentTransFontSize <= 12}
                onClick={() => {
                  const next = Math.max(12, currentTransFontSize - 2);
                  void onUpdateSettings({ translationFontSize: next });
                }}
                className="ytai-control-btn flex h-6 w-6 items-center justify-center rounded-lg transition disabled:opacity-30 cursor-pointer"
              >
                <Minus className="h-3 w-3" />
              </button>
              <button
                type="button"
                title={t.resetTo17px}
                onClick={() => void onUpdateSettings({ translationFontSize: 17 })}
                className="w-7 text-center font-mono text-[0.6875rem] font-bold cursor-pointer hover:opacity-80"
                style={{ color: 'var(--ytai-accent)' }}
              >
                {currentTransFontSize}
              </button>
              <button
                type="button"
                disabled={currentTransFontSize >= 48}
                onClick={() => {
                  const next = Math.min(48, currentTransFontSize + 2);
                  void onUpdateSettings({ translationFontSize: next });
                }}
                className="ytai-control-btn flex h-6 w-6 items-center justify-center rounded-lg transition disabled:opacity-30 cursor-pointer"
              >
                <Plus className="h-3 w-3" />
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Typography & Backdrop */}
      <section className="space-y-2.5 rounded-2xl border p-3" style={sectionCardStyle}>
        <div
          className="text-[0.6875rem] font-semibold uppercase tracking-wider"
          style={mutedTextStyle}
        >
          {t.typographyTitle}
        </div>

        <div className="grid grid-cols-[1.35fr_0.95fr] gap-2">
          <div>
            <div className="mb-1 text-[0.625rem] font-medium" style={mutedTextStyle}>
              {t.fontFamilyTitle}
            </div>
            <select
              value={currentFontFamily}
              onChange={(e) => void onUpdateSettings({ fontFamily: e.target.value as FontFamily })}
              style={{
                backgroundColor: 'rgb(var(--ytai-bg-rgb))',
                borderColor: 'var(--ytai-border)',
                color: 'var(--ytai-text-primary)',
                fontFamily: FONT_FAMILY_STACKS[currentFontFamily]
              }}
              className="h-[1.875rem] w-full rounded-xl border px-2 text-[0.6875rem] font-medium focus:outline-none cursor-pointer"
            >
              {FONT_FAMILY_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id} style={{ fontFamily: opt.stack }}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <div className="mb-1 text-[0.625rem] font-medium" style={mutedTextStyle}>
              {t.fontWeightTitle}
            </div>
            <div
              className="grid grid-cols-2 gap-1 rounded-xl border p-0.5"
              style={segmentedTrackStyle}
            >
              {(
                [
                  { id: 'normal' as const, label: t.weightNormal },
                  { id: 'bold' as const, label: t.weightBold }
                ] as const
              ).map((opt) => {
                const active = currentFontWeight === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => void onUpdateSettings({ fontWeight: opt.id })}
                    style={active ? activePillStyle : mutedTextStyle}
                    className={`rounded-lg py-1 text-[0.6875rem] transition cursor-pointer ${
                      opt.id === 'bold' ? 'font-bold' : ''
                    } ${
                      active
                        ? 'font-semibold shadow-sm'
                        : 'hover:bg-[rgba(var(--ytai-accent-rgb),0.14)]'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <div className="mb-1 text-[0.625rem] font-medium" style={mutedTextStyle}>
              {t.outlineTitle}
            </div>
            <div
              className="grid grid-cols-3 gap-1 rounded-xl border p-0.5"
              style={segmentedTrackStyle}
            >
              {(
                [
                  { id: 'none' as const, label: t.outlineNone },
                  { id: 'shadow' as const, label: t.outlineShadow },
                  { id: 'outline' as const, label: t.outlineStroke }
                ] as const
              ).map((opt) => {
                const active = currentTextOutline === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => void onUpdateSettings({ textOutline: opt.id })}
                    style={active ? activePillStyle : mutedTextStyle}
                    className={`rounded-lg py-1 text-[0.625rem] transition cursor-pointer ${
                      active
                        ? 'font-semibold shadow-sm'
                        : 'hover:bg-[rgba(var(--ytai-accent-rgb),0.14)]'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <div
              className="mb-1 flex items-center justify-between text-[0.625rem] font-medium"
              style={mutedTextStyle}
            >
              <span>{t.backdropTitle}</span>
              <span className="font-mono font-bold" style={{ color: 'var(--ytai-accent)' }}>
                {currentBackdropOpacity}%
              </span>
            </div>
            <div className="flex h-7 items-center">
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={currentBackdropOpacity}
                onChange={(e) => {
                  const val = Number.parseInt(e.target.value, 10);
                  void onUpdateSettings({ backdropOpacity: val });
                }}
                className="ytai-range w-full cursor-pointer"
              />
            </div>
          </div>
        </div>

        <div
          className="space-y-2 border-t pt-2.5"
          style={{ borderColor: 'var(--ytai-border)' }}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[0.6875rem] font-medium" style={mutedTextStyle}>
              {t.controlsScaleTitle}
            </span>
            <div
              className="grid shrink-0 grid-cols-4 gap-1 rounded-xl border p-0.5"
              style={segmentedTrackStyle}
            >
              {(
                [
                  { id: 'sm' as const, label: 'S' },
                  { id: 'md' as const, label: 'M' },
                  { id: 'lg' as const, label: 'L' },
                  { id: 'xl' as const, label: 'XL' }
                ] as const
              ).map((item) => {
                const active = (settings.controlsScale || 'md') === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => void onUpdateSettings({ controlsScale: item.id })}
                    style={active ? activePillStyle : mutedTextStyle}
                    className={`rounded-lg px-2 py-0.5 text-[0.6875rem] transition cursor-pointer ${
                      active ? 'font-bold shadow-sm' : 'hover:bg-[rgba(var(--ytai-accent-rgb),0.14)]'
                    }`}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div
            className="flex items-center justify-between rounded-xl border px-2.5 py-1.5"
            style={innerCardStyle}
          >
            <div className="flex items-center gap-1.5">
              <Lock
                className="h-3.5 w-3.5 shrink-0"
                style={{
                  color: settings.subtitleBoxFixed
                    ? 'var(--ytai-accent)'
                    : 'var(--ytai-text-muted, var(--ytai-text-secondary))'
                }}
              />
              <span className="font-medium" style={primaryTextStyle}>
                {t.staticBoxTitle}
              </span>
            </div>
            <ToggleSwitch
              checked={Boolean(settings.subtitleBoxFixed)}
              onChange={(next) =>
                void onUpdateSettings({
                  subtitleBoxFixed: next,
                  ...(next ? {} : { subtitleBoxCompact: false }),
                  ...(next && !settings.subtitleBoxSize
                    ? { subtitleBoxSize: DEFAULT_SUBTITLE_BOX_SIZE }
                    : {})
                })
              }
            />
          </div>

          <div className="flex items-center justify-between gap-2 pt-0.5">
            <button
              type="button"
              onClick={() =>
                void onUpdateSettings({
                  subtitlePosition: null,
                  subtitleBoxFixed: false,
                  subtitleBoxSize: null,
                  subtitleBoxCompact: false
                })
              }
              style={{ borderColor: 'var(--ytai-border)' }}
              className="ytai-control-btn flex flex-1 items-center justify-center gap-1 rounded-xl border px-2.5 py-1.5 text-[0.6875rem] font-medium transition cursor-pointer"
            >
              <RotateCcw className="h-3 w-3" />
              <span>{t.resetSizeBtn}</span>
            </button>
            <button
              type="button"
              onClick={() =>
                void onUpdateSettings({
                  subtitleFontSize: 20,
                  translationFontSize: 17,
                  translationScale: 0.85,
                  fontFamily: 'sans',
                  fontWeight: 'normal',
                  textOutline: 'shadow',
                  backdropOpacity: 80,
                  controlsScale: 'md'
                })
              }
              style={{ borderColor: 'var(--ytai-border)' }}
              className="ytai-control-btn flex flex-1 items-center justify-center gap-1 rounded-xl border px-2.5 py-1.5 text-[0.6875rem] font-medium transition cursor-pointer"
            >
              <RotateCcw className="h-3 w-3" />
              <span>{t.resetStyleBtn}</span>
            </button>
          </div>
        </div>
      </section>
    </>
  );
}
