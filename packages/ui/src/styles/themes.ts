import type { FontFamily, ThemeId } from '@langai/contracts';

export interface ThemeDefinition {
  id: ThemeId;
  name: string;
  tagline: string;
  bgRgb: string;
  textPrimary: string;
  textSecondary: string;
  accent: string;
  accentRgb: string;
  accentFg: string;
  border: string;
  surface: string;
  textShadow: string;
  textStroke: string;
  backdropBlur: string;
  previewOriginal: string;
  previewTranslation: string;
}

export const THEMES: Record<ThemeId, ThemeDefinition> = {
  'midnight-glass': {
    id: 'midnight-glass',
    name: 'Midnight Glass',
    tagline: 'Deep graphite with soft frosted glass',
    bgRgb: '15, 17, 23',
    textPrimary: '#F8FAFC',
    textSecondary: '#94A3B8',
    accent: '#818CF8',
    accentRgb: '129, 140, 248',
    accentFg: '#FFFFFF',
    border: 'rgba(255, 255, 255, 0.14)',
    surface: 'rgba(30, 41, 59, 0.78)',
    textShadow:
      '0 0 2px #000, -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, 0 2px 4px rgba(0, 0, 0, 0.95)',
    textStroke: '1.5px #000000',
    backdropBlur: '12px',
    previewOriginal: 'Explore new worlds',
    previewTranslation: 'Discover every nuance'
  },
  'cinema-transparent': {
    id: 'cinema-transparent',
    name: 'Cinema Minimal',
    tagline: 'Cinema yellow translation & deep shadows for video',
    bgRgb: '10, 10, 10',
    textPrimary: '#FFFFFF',
    textSecondary: '#FDE047',
    accent: '#F59E0B',
    accentRgb: '245, 158, 11',
    accentFg: '#111827',
    border: 'rgba(245, 158, 11, 0.28)',
    surface: 'rgba(26, 23, 20, 0.9)',
    textShadow:
      '0 0 3px #000, -1.5px -1.5px 0 #000, 1.5px -1.5px 0 #000, -1.5px 1.5px 0 #000, 1.5px 1.5px 0 #000, 0 2px 6px #000',
    textStroke: '1.8px #000000',
    backdropBlur: '6px',
    previewOriginal: 'Cinema subtitle style',
    previewTranslation: 'Theater-grade subtitle contrast'
  },
  'nordic-frost': {
    id: 'nordic-frost',
    name: 'Nordic Frost',
    tagline: 'Cool Scandinavian slate and arctic ice',
    bgRgb: '30, 36, 48',
    textPrimary: '#ECEFF4',
    textSecondary: '#88C0D0',
    accent: '#5E81AC',
    accentRgb: '94, 129, 172',
    accentFg: '#FFFFFF',
    border: 'rgba(136, 192, 208, 0.24)',
    surface: 'rgba(46, 52, 64, 0.86)',
    textShadow:
      '0 0 2px #000, -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, 0 2px 4px rgba(0, 0, 0, 0.95)',
    textStroke: '1.5px #000000',
    backdropBlur: '10px',
    previewOriginal: 'Nordic calm palette',
    previewTranslation: 'Calm Scandinavian palette'
  },
  'warm-espresso': {
    id: 'warm-espresso',
    name: 'Warm Espresso',
    tagline: 'Warm dark chocolate with orange accent',
    bgRgb: '28, 25, 23',
    textPrimary: '#F5F5F4',
    textSecondary: '#D6D3D1',
    accent: '#F97316',
    accentRgb: '249, 115, 22',
    accentFg: '#1C1917',
    border: 'rgba(249, 115, 22, 0.24)',
    surface: 'rgba(44, 39, 36, 0.9)',
    textShadow:
      '0 0 2px #000, -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, 0 2px 4px rgba(0, 0, 0, 0.95)',
    textStroke: '1.5px #000000',
    backdropBlur: '10px',
    previewOriginal: 'Comfort for your eyes',
    previewTranslation: 'Warm evening reading comfort'
  },
  'emerald-noir': {
    id: 'emerald-noir',
    name: 'Emerald Noir',
    tagline: 'Deep obsidian with muted dark forest emerald',
    bgRgb: '8, 12, 10',
    textPrimary: '#E6F4EE',
    textSecondary: '#7AB89F',
    accent: '#2D8A6B',
    accentRgb: '45, 138, 107',
    accentFg: '#F0FDF4',
    border: 'rgba(62, 138, 112, 0.26)',
    surface: 'rgba(13, 38, 30, 0.72)',
    textShadow:
      '0 0 2px #000, -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, 0 2px 4px rgba(0, 0, 0, 0.95)',
    textStroke: '1.6px #000000',
    backdropBlur: '10px',
    previewOriginal: 'Deep emerald clarity',
    previewTranslation: 'Calm low-glare forest emerald'
  },
  'oled-pure': {
    id: 'oled-pure',
    name: 'OLED Black',
    tagline: 'Pure black canvas, minimal gray contours, soft ivory accent',
    bgRgb: '0, 0, 0',
    textPrimary: '#F4F4F5',
    textSecondary: '#A1A1AA',
    accent: '#D6D3CB',
    accentRgb: '214, 211, 203',
    accentFg: '#09090B',
    border: 'rgba(214, 211, 203, 0.14)',
    surface: 'rgba(18, 18, 20, 0.94)',
    textShadow:
      '0 0 2px #000, -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, 0 2px 4px rgba(0, 0, 0, 0.95)',
    textStroke: '1.4px #000000',
    backdropBlur: '8px',
    previewOriginal: 'Pure OLED clarity',
    previewTranslation: 'Minimal gray contours on true black'
  }
};

