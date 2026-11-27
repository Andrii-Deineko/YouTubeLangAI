import type { CSSProperties } from 'react';

export const sectionCardStyle: CSSProperties = {
  backgroundColor: 'var(--ytai-surface)',
  borderColor: 'var(--ytai-border)'
};

export const innerCardStyle: CSSProperties = {
  backgroundColor: 'rgba(var(--ytai-bg-rgb), 0.65)',
  borderColor: 'var(--ytai-border)'
};

export const segmentedTrackStyle: CSSProperties = {
  backgroundColor: 'rgba(var(--ytai-bg-rgb), 0.72)',
  borderColor: 'var(--ytai-border)'
};

export const mutedTextStyle: CSSProperties = {
  color: 'var(--ytai-text-muted, var(--ytai-text-secondary))'
};

export const primaryTextStyle: CSSProperties = {
  color: 'var(--ytai-text-primary)'
};

export const accentBtnStyle: CSSProperties = {
  backgroundColor: 'var(--ytai-accent)',
  color: 'var(--ytai-accent-fg, #ffffff)'
};

export const activePillStyle: CSSProperties = {
  backgroundColor: 'rgba(var(--ytai-accent-rgb), 0.2)',
  color: 'var(--ytai-accent)'
};
