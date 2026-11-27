import { describe, expect, it } from 'vitest';
import { DEFAULT_KEYBINDINGS, DEFAULT_SETTINGS } from '@langai/contracts';
import {
  createVocabularyCard,
  formatCardsForTelegram,
  generateVocabularyCsv,
  getDueCards,
  getSchedulingPreview,
  isCardDue,
  mergeSettings,
  Rating,
  resolveCardSourceUrl,
  reviewCard,
  STORAGE_LOCK_NAME,
  withStorageLock
} from '../index';

describe('mergeSettings legacy migration', () => {
  it('returns default settings for undefined or invalid input', () => {
    const fromUndefined = mergeSettings(undefined);
    const fromNull = mergeSettings(null);

    expect(fromUndefined).toEqual(DEFAULT_SETTINGS);
    expect(fromNull).toEqual(DEFAULT_SETTINGS);
    expect(fromUndefined.keybindings.quickSaveCard).toEqual({ code: 'KeyS' });
  });

  it('migrates fontSize to subtitleFontSize and clamps to [12, 56]', () => {
    const migrated = mergeSettings({ fontSize: 28 });
    expect(migrated.subtitleFontSize).toBe(28);
    expect(migrated.translationFontSize).toBe(Math.round(28 * DEFAULT_SETTINGS.translationScale));
    expect('fontSize' in migrated).toBe(false);

    expect(mergeSettings({ fontSize: 4 }).subtitleFontSize).toBe(12);
    expect(mergeSettings({ fontSize: 120 }).subtitleFontSize).toBe(56);
    expect(mergeSettings({ fontSize: 20, subtitleFontSize: 32 }).subtitleFontSize).toBe(32);
  });

  it('migrates overlayOpacity (0..1 and 0..100) to backdropOpacity (0..100)', () => {
    expect(mergeSettings({ overlayOpacity: 0.75 }).backdropOpacity).toBe(75);
    expect(mergeSettings({ overlayOpacity: 1 }).backdropOpacity).toBe(100);
    expect(mergeSettings({ overlayOpacity: 0 }).backdropOpacity).toBe(0);
    expect(mergeSettings({ overlayOpacity: 65 }).backdropOpacity).toBe(65);
    expect(mergeSettings({ overlayOpacity: 150 }).backdropOpacity).toBe(100);
    expect(mergeSettings({ overlayOpacity: 0.5, backdropOpacity: 40 }).backdropOpacity).toBe(40);
    expect('overlayOpacity' in mergeSettings({ overlayOpacity: 0.5 })).toBe(false);
  });

  it('migrates showDualSubtitles and showTranslation to subtitleTrackMode', () => {
    expect(mergeSettings({ showDualSubtitles: true, showTranslation: true }).subtitleTrackMode).toBe(
      'dual'
    );
    expect(
      mergeSettings({ showDualSubtitles: false, showTranslation: true }).subtitleTrackMode
    ).toBe('translation');
    expect(
      mergeSettings({ showDualSubtitles: false, showTranslation: false }).subtitleTrackMode
    ).toBe('original');
    expect(mergeSettings({ showDualSubtitles: false }).subtitleTrackMode).toBe('original');
    expect(mergeSettings({ showTranslation: false }).subtitleTrackMode).toBe('original');

    const explicit = mergeSettings({
      subtitleTrackMode: 'translation',
      showDualSubtitles: true
    });
    expect(explicit.subtitleTrackMode).toBe('translation');
    expect('showDualSubtitles' in explicit).toBe(false);
    expect('showTranslation' in explicit).toBe(false);
  });

  it('migrates cinemaModuleEnabled and netflixModuleEnabled into enabledServices', () => {
    const enabledBoth = mergeSettings({
      cinemaModuleEnabled: true,
      netflixModuleEnabled: true
    });
    expect(enabledBoth.enabledServices).toEqual({
      youtube: true,
      urplay: true,
      hdrezka: true,
      hianime: true,
      netflix: true
    });
    expect('cinemaModuleEnabled' in enabledBoth).toBe(false);
    expect('netflixModuleEnabled' in enabledBoth).toBe(false);

    const disabledCinema = mergeSettings({
      cinemaModuleEnabled: false,
      netflixModuleEnabled: true
    });
    expect(disabledCinema.enabledServices.urplay).toBe(false);
    expect(disabledCinema.enabledServices.hdrezka).toBe(false);
    expect(disabledCinema.enabledServices.hianime).toBe(false);
    expect(disabledCinema.enabledServices.netflix).toBe(true);
    expect(disabledCinema.enabledServices.youtube).toBe(true);
  });

  it('merges keybindings with DEFAULT_KEYBINDINGS including quickSaveCard', () => {
    const withDefaultQuickSave = mergeSettings({
      keybindings: {
        repeatCue: { code: 'KeyA', alt: true }
      }
    });
    expect(withDefaultQuickSave.keybindings.repeatCue).toEqual({ code: 'KeyA', alt: true });
    expect(withDefaultQuickSave.keybindings.quickSaveCard).toEqual(
      DEFAULT_KEYBINDINGS.quickSaveCard
    );

    const withCustomQuickSave = mergeSettings({
      keybindings: {
        quickSaveCard: { code: 'KeyQ', ctrl: true, shift: true }
      }
    });
    expect(withCustomQuickSave.keybindings.quickSaveCard).toEqual({
      code: 'KeyQ',
      ctrl: true,
      shift: true
    });

    const withUnboundQuickSave = mergeSettings({
      keybindings: {
        quickSaveCard: null
      }
    });
    expect(withUnboundQuickSave.keybindings.quickSaveCard).toBeNull();
  });
});

