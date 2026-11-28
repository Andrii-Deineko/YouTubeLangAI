import { useEffect, useState, type ReactElement } from 'react';
import { Eye, EyeOff, Ghost } from 'lucide-react';
import type { UserSettings } from '@langai/contracts';
import { getUiStrings } from '../../i18n/translations';
import {
  LANGUAGE_OPTIONS,
  SOURCE_LANGUAGE_OPTIONS,
  formatShortLangCode,
  resolveLanguagePair
} from '../../utils/languages';
import { MarqueeText } from '../MarqueeText';
import { ToggleSwitch } from '../ToggleSwitch';
import {
  accentBtnStyle,
  activePillStyle,
  innerCardStyle,
  mutedTextStyle,
  primaryTextStyle,
  sectionCardStyle,
  segmentedTrackStyle
} from './styles';

export interface PlayerTabProps {
  settings: UserSettings;
  onUpdateSettings: (partial: Partial<UserSettings>) => Promise<void>;
}

export function PlayerTab({ settings, onUpdateSettings }: PlayerTabProps): ReactElement {
  const t = getUiStrings(settings.uiLanguage);
  const [showDeepLKey, setShowDeepLKey] = useState(false);
  const [deepLKeyDraft, setDeepLKeyDraft] = useState(settings.deeplApiKey);
  const [myMemoryEmailDraft, setMyMemoryEmailDraft] = useState(settings.myMemoryEmail);

  useEffect(() => {
    setDeepLKeyDraft(settings.deeplApiKey);
  }, [settings.deeplApiKey]);

  useEffect(() => {
    setMyMemoryEmailDraft(settings.myMemoryEmail);
  }, [settings.myMemoryEmail]);

  const currentLangPair = resolveLanguagePair(settings);
  const dualSubtitlesEnabled = settings.subtitleTrackMode !== 'original';

  return (
    <>
      {/* Languages + Translation Provider */}
      <section className="space-y-2.5 rounded-2xl border p-3" style={sectionCardStyle}>
        <div
          className="flex items-center justify-between gap-2 rounded-xl border px-3 py-2"
          style={innerCardStyle}
        >
          <div className="min-w-0">
            <div className="text-[0.625rem] uppercase tracking-wider" style={mutedTextStyle}>
              {t.translationDirection}
            </div>
            <div className="mt-0.5 flex items-center gap-1.5 font-mono text-xs font-bold">
              <span style={{ color: 'var(--ytai-accent)' }}>
                [{formatShortLangCode(currentLangPair.effectiveSource)}]
              </span>
              <span style={primaryTextStyle}>⇄</span>
              <span style={{ color: 'var(--ytai-accent)' }}>
                [{formatShortLangCode(currentLangPair.effectiveTarget)}]
              </span>
              {currentLangPair.isReversed && (
                <span
                  className="rounded px-1.5 py-0.5 text-[0.5625rem] font-semibold"
                  style={activePillStyle}
                >
                  {t.reverseTag}
                </span>
              )}
              {currentLangPair.isSmartSwitched && (
                <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[0.5625rem] font-semibold text-emerald-300">
                  {t.smartSwitchTag}
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            title={t.reverseBtnTitle}
            onClick={() => void onUpdateSettings({ reversePair: !settings.reversePair })}
            style={{
              backgroundColor: 'rgba(var(--ytai-accent-rgb), 0.16)',
              borderColor: 'var(--ytai-accent)',
              color: 'var(--ytai-accent)'
            }}
            className="flex shrink-0 items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-semibold transition hover:opacity-85 cursor-pointer"
          >
            <span>⇄</span>
            <span>{t.reverseBtn}</span>
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="mb-1 block text-[0.6875rem]" style={mutedTextStyle}>
              {t.targetLangLabel}
            </label>
            <select
              value={settings.nativeLang}
              onChange={(e) => void onUpdateSettings({ nativeLang: e.target.value })}
              style={{
                backgroundColor: 'rgb(var(--ytai-bg-rgb))',
                borderColor: 'var(--ytai-border)',
                color: 'var(--ytai-text-primary)'
              }}
              className="w-full rounded-xl border px-2.5 py-1.5 text-xs focus:outline-none"
            >
              {LANGUAGE_OPTIONS.map((opt) => (
                <option key={opt.code} value={opt.code}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-[0.6875rem]" style={mutedTextStyle}>
              {t.sourceLangLabel}
            </label>
            <select
              value={settings.sourceLang || 'auto'}
              onChange={(e) => void onUpdateSettings({ sourceLang: e.target.value })}
              style={{
                backgroundColor: 'rgb(var(--ytai-bg-rgb))',
                borderColor: 'var(--ytai-border)',
                color: 'var(--ytai-text-primary)'
              }}
              className="w-full rounded-xl border px-2.5 py-1.5 text-xs focus:outline-none"
            >
              {SOURCE_LANGUAGE_OPTIONS.map((opt) => (
                <option key={opt.code} value={opt.code}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="mb-1 block text-[0.6875rem]" style={mutedTextStyle}>
            {t.secondaryLangLabel}
          </label>
          <select
            value={settings.secondaryLang || (settings.nativeLang === 'en' ? 'uk' : 'en')}
            onChange={(e) => void onUpdateSettings({ secondaryLang: e.target.value })}
            style={{
              backgroundColor: 'rgb(var(--ytai-bg-rgb))',
              borderColor: 'var(--ytai-border)',
              color: 'var(--ytai-text-primary)'
            }}
            className="w-full rounded-xl border px-2.5 py-1.5 text-xs focus:outline-none"
          >
            {LANGUAGE_OPTIONS.map((opt) => (
              <option key={opt.code} value={opt.code}>
                {opt.label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-[0.625rem] leading-tight" style={mutedTextStyle}>
            {t.secondaryLangHint}
          </p>
        </div>

        {/* Translation Provider */}
        <div
          className="space-y-2 border-t pt-2.5"
          style={{ borderColor: 'var(--ytai-border)' }}
        >
          <div className="text-[0.6875rem] font-medium" style={mutedTextStyle}>
            {t.subtitleTranslationTitle}
          </div>
          <div
            className="grid grid-cols-4 gap-1 rounded-xl border p-0.5"
            style={segmentedTrackStyle}
          >
            {(
              [
                { id: 'googleDict' as const, label: 'Google Dict' },
                { id: 'google' as const, label: 'Google' },
                { id: 'mymemory' as const, label: 'MyMemory' },
                { id: 'deepl' as const, label: 'DeepL' }
              ] as const
            ).map((p) => {
              const active = settings.translationProvider === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => void onUpdateSettings({ translationProvider: p.id })}
                  style={active ? accentBtnStyle : mutedTextStyle}
                  className="ytai-marquee-btn flex min-w-0 items-center justify-center rounded-lg px-1.5 py-1 text-[0.625rem] font-semibold transition cursor-pointer hover:opacity-90"
                >
                  <MarqueeText>{p.label}</MarqueeText>
                </button>
              );
            })}
          </div>

          {settings.translationProvider === 'mymemory' && (
            <input
              type="email"
              value={myMemoryEmailDraft}
              onChange={(event) => setMyMemoryEmailDraft(event.target.value)}
              onBlur={() => {
                if (myMemoryEmailDraft.trim() !== settings.myMemoryEmail) {
                  void onUpdateSettings({ myMemoryEmail: myMemoryEmailDraft.trim() });
                }
              }}
              placeholder={t.myMemoryEmailPlaceholder}
              className="ytai-input w-full rounded-xl border px-3 py-1.5 text-xs transition"
            />
          )}

          {settings.translationProvider === 'deepl' && (
            <div className="relative">
              <input
                type={showDeepLKey ? 'text' : 'password'}
                value={deepLKeyDraft}
                onChange={(event) => setDeepLKeyDraft(event.target.value)}
                onBlur={() => {
                  if (deepLKeyDraft.trim() !== settings.deeplApiKey) {
                    void onUpdateSettings({ deeplApiKey: deepLKeyDraft.trim() });
                  }
                }}
                placeholder={t.deeplKeyPlaceholder}
                className="ytai-input w-full rounded-xl border px-3 py-1.5 pr-9 text-xs transition"
              />
              <button
                type="button"
                onClick={() => setShowDeepLKey((value) => !value)}
                className="ytai-ghost-btn absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 cursor-pointer"
                title={showDeepLKey ? t.hideKey : t.showKey}
              >
                {showDeepLKey ? (
                  <EyeOff className="h-3.5 w-3.5" />
                ) : (
                  <Eye className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
          )}
        </div>
      </section>

      {/* Active Listening & Auto-Pause Timer */}
      <section className="space-y-2.5 rounded-2xl border p-3" style={sectionCardStyle}>
        <div>
          <div className="mb-1.5 text-[0.6875rem] font-medium" style={mutedTextStyle}>
            {t.activeListeningTitle}
          </div>
          <div
            className="grid grid-cols-3 gap-1 rounded-xl border p-1"
            style={segmentedTrackStyle}
          >
            {[
              { id: 'off' as const, label: t.modeNormal, icon: Eye },
              { id: 'blur' as const, label: t.modeBlur, icon: EyeOff },
              { id: 'hidden' as const, label: t.modeStealth, icon: Ghost }
            ].map((mode) => {
              const active = settings.activeListeningMode === mode.id;
              const Icon = mode.icon;
              return (
                <button
                  key={mode.id}
                  type="button"
                  onClick={() => void onUpdateSettings({ activeListeningMode: mode.id })}
                  style={active ? activePillStyle : mutedTextStyle}
                  className={`flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-[0.6875rem] transition cursor-pointer ${
                    active ? 'font-semibold shadow-sm' : 'hover:bg-[rgba(var(--ytai-accent-rgb),0.14)]'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  <span>{mode.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <div
            className="mb-1.5 flex items-center justify-between text-[0.6875rem]"
            style={mutedTextStyle}
          >
            <span>{t.pauseTimerTitle}</span>
            <span className="font-mono font-semibold" style={primaryTextStyle}>
              {!settings.autoPauseAfterCue
                ? t.offLabel
                : settings.pauseTimerSeconds > 0
                  ? `${settings.pauseTimerSeconds}${t.secShort}`
                  : t.pauseManualLabel}
            </span>
          </div>
          <div
            className="grid grid-cols-5 gap-1 rounded-xl border p-1"
            style={segmentedTrackStyle}
          >
            {[
              { id: 'off', label: t.offLabel, autoPause: false, val: 0 },
              { id: 'manual', label: t.pauseManualLabel, autoPause: true, val: 0 },
              { id: '1.5', label: `1.5${t.secShort}`, autoPause: true, val: 1.5 },
              { id: '3', label: `3${t.secShort}`, autoPause: true, val: 3 },
              { id: '5', label: `5${t.secShort}`, autoPause: true, val: 5 }
            ].map((opt) => {
              const active = opt.autoPause
                ? Boolean(settings.autoPauseAfterCue) &&
                  Math.abs((settings.pauseTimerSeconds ?? 0) - opt.val) < 0.05
                : !settings.autoPauseAfterCue;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() =>
                    void onUpdateSettings({
                      autoPauseAfterCue: opt.autoPause,
                      ...(opt.autoPause ? { pauseTimerSeconds: opt.val } : {})
                    })
                  }
                  style={active ? activePillStyle : mutedTextStyle}
                  className={`flex items-center justify-center rounded-lg py-1.5 text-[0.6875rem] transition cursor-pointer ${
                    active ? 'font-semibold shadow-sm' : 'hover:bg-[rgba(var(--ytai-accent-rgb),0.14)]'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* Player Behavior Switches */}
      <section className="space-y-1.5 rounded-2xl border p-3" style={sectionCardStyle}>
        <div
          className="mb-1 text-[0.6875rem] font-semibold uppercase tracking-wider"
          style={mutedTextStyle}
        >
          {t.behaviorTogglesTitle}
        </div>

        <div
          className="flex items-center justify-between gap-2 rounded-xl border px-3 py-2"
          style={innerCardStyle}
        >
          <span className="text-[0.6875rem]" style={primaryTextStyle}>
            {t.toggleOverlay}
          </span>
          <ToggleSwitch
            checked={Boolean(settings.enabled)}
            onChange={(checked) => void onUpdateSettings({ enabled: checked })}
          />
        </div>

        <div
          className="flex items-center justify-between gap-2 rounded-xl border px-3 py-2"
          style={innerCardStyle}
        >
          <span className="text-[0.6875rem]" style={primaryTextStyle}>
            {t.toggleDual}
          </span>
          <ToggleSwitch
            checked={dualSubtitlesEnabled}
            onChange={(checked) =>
              void onUpdateSettings({ subtitleTrackMode: checked ? 'dual' : 'original' })
            }
          />
        </div>

        {(
          [
            { key: 'autoHideControls' as const, label: t.toggleAutoHide },
            { key: 'pauseOnAltHold' as const, label: t.toggleAltHold },
            { key: 'autoPauseOnWordClick' as const, label: t.togglePauseOnWord }
          ] as const
        ).map((item) => (
          <div
            key={item.key}
            className="flex items-center justify-between gap-2 rounded-xl border px-3 py-2"
            style={innerCardStyle}
          >
            <span className="text-[0.6875rem]" style={primaryTextStyle}>
              {item.label}
            </span>
            <ToggleSwitch
              checked={Boolean(settings[item.key])}
              onChange={(checked) => void onUpdateSettings({ [item.key]: checked })}
            />
          </div>
        ))}
      </section>
    </>
  );
}
