import { useEffect, useMemo, useState, type ReactElement } from 'react';
import {
  BookOpen,
  GraduationCap,
  Maximize2,
  Settings as SettingsIcon
} from 'lucide-react';
import { getDueCards } from '../shared/srs';
import {
  deleteVocabularyCard,
  getSettings,
  getVocabulary,
  onSettingsChanged,
  onVocabularyChanged,
  saveSettings,
  updateVocabularyCard
} from '../shared/storage';
import { DEFAULT_SETTINGS, type UserSettings } from '../types/settings';
import type { VocabularyCard } from '../types/vocabulary';
import { FlashcardTrainer } from './components/FlashcardTrainer';
import { SettingsPanel } from './components/SettingsPanel';
import { VocabularyList } from './components/VocabularyList';

type AppTab = 'trainer' | 'vocabulary' | 'settings';

export function App(): ReactElement {
  const [activeTab, setActiveTab] = useState<AppTab>('trainer');
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [cards, setCards] = useState<VocabularyCard[]>([]);
  const [loaded, setLoaded] = useState(false);

  const isFullscreen = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).get('mode') === 'full';
  }, []);

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

    const unsubSettings = onSettingsChanged((next) => setSettings(next));
    const unsubVocab = onVocabularyChanged((next) => setCards(next));

    return () => {
      mounted = false;
      unsubSettings();
      unsubVocab();
    };
  }, []);

  const dueCount = useMemo(() => getDueCards(cards).length, [cards]);

  const handleUpdateSettings = async (
    partial: Partial<UserSettings>
  ): Promise<void> => {
    const next = await saveSettings(partial);
    setSettings(next);
  };

  const handleUpdateCard = async (updated: VocabularyCard): Promise<void> => {
    const nextCards = await updateVocabularyCard(updated);
    setCards(nextCards);
  };

  const handleDeleteCard = async (cardId: string): Promise<void> => {
    const nextCards = await deleteVocabularyCard(cardId);
    setCards(nextCards);
  };

  const openFullscreenTrainer = (): void => {
    const url = chrome.runtime.getURL('src/app/index.html?mode=full');
    if (chrome.tabs?.create) {
      void chrome.tabs.create({ url });
    } else {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <div
      data-theme={settings.theme || 'midnight-glass'}
      style={
        {
          '--ytai-bg-opacity': String(settings.overlayOpacity ?? 0.85),
          '--ai-bg-opacity': String(settings.overlayOpacity ?? 0.85),
          backgroundColor: 'rgb(var(--ytai-bg-rgb, var(--ai-bg-rgb, 15, 17, 23)))',
          color: 'var(--ytai-text-primary, var(--ai-text-primary))'
        } as React.CSSProperties
      }
      className={`transition-colors duration-200 ${
        isFullscreen
          ? 'min-h-screen w-full px-6 py-8'
          : 'min-h-[560px] w-[460px] p-4'
      }`}
    >
      <div className={isFullscreen ? 'mx-auto max-w-3xl' : 'w-full'}>
        {/* Header */}
        <header className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <img
              src="/logo.svg"
              alt="CineLingua"
              className="h-8 w-8 rounded-xl shadow-md shrink-0 object-contain"
            />
            <div>
              <h1
                className="text-sm font-bold tracking-tight"
                style={{ color: 'var(--ytai-text-primary, var(--ai-text-primary))' }}
              >
                CineLingua
              </h1>
              <p
                className="text-[11px]"
                style={{ color: 'var(--ytai-text-secondary, var(--ai-text-secondary))' }}
              >
                {cards.length} слов в словаре · {dueCount} к повторению
              </p>
            </div>
          </div>

          {!isFullscreen && (
            <button
              type="button"
              title="Открыть в отдельной вкладке во весь экран"
              onClick={openFullscreenTrainer}
              style={{
                backgroundColor: 'var(--ytai-surface, var(--ai-surface))',
                borderColor: 'var(--ytai-border, var(--ai-border))',
                color: 'var(--ytai-text-secondary, var(--ai-text-secondary))'
              }}
              className="flex items-center gap-1 rounded-xl border px-2.5 py-1.5 text-[11px] font-medium transition hover:text-white"
            >
              <Maximize2 className="h-3.5 w-3.5" />
              <span>Во весь экран</span>
            </button>
          )}
        </header>

        {/* Navigation Tabs */}
        <nav
          className="mb-4 grid grid-cols-3 gap-1.5 rounded-xl border p-1"
          style={{
            backgroundColor: 'var(--ytai-surface, var(--ai-surface))',
            borderColor: 'var(--ytai-border, var(--ai-border))'
          }}
        >
          <button
            type="button"
            onClick={() => setActiveTab('trainer')}
            style={
              activeTab === 'trainer'
                ? {
                    backgroundColor: 'var(--ytai-accent, var(--ai-accent))',
                    color: 'var(--ytai-accent-fg, var(--ai-accent-fg, #ffffff))'
                  }
                : {
                    color: 'var(--ytai-text-secondary, var(--ai-text-secondary))'
                  }
            }
            className="flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold transition hover:text-white shadow-sm"
          >
            <GraduationCap className="h-3.5 w-3.5" />
            <span>Тренажёр</span>
            {dueCount > 0 && (
              <span className="rounded-full bg-white/20 px-1.5 py-0.2 text-[10px]">
                {dueCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('vocabulary')}
            style={
              activeTab === 'vocabulary'
                ? {
                    backgroundColor: 'var(--ytai-accent, var(--ai-accent))',
                    color: 'var(--ytai-accent-fg, var(--ai-accent-fg, #ffffff))'
                  }
                : {
                    color: 'var(--ytai-text-secondary, var(--ai-text-secondary))'
                  }
            }
            className="flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold transition hover:text-white shadow-sm"
          >
            <BookOpen className="h-3.5 w-3.5" />
            <span>Словарь</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('settings')}
            style={
              activeTab === 'settings'
                ? {
                    backgroundColor: 'var(--ytai-accent, var(--ai-accent))',
                    color: 'var(--ytai-accent-fg, var(--ai-accent-fg, #ffffff))'
                  }
                : {
                    color: 'var(--ytai-text-secondary, var(--ai-text-secondary))'
                  }
            }
            className="flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold transition hover:text-white shadow-sm"
          >
            <SettingsIcon className="h-3.5 w-3.5" />
            <span>Настройки</span>
          </button>
        </nav>

        {/* Tab Content */}
        {!loaded ? (
          <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-8 text-center text-xs text-slate-400">
            Загрузка данных...
          </div>
        ) : activeTab === 'trainer' ? (
          <FlashcardTrainer cards={cards} onUpdateCard={handleUpdateCard} />
        ) : activeTab === 'vocabulary' ? (
          <VocabularyList
            cards={cards}
            settings={settings}
            onDeleteCard={handleDeleteCard}
          />
        ) : (
          <SettingsPanel
            settings={settings}
            onUpdateSettings={handleUpdateSettings}
          />
        )}
      </div>
    </div>
  );
}
