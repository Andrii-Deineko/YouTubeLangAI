export interface LanguageOption {
  code: string;
  label: string;
}

export const LANGUAGE_OPTIONS: readonly LanguageOption[] = [
  { code: 'uk', label: 'Ukrainian (Українська)' },
  { code: 'en', label: 'English' },
  { code: 'sv', label: 'Swedish (Svenska)' },
  { code: 'es', label: 'Spanish (Español)' },
  { code: 'de', label: 'German (Deutsch)' },
  { code: 'fr', label: 'French (Français)' },
  { code: 'it', label: 'Italian (Italiano)' },
  { code: 'pt', label: 'Portuguese (Português)' },
  { code: 'pl', label: 'Polish (Polski)' },
  { code: 'tr', label: 'Turkish (Türkçe)' },
  { code: 'ja', label: 'Japanese (日本語)' },
  { code: 'ko', label: 'Korean (한국어)' },
  { code: 'zh-CN', label: 'Chinese (简体中文)' },
  { code: 'ru', label: 'Russian (Русский)' }
];

export const SOURCE_LANGUAGE_OPTIONS: readonly LanguageOption[] = [
  { code: 'auto', label: 'Auto' },
  ...LANGUAGE_OPTIONS
];

export interface ResolvedLanguagePair {
  effectiveSource: string;
  effectiveTarget: string;
  isReversed: boolean;
  isSmartSwitched: boolean;
}

export function normalizeLanguageCode(code: string | undefined | null): string {
  if (!code) return 'en';
  const clean = code.trim().toLowerCase();
  if (!clean || clean === 'auto' || clean === 'unknown' || clean === 'und') return 'auto';

  if (clean === 'swedish' || clean === 'svenska' || clean === 'swe' || clean === 'sve') {
    return 'sv';
  }
  if (clean === 'russian' || clean === 'rus') {
    return 'ru';
  }
  if (clean === 'english' || clean === 'eng') {
    return 'en';
  }
  if (clean === 'ukrainian' || clean === 'українська' || clean === 'ukr') {
    return 'uk';
  }
  if (clean === 'zh' || clean === 'zh-cn' || clean === 'zh_cn' || clean === 'zho' || clean === 'chi') {
    return 'zh-CN';
  }
  if (clean === 'zh-tw' || clean === 'zh_tw' || clean === 'zh-hk') {
    return 'zh-TW';
  }

  const twoMatch = clean.match(/^([a-z]{2})(?:[-_][a-z0-9]+)?$/i);
  if (twoMatch?.[1]) {
    return twoMatch[1].toLowerCase();
  }
  return clean;
}

export function formatShortLangCode(code: string | undefined | null): string {
  if (!code) return 'AUTO';
  const norm = normalizeLanguageCode(code);
  if (norm === 'auto') return 'AUTO';
  if (norm.toLowerCase().startsWith('zh')) return 'ZH';
  return norm.slice(0, 3).toUpperCase();
}

export function getLanguageLabel(code: string): string {
  const norm = normalizeLanguageCode(code);
  const found = SOURCE_LANGUAGE_OPTIONS.find(
    (opt) => opt.code.toLowerCase() === norm.toLowerCase() || opt.code.toLowerCase() === code.toLowerCase()
  );
  return found ? found.label : formatShortLangCode(code);
}

export function isSameBaseLang(a: string, b: string): boolean {
  if (!a || !b || a === 'auto' || b === 'auto') return false;
  const na = normalizeLanguageCode(a).toLowerCase();
  const nb = normalizeLanguageCode(b).toLowerCase();
  return na === nb || na.split('-')[0] === nb.split('-')[0];
}

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

  let resolvedTarget = normalizeLanguageCode(settings.nativeLang || 'uk');
  if (resolvedTarget === 'auto') {
    resolvedTarget = 'uk';
  }

  let secondary = normalizeLanguageCode(
    settings.secondaryLang || (isSameBaseLang(resolvedTarget, 'en') ? 'uk' : 'en')
  );
  if (secondary === 'auto' || isSameBaseLang(secondary, resolvedTarget)) {
    secondary = isSameBaseLang(resolvedTarget, 'en') ? 'uk' : 'en';
  }

  let isSmartSwitched = false;
  if (resolvedSource !== 'auto' && isSameBaseLang(resolvedSource, resolvedTarget)) {
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