export const THEME_LIST: readonly ThemeDefinition[] = [
  THEMES['midnight-glass'],
  THEMES['cinema-transparent'],
  THEMES['nordic-frost'],
  THEMES['warm-espresso'],
  THEMES['emerald-noir'],
  THEMES['oled-pure']
];

export interface FontFamilyOption {
  id: FontFamily;
  label: string;
  stack: string;
}

export const FONT_FAMILY_OPTIONS: readonly FontFamilyOption[] = [
  {
    id: 'sans',
    label: 'System Sans',
    stack: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
  },
  {
    id: 'inter',
    label: 'Clean UI (Segoe / Arial)',
    stack: "'Inter', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif"
  },
  {
    id: 'rounded',
    label: 'Rounded Soft (Trebuchet)',
    stack: "'Segoe UI Variable', 'Trebuchet MS', 'SF Pro Rounded', ui-rounded, sans-serif"
  },
  {
    id: 'condensed',
    label: 'Cinema Condensed',
    stack: "'Bahnschrift Condensed', 'Arial Narrow', 'Roboto Condensed', 'Helvetica Neue', sans-serif"
  },
  {
    id: 'readable',
    label: 'Wide Readable (Verdana)',
    stack: 'Verdana, Geneva, Tahoma, sans-serif'
  },
  {
    id: 'serif',
    label: 'Classic Serif (Georgia)',
    stack: "Georgia, 'Times New Roman', Cambria, serif"
  },
  {
    id: 'slab',
    label: 'Editorial Serif (Cambria)',
    stack: "Cambria, 'Palatino Linotype', 'Book Antiqua', Palatino, serif"
  },
  {
    id: 'mono',
    label: 'Monospace (Consolas)',
    stack: "'JetBrains Mono', 'Cascadia Mono', Consolas, ui-monospace, SFMono-Regular, monospace"
  }
];

export const FONT_FAMILY_STACKS: Record<FontFamily, string> = FONT_FAMILY_OPTIONS.reduce(
  (acc, item) => {
    acc[item.id] = item.stack;
    return acc;
  },
  {} as Record<FontFamily, string>
);
