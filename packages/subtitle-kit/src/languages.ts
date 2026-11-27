import type { SubtitleCue } from '@langai/contracts';

export interface LanguageOption {
  code: string;
  name: string;
  nativeName: string;
  label: string;
}

export interface ResolvedLanguagePair {
  effectiveSource: string;
  effectiveTarget: string;
  isReversed: boolean;
  isSmartSwitched: boolean;
}

export const SUPPORTED_LANGUAGES: readonly LanguageOption[] = [
  { code: 'ru', name: 'Russian', nativeName: 'Русский', label: 'Russian (Русский)' },
  { code: 'uk', name: 'Ukrainian', nativeName: 'Українська', label: 'Ukrainian (Українська)' },
  { code: 'en', name: 'English', nativeName: 'English', label: 'English' },
  { code: 'sv', name: 'Swedish', nativeName: 'Svenska', label: 'Swedish (Svenska)' },
  { code: 'es', name: 'Spanish', nativeName: 'Español', label: 'Spanish (Español)' },
  { code: 'de', name: 'German', nativeName: 'Deutsch', label: 'German (Deutsch)' },
  { code: 'fr', name: 'French', nativeName: 'Français', label: 'French (Français)' },
  { code: 'it', name: 'Italian', nativeName: 'Italiano', label: 'Italian (Italiano)' },
  { code: 'pt', name: 'Portuguese', nativeName: 'Português', label: 'Portuguese (Português)' },
  { code: 'pl', name: 'Polish', nativeName: 'Polski', label: 'Polish (Polski)' },
  { code: 'tr', name: 'Turkish', nativeName: 'Türkçe', label: 'Turkish (Türkçe)' },
  { code: 'ja', name: 'Japanese', nativeName: '日本語', label: 'Japanese (日本語)' },
  { code: 'ko', name: 'Korean', nativeName: '한국어', label: 'Korean (한국어)' },
  { code: 'zh-CN', name: 'Chinese', nativeName: '简体中文', label: 'Chinese (简体中文)' }
];

export const LANGUAGE_OPTIONS: readonly LanguageOption[] = SUPPORTED_LANGUAGES;

export const SOURCE_LANGUAGE_OPTIONS: readonly LanguageOption[] = [
  { code: 'auto', name: 'Auto', nativeName: 'Auto', label: 'Auto' },
  ...SUPPORTED_LANGUAGES
];

const LANGUAGE_ALIASES: Readonly<Record<string, string>> = {
  russian: 'ru',
  русский: 'ru',
  rus: 'ru',
  ukrainian: 'uk',
  українська: 'uk',
  ukr: 'uk',
  english: 'en',
  eng: 'en',
  swedish: 'sv',
  svenska: 'sv',
  swe: 'sv',
  sve: 'sv',
  spanish: 'es',
  español: 'es',
  espanol: 'es',
  spa: 'es',
  german: 'de',
  deutsch: 'de',
  deu: 'de',
  ger: 'de',
  french: 'fr',
  français: 'fr',
  francais: 'fr',
  fra: 'fr',
  fre: 'fr',
  italian: 'it',
  italiano: 'it',
  ita: 'it',
  portuguese: 'pt',
  português: 'pt',
  portugues: 'pt',
  por: 'pt',
  polish: 'pl',
  polski: 'pl',
  pol: 'pl',
  turkish: 'tr',
  türkçe: 'tr',
  turkce: 'tr',
  tur: 'tr',
  japanese: 'ja',
  日本語: 'ja',
  jpn: 'ja',
  korean: 'ko',
  한국어: 'ko',
  kor: 'ko',
  chinese: 'zh-CN',
  简体中文: 'zh-CN',
  zh: 'zh-CN',
  'zh-cn': 'zh-CN',
  zh_cn: 'zh-CN',
  'zh-hans': 'zh-CN',
  zho: 'zh-CN',
  chi: 'zh-CN',
  'zh-tw': 'zh-TW',
  zh_tw: 'zh-TW',
  'zh-hk': 'zh-TW',
  'zh-hant': 'zh-TW'
};

/**
 * Normalizes a language code, ISO-639-2 code, or language name into canonical BCP-47 form.
 */
