import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import {
  CheckCircle2,
  ExternalLink,
  Eye,
  RotateCcw,
  Sparkles,
  Volume2
} from 'lucide-react';
import type { UiLanguage, VocabularyCard } from '@langai/contracts';
import {
  Rating,
  getCardStateLabel,
  getDueCards,
  previewCardGrades,
  reviewCard,
  saveVocabularyCard,
  type Grade,
  type GradePreview
} from '@langai/storage';
import { getUiStrings } from '../i18n/translations';
import { resolveCardSourceUrl } from '../utils/export';
import { speakText } from '../utils/tts';
import { useCardMediaUrl } from './CardThumbnail';
import { MarqueeText } from './MarqueeText';

export interface FlashcardTrainerProps {
  cards: VocabularyCard[];
  uiLanguage?: UiLanguage;
  onUpdateCard?: (updated: VocabularyCard) => Promise<void>;
}

function renderClozeSentence(
  sentence: string,
  targetWord: string,
  revealed: boolean,
  emptySentenceText: string
): ReactElement {
  if (!sentence) {
    return (
      <span
        className="italic"
        style={{ color: 'var(--ytai-text-muted, var(--ytai-text-secondary))' }}
      >
        {emptySentenceText}
      </span>
    );
  }

  const cleanWord = targetWord.trim();
  if (!cleanWord) {
    return <span>{sentence}</span>;
  }

  const escaped = cleanWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escaped})`, 'gi');
  const parts = sentence.split(regex);

  if (parts.length === 1) {
    return (
      <span>
        {sentence}{' '}
        <span
          className="inline-block rounded-md px-2 py-0.5 font-semibold"
          style={{
            backgroundColor: 'rgba(var(--ytai-accent-rgb), 0.2)',
            color: 'var(--ytai-accent)'
          }}
        >
          {revealed ? cleanWord : '[ ... ]'}
        </span>
      </span>
    );
  }

  return (
    <span>
      {parts.map((part, idx) =>
        part.toLowerCase() === cleanWord.toLowerCase() ? (
          <span
            key={idx}
            className="mx-0.5 inline-block rounded-md border px-2 py-0.5 font-semibold transition"
            style={
              revealed
                ? {
                    backgroundColor: 'rgba(16, 185, 129, 0.2)',
                    borderColor: 'rgba(16, 185, 129, 0.4)',
                    color: '#6ee7b7'
                  }
                : {
                    backgroundColor: 'rgba(var(--ytai-accent-rgb), 0.22)',
                    borderColor: 'rgba(var(--ytai-accent-rgb), 0.45)',
                    color: 'var(--ytai-accent)'
                  }
            }
          >
            {revealed ? part : '[ ... ]'}
          </span>
        ) : (
          <span key={idx}>{part}</span>
        )
      )}
    </span>
  );
}

export function FlashcardTrainer({
  cards,
  uiLanguage,
  onUpdateCard
}: FlashcardTrainerProps): ReactElement {
  const t = getUiStrings(uiLanguage);
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const [practiceAllMode, setPracticeAllMode] = useState(false);
  const [practiceQueueIds, setPracticeQueueIds] = useState<string[]>([]);
  const [revealed, setRevealed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [reviewedCount, setReviewedCount] = useState(0);

  const sourceTabs = useMemo(() => {
    const map = new Map<string, string>();
    for (const card of cards) {
      const id = card.source || 'other';
      if (!map.has(id)) {
        map.set(id, card.sourceLabel || id);
      }
    }
    return [
      { id: 'all', label: t.allSources },
      ...Array.from(map.entries()).map(([id, label]) => ({ id, label }))
    ];
  }, [cards, t.allSources]);

  const filteredCards = useMemo(() => {
    if (sourceFilter === 'all') return cards;
    return cards.filter((c) => (c.source || 'other') === sourceFilter);
  }, [cards, sourceFilter]);

  const dueCards = useMemo(() => getDueCards(filteredCards), [filteredCards]);

  const activeCard = useMemo(() => {
    if (!practiceAllMode) {
      return dueCards[0] ?? null;
    }
    const nextId = practiceQueueIds[0];
    return filteredCards.find((c) => c.id === nextId) ?? null;
  }, [filteredCards, dueCards, practiceAllMode, practiceQueueIds]);

  const activeCardMediaUrl = useCardMediaUrl(activeCard);

  const gradePreviews = useMemo(() => {
    if (!activeCard) return [];
    return previewCardGrades(activeCard);
  }, [activeCard]);

  const handleGrade = useCallback(
    async (grade: Grade): Promise<void> => {
      if (!activeCard || submitting) return;
      setSubmitting(true);
      try {
        const updated = reviewCard(activeCard, grade);
        if (onUpdateCard) {
          await onUpdateCard(updated);
        } else {
          await saveVocabularyCard(updated);
        }
        setRevealed(false);
        setReviewedCount((n) => n + 1);
        if (practiceAllMode) {
          setPracticeQueueIds((prev) => prev.slice(1));
        }
      } finally {
        setSubmitting(false);
      }
    },
    [activeCard, onUpdateCard, practiceAllMode, submitting]
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (!activeCard) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }

      if (e.code === 'Space' && !revealed) {
        e.preventDefault();
        setRevealed(true);
        return;
      }

      if (revealed) {
        if (e.key === '1') {
          e.preventDefault();
          void handleGrade(Rating.Again);
        } else if (e.key === '2') {
          e.preventDefault();
          void handleGrade(Rating.Hard);
        } else if (e.key === '3') {
          e.preventDefault();
          void handleGrade(Rating.Good);
        } else if (e.key === '4') {
          e.preventDefault();
          void handleGrade(Rating.Easy);
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeCard, handleGrade, revealed]);

  const startPracticeAll = (): void => {
    setPracticeAllMode(true);
    setPracticeQueueIds(filteredCards.map((c) => c.id));
    setRevealed(false);
  };

  if (cards.length === 0) {
    return (
      <div
        className="flex flex-col items-center justify-center rounded-2xl border p-8 text-center"
        style={{
          backgroundColor: 'var(--ytai-surface)',
          borderColor: 'var(--ytai-border)'
        }}
      >
        <Sparkles className="h-10 w-10" style={{ color: 'var(--ytai-accent)' }} />
        <h2 className="mt-3 text-base font-semibold" style={{ color: 'var(--ytai-text-primary)' }}>
          {t.emptyVocabTitle}
        </h2>
        <p
          className="mt-1 max-w-xs text-xs"
          style={{ color: 'var(--ytai-text-muted, var(--ytai-text-secondary))' }}
        >
          {t.emptyVocabDescPrefix}{' '}
          <span className="font-semibold" style={{ color: 'var(--ytai-text-primary)' }}>
            «{t.emptyVocabSaveBtn}»
          </span>{' '}
          ({t.emptyVocabOrPress}{' '}
          <kbd
            className="rounded border px-1.5 py-0.5 text-[11px]"
            style={{
              backgroundColor: 'var(--ytai-control-bg)',
              borderColor: 'var(--ytai-border)',
              color: 'var(--ytai-text-primary)'
            }}
          >
            S
          </kbd>
          ).
        </p>
      </div>
    );
  }

  const sourceSelector = sourceTabs.length > 2 && (
    <div
      className="flex items-center gap-1 overflow-x-auto rounded-xl border p-1 text-xs"
      style={{
        backgroundColor: 'var(--ytai-surface)',
        borderColor: 'var(--ytai-border)'
      }}
    >
      {sourceTabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          title={tab.label}
          onClick={() => {
            setSourceFilter(tab.id);
            setPracticeAllMode(false);
            setPracticeQueueIds([]);
            setRevealed(false);
          }}
          style={
            sourceFilter === tab.id
              ? {
                  backgroundColor: 'var(--ytai-accent)',
                  color: 'var(--ytai-accent-fg, #ffffff)'
                }
              : { color: 'var(--ytai-text-muted, var(--ytai-text-secondary))' }
          }
          className={`ytai-marquee-btn flex min-w-0 flex-1 items-center justify-center rounded-lg px-2 py-1 text-center font-medium transition ${
            sourceFilter === tab.id
              ? 'shadow'
              : 'hover:bg-[rgba(var(--ytai-accent-rgb),0.14)]'
          }`}
        >
          <MarqueeText>{tab.label}</MarqueeText>
        </button>
      ))}
    </div>
  );

  if (!activeCard) {
    return (
      <div className="space-y-3">
        {sourceSelector}
        <div
          className="flex flex-col items-center justify-center rounded-2xl border p-8 text-center"
          style={{
            backgroundColor: 'var(--ytai-surface)',
            borderColor: 'var(--ytai-border)'
          }}
        >
          <CheckCircle2 className="h-11 w-11 text-emerald-400" />
          <h2 className="mt-3 text-lg font-semibold" style={{ color: 'var(--ytai-text-primary)' }}>
            {t.allCaughtUp}
          </h2>
          <p
            className="mt-1 text-xs"
            style={{ color: 'var(--ytai-text-muted, var(--ytai-text-secondary))' }}
          >
            {reviewedCount > 0 ? t.completedReviews(reviewedCount) : ''}
            {t.savedCardsCount(filteredCards.length)}
          </p>
          {filteredCards.length > 0 && (
            <button
              type="button"
              onClick={startPracticeAll}
              style={{
                backgroundColor: 'var(--ytai-accent)',
                color: 'var(--ytai-accent-fg, #ffffff)'
              }}
              className="mt-4 flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold shadow transition hover:opacity-90"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>{t.practiceAllAnyway}</span>
            </button>
          )}
        </div>
      </div>
    );
  }

  const remainingCount = practiceAllMode ? practiceQueueIds.length : dueCards.length;
  const sourceBadgeLabel = activeCard.sourceLabel || activeCard.source;
  const externalUrl = resolveCardSourceUrl(activeCard);

  const ratingLabelMap: Record<'Again' | 'Hard' | 'Good' | 'Easy', string> = {
    Again: t.ratingAgain,
    Hard: t.ratingHard,
    Good: t.ratingGood,
    Easy: t.ratingEasy
  };

  const buttonStyleByLabel: Record<'Again' | 'Hard' | 'Good' | 'Easy', string> = {
    Again: 'border-rose-500/30 bg-rose-500/15 text-rose-200 hover:bg-rose-500/25',
    Hard: 'border-amber-500/30 bg-amber-500/15 text-amber-200 hover:bg-amber-500/25',
    Good: 'border-emerald-500/30 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25',
    Easy: 'border-sky-500/30 bg-sky-500/15 text-sky-200 hover:bg-sky-500/25'
  };

  return (
    <div className="space-y-3">
      {sourceSelector}

      {/* Progress Bar */}
      <div
        className="flex items-center justify-between text-xs"
        style={{ color: 'var(--ytai-text-muted, var(--ytai-text-secondary))' }}
      >
        <div className="flex items-center gap-2">
          <span
            className="rounded-full px-2 py-0.5 font-medium"
            style={{
              backgroundColor: 'rgba(var(--ytai-accent-rgb), 0.2)',
              color: 'var(--ytai-accent)'
            }}
          >
            {practiceAllMode ? t.freePractice : t.dueQueue}: {remainingCount}
          </span>
          <span
            className="rounded-full border px-2 py-0.5"
            style={{
              backgroundColor: 'var(--ytai-control-bg)',
              borderColor: 'var(--ytai-border)',
              color: 'var(--ytai-text-primary)'
            }}
          >
            {getCardStateLabel(activeCard.fsrsState.state)}
          </span>
        </div>
        {practiceAllMode && (
          <button
            type="button"
            onClick={() => {
              setPracticeAllMode(false);
              setRevealed(false);
            }}
            className="transition hover:opacity-80"
            style={{ color: 'var(--ytai-accent)' }}
          >
            {t.exitFreePractice}
          </button>
        )}
      </div>

      {/* Card Surface */}
      <div
        className="overflow-hidden rounded-2xl border shadow-xl transition-colors"
        style={{
          backgroundColor: 'var(--ytai-surface)',
          borderColor: 'var(--ytai-border)'
        }}
      >
        {activeCardMediaUrl && (
          <div className="relative h-36 w-full overflow-hidden bg-black">
            <img
              src={activeCardMediaUrl}
              alt={activeCard.videoTitle}
              className="h-full w-full object-cover opacity-90"
            />
            <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/90 via-black/50 to-transparent px-3 py-2 text-[11px] text-white/90">
              <div className="flex items-center gap-1.5 truncate pr-2">
                <span
                  className="inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider"
                  style={{
                    backgroundColor: 'rgba(var(--ytai-accent-rgb), 0.24)',
                    borderColor: 'rgba(var(--ytai-accent-rgb), 0.45)',
                    color: 'var(--ytai-accent)'
                  }}
                >
                  {sourceBadgeLabel}
                </span>
                <span className="truncate">{activeCard.sourceTitle || activeCard.videoTitle}</span>
              </div>
              {externalUrl && (
                <a
                  href={externalUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex shrink-0 items-center gap-1 rounded-md bg-white/15 px-2 py-0.5 font-medium text-white hover:bg-white/25"
                >
                  <ExternalLink className="h-3 w-3" />
                  <span>{Math.floor(activeCard.timestampSec)}s</span>
                </a>
              )}
            </div>
          </div>
        )}

        <div className="p-4">
          {!activeCardMediaUrl && (
            <div
              className="mb-2 flex items-center justify-between text-[11px]"
              style={{ color: 'var(--ytai-text-muted, var(--ytai-text-secondary))' }}
            >
              <div className="flex items-center gap-1.5 truncate pr-2">
                <span
                  className="inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider"
                  style={{
                    backgroundColor: 'rgba(var(--ytai-accent-rgb), 0.18)',
                    borderColor: 'rgba(var(--ytai-accent-rgb), 0.4)',
                    color: 'var(--ytai-accent)'
                  }}
                >
                  {sourceBadgeLabel}
                </span>
                <span className="truncate">{activeCard.sourceTitle || activeCard.videoTitle}</span>
              </div>
              {externalUrl && (
                <a
                  href={externalUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex shrink-0 items-center gap-1 transition hover:opacity-80"
                  style={{ color: 'var(--ytai-accent)' }}
                >
                  <ExternalLink className="h-3 w-3" />
                  <span>{Math.floor(activeCard.timestampSec)}s</span>
                </a>
              )}
            </div>
          )}

          {/* Cloze Sentence */}
          <div
            className="rounded-xl border p-3.5 text-sm leading-relaxed"
            style={{
              backgroundColor: 'rgba(var(--ytai-bg-rgb), 0.65)',
              borderColor: 'var(--ytai-border)',
              color: 'var(--ytai-text-primary)'
            }}
          >
            {renderClozeSentence(
              activeCard.contextSentence,
              activeCard.word,
              revealed,
              t.noContextSentence
            )}
          </div>

          {!revealed ? (
            <button
              type="button"
              onClick={() => setRevealed(true)}
              style={{
                backgroundColor: 'var(--ytai-accent)',
                color: 'var(--ytai-accent-fg, #ffffff)'
              }}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold shadow transition hover:opacity-90"
            >
              <Eye className="h-4 w-4" />
              <span>{t.showAnswerSpace}</span>
            </button>
          ) : (
            <div className="mt-4 space-y-3">
              <div
                className="rounded-xl border p-3"
                style={{
                  backgroundColor: 'rgba(var(--ytai-bg-rgb), 0.6)',
                  borderColor: 'var(--ytai-border)'
                }}
              >
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span
                        className="text-lg font-bold"
                        style={{ color: 'var(--ytai-text-primary)' }}
                      >
                        {activeCard.word}
                      </span>
                      <button
                        type="button"
                        title={t.pronounce}
                        onClick={() => speakText(activeCard.word, activeCard.sourceLang)}
                        style={{ color: 'var(--ytai-accent)' }}
                        className="rounded-lg p-1 transition hover:bg-[rgba(var(--ytai-accent-rgb),0.18)]"
                      >
                        <Volume2 className="h-4 w-4" />
                      </button>
                    </div>
                    {activeCard.lemma &&
                      activeCard.lemma.toLowerCase() !== activeCard.word.toLowerCase() && (
                        <div
                          className="text-xs"
                          style={{ color: 'var(--ytai-text-muted, var(--ytai-text-secondary))' }}
                        >
                          {t.lemmaLabel}{' '}
                          <span style={{ color: 'var(--ytai-text-primary)' }}>
                            {activeCard.lemma}
                          </span>
                        </div>
                      )}
                  </div>
                  {activeCard.aiExplanation?.partOfSpeech && (
                    <span
                      className="rounded-md border px-2 py-0.5 text-[11px]"
                      style={{
                        backgroundColor: 'var(--ytai-control-bg)',
                        borderColor: 'var(--ytai-border)',
                        color: 'var(--ytai-text-secondary)'
                      }}
                    >
                      {activeCard.aiExplanation.partOfSpeech}
                    </span>
                  )}
                </div>

                <div
                  className="mt-2 text-base font-semibold"
                  style={{ color: 'var(--ytai-accent)' }}
                >
                  {activeCard.aiExplanation?.contextualTranslation || activeCard.translation}
                </div>

                {activeCard.contextTranslation && (
                  <div
                    className="mt-1 text-xs italic"
                    style={{ color: 'var(--ytai-text-muted, var(--ytai-text-secondary))' }}
                  >
                    {activeCard.contextTranslation}
                  </div>
                )}
              </div>

              {activeCard.aiExplanation && (
                <div
                  className="space-y-1.5 rounded-xl border p-3 text-xs"
                  style={{
                    backgroundColor: 'rgba(var(--ytai-accent-rgb), 0.1)',
                    borderColor: 'rgba(var(--ytai-accent-rgb), 0.25)',
                    color: 'var(--ytai-text-primary)'
                  }}
                >
                  {activeCard.aiExplanation.grammarNote && (
                    <div>
                      <span className="font-semibold" style={{ color: 'var(--ytai-accent)' }}>
                        {t.grammarLabel}{' '}
                      </span>
                      {activeCard.aiExplanation.grammarNote}
                    </div>
                  )}
                  {activeCard.aiExplanation.nuanceExplanation && (
                    <div>
                      <span className="font-semibold" style={{ color: 'var(--ytai-accent)' }}>
                        {t.nuanceLabel}{' '}
                      </span>
                      {activeCard.aiExplanation.nuanceExplanation}
                    </div>
                  )}
                </div>
              )}

              {/* 4 FSRS Rating Buttons */}
              <div className="grid grid-cols-4 gap-2 pt-1">
                {gradePreviews.map((item: GradePreview, idx: number) => (
                  <button
                    key={item.label}
                    type="button"
                    disabled={submitting}
                    onClick={() => void handleGrade(item.grade)}
                    className={`flex flex-col items-center rounded-xl border px-2 py-2 transition disabled:opacity-50 ${
                      buttonStyleByLabel[item.label]
                    }`}
                  >
                    <span className="text-xs font-semibold">{ratingLabelMap[item.label]}</span>
                    <span className="mt-0.5 text-[11px] opacity-80">
                      {item.interval} · [{idx + 1}]
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
