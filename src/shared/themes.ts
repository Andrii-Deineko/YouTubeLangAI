import type { SubtitleScale, ThemeId } from '../types/settings';

export interface ThemeDefinition {
  id: ThemeId;
  name: string;
  tagline: string;
  bgRgb: string;
  textPrimary: string;
  textSecondary: string;
  accent: string;
  accentRgb: string;
  border: string;
  surface: string;
  textShadow: string;
  backdropBlur: string;
  previewOriginal: string;
  previewTranslation: string;
}

export const THEMES: Record<ThemeId, ThemeDefinition> = {
  'midnight-glass': {
    id: 'midnight-glass',
    name: 'Midnight Glass',
    tagline: 'Глубокий графит и мягкое матовое стекло',
    bgRgb: '15, 17, 23',
    textPrimary: '#F8FAFC',
    textSecondary: '#94A3B8',
    accent: '#818CF8',
    accentRgb: '129, 140, 248',
    border: 'rgba(255, 255, 255, 0.12)',
    surface: 'rgba(30, 41, 59, 0.75)',
    textShadow: '0 1px 3px rgba(0, 0, 0, 0.6)',
    backdropBlur: '12px',
    previewOriginal: 'Explore new worlds',
    previewTranslation: 'Исследуй новые миры'
  },
  'cinema-transparent': {
    id: 'cinema-transparent',
    name: 'Cinema Minimal',
    tagline: 'Кино-жёлтый перевод и глубокие тени для видео',
    bgRgb: '0, 0, 0',
    textPrimary: '#FFFFFF',
    textSecondary: '#FDE047',
    accent: '#F59E0B',
    accentRgb: '245, 158, 11',
    border: 'rgba(255, 255, 255, 0.08)',
    surface: 'rgba(20, 20, 20, 0.8)',
    textShadow: '0 2px 6px rgba(0, 0, 0, 0.95)',
    backdropBlur: '4px',
    previewOriginal: 'Cinema subtitle style',
    previewTranslation: 'Кинотеатральный стиль субтитров'
  },
  'nordic-frost': {
    id: 'nordic-frost',
    name: 'Nordic Frost',
    tagline: 'Холодный скандинавский сланец и лёд',
    bgRgb: '30, 36, 48',
    textPrimary: '#ECEFF4',
    textSecondary: '#88C0D0',
    accent: '#5E81AC',
    accentRgb: '94, 129, 172',
    border: 'rgba(136, 192, 208, 0.2)',
    surface: 'rgba(46, 52, 64, 0.8)',
    textShadow: '0 1px 3px rgba(0, 0, 0, 0.5)',
    backdropBlur: '10px',
    previewOriginal: 'Nordic calm palette',
    previewTranslation: 'Спокойная нордическая палитра'
  },
  'warm-espresso': {
    id: 'warm-espresso',
    name: 'Warm Espresso',
    tagline: 'Тёплый шоколадный оттенок для вечернего чтения',
    bgRgb: '28, 25, 23',
    textPrimary: '#F5F5F4',
    textSecondary: '#D6D3D1',
    accent: '#F97316',
    accentRgb: '249, 115, 22',
    border: 'rgba(245, 245, 244, 0.12)',
    surface: 'rgba(41, 37, 36, 0.85)',
    textShadow: '0 1px 3px rgba(0, 0, 0, 0.6)',
    backdropBlur: '10px',
    previewOriginal: 'Comfort for your eyes',
    previewTranslation: 'Комфорт для вечерних глаз'
  },
  'emerald-noir': {
    id: 'emerald-noir',
    name: 'Emerald Noir',
    tagline: 'Высокий контраст с неоновым изумрудным акцентом',
    bgRgb: '10, 14, 12',
    textPrimary: '#ECFDF5',
    textSecondary: '#6EE7B7',
    accent: '#10B981',
    accentRgb: '16, 185, 129',
    border: 'rgba(16, 185, 129, 0.2)',
    surface: 'rgba(6, 78, 59, 0.35)',
    textShadow: '0 1px 3px rgba(0, 0, 0, 0.7)',
    backdropBlur: '10px',
    previewOriginal: 'High contrast emerald',
    previewTranslation: 'Высококонтрастный изумруд'
  }
};

export const THEME_LIST: ThemeDefinition[] = [
  THEMES['midnight-glass'],
  THEMES['cinema-transparent'],
  THEMES['nordic-frost'],
  THEMES['warm-espresso'],
  THEMES['emerald-noir']
];

export const SUBTITLE_SCALES: Array<{
  id: SubtitleScale;
  label: string;
  name: string;
  primary: number;
  translated: number;
}> = [
  { id: 'sm', label: 'S', name: 'Маленький (16px)', primary: 16, translated: 12 },
  { id: 'md', label: 'M', name: 'Средний (20px)', primary: 20, translated: 15 },
  { id: 'lg', label: 'L', name: 'Большой (28px)', primary: 28, translated: 21 },
  { id: 'xl', label: 'XL', name: 'Крупный (36px)', primary: 36, translated: 27 },
  { id: 'tv', label: 'TV', name: 'Телевизор (48px)', primary: 48, translated: 36 }
];

export function getSubtitleFontSizes(
  fontSizeOrScale?: number | SubtitleScale,
  scaleOrFallback?: SubtitleScale | number
): { primary: number; translated: number } {
  let primary = 20;

  if (typeof fontSizeOrScale === 'number' && fontSizeOrScale > 0) {
    primary = Math.min(56, Math.max(14, fontSizeOrScale));
  } else if (typeof scaleOrFallback === 'number' && scaleOrFallback > 0) {
    primary = Math.min(56, Math.max(14, scaleOrFallback));
  } else if (typeof fontSizeOrScale === 'string') {
    const match = SUBTITLE_SCALES.find((s) => s.id === fontSizeOrScale);
    if (match) {
      primary = match.primary;
    }
  } else if (typeof scaleOrFallback === 'string') {
    const match = SUBTITLE_SCALES.find((s) => s.id === scaleOrFallback);
    if (match) {
      primary = match.primary;
    }
  }

  return {
    primary,
    translated: Math.max(12, Math.round(primary * 0.75))
  };
}
