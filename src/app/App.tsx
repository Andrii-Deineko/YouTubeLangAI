import { useEffect, useMemo, useState, type ReactElement } from 'react';
import {
  BookOpen,
  GraduationCap,
  Maximize2,
  Settings as SettingsIcon,
  Sparkles
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
      className={`bg-slate-950 text-slate-100 ${
        isFullscreen
          ? 'min-h-screen w-full px-6 py-8'
          : 'min-h-[560px] w-[460px] p-4'
      }`}
    >
      <div className={isFullscreen ? 'mx-auto max-w-3xl' : 'w-full'}>
        {/* Header */}
        <header className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 shadow-lg shadow-indigo-500/20">
              <Sparkles className="h-4 w-4 text-white" />
            </div>
            <div>
              <h1 className="text-sm font-bold tracking-tight text-white">
                YouTube Lang AI
              </h1>
              <p className="text-[11px] text-slate-400">
                {cards.length} words · {dueCount} due for review
              </p>
            </div>
          </div>

          {!isFullscreen && (
            <button
              type="button"
              title="Open fullscreen trainer"
              onClick={openFullscreenTrainer}
              className="flex items-center gap-1 rounded-xl border border-white/10 bg-slate-900 px-2.5 py-1.5 text-[11px] font-medium text-slate-300 transition hover:bg-slate-800 hover:text-white"
            >
              <Maximize2 className="h-3.5 w-3.5" />
              <span>Fullscreen</span>
            </button>
          )}
        </header>

        {/* Navigation Tabs */}
        <nav className="mb-4 grid grid-cols-3 gap-1.5 rounded-xl border border-white/10 bg-slate-900/70 p-1">
          <button
            type="button"
            onClick={() => setActiveTab('trainer')}
            className={`flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold transition ${
              activeTab === 'trainer'
                ? 'bg-indigo-600 text-white shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <GraduationCap className="h-3.5 w-3.5" />
            <span>Trainer</span>
            {dueCount > 0 && (
              <span className="rounded-full bg-white/20 px-1.5 py-0.2 text-[10px]">
                {dueCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('vocabulary')}
            className={`flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold transition ${
              activeTab === 'vocabulary'
                ? 'bg-indigo-600 text-white shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <BookOpen className="h-3.5 w-3.5" />
            <span>Vocabulary</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('settings')}
            className={`flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold transition ${
              activeTab === 'settings'
                ? 'bg-indigo-600 text-white shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <SettingsIcon className="h-3.5 w-3.5" />
            <span>Settings</span>
          </button>
        </nav>

        {/* Tab Content */}
        {!loaded ? (
          <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-8 text-center text-xs text-slate-400">
            Loading workspace...
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
