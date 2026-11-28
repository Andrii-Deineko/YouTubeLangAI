const FALLBACK_TTS_LOCALES: Record<string, string> = {
  sv: 'sv-SE',
  ru: 'ru-RU',
  uk: 'uk-UA',
  en: 'en-US',
  de: 'de-DE',
  fr: 'fr-FR',
  es: 'es-ES',
  it: 'it-IT',
  pt: 'pt-BR',
  pl: 'pl-PL',
  tr: 'tr-TR',
  ja: 'ja-JP',
  ko: 'ko-KR',
  'zh-cn': 'zh-CN'
};

/**
 * Pronounces text via the Web Speech API using the best matching system voice.
 */
export function speakText(text: string, langCode: string): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  try {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const voices = window.speechSynthesis.getVoices();
    const normLang = langCode.trim().toLowerCase();
    const baseLang = normLang.split('-')[0] ?? normLang;
    const matchedVoice =
      voices.find((v) => v.lang.toLowerCase() === normLang) ??
      voices.find((v) => v.lang.toLowerCase().startsWith(baseLang));
    if (matchedVoice) {
      utterance.voice = matchedVoice;
      utterance.lang = matchedVoice.lang;
    } else if (normLang && normLang !== 'unknown' && normLang !== 'auto') {
      utterance.lang = FALLBACK_TTS_LOCALES[normLang] ?? FALLBACK_TTS_LOCALES[baseLang] ?? langCode;
    }
    utterance.rate = 0.95;
    window.speechSynthesis.speak(utterance);
  } catch {
    // Ignore speech synthesis errors in restricted contexts
  }
}
