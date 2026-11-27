import { describe, expect, it } from 'vitest';
import type { Json3Response, SubtitleCue } from '@langai/contracts';
import {
  SUPPORTED_LANGUAGES,
  SOURCE_LANGUAGE_OPTIONS,
  SubtitleEngine,
  cleanSubtitleText,
  convertSubtitleLnsToPlayerJs,
  decodeHtmlEntities,
  detectAsrTrack,
  extractLangCodeFromUrl,
  getLanguageLabel,
  isSameLanguage,
  normalizeLanguageCode,
  normalizeWord,
  parseJson3,
  parsePlayerJsSubtitleString,
  parseSrt,
  parseSrv3,
  parseSubtitles,
  parseTimedtextToJson3,
  parseVtt,
  resolveLanguagePair,
  splitLongCue,
  tokenizeCue,
  tokenizeText
} from '../index';

describe('HTML entities and text cleaning', () => {
  it('decodes named, decimal, and hex HTML entities', () => {
    expect(decodeHtmlEntities('Tom &amp; Jerry&#39;s &quot;show&quot; &lt;3&gt;&nbsp;ok')).toBe(
      'Tom & Jerry\'s "show" <3> ok'
    );
    expect(decodeHtmlEntities('Hex &#x2014; dec &#8212;')).toBe('Hex \u2014 dec \u2014');
  });

  it('cleans markup, ASS blocks, and line breaks', () => {
    expect(cleanSubtitleText('{\\an8}<i>Hello</i><br/>world &amp; friends')).toBe(
      'Hello world & friends'
    );
  });
});

describe('Tokenizer', () => {
  it('tokenizes text and cues with proportional timings', () => {
    const tokens = tokenizeText("Don't stop, Sweden!", {
      cueId: 'c1',
      startTime: 10,
      endTime: 14
    });
    const words = tokens.filter((t) => t.isWord);
    expect(words.map((w) => w.normalized)).toEqual(["don't", 'stop', 'sweden']);
    expect(words[0].startTime).toBeGreaterThanOrEqual(10);
    expect(words[words.length - 1].endTime).toBeLessThanOrEqual(14);

    const cue: SubtitleCue = {
      id: 'c2',
      startTime: 1,
      endTime: 3,
      text: 'Hej världen',
      tokens: []
    };
    const cueTokens = tokenizeCue(cue);
    expect(cueTokens.filter((t) => t.isWord).map((t) => t.normalized)).toEqual(['hej', 'världen']);
    expect(normalizeWord('  "Hello!" ')).toBe('hello');
  });
});

