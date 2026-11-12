import type { AnkiExportResult } from '../types/messages';
import type { VocabularyCard } from '../types/vocabulary';
import { getCardStateLabel } from './srs';

interface AnkiConnectResponse<T> {
  result: T;
  error: string | null;
}

function escapeCsvCell(value: string): string {
  const normalized = value.replace(/\r?\n/g, ' ');
  if (/[",]/.test(normalized)) {
    return `"${normalized.replace(/"/g, '""')}"`;
  }
  return normalized;
}

export function buildYouTubeTimestampUrl(videoId: string, timestampSec: number): string {
  const sec = Math.max(0, Math.floor(timestampSec));
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&t=${sec}s`;
}

export function generateVocabularyCsv(cards: VocabularyCard[]): string {
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
    'VideoTitle',
    'TimestampSec',
    'YouTubeURL',
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
      card.videoTitle,
      String(Math.floor(card.timestampSec)),
      buildYouTubeTimestampUrl(card.videoId, card.timestampSec),
      getCardStateLabel(card.fsrsState.state),
      card.fsrsState.due
    ];
    return cells.map(escapeCsvCell).join(',');
  });

  return `\uFEFF${[headers.join(','), ...rows].join('\r\n')}`;
}

export function downloadVocabularyCsv(
  cards: VocabularyCard[],
  filename = `youtube-lang-ai-vocab-${new Date().toISOString().slice(0, 10)}.csv`
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

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function highlightWordInSentence(sentence: string, word: string): string {
  const escapedSentence = escapeHtml(sentence);
  const cleanWord = word.trim();
  if (!cleanWord) return escapedSentence;

  const escapedRegex = cleanWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escapedRegex})`, 'gi');
  return escapedSentence.replace(regex, '<b style="color:#4f46e5;">$1</b>');
}

async function invokeAnkiConnect<T>(
  url: string,
  action: string,
  params: Record<string, unknown> = {}
): Promise<T> {
  const endpoint = url.trim() || 'http://127.0.0.1:8765';
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, version: 6, params })
  });

  if (!response.ok) {
    throw new Error(`AnkiConnect HTTP ${response.status}`);
  }

  const json = (await response.json()) as AnkiConnectResponse<T>;
  if (json.error) {
    throw new Error(json.error);
  }
  return json.result;
}

export async function testAnkiConnection(url: string): Promise<{ version: number }> {
  const version = await invokeAnkiConnect<number>(url, 'version');
  return { version };
}

export async function exportCardsToAnki(
  url: string,
  deckName: string,
  cards: VocabularyCard[]
): Promise<AnkiExportResult> {
  const targetDeck = deckName.trim() || 'YouTube Lang AI';
  await invokeAnkiConnect<number>(url, 'createDeck', { deck: targetDeck });

  let added = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const card of cards) {
    try {
      let mediaHtml = '';
      if (card.screenshotBase64) {
        const base64Match = card.screenshotBase64.match(/^data:image\/([a-zA-Z0-9+]+);base64,(.+)$/);
        if (base64Match?.[2]) {
          const ext = base64Match[1] === 'jpeg' ? 'jpg' : base64Match[1];
          const mediaFilename = `yt-lang-ai-${card.id}.${ext}`;
          await invokeAnkiConnect<string>(url, 'storeMediaFile', {
            filename: mediaFilename,
            data: base64Match[2]
          });
          mediaHtml = `<div style="margin-top:10px;"><img src="${escapeHtml(mediaFilename)}" style="max-width:320px;border-radius:8px;" /></div>`;
        }
      }

      const ytUrl = buildYouTubeTimestampUrl(card.videoId, card.timestampSec);
      const frontHtml = [
        `<div style="font-size:24px;font-weight:700;">${escapeHtml(card.word)}</div>`,
        card.contextSentence
          ? `<div style="margin-top:10px;font-size:16px;line-height:1.4;">${highlightWordInSentence(
              card.contextSentence,
              card.word
            )}</div>`
          : '',
        mediaHtml
      ]
        .filter(Boolean)
        .join('');

      const ai = card.aiExplanation;
      const backParts = [
        `<div style="font-size:20px;font-weight:700;color:#059669;">${escapeHtml(
          ai?.contextualTranslation || card.translation
        )}</div>`
      ];

      if (card.lemma && card.lemma.toLowerCase() !== card.word.toLowerCase()) {
        backParts.push(
          `<div style="margin-top:4px;color:#64748b;">Lemma: <b>${escapeHtml(card.lemma)}</b>${
            ai?.partOfSpeech ? ` (${escapeHtml(ai.partOfSpeech)})` : ''
          }</div>`
        );
      } else if (ai?.partOfSpeech) {
        backParts.push(
          `<div style="margin-top:4px;color:#64748b;">${escapeHtml(ai.partOfSpeech)}</div>`
        );
      }

      if (card.contextTranslation) {
        backParts.push(
          `<div style="margin-top:8px;font-style:italic;color:#475569;">${escapeHtml(
            card.contextTranslation
          )}</div>`
        );
      }

      if (ai?.grammarNote) {
        backParts.push(
          `<div style="margin-top:8px;"><b>Grammar:</b> ${escapeHtml(ai.grammarNote)}</div>`
        );
      }

      if (ai?.nuanceExplanation) {
        backParts.push(
          `<div style="margin-top:6px;"><b>Nuance:</b> ${escapeHtml(ai.nuanceExplanation)}</div>`
        );
      }

      if (ai?.examples && ai.examples.length > 0) {
        const exList = ai.examples
          .map(
            (ex) =>
              `<li>${escapeHtml(ex.source)} — <i>${escapeHtml(ex.translation)}</i></li>`
          )
          .join('');
        backParts.push(`<ul style="margin-top:8px;text-align:left;">${exList}</ul>`);
      }

      backParts.push(
        `<div style="margin-top:12px;font-size:12px;"><a href="${escapeHtml(
          ytUrl
        )}">▶ Watch on YouTube (${escapeHtml(card.videoTitle || card.videoId)})</a></div>`
      );

      await invokeAnkiConnect<number>(url, 'addNote', {
        note: {
          deckName: targetDeck,
          modelName: 'Basic',
          fields: {
            Front: frontHtml,
            Back: backParts.join('')
          },
          options: {
            allowDuplicate: false
          },
          tags: ['youtube-lang-ai', card.sourceLang || 'lang']
        }
      });

      added++;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown AnkiConnect error';
      if (msg.toLowerCase().includes('duplicate')) {
        skipped++;
      } else {
        errors.push(`${card.word}: ${msg}`);
      }
    }
  }

  return { added, skipped, errors };
}

export function formatCardsForTelegram(cards: VocabularyCard[]): string {
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
    lines.push(`   ▶ ${buildYouTubeTimestampUrl(card.videoId, card.timestampSec)}`);
    return lines.join('\n');
  });

  const footer =
    cards.length > 20 ? `\n\n...and ${cards.length - 20} more cards in YouTube Lang AI.` : '';

  return `📚 *YouTube Lang AI Vocabulary (${cards.length})*\n\n${blocks.join('\n\n')}${footer}`;
}

export function buildTelegramShareUrl(cards: VocabularyCard[]): string {
  const text = formatCardsForTelegram(cards.slice(0, 8));
  return `https://t.me/share/url?url=${encodeURIComponent(
    'https://www.youtube.com'
  )}&text=${encodeURIComponent(text)}`;
}
