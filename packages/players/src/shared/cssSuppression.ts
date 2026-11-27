/**
 * Creates an idempotent style-tag suppressor for native player caption layers.
 */
export function createCssCaptionSuppressor(
  styleId: string,
  cssText: string
): {
  setEnabled: (enabled: boolean) => void;
} {
  const setEnabled = (enabled: boolean): void => {
    if (typeof document === 'undefined') return;

    const existing = document.getElementById(styleId);
    if (enabled) {
      if (!existing) {
        const styleEl = document.createElement('style');
        styleEl.id = styleId;
        styleEl.textContent = cssText;
        (document.head || document.documentElement).appendChild(styleEl);
      }
    } else if (existing) {
      existing.remove();
    }
  };

  return { setEnabled };
}