describe('VTT, SRT, JSON3, and SRV3 parsing', () => {
  it('parses WebVTT with BOM, NOTE blocks, cue settings, and entities', () => {
    const vtt = `\uFEFFWEBVTT

NOTE comment with --> arrow inside

1
00:00:01.000 --> 00:00:03.500 align:start position:0%
<i>Hello</i> &amp; welcome!

00:00:04.000 --> 00:00:06.250
Second line
continues here.
`;
    const cues = parseVtt(vtt);
    expect(cues).toHaveLength(2);
    expect(cues[0].text).toBe('Hello & welcome!');
    expect(cues[0].startTime).toBe(1);
    expect(cues[0].endTime).toBe(3.5);
    expect(cues[1].text).toBe('Second line continues here.');
    expect(cues[1].tokens.some((t) => t.isWord && t.normalized === 'continues')).toBe(true);
  });

  it('parses SRT with CRLF line endings and comma milliseconds', () => {
    const srt =
      '1\r\n00:00:02,500 --> 00:00:05,000\r\nFirst subtitle\r\n\r\n2\r\n00:01:00,100 --> 00:01:02,200\r\nSecond subtitle\r\n';
    const cues = parseSubtitles(srt);
    expect(cues).toHaveLength(2);
    expect(cues[0]).toMatchObject({ startTime: 2.5, endTime: 5, text: 'First subtitle' });
    expect(cues[1]).toMatchObject({ startTime: 60.1, endTime: 62.2, text: 'Second subtitle' });
    expect(parseSrt(srt)).toHaveLength(2);
  });

  it('splits overly long cues proportionally while preserving total range', () => {
    const longText =
      'This is a deliberately very long subtitle sentence that should be split cleanly at a natural boundary, because readers cannot easily read eighty-five characters at once.';
    const parts = splitLongCue({
      id: 'long_1',
      index: 0,
      startTime: 10,
      endTime: 20,
      text: longText,
      translation: 'Це навмисно дуже довгий рядок субтитрів, який має бути розділений пропорційно.',
      tokens: []
    });
    expect(parts.length).toBeGreaterThan(1);
    expect(parts[0].startTime).toBe(10);
    expect(parts[parts.length - 1].endTime).toBe(20);
    expect(parts.every((p) => p.text.length <= 85)).toBe(true);
  });

  it('parses standard JSON3 and SRV3 XML without DOM APIs', () => {
    const json3: Json3Response = {
      events: [
        { tStartMs: 1000, dDurationMs: 2000, segs: [{ utf8: 'Hello ' }, { utf8: 'world!' }] },
        { tStartMs: 4000, dDurationMs: 1500, segs: [{ utf8: 'Next cue.' }] }
      ]
    };
    const cues = parseJson3(json3);
    expect(cues).toHaveLength(2);
    expect(cues[0].text).toBe('Hello world!');
    expect(cues[0].startTime).toBe(1);
    expect(cues[0].endTime).toBe(3);

    const srv3 =
      '<timedtext format="3"><body><p t="1500" d="2000">Hi &amp; bye</p></body></timedtext>';
    const srvCues = parseSrv3(srv3);
    expect(srvCues).toHaveLength(1);
    expect(srvCues[0].text).toBe('Hi & bye');
    expect(srvCues[0].startTime).toBe(1.5);
    expect(parseTimedtextToJson3(srv3)?.events).toHaveLength(1);
  });

  it('merges YouTube ASR word-level events and deduplicates overlaps', () => {
    const asrData: Json3Response = {
      events: [
        {
          tStartMs: 1000,
          dDurationMs: 2000,
          wWinId: 1,
          segs: [
            { utf8: 'Hello', tOffsetMs: 0 },
            { utf8: 'world', tOffsetMs: 400 },
            { utf8: 'today.', tOffsetMs: 800 }
          ]
        },
        {
          tStartMs: 1400,
          dDurationMs: 600,
          aAppend: 1,
          segs: [{ utf8: 'world', tOffsetMs: 0 }]
        },
        {
          tStartMs: 3200,
          dDurationMs: 1500,
          wWinId: 1,
          segs: [
            { utf8: 'New', tOffsetMs: 0 },
            { utf8: 'sentence', tOffsetMs: 300 }
          ]
        }
      ]
    };

    expect(detectAsrTrack(asrData.events ?? [])).toBe(true);
    const cues = parseJson3(asrData, { kind: 'asr' });
    expect(cues).toHaveLength(2);
    expect(cues[0].text).toBe('Hello world today.');
    expect(cues[0].startTime).toBe(1);
    expect(cues[1].text).toBe('New sentence');
    expect(cues[1].startTime).toBe(3.2);
  });
});

