import type { AnkiExportResult, VocabularyCard } from '@langai/contracts';
import { getCardMediaDataUrl } from './db';
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

/**
 * Resolves the canonical source URL for a vocabulary card.
 * Uses `card.sourceUrl` when present and only falls back to a YouTube URL
 * if `card.source === 'youtube'` and `card.sourceUrl` is missing.
 */
export function resolveCardSourceUrl(card: VocabularyCard): string {
  if (typeof card.sourceUrl === 'string' && card.sourceUrl.trim()) {
    return card.sourceUrl.trim();
  }
  if (card.source === 'youtube' && card.videoId) {
    return buildYouTubeTimestampUrl(card.videoId, card.timestampSec);
  }
  return '';
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
      card.sourceLabel || card.source || '',
      card.videoTitle,
      String(Math.floor(card.timestampSec)),
      resolveCardSourceUrl(card),
      getCardStateLabel(card.fsrsState.state),
      card.fsrsState.due
    ];
    return cells.map(escapeCsvCell).join(',');
  });

  return `\uFEFF${[headers.join(','), ...rows].join('\r\n')}`;
}

export function downloadVocabularyCsv(
  cards: VocabularyCard[],
  filename = `langai-vocab-${new Date().toISOString().slice(0, 10)}.csv`
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
    body: JSON.stringify({ action, version: 6, params }),
    signal: AbortSignal.timeout(8_000)
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

async function resolveCardScreenshotDataUrl(card: VocabularyCard): Promise<string | null> {
  if (card.screenshotBase64) {
    return card.screenshotBase64;
  }
  if (card.mediaBlobKey) {
    try {
      return await getCardMediaDataUrl(card.mediaBlobKey);
    } catch {
      return null;
    }
  }
  return null;
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

  interface AnkiNotePayload {
    deckName: string;
    modelName: string;
    fields: { Front: string; Back: string };
    options: { allowDuplicate: boolean };
    tags: string[];
  }

  const notes: AnkiNotePayload[] = [];
  const cardOrder: VocabularyCard[] = [];

  for (const card of cards) {
    try {
      let mediaHtml = '';
      const screenshotDataUrl = await resolveCardScreenshotDataUrl(card);
      if (screenshotDataUrl) {
        const base64Match = screenshotDataUrl.match(/^data:image\/([a-zA-Z0-9+]+);base64,(.+)$/);
        if (base64Match?.[2]) {
          const ext = base64Match[1] === 'jpeg' ? 'jpg' : base64Match[1];
          const mediaFilename = `langai-${card.id}.${ext}`;
          try {
            await invokeAnkiConnect<string>(url, 'storeMediaFile', {
              filename: mediaFilename,
              data: base64Match[2]
            });
            mediaHtml = `<div style="margin-top:10px;"><img src="${escapeHtml(mediaFilename)}" style="max-width:320px;border-radius:8px;" /></div>`;
          } catch {
            // Proceed without media if storing media fails
          }
        }
      }

      const sourceUrl = resolveCardSourceUrl(card);
      const sourceName = card.sourceLabel || card.source || 'Source';
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

      if (sourceUrl) {
        backParts.push(
          `<div style="margin-top:12px;font-size:12px;"><a href="${escapeHtml(
            sourceUrl
          )}">▶ Watch on ${escapeHtml(sourceName)} (${escapeHtml(
            card.videoTitle || card.videoId
          )})</a></div>`
        );
      } else if (card.videoTitle || card.videoId) {
        backParts.push(
          `<div style="margin-top:12px;font-size:12px;color:#64748b;">${escapeHtml(
            sourceName
          )}: ${escapeHtml(card.videoTitle || card.videoId)}</div>`
        );
      }

      notes.push({
        deckName: targetDeck,
        modelName: 'Basic',
        fields: {
          Front: frontHtml,
          Back: backParts.join('')
        },
        options: {
          allowDuplicate: false
        },
        tags: ['langai', card.source || 'video', card.sourceLang || 'lang']
      });
      cardOrder.push(card);
    } catch (prepErr: unknown) {
      errors.push(`${card.word}: ${prepErr instanceof Error ? prepErr.message : 'Preparation error'}`);
    }
  }

  if (notes.length === 0) {
    return { added, skipped, errors };
  }

  try {
    const results = await invokeAnkiConnect<Array<number | null>>(url, 'addNotes', {
      notes
    });
    for (let i = 0; i < results.length; i++) {
      const res = results[i];
      if (typeof res === 'number') {
        added++;
      } else {
        skipped++;
      }
    }
  } catch {
    for (let i = 0; i < notes.length; i++) {
      try {
        await invokeAnkiConnect<number>(url, 'addNote', {
          note: notes[i]
        });
        added++;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Unknown AnkiConnect error';
        if (msg.toLowerCase().includes('duplicate')) {
          skipped++;
        } else {
          errors.push(`${cardOrder[i]?.word || 'Card'}: ${msg}`);
        }
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
    const sourceUrl = resolveCardSourceUrl(card);
    if (sourceUrl) {
      lines.push(`   ▶ ${sourceUrl}`);
    } else if (card.videoTitle) {
      const sourceName = card.sourceLabel || card.source;
      lines.push(`   📺 ${sourceName ? `${sourceName}: ` : ''}${card.videoTitle}`);
    }
    return lines.join('\n');
  });

  const footer =
    cards.length > 20 ? `\n\n...and ${cards.length - 20} more cards in LangAI.` : '';

  return `📚 *LangAI Vocabulary (${cards.length})*\n\n${blocks.join('\n\n')}${footer}`;
}

export function buildTelegramShareUrl(cards: VocabularyCard[]): string {
  const slice = cards.slice(0, 8);
  const text = formatCardsForTelegram(slice);
  const firstSourceUrl = slice.map(resolveCardSourceUrl).find(Boolean);
  if (firstSourceUrl) {
    return `https://t.me/share/url?url=${encodeURIComponent(
      firstSourceUrl
    )}&text=${encodeURIComponent(text)}`;
  }
  return `https://t.me/share/url?text=${encodeURIComponent(text)}`;
}
