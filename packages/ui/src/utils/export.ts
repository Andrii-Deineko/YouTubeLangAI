import type { VocabularyCard } from '@langai/contracts';
import { getCardStateLabel } from '@langai/storage';

function escapeCsvCell(value: string): string {
  const normalized = value.replace(/\r?\n/g, ' ');
  if (/[",]/.test(normalized)) {
    return `"${normalized.replace(/"/g, '""')}"`;
  }
  return normalized;
}

export function resolveCardSourceUrl(card: VocabularyCard): string | null {
  const raw = card.sourceUrl?.trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.toString();
    }
  } catch {
    // ignore invalid URLs
  }
  return null;
}

export function generateVocabularyCsv(cards: readonly VocabularyCard[]): string {
  const headers = [
    'Word',
    'Lemma',
    'Translation',
    'PartOfSpeech',
    'ContextualTranslation',
    'GrammarNote',
    'NuanceExplanation',
    'ContextSentence',
    'ContextTranslation',
    'Source',
    'VideoTitle',
    'TimestampSec',
    'SourceURL',
    'FSRSState',
    'DueDate'
  ];

  const rows = cards.map((card) => {
    const ai = card.aiExplanation;
    const cells = [
      card.word,
      card.lemma,
      card.translation,
      ai?.partOfSpeech ?? '',
      ai?.contextualTranslation ?? '',
      ai?.grammarNote ?? '',
      ai?.nuanceExplanation ?? '',
      card.contextSentence,
      card.contextTranslation,
      card.sourceLabel || card.source,
      card.sourceTitle || card.videoTitle,
      String(Math.floor(card.timestampSec)),
      resolveCardSourceUrl(card) ?? '',
      getCardStateLabel(card.fsrsState.state),
      card.fsrsState.due
    ];
    return cells.map(escapeCsvCell).join(',');
  });

  return `\uFEFF${[headers.join(','), ...rows].join('\r\n')}`;
}

export function downloadVocabularyCsv(
  cards: readonly VocabularyCard[],
  filename = `lang-ai-vocab-${new Date().toISOString().slice(0, 10)}.csv`
): void {
  const csv = generateVocabularyCsv(cards);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function formatCardsForTelegram(cards: readonly VocabularyCard[]): string {
  if (cards.length === 0) return '';
  const blocks = cards.slice(0, 20).map((card, index) => {
    const lines = [
      `${index + 1}. *${card.word}* — ${card.aiExplanation?.contextualTranslation || card.translation}`
    ];
    if (card.lemma && card.lemma.toLowerCase() !== card.word.toLowerCase()) {
      lines.push(`   _${card.lemma}_ (${card.aiExplanation?.partOfSpeech ?? 'word'})`);
    }
    if (card.contextSentence) {
      lines.push(`   "${card.contextSentence}"`);
    }
    if (card.aiExplanation?.nuanceExplanation) {
      lines.push(`   💡 ${card.aiExplanation.nuanceExplanation}`);
    }
    const sourceUrl = resolveCardSourceUrl(card);
    if (sourceUrl) {
      lines.push(`   ▶ ${sourceUrl}`);
    }
    return lines.join('\n');
  });

  const footer =
    cards.length > 20 ? `\n\n...and ${cards.length - 20} more cards in Lang AI.` : '';

  return `📚 *Lang AI Vocabulary (${cards.length})*\n\n${blocks.join('\n\n')}${footer}`;
}

export function buildTelegramShareUrl(cards: readonly VocabularyCard[]): string {
  const slice = cards.slice(0, 8);
  const text = formatCardsForTelegram(slice);
  const firstUrl = slice.map(resolveCardSourceUrl).find((u): u is string => u !== null);
  if (firstUrl) {
    return `https://t.me/share/url?url=${encodeURIComponent(firstUrl)}&text=${encodeURIComponent(text)}`;
  }
  return `https://t.me/share/url?text=${encodeURIComponent(text)}`;
}