describe('PlayerJS subtitle string parser', () => {
  it('allows relative paths starting with / and resolves them with baseUrl', () => {
    const raw = '[English]/subs/en.vtt,[Swedish]/media/tracks/sv.srt,[German]https://cdn.site.com/de.vtt';
    const resolved = parsePlayerJsSubtitleString(raw, 'https://cinema.example.com/watch/42');
    expect(resolved).toEqual([
      {
        label: 'English',
        language: 'en',
        url: 'https://cinema.example.com/subs/en.vtt'
      },
      {
        label: 'Swedish',
        language: 'sv',
        url: 'https://cinema.example.com/media/tracks/sv.srt'
      },
      {
        label: 'German',
        language: 'de',
        url: 'https://cdn.site.com/de.vtt'
      }
    ]);
  });

  it('preserves valid relative paths starting with / when no baseUrl is provided', () => {
    const raw = '[Ukrainian]/subtitles/uk.vtt';
    expect(parsePlayerJsSubtitleString(raw)).toEqual([
      {
        label: 'Ukrainian',
        language: 'uk',
        url: '/subtitles/uk.vtt'
      }
    ]);

    expect(parsePlayerJsSubtitleString('/tracks/sv.vtt')).toEqual([
      {
        label: 'Subtitles',
        language: 'sv',
        url: '/tracks/sv.vtt'
      }
    ]);
  });

  it('converts subtitle_lns JSON objects containing relative / paths', () => {
    const jsonRaw = '{"English":"/subs/en.vtt","Spanish":"https://cdn.example.com/es.vtt"}';
    expect(convertSubtitleLnsToPlayerJs(jsonRaw)).toBe(
      '[English]/subs/en.vtt,[Spanish]https://cdn.example.com/es.vtt'
    );
    const tracks = parsePlayerJsSubtitleString(jsonRaw, 'https://player.example.org/embed');
    expect(tracks).toEqual([
      { label: 'English', language: 'en', url: 'https://player.example.org/subs/en.vtt' },
      { label: 'Spanish', language: 'es', url: 'https://cdn.example.com/es.vtt' }
    ]);
  });
});

describe('SubtitleEngine', () => {
  const sampleCues: SubtitleCue[] = [
    { id: 'c0', startTime: 2, endTime: 5, text: 'First cue', tokens: [] },
    { id: 'c1', startTime: 7, endTime: 10, text: 'Second cue', tokens: [] },
    { id: 'c2', startTime: 12, endTime: 15, text: 'Third cue', tokens: [] }
  ];

  it('stores batch translations directly on cue.translation without synthetic tr-* cues', () => {
    const engine = new SubtitleEngine();
    engine.loadCues(sampleCues);

    const changed = engine.applyBatchTranslations(
      new Map([
        ['c0', 'Перший рядок'],
        ['c1', 'MYMEMORY WARNING: QUOTA EXCEEDED'],
        ['c2', 'Третій рядок']
      ])
    );

    expect(changed).toBe(true);
    expect(engine.getCues()).toHaveLength(3);
    expect(engine.getCues()[0].translation).toBe('Перший рядок');
    expect(engine.getCues()[1].translation).toBeUndefined();
    expect(engine.getCues()[2].translation).toBe('Третій рядок');
    expect(engine.getCues().some((c) => c.id.startsWith('tr-'))).toBe(false);

    engine.clearTranslations();
    expect(engine.getCues()[0].translation).toBeUndefined();

    // Verify legacy synthetic methods were completely removed
    const engineProto = SubtitleEngine.prototype as unknown as Record<string, unknown>;
    expect(engineProto.setTranslatedCuesFromBatch).toBeUndefined();
    expect(engineProto.syncGeneratedCueTimings).toBeUndefined();
    expect(engineProto.getGeneratedCue).toBeUndefined();
    expect(engineProto.hasNativeCues).toBeUndefined();
  });

  it('applies subtitleOffsetSec (effectiveTime = timeSec - offsetSec) across lookup and navigation', () => {
    const engine = new SubtitleEngine();
    engine.loadCues(sampleCues);

    // Without offset: 3.5s -> c0 (2..5)
    expect(engine.getCueAt(3.5)?.id).toBe('c0');
    expect(engine.findActiveCue(3.5)?.id).toBe('c0');

    // Positive offset +2s delays subtitles: at video time 9s, effectiveTime = 9 - 2 = 7s -> c1 (7..10)
    expect(engine.getCueAt(9, 2)?.id).toBe('c1');
    expect(engine.getCueAt(5.5, 2)?.id).toBe('c0'); // effectiveTime = 3.5s -> c0 (2..5)
    expect(engine.getCueAt(8.5, 2)).toBeNull(); // effectiveTime = 6.5s -> gap between c0 and c1

    // Negative offset -2s advances subtitles: at video time 5.5s, effectiveTime = 5.5 - (-2) = 7.5s -> c1 (7..10)
    expect(engine.getCueAt(5.5, -2)?.id).toBe('c1');

    // Navigation with offsetSec = 2:
    // At timeSec = 9.5, effectiveTime = 7.5 (within 1s of c1.startTime=7) -> previous cue is c0
    expect(engine.getPreviousCue(9.5, 2)?.id).toBe('c0');
    // At timeSec = 10.5, effectiveTime = 8.5 (>1s past c1.startTime=7) -> restarts c1
    expect(engine.getPreviousCue(10.5, 2)?.id).toBe('c1');
    // At timeSec = 9.5, effectiveTime = 7.5 (inside c1) -> next cue is c2
    expect(engine.getNextCue(9.5, 2)?.id).toBe('c2');
    // In gap at timeSec = 8.0, offsetSec = 2 -> effectiveTime = 6.0 -> beforeIdx = 0 -> next is c1
    expect(engine.findCueIndexAtOrBefore(8.0, 2)).toBe(0);
    expect(engine.getNextCue(8.0, 2)?.id).toBe('c1');
  });
});

