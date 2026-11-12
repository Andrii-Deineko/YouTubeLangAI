import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import {
  CheckCircle2,
  ExternalLink,
  Eye,
  RotateCcw,
  Sparkles,
  Volume2
} from 'lucide-react';
import { Rating, type Grade } from 'ts-fsrs';
import { buildYouTubeTimestampUrl } from '../../shared/export';
import {
  getCardStateLabel,
  getDueCards,
  previewCardGrades,
  reviewCard
} from '../../shared/srs';
import type { VocabularyCard } from '../../types/vocabulary';

interface FlashcardTrainerProps {
  cards: VocabularyCard[];
  onUpdateCard: (updated: VocabularyCard) => Promise<void>;
}

function speakWord(text: string, langCode: string): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  try {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const voices = window.speechSynthesis.getVoices();
    const norm = langCode.toLowerCase();
    const matched =
      voices.find((v) => v.lang.toLowerCase() === norm) ??
      voices.find((v) => v.lang.toLowerCase().startsWith(norm.split('-')[0] ?? norm));
    if (matched) {
      utterance.voice = matched;
      utterance.lang = matched.lang;
    } else if (norm && norm !== 'auto' && norm !== 'unknown') {
      utterance.lang = norm;
    }
    utterance.rate = 0.95;
    window.speechSynthesis.speak(utterance);
  } catch {
    // Ignore speech synthesis failures
  }
}

