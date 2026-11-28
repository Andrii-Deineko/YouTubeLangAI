import { useEffect, useMemo, useState, type ReactElement } from 'react';
import {
  BookOpen,
  GraduationCap,
  Maximize2,
  Settings as SettingsIcon,
  Sparkles
} from 'lucide-react';
import {
  DEFAULT_SETTINGS,
  type ServiceDescriptor,
  type UserSettings,
  type VocabularyCard
} from '@langai/contracts';
import {
  deleteVocabularyCard,
  getDueCards,
  getSettings,
  getVocabulary,
  onSettingsChanged,
  onVocabularyChanged,
  saveSettings,
  saveVocabularyCard
} from '@langai/storage';
import { getUiStrings } from '../i18n/translations';
import { FlashcardTrainer } from './FlashcardTrainer';
import { MarqueeText } from './MarqueeText';
import { SettingsPanel } from './SettingsPanel';
import { VocabularyList } from './VocabularyList';

export type AppTab = 'trainer' | 'vocabulary' | 'settings';

export interface PopupAppProps {
  services?: readonly ServiceDescriptor[];
  fullscreenUrl?: string;
}

function getInitialTabFromUrl(): AppTab {
  if (typeof window === 'undefined') return 'trainer';
  const tab = new URLSearchParams(window.location.search).get('tab');
  if (tab === 'settings' || tab === 'vocabulary' || tab === 'trainer') {
    return tab;
  }
  return 'trainer';
}

