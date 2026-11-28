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
import type {
  AnkiExportResponse,
  RuntimeRequest,
  UserSettings,
  VocabularyCard
} from '@langai/contracts';
import { State, getCardStateLabel } from '@langai/storage';
import { getUiStrings } from '../i18n/translations';
import {
  buildTelegramShareUrl,
  downloadVocabularyCsv,
  formatCardsForTelegram,
  resolveCardSourceUrl
} from '../utils/export';
import { ensureHostPermissionForUrl } from '../utils/permissions';
import { CardThumbnail } from './CardThumbnail';
import { MarqueeText } from './MarqueeText';

type VocabFilter = 'all' | 'due' | 'new' | 'learning' | 'review';

export interface VocabularyListProps {
  cards: VocabularyCard[];
  settings: UserSettings;
  onDeleteCard: (cardId: string) => Promise<void>;
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
  const t = getUiStrings(settings.uiLanguage);

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<VocabFilter>('all');
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const [ankiLoading, setAnkiLoading] = useState(false);
  const [exportStatus, setExportStatus] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const [copiedTelegram, setCopiedTelegram] = useState(false);

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
    const nowMs = Date.now();
    const q = query.trim().toLowerCase();

    return cards.filter((card) => {
      if (sourceFilter !== 'all' && (card.source || 'other') !== sourceFilter) {
        return false;
      }

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
        card.videoTitle.toLowerCase().includes(q) ||
        (card.sourceTitle?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [cards, filter, sourceFilter, query]);

  const handleAnkiExport = async (): Promise<void> => {
    if (filteredCards.length === 0 || ankiLoading) return;
    setAnkiLoading(true);
    setExportStatus(null);
    try {
      const perm = await ensureHostPermissionForUrl(
        settings.ankiConnectUrl,
        'http://127.0.0.1/*'
      );
      if (!perm.granted) {
        setExportStatus({
          type: 'error',
          text: t.ankiPermissionDenied
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
          text: t.ankiExportPartial(added, skipped ?? 0, errors[0] ?? '')
        });
      } else {
        setExportStatus({
          type: 'success',
          text: t.ankiExportSuccess(added, skipped ?? 0)
        });
      }
    } catch (err: unknown) {
      setExportStatus({
        type: 'error',
        text: err instanceof Error ? err.message : t.ankiExportFailed
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

  const filterLabels: Record<VocabFilter, string> = {
    all: t.filterAll,
    due: t.filterDue,
    new: t.filterNew,
    learning: t.filterLearning,
    review: t.filterReview
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
      {/* Search & Filters */}
      <div className="shrink-0 space-y-2">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2"
            style={{ color: 'var(--ytai-text-muted, var(--ytai-text-secondary))' }}
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.searchPlaceholder}
            style={{
              backgroundColor: 'var(--ytai-surface)',
              borderColor: 'var(--ytai-border)'
            }}
            className="ytai-input w-full rounded-xl border py-2 pl-9 pr-3 text-xs"
          />
        </div>

        {/* Dynamic Platform Source Tabs */}
        {sourceTabs.length > 2 && (
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
                onClick={() => setSourceFilter(tab.id)}
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
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1">
            {(['all', 'due', 'new', 'learning', 'review'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setFilter(tab)}
                style={
                  filter === tab
                    ? {
                        backgroundColor: 'var(--ytai-accent)',
                        color: 'var(--ytai-accent-fg, #ffffff)'
                      }
                    : {
                        backgroundColor: 'var(--ytai-surface)',
                        borderColor: 'var(--ytai-border)',
                        color: 'var(--ytai-text-muted, var(--ytai-text-secondary))'
                      }
                }
                className={`rounded-lg border px-2.5 py-1 text-[11px] font-medium transition ${
                  filter === tab
                    ? 'border-transparent shadow-sm'
                    : 'hover:bg-[rgba(var(--ytai-accent-rgb),0.14)]'
                }`}
              >
                {filterLabels[tab]}
              </button>
            ))}
          </div>
          <span
            className="text-[11px]"
            style={{ color: 'var(--ytai-text-muted, var(--ytai-text-secondary))' }}
          >
            {filteredCards.length} / {cards.length}
          </span>
        </div>
      </div>

      {/* Export Toolbar */}
      <div
        className="flex shrink-0 flex-wrap items-center gap-1.5 rounded-xl border p-2 transition-colors"
        style={{
          backgroundColor: 'var(--ytai-surface)',
          borderColor: 'var(--ytai-border)'
        }}
      >
        <button
          type="button"
          disabled={filteredCards.length === 0}
          onClick={() => downloadVocabularyCsv(filteredCards)}
          style={{ borderColor: 'var(--ytai-border)' }}
          className="ytai-control-btn flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition disabled:opacity-40"
        >
          <Download className="h-3.5 w-3.5 text-emerald-400" />
          <span>{t.csvBtn}</span>
        </button>

        <button
          type="button"
          disabled={filteredCards.length === 0 || ankiLoading}
          onClick={() => void handleAnkiExport()}
          style={{
            backgroundColor: 'var(--ytai-accent)',
            color: 'var(--ytai-accent-fg, #ffffff)'
          }}
          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition hover:opacity-90 disabled:opacity-40"
        >
          {ankiLoading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Upload className="h-3.5 w-3.5" />
          )}
          <span>{t.ankiConnectBtn}</span>
        </button>

        <button
          type="button"
          disabled={filteredCards.length === 0}
          onClick={() => void handleCopyTelegram()}
          style={{ borderColor: 'var(--ytai-border)' }}
          className="ytai-control-btn flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition disabled:opacity-40"
        >
          {copiedTelegram ? (
            <Check className="h-3.5 w-3.5 text-emerald-400" />
          ) : (
            <Copy className="h-3.5 w-3.5 text-sky-400" />
          )}
          <span>{copiedTelegram ? t.copied : t.tgCopy}</span>
        </button>

        <button
          type="button"
          disabled={filteredCards.length === 0}
          onClick={handleShareTelegram}
          className="flex items-center gap-1.5 rounded-lg bg-sky-600/90 px-2.5 py-1.5 text-[11px] font-medium text-white transition hover:bg-sky-500 disabled:opacity-40"
        >
          <Send className="h-3.5 w-3.5" />
          <span>{t.telegramBtn}</span>
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
        <div
          className="rounded-2xl border p-6 text-center text-xs"
          style={{
            backgroundColor: 'var(--ytai-surface)',
            borderColor: 'var(--ytai-border)',
            color: 'var(--ytai-text-muted, var(--ytai-text-secondary))'
          }}
        >
          {t.noCardsMatch}
        </div>
      ) : (
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
          {filteredCards.map((card) => {
            const externalUrl = resolveCardSourceUrl(card);
            const badgeLabel = card.sourceLabel || card.source;

            return (
              <div
                key={card.id}
                style={{
                  backgroundColor: 'var(--ytai-surface)',
                  borderColor: 'var(--ytai-border)'
                }}
                className="flex gap-3 rounded-xl border p-3 transition hover:opacity-95"
              >
                <CardThumbnail
                  card={card}
                  alt={card.word}
                  className="h-16 w-28 shrink-0 rounded-lg object-cover"
                />

                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className="truncate text-sm font-bold"
                          style={{ color: 'var(--ytai-text-primary)' }}
                        >
                          {card.word}
                        </span>
                        <span
                          className="inline-flex shrink-0 items-center rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider"
                          style={{
                            backgroundColor: 'rgba(var(--ytai-accent-rgb), 0.16)',
                            borderColor: 'rgba(var(--ytai-accent-rgb), 0.35)',
                            color: 'var(--ytai-accent)'
                          }}
                        >
                          {badgeLabel}
                        </span>
                        <span
                          className="rounded border px-1.5 py-0.5 text-[10px]"
                          style={{
                            backgroundColor: 'var(--ytai-control-bg)',
                            borderColor: 'var(--ytai-border)',
                            color: 'var(--ytai-text-secondary)'
                          }}
                        >
                          {getCardStateLabel(card.fsrsState.state)}
                        </span>
                      </div>
                      <div className="text-xs font-medium" style={{ color: 'var(--ytai-accent)' }}>
                        {card.aiExplanation?.contextualTranslation || card.translation}
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-1">
                      {externalUrl && (
                        <a
                          href={externalUrl}
                          target="_blank"
                          rel="noreferrer"
                          title={t.openSourcePage}
                          style={{ color: 'var(--ytai-accent)' }}
                          className="rounded-lg p-1 transition hover:bg-[rgba(var(--ytai-accent-rgb),0.15)]"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      )}
                      <button
                        type="button"
                        title={t.deleteCard}
                        onClick={() => void onDeleteCard(card.id)}
                        style={{ color: 'var(--ytai-text-muted, var(--ytai-text-secondary))' }}
                        className="rounded-lg p-1 hover:bg-rose-500/15 hover:text-rose-400"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  {card.contextSentence && (
                    <p
                      className="mt-1 line-clamp-2 text-[11px]"
                      style={{ color: 'var(--ytai-text-primary)', opacity: 0.85 }}
                    >
                      {card.contextSentence}
                    </p>
                  )}

                  <div
                    className="mt-1 flex items-center justify-between text-[10px]"
                    style={{ color: 'var(--ytai-text-muted, var(--ytai-text-secondary))' }}
                  >
                    <span className="truncate pr-2">{card.sourceTitle || card.videoTitle}</span>
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