describe('storage lock, FSRS, card factory, and export URL resolution', () => {
  it('serializes concurrent operations with withStorageLock fallback queue', async () => {
    const events: string[] = [];
    await Promise.all([
      withStorageLock(STORAGE_LOCK_NAME, async () => {
        events.push('start-1');
        await new Promise((r) => setTimeout(r, 15));
        events.push('end-1');
      }),
      withStorageLock(STORAGE_LOCK_NAME, async () => {
        events.push('start-2');
        events.push('end-2');
      })
    ]);

    expect(events).toEqual(['start-1', 'end-1', 'start-2', 'end-2']);
  });

  it('creates vocabulary card with source metadata and runs FSRS scheduling', () => {
    const now = new Date('2026-01-01T10:00:00.000Z');
    const card = createVocabularyCard(
      {
        word: 'fönster',
        translation: 'window',
        contextSentence: 'Titta ut genom fönstret.',
        contextTranslation: 'Look out the window.',
        videoId: 'urplay-123',
        videoTitle: 'Svenska nyheter',
        timestampSec: 42,
        screenshotBase64: 'data:image/webp;base64,AAAA',
        sourceLang: 'sv',
        nativeLang: 'en',
        source: 'urplay',
        sourceLabel: 'UR Play',
        sourceUrl: 'https://urplay.se/program/123?t=42'
      },
      now
    );

    expect(card.source).toBe('urplay');
    expect(card.sourceLabel).toBe('UR Play');
    expect(card.sourceUrl).toBe('https://urplay.se/program/123?t=42');
    expect(card.mediaBlobKey).toBe(`media:${card.id}`);
    expect(isCardDue(card, now)).toBe(true);
    expect(getDueCards([card], now)).toHaveLength(1);

    const preview = getSchedulingPreview(card, now);
    expect(preview).toHaveLength(4);

    const reviewed = reviewCard(card, Rating.Good, now);
    expect(reviewed.fsrsState.reps).toBe(1);
    expect(new Date(reviewed.fsrsState.due).getTime()).toBeGreaterThan(now.getTime());
  });

  it('uses card.sourceUrl for CSV and Telegram exports without YouTube fallback on non-YouTube cards', () => {
    const now = new Date('2026-01-01T10:00:00.000Z');
    const urplayCard = createVocabularyCard(
      {
        word: 'lagom',
        translation: 'just enough',
        contextSentence: 'Det är lagom.',
        contextTranslation: 'That is just right.',
        videoId: 'ur-999',
        videoTitle: 'UR Play Show',
        timestampSec: 12,
        sourceLang: 'sv',
        nativeLang: 'en',
        source: 'urplay',
        sourceLabel: 'UR Play',
        sourceUrl: 'https://urplay.se/program/999?t=12'
      },
      now
    );

    const nonYoutubeWithoutUrl = createVocabularyCard(
      {
        word: 'nakama',
        translation: 'companion',
        contextSentence: 'Ore no nakama',
        contextTranslation: 'My companion',
        videoId: 'ep-1',
        videoTitle: 'Anime Ep 1',
        timestampSec: 100,
        sourceLang: 'ja',
        nativeLang: 'en',
        source: 'hianime',
        sourceLabel: 'HiAnime'
      },
      now
    );

    const youtubeFallback = createVocabularyCard(
      {
        word: 'hello',
        translation: 'привіт',
        contextSentence: 'Hello world',
        contextTranslation: 'Привіт світ',
        videoId: 'dQw4w9WgXcQ',
        videoTitle: 'YT Video',
        timestampSec: 15,
        sourceLang: 'en',
        nativeLang: 'uk',
        source: 'youtube'
      },
      now
    );

    expect(resolveCardSourceUrl(urplayCard)).toBe('https://urplay.se/program/999?t=12');
    expect(resolveCardSourceUrl(nonYoutubeWithoutUrl)).toBe('');
    expect(resolveCardSourceUrl(youtubeFallback)).toBe(
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=15s'
    );

    const csv = generateVocabularyCsv([urplayCard, nonYoutubeWithoutUrl]);
    expect(csv).toContain('https://urplay.se/program/999?t=12');
    expect(csv).not.toContain('youtube.com/watch');

    const tg = formatCardsForTelegram([urplayCard, nonYoutubeWithoutUrl]);
    expect(tg).toContain('https://urplay.se/program/999?t=12');
    expect(tg).not.toContain('youtube.com/watch');
  });
});