describe('Language utilities', () => {
  it('exports SUPPORTED_LANGUAGES without Russian UI strings', () => {
    expect(SUPPORTED_LANGUAGES.length).toBeGreaterThanOrEqual(14);
    const allLabels = [...SUPPORTED_LANGUAGES, ...SOURCE_LANGUAGE_OPTIONS].map((l) => l.label);
    expect(allLabels.some((l) => l.includes('Шведский'))).toBe(false);
    expect(allLabels.some((l) => l.includes('Автоопределение'))).toBe(false);
    expect(getLanguageLabel('sv')).toBe('Swedish (Svenska)');
    expect(getLanguageLabel('auto')).toBe('Auto');
  });

  it('normalizes codes, compares base languages, and extracts lang codes from URLs', () => {
    expect(normalizeLanguageCode('sv-SE')).toBe('sv');
    expect(normalizeLanguageCode('zh_CN')).toBe('zh-CN');
    expect(normalizeLanguageCode('swe')).toBe('sv');
    expect(isSameLanguage('en-US', 'en-GB')).toBe(true);
    expect(isSameLanguage('sv', 'de')).toBe(false);
    expect(isSameLanguage('auto', 'en')).toBe(false);

    expect(
      extractLangCodeFromUrl('https://www.youtube.com/api/timedtext?v=123&lang=sv&fmt=json3')
    ).toBe('sv');
    expect(
      extractLangCodeFromUrl('https://www.youtube.com/api/timedtext?v=123&lang=en&tlang=uk')
    ).toBe('uk');
    expect(extractLangCodeFromUrl('/subtitles/de/episode1.vtt')).toBe('de');
    expect(extractLangCodeFromUrl('https://cdn.example.com/tracks/movie.fr.srt')).toBe('fr');
  });

  it('resolves language pairs with auto detection, smart-switching, and reversePair', () => {
    // 1. Standard auto source with detected Swedish track -> sv -> uk
    expect(
      resolveLanguagePair(
        { nativeLang: 'uk', sourceLang: 'auto', secondaryLang: 'en', reversePair: false },
        'sv-SE'
      )
    ).toEqual({
      effectiveSource: 'sv',
      effectiveTarget: 'uk',
      isReversed: false,
      isSmartSwitched: false
    });

    // 2. Smart switch when detected source matches nativeLang (uk -> uk switches target to secondaryLang en)
    expect(
      resolveLanguagePair(
        { nativeLang: 'uk', sourceLang: 'auto', secondaryLang: 'en', reversePair: false },
        'uk'
      )
    ).toEqual({
      effectiveSource: 'uk',
      effectiveTarget: 'en',
      isReversed: false,
      isSmartSwitched: true
    });

    // 3. Reverse pair flips effectiveSource and effectiveTarget
    expect(
      resolveLanguagePair(
        { nativeLang: 'uk', sourceLang: 'sv', secondaryLang: 'en', reversePair: true },
        null
      )
    ).toEqual({
      effectiveSource: 'uk',
      effectiveTarget: 'sv',
      isReversed: true,
      isSmartSwitched: false
    });
  });
});
