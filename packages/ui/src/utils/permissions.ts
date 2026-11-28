/**
 * Converts an arbitrary http(s) URL into a Chrome MV3 host permission origin pattern (without port).
 */
export function toOriginPermissionPattern(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    const host = parsed.hostname;
    if (!host) return null;
    return `${parsed.protocol}//${host}/*`;
  } catch {
    return null;
  }
}

/**
 * Requests optional Chrome host permission for the given URL if needed.
 * Returns { granted: true } in non-extension contexts or if permission is already granted.
 */
export async function ensureHostPermissionForUrl(
  rawUrl: string,
  fallbackPattern?: string
): Promise<{ granted: boolean; originPattern: string | null }> {
  const originPattern = toOriginPermissionPattern(rawUrl) ?? fallbackPattern ?? null;
  if (!originPattern) {
    return { granted: false, originPattern: null };
  }
  if (typeof chrome === 'undefined' || !chrome.permissions?.request) {
    return { granted: true, originPattern };
  }
  try {
    if (chrome.permissions.contains) {
      const already = await chrome.permissions.contains({ origins: [originPattern] });
      if (already) {
        return { granted: true, originPattern };
      }
    }
    const granted = await chrome.permissions.request({ origins: [originPattern] });
    return { granted, originPattern };
  } catch {
    return { granted: false, originPattern };
  }
}

/**
 * Checks host permission without triggering a user-gesture permission prompt.
 */
export async function hasHostPermissionForUrl(rawUrl: string): Promise<boolean> {
  const originPattern = toOriginPermissionPattern(rawUrl);
  if (!originPattern) return false;
  if (typeof chrome === 'undefined' || !chrome.permissions?.contains) return true;
  try {
    return await chrome.permissions.contains({ origins: [originPattern] });
  } catch {
    return false;
  }
}