export function PopupApp({ services = [], fullscreenUrl }: PopupAppProps): ReactElement {
  const [activeTab, setActiveTab] = useState<AppTab>(getInitialTabFromUrl);
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [cards, setCards] = useState<VocabularyCard[]>([]);
  const [loaded, setLoaded] = useState(false);

  const isFullscreen = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).get('mode') === 'full';
  }, []);

  const popupScale = settings.popupScale ?? 1;
  const effectiveRem = Math.round(16 * popupScale * 10) / 10;
  const targetWidth = Math.round(Math.max(400, Math.min(720, effectiveRem * 28.75)));
  const targetHeight = Math.round(Math.max(420, Math.min(540, effectiveRem * 29.5)));

  const [popupSize, setPopupSize] = useState<{ width: number; height: number }>({
    width: targetWidth,
    height: targetHeight
  });

  useEffect(() => {
    if (typeof document === 'undefined' || typeof window === 'undefined') return;

    document.documentElement.style.fontSize = `${effectiveRem}px`;

    if (isFullscreen) {
      document.documentElement.style.width = '';
      document.documentElement.style.height = '';
      document.documentElement.style.overflow = '';
      document.body.style.width = '';
      document.body.style.height = '';
      document.body.style.overflow = '';
      const rootEl = document.getElementById('root');
      if (rootEl) {
        rootEl.style.width = '';
        rootEl.style.height = '';
        rootEl.style.overflow = '';
      }
      return;
    }

    const applyPopupSize = (w: number, h: number): void => {
      document.documentElement.style.width = `${w}px`;
      document.documentElement.style.height = `${h}px`;
      document.documentElement.style.overflow = 'hidden';
      document.body.style.width = `${w}px`;
      document.body.style.height = `${h}px`;
      document.body.style.overflow = 'hidden';
      const rootEl = document.getElementById('root');
      if (rootEl) {
        rootEl.style.width = `${w}px`;
        rootEl.style.height = `${h}px`;
        rootEl.style.overflow = 'hidden';
      }
    };

    applyPopupSize(targetWidth, targetHeight);
    setPopupSize((prev) =>
      prev.width !== targetWidth || prev.height !== targetHeight
        ? { width: targetWidth, height: targetHeight }
        : prev
    );

    const syncToViewport = (): void => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const clampedW = vw >= 300 ? Math.min(targetWidth, vw) : targetWidth;
      const clampedH = vh >= 200 ? Math.min(targetHeight, vh) : targetHeight;
      applyPopupSize(clampedW, clampedH);
      setPopupSize((prev) =>
        prev.width !== clampedW || prev.height !== clampedH
          ? { width: clampedW, height: clampedH }
          : prev
      );
    };

    const rafId = window.requestAnimationFrame(() => {
      syncToViewport();
      window.setTimeout(syncToViewport, 80);
    });
    window.addEventListener('resize', syncToViewport);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('resize', syncToViewport);
    };
  }, [effectiveRem, isFullscreen, targetHeight, targetWidth]);

  useEffect(() => {
    let mounted = true;
    void Promise.all([getSettings(), getVocabulary()]).then(
      ([loadedSettings, loadedCards]) => {
        if (!mounted) return;
        setSettings(loadedSettings);
        setCards(loadedCards);
        setLoaded(true);
      }
    );

    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      void chrome.storage.local
        .get('cinelingua_pending_popup_tab')
        .then((res) => {
          if (!mounted) return;
          const pending = res?.cinelingua_pending_popup_tab as
            | { tab?: AppTab; ts?: number }
            | undefined;
          if (pending?.tab) {
            void chrome.storage.local.remove('cinelingua_pending_popup_tab');
            const isFresh = typeof pending.ts === 'number' && Date.now() - pending.ts < 15000;
            if (
              isFresh &&
              (pending.tab === 'settings' ||
                pending.tab === 'vocabulary' ||
                pending.tab === 'trainer')
            ) {
              setActiveTab(pending.tab);
            }
          }
        })
        .catch(() => undefined);
    }

    const unsubSettings = onSettingsChanged((next) => setSettings(next));
    const unsubVocab = onVocabularyChanged((next) => setCards(next));

    return () => {
      mounted = false;
      unsubSettings();
      unsubVocab();
    };
  }, []);

  const t = getUiStrings(settings.uiLanguage);

  const dueCount = useMemo(() => getDueCards(cards).length, [cards]);

  const handleUpdateSettings = async (partial: Partial<UserSettings>): Promise<void> => {
    const next = await saveSettings(partial);
    setSettings(next);
  };

  const handleUpdateCard = async (updated: VocabularyCard): Promise<void> => {
    await saveVocabularyCard(updated);
    setCards((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
  };

  const handleDeleteCard = async (cardId: string): Promise<void> => {
    await deleteVocabularyCard(cardId);
    setCards((prev) => prev.filter((c) => c.id !== cardId));
  };

  const openFullscreenTrainer = (): void => {
    let targetUrl = fullscreenUrl;
    if (!targetUrl && typeof window !== 'undefined') {
      const current = new URL(window.location.href);
      current.searchParams.set('mode', 'full');
      targetUrl = current.toString();
    }
    if (!targetUrl) return;

    if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
      void chrome.tabs.create({ url: targetUrl });
    } else {
      window.open(targetUrl, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <div
      data-theme={settings.theme || 'midnight-glass'}
      style={{
        backgroundColor: 'rgb(var(--ytai-bg-rgb))',
        color: 'var(--ytai-text-primary)',
        ...(!isFullscreen
          ? { width: `${popupSize.width}px`, height: `${popupSize.height}px` }
          : {})
      }}
      className={`transition-colors duration-200 ${
        isFullscreen
          ? 'min-h-screen w-full px-6 py-8'
          : 'flex flex-col overflow-hidden p-3'
      }`}
    >
      <div
        className={
          isFullscreen
            ? 'mx-auto flex w-full max-w-3xl flex-col rounded-2xl border p-5 shadow-2xl'
            : 'flex min-h-0 flex-1 flex-col overflow-hidden'
        }
        style={
          isFullscreen
            ? {
                backgroundColor: 'rgb(var(--ytai-bg-rgb))',
                borderColor: 'var(--ytai-border)'
              }
            : undefined
        }
      >
        {/* Header */}
        <header className="mb-2.5 flex shrink-0 items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <div
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl shadow-lg transition-colors"
              style={{
                backgroundColor: 'var(--ytai-accent)',
                boxShadow: '0 4px 14px rgba(var(--ytai-accent-rgb), 0.35)'
              }}
            >
              <Sparkles
                className="h-4 w-4"
                style={{ color: 'var(--ytai-accent-fg, #ffffff)' }}
              />
            </div>
            <div className="min-w-0">
              <h1
                className="truncate text-sm font-bold tracking-tight"
                style={{ color: 'var(--ytai-text-primary)' }}
              >
                {t.appTitle}
              </h1>
              <p
                className="truncate text-[0.6875rem]"
                style={{ color: 'var(--ytai-text-secondary)' }}
              >
                {t.wordsDue(cards.length, dueCount)}
              </p>
            </div>
          </div>

          {!isFullscreen && (
            <button
              type="button"
              title={t.openFullscreenTrainer}
              onClick={openFullscreenTrainer}
              style={{
                backgroundColor: 'var(--ytai-surface)',
                borderColor: 'var(--ytai-border)',
                color: 'var(--ytai-text-secondary)'
              }}
              className="ytai-marquee-btn flex max-w-[9rem] shrink-0 items-center gap-1 rounded-xl border px-2.5 py-1.5 text-[0.6875rem] font-medium transition hover:opacity-85"
            >
              <Maximize2 className="h-3.5 w-3.5 shrink-0" />
              <MarqueeText>{t.fullscreen}</MarqueeText>
            </button>
          )}
        </header>

        {/* Navigation Tabs */}
        <nav
          className="mb-2.5 flex shrink-0 items-center gap-1 rounded-xl border p-1"
          style={{
            backgroundColor: 'var(--ytai-surface)',
            borderColor: 'var(--ytai-border)'
          }}
        >
          <button
            type="button"
            title={t.tabTrainer}
            onClick={() => setActiveTab('trainer')}
            style={
              activeTab === 'trainer'
                ? {
                    backgroundColor: 'var(--ytai-accent)',
                    color: 'var(--ytai-accent-fg, #ffffff)'
                  }
                : {
                    color: 'var(--ytai-text-muted, var(--ytai-text-secondary))'
                  }
            }
            className={`ytai-marquee-btn flex min-w-0 flex-auto items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${
              activeTab === 'trainer'
                ? 'shadow-sm hover:opacity-90'
                : 'hover:bg-[rgba(var(--ytai-accent-rgb),0.14)]'
            }`}
          >
            <GraduationCap className="h-3.5 w-3.5 shrink-0" />
            <MarqueeText>{t.tabTrainer}</MarqueeText>
            {dueCount > 0 && (
              <span
                className="shrink-0 rounded-full px-1.5 py-0.5 text-[0.625rem] leading-none"
                style={{
                  backgroundColor:
                    activeTab === 'trainer'
                      ? 'rgba(0, 0, 0, 0.2)'
                      : 'rgba(var(--ytai-accent-rgb), 0.2)'
                }}
              >
                {dueCount}
              </span>
            )}
          </button>

          <button
            type="button"
            title={t.tabVocabulary}
            onClick={() => setActiveTab('vocabulary')}
            style={
              activeTab === 'vocabulary'
                ? {
                    backgroundColor: 'var(--ytai-accent)',
                    color: 'var(--ytai-accent-fg, #ffffff)'
                  }
                : {
                    color: 'var(--ytai-text-muted, var(--ytai-text-secondary))'
                  }
            }
            className={`ytai-marquee-btn flex min-w-0 flex-auto items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${
              activeTab === 'vocabulary'
                ? 'shadow-sm hover:opacity-90'
                : 'hover:bg-[rgba(var(--ytai-accent-rgb),0.14)]'
            }`}
          >
            <BookOpen className="h-3.5 w-3.5 shrink-0" />
            <MarqueeText>{t.tabVocabulary}</MarqueeText>
          </button>

          <button
            type="button"
            title={t.tabSettings}
            onClick={() => setActiveTab('settings')}
            style={
              activeTab === 'settings'
                ? {
                    backgroundColor: 'var(--ytai-accent)',
                    color: 'var(--ytai-accent-fg, #ffffff)'
                  }
                : {
                    color: 'var(--ytai-text-muted, var(--ytai-text-secondary))'
                  }
            }
            className={`ytai-marquee-btn flex min-w-0 flex-auto items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${
              activeTab === 'settings'
                ? 'shadow-sm hover:opacity-90'
                : 'hover:bg-[rgba(var(--ytai-accent-rgb),0.14)]'
            }`}
          >
            <SettingsIcon className="h-3.5 w-3.5 shrink-0" />
            <MarqueeText>{t.tabSettings}</MarqueeText>
          </button>
        </nav>

        {/* Tab Content */}
        <div className={isFullscreen ? 'w-full' : 'flex min-h-0 flex-1 flex-col overflow-hidden'}>
          {!loaded ? (
            <div
              className="rounded-2xl border p-8 text-center text-xs"
              style={{
                backgroundColor: 'var(--ytai-surface)',
                borderColor: 'var(--ytai-border)',
                color: 'var(--ytai-text-muted, var(--ytai-text-secondary))'
              }}
            >
              {t.loadingWorkspace}
            </div>
          ) : activeTab === 'trainer' ? (
            <div className={isFullscreen ? '' : 'min-h-0 flex-1 overflow-y-auto pr-0.5'}>
              <FlashcardTrainer
                cards={cards}
                uiLanguage={settings.uiLanguage}
                onUpdateCard={handleUpdateCard}
              />
            </div>
          ) : activeTab === 'vocabulary' ? (
            <VocabularyList
              cards={cards}
              settings={settings}
              onDeleteCard={handleDeleteCard}
            />
          ) : (
            <SettingsPanel
              settings={settings}
              services={services}
              onUpdateSettings={handleUpdateSettings}
            />
          )}
        </div>
      </div>
    </div>
  );
}

export { PopupApp as App };