export function normalizeLanguageCode(code: string | undefined | null): string {
  if (!code) return 'en';
  const clean = code.trim().toLowerCase();
  if (!clean || clean === 'auto' || clean === 'unknown' || clean === 'und') return 'auto';

  const aliased = LANGUAGE_ALIASES[clean];
  if (aliased) return aliased;

  const twoMatch = clean.match(/^([a-z]{2})(?:[-_][a-z0-9]+)?$/i);
  if (twoMatch) {
    return twoMatch[1].toLowerCase();
  }
  return clean;
}

/**
 * Formats a language code as a compact uppercase badge label (e.g. `EN`, `ZH`, `AUTO`).
 */
export function formatShortLangCode(code: string | undefined | null): string {
  if (!code) return 'AUTO';
  const norm = normalizeLanguageCode(code);
  if (norm === 'auto') return 'AUTO';
  if (norm.toLowerCase().startsWith('zh')) return 'ZH';
  return norm.slice(0, 3).toUpperCase();
}

/**
 * Returns the English + native label for a language code, or its short code if unknown.
 */
export function getLanguageLabel(code: string): string {
  const norm = normalizeLanguageCode(code);
  const found = SOURCE_LANGUAGE_OPTIONS.find(
    (opt) =>
      opt.code.toLowerCase() === norm.toLowerCase() ||
      opt.code.toLowerCase() === code.trim().toLowerCase()
  );
  return found ? found.label : formatShortLangCode(code);
}

/**
 * Returns true if two language codes share the same base language (ignoring regional variants).
 */
export function isSameLanguage(a: string, b: string): boolean {
  if (!a || !b || a === 'auto' || b === 'auto') return false;
  const na = normalizeLanguageCode(a).toLowerCase();
  const nb = normalizeLanguageCode(b).toLowerCase();
  if (na === 'auto' || nb === 'auto') return false;
  return na === nb || na.split('-')[0] === nb.split('-')[0];
}

/**
 * Backwards-compatible alias for `isSameLanguage`.
 */
export const isSameBaseLang = isSameLanguage;

/**
 * Resolves the effective source/target translation pair, applying smart-switching
 * when source matches nativeLang and optional reversePair inversion.
 */
export function resolveLanguagePair(
  settings: {
    nativeLang: string;
    sourceLang?: string;
    secondaryLang?: string;
    reversePair?: boolean;
  },
  detectedTrackLang?: string | null
): ResolvedLanguagePair {
  const rawSource = settings.sourceLang ? normalizeLanguageCode(settings.sourceLang) : 'auto';
  let resolvedSource = rawSource;

  if (
    rawSource === 'auto' &&
    detectedTrackLang &&
    detectedTrackLang !== 'auto' &&
    detectedTrackLang !== 'unknown' &&
    detectedTrackLang !== 'und'
  ) {
    const normDetected = normalizeLanguageCode(detectedTrackLang);
    if (normDetected && normDetected !== 'auto') {
      resolvedSource = normDetected;
    }
  }

  let resolvedTarget = normalizeLanguageCode(settings.nativeLang || 'ru');
  if (resolvedTarget === 'auto') {
    resolvedTarget = 'ru';
  }

  let secondary = normalizeLanguageCode(
    settings.secondaryLang || (isSameLanguage(resolvedTarget, 'en') ? 'ru' : 'en')
  );
  if (secondary === 'auto' || isSameLanguage(secondary, resolvedTarget)) {
    secondary = isSameLanguage(resolvedTarget, 'en') ? 'ru' : 'en';
  }

  let isSmartSwitched = false;
  if (resolvedSource !== 'auto' && isSameLanguage(resolvedSource, resolvedTarget)) {
    resolvedTarget = secondary;
    isSmartSwitched = true;
  }

  const isReversed = Boolean(settings.reversePair);
  if (isReversed) {
    const tmpSource = resolvedSource === 'auto' ? secondary : resolvedSource;
    resolvedSource = resolvedTarget;
    resolvedTarget = tmpSource;
  }

  return {
    effectiveSource: resolvedSource,
    effectiveTarget: resolvedTarget,
    isReversed,
    isSmartSwitched
  };
}

/**
 * Detects a normalized language code from a track label, filename, or hint string.
 */
