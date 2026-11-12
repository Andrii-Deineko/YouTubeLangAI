import { useMemo, useState, type ReactElement } from 'react';
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  Loader2,
  Search,
  Send,
  Trash2,
  Upload
} from 'lucide-react';
import { State } from 'ts-fsrs';
import {
  buildTelegramShareUrl,
  buildYouTubeTimestampUrl,
  downloadVocabularyCsv,
  formatCardsForTelegram
} from '../../shared/export';
import { getCardStateLabel } from '../../shared/srs';
import type { AnkiExportResponse, RuntimeRequest } from '../../types/messages';
import type { UserSettings } from '../../types/settings';
import type { VocabularyCard } from '../../types/vocabulary';

type VocabFilter = 'all' | 'due' | 'new' | 'learning' | 'review';

interface VocabularyListProps {
  cards: VocabularyCard[];
  settings: UserSettings;
  onDeleteCard: (cardId: string) => Promise<void>;
}

async function ensureAnkiHostPermission(): Promise<boolean> {
  if (!chrome.permissions?.request) return true;
  return chrome.permissions.request({
    origins: ['http://127.0.0.1/*']
  });
}

function sendAnkiExport(
  url: string,
  deckName: string,
  cards: VocabularyCard[]
): Promise<AnkiExportResponse> {
  return new Promise((resolve, reject) => {
    const request: RuntimeRequest = {
      type: 'ANKI_EXPORT_CARDS',
      payload: { url, deckName, cards }
    };
    chrome.runtime.sendMessage(request, (response: AnkiExportResponse | undefined) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!response) {
        reject(new Error('No response from service worker'));
        return;
      }
      resolve(response);
    });
  });
}