function renderClozeSentence(
  sentence: string,
  targetWord: string,
  revealed: boolean
): ReactElement {
  if (!sentence) {
    return (
      <span className="text-slate-400 italic">No context sentence recorded.</span>
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
        <span className="inline-block rounded-md bg-indigo-500/20 px-2 py-0.5 font-semibold text-indigo-300">
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
            className={`mx-0.5 inline-block rounded-md px-2 py-0.5 font-semibold transition ${
              revealed
                ? 'bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/40'
                : 'bg-indigo-500/25 text-indigo-200 ring-1 ring-indigo-400/40'
            }`}
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
  onUpdateCard
}: FlashcardTrainerProps): ReactElement {
  const [practiceAllMode, setPracticeAllMode] = useState(false);
  const [practiceQueueIds, setPracticeQueueIds] = useState<string[]>([]);
  const [revealed, setRevealed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [reviewedCount, setReviewedCount] = useState(0);

  const dueCards = useMemo(() => getDueCards(cards), [cards]);

  const activeCard = useMemo(() => {
    if (!practiceAllMode) {
      return dueCards[0] ?? null;
    }
    const nextId = practiceQueueIds[0];
    return cards.find((c) => c.id === nextId) ?? null;
  }, [cards, dueCards, practiceAllMode, practiceQueueIds]);

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
        await onUpdateCard(updated);
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
    setPracticeQueueIds(cards.map((c) => c.id));
    setRevealed(false);
  };

  if (cards.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-white/10 bg-slate-900/60 p-8 text-center">
        <Sparkles className="h-10 w-10 text-indigo-400" />
        <h2 className="mt-3 text-base font-semibold text-white">
          Your vocabulary is empty
        </h2>
        <p className="mt-1 max-w-xs text-xs text-slate-400">
          Open any YouTube video with subtitles, click on unfamiliar words, and press{' '}
          <span className="font-semibold text-slate-200">«В словарь»</span> (or press{' '}
          <kbd className="rounded bg-slate-800 px-1.5 py-0.5 text-[11px]">S</kbd>).
        </p>
      </div>
    );
  }

  if (!activeCard) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-emerald-500/20 bg-slate-900/60 p-8 text-center">
        <CheckCircle2 className="h-11 w-11 text-emerald-400" />
        <h2 className="mt-3 text-lg font-semibold text-white">
          All caught up!
        </h2>
        <p className="mt-1 text-xs text-slate-400">
          {reviewedCount > 0
            ? `Completed ${reviewedCount} review${reviewedCount === 1 ? '' : 's'} this session. `
            : ''}
          You have {cards.length} saved card{cards.length === 1 ? '' : 's'} total.
        </p>
        <button
          type="button"
          onClick={startPracticeAll}
          className="mt-4 flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-indigo-500"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          <span>Practice all cards anyway</span>
        </button>
      </div>
    );
  }

  const remainingCount = practiceAllMode ? practiceQueueIds.length : dueCards.length;
  const ytUrl = buildYouTubeTimestampUrl(activeCard.videoId, activeCard.timestampSec);

  const buttonStyleByLabel: Record<'Again' | 'Hard' | 'Good' | 'Easy', string> = {
    Again: 'border-rose-500/30 bg-rose-500/15 text-rose-200 hover:bg-rose-500/25',
    Hard: 'border-amber-500/30 bg-amber-500/15 text-amber-200 hover:bg-amber-500/25',
    Good: 'border-emerald-500/30 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25',
    Easy: 'border-sky-500/30 bg-sky-500/15 text-sky-200 hover:bg-sky-500/25'
  };

  return (
    <div className="space-y-3">
      {/* Progress Bar */}
      <div className="flex items-center justify-between text-xs text-slate-400">
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-indigo-500/20 px-2 py-0.5 font-medium text-indigo-300">
            {practiceAllMode ? 'Free Practice' : 'Due Queue'}: {remainingCount}
          </span>
          <span className="rounded-full bg-slate-800 px-2 py-0.5 text-slate-300">
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
            className="text-indigo-400 hover:text-indigo-300"
          >
            Exit Free Practice
          </button>
        )}
      </div>

      {/* Card Surface */}
      <div className="overflow-hidden rounded-2xl border border-white/10 bg-slate-900/80 shadow-xl">
        {activeCard.screenshotBase64 && (
          <div className="relative h-36 w-full overflow-hidden bg-black">
            <img
              src={activeCard.screenshotBase64}
              alt={activeCard.videoTitle}
              className="h-full w-full object-cover opacity-90"
            />
            <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/90 via-black/50 to-transparent px-3 py-2 text-[11px] text-slate-200">
              <span className="truncate pr-2">{activeCard.videoTitle}</span>
              <a
                href={ytUrl}
                target="_blank"
                rel="noreferrer"
                className="flex shrink-0 items-center gap-1 rounded-md bg-white/15 px-2 py-0.5 font-medium text-white hover:bg-white/25"
              >
                <ExternalLink className="h-3 w-3" />
                <span>{Math.floor(activeCard.timestampSec)}s</span>
              </a>
            </div>
          </div>
        )}

        <div className="p-4">
          {!activeCard.screenshotBase64 && (
            <div className="mb-2 flex items-center justify-between text-[11px] text-slate-400">
              <span className="truncate pr-2">{activeCard.videoTitle}</span>
              <a
                href={ytUrl}
                target="_blank"
                rel="noreferrer"
                className="flex shrink-0 items-center gap-1 text-indigo-400 hover:text-indigo-300"
              >
                <ExternalLink className="h-3 w-3" />
                <span>YouTube ({Math.floor(activeCard.timestampSec)}s)</span>
              </a>
            </div>
          )}

          {/* Cloze Sentence */}
          <div className="rounded-xl border border-white/10 bg-slate-950/60 p-3.5 text-sm leading-relaxed text-slate-100">
            {renderClozeSentence(
              activeCard.contextSentence,
              activeCard.word,
              revealed
            )}
          </div>

          {!revealed ? (
            <button
              type="button"
              onClick={() => setRevealed(true)}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow transition hover:bg-indigo-500"
            >
              <Eye className="h-4 w-4" />
              <span>Показать ответ (Space)</span>
            </button>
          ) : (
            <div className="mt-4 space-y-3">
              {/* Word & Translation */}
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-950/20 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-lg font-bold text-white">
                        {activeCard.word}
                      </span>
                      <button
                        type="button"
                        onClick={() => speakWord(activeCard.word, activeCard.sourceLang)}
                        className="rounded-lg p-1 text-indigo-300 hover:bg-indigo-500/20"
                      >
                        <Volume2 className="h-4 w-4" />
                      </button>
                    </div>
                    {activeCard.lemma &&
                      activeCard.lemma.toLowerCase() !== activeCard.word.toLowerCase() && (
                        <div className="text-xs text-slate-400">
                          Lemma: <span className="text-slate-200">{activeCard.lemma}</span>
                        </div>
                      )}
                  </div>
                  {activeCard.aiExplanation?.partOfSpeech && (
                    <span className="rounded-md bg-white/10 px-2 py-0.5 text-[11px] text-slate-300">
                      {activeCard.aiExplanation.partOfSpeech}
                    </span>
                  )}
                </div>

                <div className="mt-2 text-base font-semibold text-emerald-400">
                  {activeCard.aiExplanation?.contextualTranslation ||
                    activeCard.translation}
                </div>

                {activeCard.contextTranslation && (
                  <div className="mt-1 text-xs italic text-slate-400">
                    {activeCard.contextTranslation}
                  </div>
                )}
              </div>

              {/* AI Breakdown Details */}
              {activeCard.aiExplanation && (
                <div className="space-y-1.5 rounded-xl border border-indigo-500/20 bg-indigo-950/20 p-3 text-xs text-slate-300">
                  {activeCard.aiExplanation.grammarNote && (
                    <div>
                      <span className="font-semibold text-indigo-300">Грамматика: </span>
                      {activeCard.aiExplanation.grammarNote}
                    </div>
                  )}
                  {activeCard.aiExplanation.nuanceExplanation && (
                    <div>
                      <span className="font-semibold text-indigo-300">Нюанс: </span>
                      {activeCard.aiExplanation.nuanceExplanation}
                    </div>
                  )}
                </div>
              )}

              {/* 4 FSRS Rating Buttons */}
              <div className="grid grid-cols-4 gap-2 pt-1">
                {gradePreviews.map((item, idx) => (
                  <button
                    key={item.label}
                    type="button"
                    disabled={submitting}
                    onClick={() => void handleGrade(item.grade)}
                    className={`flex flex-col items-center rounded-xl border px-2 py-2 transition disabled:opacity-50 ${
                      buttonStyleByLabel[item.label]
                    }`}
                  >
                    <span className="text-xs font-semibold">
                      {item.label}
                    </span>
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