export function detectLanguageFromLabel(label: string): string {
  if (!label) return '';
  const l = label.toLowerCase().trim();
  if (!l || l === 'auto' || l === 'und' || l === 'unknown') return '';

  const isoExact = l.match(/^(ru|uk|en|sv|es|de|fr|it|pt|pl|tr|ja|ko)(?:[-_][a-z0-9]+)?$/i);
  if (isoExact) return isoExact[1].toLowerCase();
  if (/^zh(?:[-_][a-z0-9]+)?$/i.test(l)) return 'zh-CN';

  if (
    l.includes('svensk') ||
    l.includes('swed') ||
    l.includes('швед') ||
    /\b(swe|sve)\b/.test(l)
  ) {
    return 'sv';
  }
  if (l.includes('eng') || l.includes('англ')) return 'en';
  if (
    l.includes('rus') ||
    l.includes('рус') ||
    /(?:^|[\s([._-])ру(?:$|[\s)\]._,-])/i.test(l)
  ) {
    return 'ru';
  }
  if (l.includes('ukr') || l.includes('укр') || l.includes('україн')) return 'uk';
  if (
    l.includes('jap') ||
    l.includes('япон') ||
    l.includes('nihon') ||
    l.includes('jpn') ||
    l.includes('日本語')
  ) {
    return 'ja';
  }
  if (
    l.includes('kor') ||
    l.includes('корей') ||
    l.includes('hangul') ||
    l.includes('한국')
  ) {
    return 'ko';
  }
  if (l.includes('chi') || l.includes('zho') || l.includes('кит') || l.includes('中文')) {
    return 'zh-CN';
  }
  if (l.includes('spa') || l.includes('испан') || l.includes('esp') || l.includes('spansk')) {
    return 'es';
  }
  if (
    l.includes('ger') ||
    l.includes('deu') ||
    l.includes('немец') ||
    l.includes('deutsch') ||
    l.includes('tysk')
  ) {
    return 'de';
  }
  if (l.includes('fra') || l.includes('fre') || l.includes('франц') || l.includes('fransk')) {
    return 'fr';
  }
  if (l.includes('ita') || l.includes('итал')) return 'it';
  if (l.includes('por') || l.includes('португ')) return 'pt';
  if (l.includes('pol') || l.includes('польск')) return 'pl';
  if (l.includes('tur') || l.includes('турец') || l.includes('türk')) return 'tr';

  const fileLangMatch =
    l.match(/[/_.-](ru|uk|en|sv|swe|es|de|fr|it|pt|pl|tr|ja|ko|zh)[/_.-]/i) ??
    l.match(
      /(?:^|[/_.-])sub[_-]?(ru|uk|en|sv|swe|es|de|fr|it|pt|pl|tr|ja|ko|zh)\.(?:vtt|srt)/i
    );
  if (fileLangMatch?.[1]) {
    const code = fileLangMatch[1].toLowerCase();
    if (code === 'swe') return 'sv';
    if (code === 'zh') return 'zh-CN';
    return code;
  }

  return '';
}

/**
 * Heuristically detects the dominant language from a sample of subtitle cues.
 */