export function VocabularyList({
  cards,
  settings,
  onDeleteCard
}: VocabularyListProps): ReactElement {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<VocabFilter>('all');
  const [ankiLoading, setAnkiLoading] = useState(false);
  const [exportStatus, setExportStatus] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const [copiedTelegram, setCopiedTelegram] = useState(false);

  const filteredCards = useMemo(() => {
    const nowMs = Date.now();
    const q = query.trim().toLowerCase();

    return cards.filter((card) => {
      if (filter === 'due' && new Date(card.fsrsState.due).getTime() > nowMs) {
        return false;
      }
      if (filter === 'new' && card.fsrsState.state !== State.New) {
        return false;
      }
      if (
        filter === 'learning' &&
        card.fsrsState.state !== State.Learning &&
        card.fsrsState.state !== State.Relearning
      ) {
        return false;
      }
      if (filter === 'review' && card.fsrsState.state !== State.Review) {
        return false;
      }

      if (!q) return true;
      return (
        card.word.toLowerCase().includes(q) ||
        card.lemma.toLowerCase().includes(q) ||
        card.translation.toLowerCase().includes(q) ||
        card.contextSentence.toLowerCase().includes(q) ||
        card.videoTitle.toLowerCase().includes(q)
      );
    });
  }, [cards, filter, query]);

  const handleAnkiExport = async (): Promise<void> => {
    if (filteredCards.length === 0 || ankiLoading) return;
    setAnkiLoading(true);
    setExportStatus(null);
    try {
      const granted = await ensureAnkiHostPermission();
      if (!granted) {
        setExportStatus({
          type: 'error',
          text: 'Permission for http://127.0.0.1/* was denied.'
        });
        return;
      }

      const res = await sendAnkiExport(
        settings.ankiConnectUrl,
        settings.ankiDeckName,
        filteredCards
      );
      if (!res.ok) {
        setExportStatus({ type: 'error', text: res.error });
        return;
      }

      const { added, skipped, errors } = res.data;
      if (errors.length > 0) {
        setExportStatus({
          type: 'error',
          text: `Added ${added}, skipped ${skipped}, errors: ${errors[0]}`
        });
      } else {
        setExportStatus({
          type: 'success',
          text: `Anki export complete: ${added} added, ${skipped} duplicates skipped.`
        });
      }
    } catch (err: unknown) {
      setExportStatus({
        type: 'error',
        text: err instanceof Error ? err.message : 'AnkiConnect export failed'
      });
    } finally {
      setAnkiLoading(false);
    }
  };

  const handleCopyTelegram = async (): Promise<void> => {
    if (filteredCards.length === 0) return;
    const text = formatCardsForTelegram(filteredCards);
    await navigator.clipboard.writeText(text);
    setCopiedTelegram(true);
    window.setTimeout(() => setCopiedTelegram(false), 2000);
  };

  const handleShareTelegram = (): void => {
    if (filteredCards.length === 0) return;
    const shareUrl = buildTelegramShareUrl(filteredCards);
    window.open(shareUrl, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="space-y-3">
      {/* Search & Filters */}
      <div className="space-y-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search word, translation, sentence, video..."
            className="w-full rounded-xl border border-white/10 bg-slate-900/80 py-2 pl-9 pr-3 text-xs text-slate-100 placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1">
            {(['all', 'due', 'new', 'learning', 'review'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setFilter(tab)}
                className={`rounded-lg px-2.5 py-1 text-[11px] font-medium capitalize transition ${
                  filter === tab
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-900 text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
          <span className="text-[11px] text-slate-400">
            {filteredCards.length} / {cards.length}
          </span>
        </div>
      </div>

      {/* Export Toolbar */}
      <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-white/10 bg-slate-900/60 p-2">
        <button
          type="button"
          disabled={filteredCards.length === 0}
          onClick={() => downloadVocabularyCsv(filteredCards)}
          className="flex items-center gap-1.5 rounded-lg bg-slate-800 px-2.5 py-1.5 text-[11px] font-medium text-slate-200 transition hover:bg-slate-700 disabled:opacity-40"
        >
          <Download className="h-3.5 w-3.5 text-emerald-400" />
          <span>CSV (UTF-8)</span>
        </button>

        <button
          type="button"
          disabled={filteredCards.length === 0 || ankiLoading}
          onClick={() => void handleAnkiExport()}
          className="flex items-center gap-1.5 rounded-lg bg-indigo-600/90 px-2.5 py-1.5 text-[11px] font-medium text-white transition hover:bg-indigo-500 disabled:opacity-40"
        >
          {ankiLoading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Upload className="h-3.5 w-3.5" />
          )}
          <span>AnkiConnect</span>
        </button>

        <button
          type="button"
          disabled={filteredCards.length === 0}
          onClick={() => void handleCopyTelegram()}
          className="flex items-center gap-1.5 rounded-lg bg-slate-800 px-2.5 py-1.5 text-[11px] font-medium text-slate-200 transition hover:bg-slate-700 disabled:opacity-40"
        >
          {copiedTelegram ? (
            <Check className="h-3.5 w-3.5 text-emerald-400" />
          ) : (
            <Copy className="h-3.5 w-3.5 text-sky-400" />
          )}
          <span>{copiedTelegram ? 'Copied' : 'TG Copy'}</span>
        </button>

        <button
          type="button"
          disabled={filteredCards.length === 0}
          onClick={handleShareTelegram}
          className="flex items-center gap-1.5 rounded-lg bg-sky-600/90 px-2.5 py-1.5 text-[11px] font-medium text-white transition hover:bg-sky-500 disabled:opacity-40"
        >
          <Send className="h-3.5 w-3.5" />
          <span>Telegram</span>
        </button>
      </div>

      {exportStatus && (
        <div
          className={`rounded-xl border px-3 py-2 text-xs ${
            exportStatus.type === 'success'
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
              : 'border-rose-500/30 bg-rose-500/10 text-rose-300'
          }`}
        >
          {exportStatus.text}
        </div>
      )}

      {/* Card Items */}
      {filteredCards.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-6 text-center text-xs text-slate-400">
          No vocabulary cards match your filter.
        </div>
      ) : (
        <div className="max-h-[360px] space-y-2 overflow-y-auto pr-1">
          {filteredCards.map((card) => {
            const ytUrl = buildYouTubeTimestampUrl(card.videoId, card.timestampSec);
            return (
              <div
                key={card.id}
                className="flex gap-3 rounded-xl border border-white/10 bg-slate-900/70 p-3 transition hover:border-white/20"
              >
                {card.screenshotBase64 && (
                  <img
                    src={card.screenshotBase64}
                    alt={card.word}
                    className="h-16 w-28 shrink-0 rounded-lg object-cover"
                  />
                )}

                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-bold text-white">
                          {card.word}
                        </span>
                        <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-300">
                          {getCardStateLabel(card.fsrsState.state)}
                        </span>
                      </div>
                      <div className="text-xs font-medium text-emerald-400">
                        {card.aiExplanation?.contextualTranslation || card.translation}
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-1">
                      <a
                        href={ytUrl}
                        target="_blank"
                        rel="noreferrer"
                        title="Open YouTube at timestamp"
                        className="rounded-lg p-1 text-indigo-400 hover:bg-indigo-500/15 hover:text-indigo-300"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                      <button
                        type="button"
                        title="Delete card"
                        onClick={() => void onDeleteCard(card.id)}
                        className="rounded-lg p-1 text-slate-400 hover:bg-rose-500/15 hover:text-rose-400"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  {card.contextSentence && (
                    <p className="mt-1 line-clamp-2 text-[11px] text-slate-300">
                      {card.contextSentence}
                    </p>
                  )}

                  <div className="mt-1 flex items-center justify-between text-[10px] text-slate-500">
                    <span className="truncate pr-2">{card.videoTitle}</span>
                    <span className="shrink-0">{Math.floor(card.timestampSec)}s</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