export function detectLanguageFromCues(cues: SubtitleCue[], defaultLang = 'en'): string {
  const sample = cues
    .slice(0, 30)
    .map((c) => c.text)
    .join(' ');
  if (!sample.trim()) return defaultLang;

  // Japanese (Hiragana / Katakana)
  if (/[\u3040-\u309F\u30A0-\u30FF]/.test(sample)) {
    return 'ja';
  }
  // Korean (Hangul)
  if (/[\uAC00-\uD7AF\u1100-\u11FF]/.test(sample)) {
    return 'ko';
  }
  // Chinese (CJK Unified Ideographs without Japanese kana)
  if (/[\u4E00-\u9FFF]/.test(sample)) {
    return 'zh-CN';
  }
  // Cyrillic
  if (/[\u0400-\u04FF]/.test(sample)) {
    if (/[іїєґІЇЄҐ]/.test(sample)) {
      return 'uk';
    }
    return 'ru';
  }

  // German sharp-s is unambiguous
  if (/ß/.test(sample)) {
    return 'de';
  }

  // Distinguish Swedish vs German vs default Latin
  const hasAring = /[åÅ]/.test(sample);
  const hasSweDia = /[äöÄÖ]/.test(sample);
  const hasUmlautU = /[üÜ]/.test(sample);
  const sweWordMatches =
    sample.match(
      /\b(och|att|det|jag|inte|är|för|som|på|har|med|från|när|här|vad|ska|kan|vill|också|eller|mycket)\b/gi
    ) ?? [];
  const deWordMatches =
    sample.match(
      /\b(und|nicht|ich|das|ist|ein|eine|wir|sie|mit|auf|für|auch|oder|aber)\b/gi
    ) ?? [];

  const sweScore = (hasAring ? 3 : 0) + (hasSweDia ? 1 : 0) + sweWordMatches.length;
  const deScore = (hasUmlautU ? 2 : 0) + (hasSweDia ? 1 : 0) + deWordMatches.length;

  if (sweScore > deScore && (hasAring || sweScore >= 2 || (hasSweDia && defaultLang === 'sv'))) {
    return 'sv';
  }
  if (deScore > sweScore && (hasUmlautU || deScore >= 2)) {
    return 'de';
  }
  if (hasAring) {
    return 'sv';
  }

  return defaultLang;
}

/**
 * Detects track language from its label first, falling back to cue text heuristics.
 */
export function detectLanguageFromLabelAndCues(
  label: string,
  cues: SubtitleCue[],
  defaultLang = 'en'
): string {
  const fromLabel = detectLanguageFromLabel(label);
  if (fromLabel && fromLabel !== 'auto' && fromLabel !== 'und') {
    return fromLabel;
  }
  const fallback =
    /\b(orig|ориг)\b/i.test(label) && defaultLang === 'sv' ? 'sv' : defaultLang;
  return detectLanguageFromCues(cues, fallback);
}

const KNOWN_URL_LANG_CODES = new Set([
  'ru', 'uk', 'en', 'sv', 'swe', 'sve', 'es', 'spa', 'de', 'deu', 'ger',
  'fr', 'fra', 'fre', 'it', 'ita', 'pt', 'por', 'pl', 'pol', 'tr', 'tur',
  'ja', 'jpn', 'ko', 'kor', 'zh', 'zh-cn', 'zh-tw', 'zho', 'chi'
]);

/**
 * Extracts and normalizes a subtitle language code from a track URL's query params or path.
 */
export function extractLangCodeFromUrl(rawUrl: string): string {
  if (!rawUrl || !rawUrl.trim()) return '';

  try {
    const parsed = new URL(rawUrl.trim(), 'https://placeholder.local');

    for (const param of ['tlang', 'lang', 'language', 'srclang', 'locale', 'hl']) {
      const value = parsed.searchParams.get(param);
      if (!value) continue;
      const detected = detectLanguageFromLabel(value) || normalizeLanguageCode(value);
      if (detected && detected !== 'auto') {
        return detected;
      }
    }

    const pathname = decodeURIComponent(parsed.pathname);
    const fileMatch = pathname.match(
      /(?:^|[/_.-])(?:sub(?:title)?s?[_-]?)?(ru|uk|en|sv|swe|sve|es|spa|de|deu|ger|fr|fra|fre|it|ita|pt|por|pl|pol|tr|tur|ja|jpn|ko|kor|zh|zh-cn|zh-tw|zho|chi)(?:[-_][a-z]{2,4})?\.(?:vtt|srt|ass|ssa|json3|xml|srv3)$/i
    );
    if (fileMatch?.[1]) {
      const norm = normalizeLanguageCode(fileMatch[1]);
      if (norm && norm !== 'auto') return norm;
    }

    const segments = pathname.split('/').filter(Boolean);
    for (const segment of segments) {
      const lower = segment.toLowerCase();
      const base = lower.split(/[-_]/)[0];
      if (KNOWN_URL_LANG_CODES.has(lower) || KNOWN_URL_LANG_CODES.has(base)) {
        const norm = normalizeLanguageCode(lower);
        if (norm && norm !== 'auto') return norm;
      }
    }

    const labelDetected = detectLanguageFromLabel(pathname);
    if (labelDetected) return labelDetected;
  } catch {
    return detectLanguageFromLabel(rawUrl);
  }

  return '';
}
