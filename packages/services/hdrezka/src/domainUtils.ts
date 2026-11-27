/**
 * Domain normalization and frame-chain matching utilities for HDRezka & PlayerJS mirrors.
 */

export const HDREZKA_DOMAINS: readonly string[] = [
  'rezka.ag',
  'hdrezka.ag',
  'hdrezka.me',
  'hdrezka.ac',
  'hdrezka.cm',
  'hdrezka.co',
  'hdrezka.tv',
  'hdrezka.app',
  'hdrezka.re',
  'hdrezka-ag.com'
];

export const HDREZKA_PLAYER_IFRAME_DOMAINS: readonly string[] = [
  'voidboost.tv',
  'voidboost.net',
  'voidboost.cc',
  'streamguard.cc'
];

export const HDREZKA_ALL_DOMAINS: readonly string[] = [
  ...HDREZKA_DOMAINS,
  ...HDREZKA_PLAYER_IFRAME_DOMAINS
];

export const HDREZKA_HOST_MATCHES: readonly string[] = HDREZKA_DOMAINS.map(
  (domain) => `*://*.${domain}/*`
);

export const HDREZKA_PLAYER_IFRAME_MATCHES: readonly string[] = [
  '*://*.voidboost.tv/*',
  '*://*.voidboost.net/*',
  '*://*.voidboost.cc/*',
  '*://*.streamguard.cc/*'
];

let configuredCustomMirrors: readonly string[] = [];

/**
 * Updates cached custom mirror domains used by synchronous URL matching.
 */
export function setCustomMirrors(mirrors: readonly string[]): void {
  configuredCustomMirrors = mirrors.filter((m) => typeof m === 'string' && m.trim().length > 0);
}

/**
 * Returns currently cached custom mirror domains.
 */
export function getCustomMirrors(): readonly string[] {
  return configuredCustomMirrors;
}

/**
 * Normalizes a domain, URL, or match-pattern string into a clean lowercase hostname
 * without protocol, wildcards, `www.`, path, query, or port.
 * Global wildcards normalize to `''`.
 */
export function normalizeDomain(input: string): string {
  if (!input) return '';
  let str = input.trim().toLowerCase();
  if (!str || str === '*' || str === '*.*' || str === '<all_urls>') {
    return '';
  }

  if (str.startsWith('*://')) {
    str = str.slice(4);
  } else if (str.includes('://')) {
    try {
      str = new URL(str).hostname.toLowerCase();
    } catch {
      str = str.replace(/^[a-z*]+:\/\//, '');
    }
  }

  str = str.split('/')[0]?.split('?')[0]?.split('#')[0] ?? '';
  str = str.split(':')[0] ?? '';

  if (str.startsWith('*.')) {
    str = str.slice(2);
  }
  if (str.startsWith('www.')) {
    str = str.slice(4);
  }

  str = str.replace(/\.+$/, '').trim();
  if (!str || str.includes('*')) {
    return '';
  }

  return str;
}

function hostMatchesCandidateList(hostname: string, list: readonly string[]): boolean {
  const cleanHost = normalizeDomain(hostname);
  if (!cleanHost || list.length === 0) return false;

  return list.some((item) => {
    const cleanItem = normalizeDomain(item);
    if (!cleanItem) return false;
    return cleanHost === cleanItem || cleanHost.endsWith(`.${cleanItem}`);
  });
}

/**
 * Checks whether the current hostname or any host in `frameChainHosts` matches
 * `domains` or user-configured `customMirrors` (exact or subdomain match).
 */
export function matchesDomainList(
  hostname: string,
  frameChainHosts: readonly string[] = [],
  domains: readonly string[] = HDREZKA_ALL_DOMAINS,
  customMirrors: readonly string[] = configuredCustomMirrors
): boolean {
  const allowed = customMirrors.length > 0 ? [...domains, ...customMirrors] : domains;
  if (allowed.length === 0) return false;

  if (hostname && hostMatchesCandidateList(hostname, allowed)) {
    return true;
  }

  for (const frameHost of frameChainHosts) {
    if (frameHost && hostMatchesCandidateList(frameHost, allowed)) {
      return true;
    }
  }

  return false;
}

/**
 * Extracts normalized hostnames from `window.location.ancestorOrigins`.
 */
export function getAncestorOriginsHosts(): string[] {
  if (typeof window === 'undefined' || !window.location) return [];

  const hosts: string[] = [];
  try {
    const ancestors = window.location.ancestorOrigins;
    if (!ancestors) return hosts;
    for (let i = 0; i < ancestors.length; i++) {
      const origin = ancestors[i];
      if (!origin) continue;
      const clean = normalizeDomain(origin);
      if (clean && !hosts.includes(clean)) {
        hosts.push(clean);
      }
    }
  } catch {
    // Ignore cross-origin frame access errors
  }
  return hosts;
}

/**
 * Collects normalized hostnames across `window.location.hostname`, `ancestorOrigins`,
 * and `document.referrer`.
 */
export function getFrameChainHosts(): string[] {
  const hosts = new Set<string>();

  if (typeof window !== 'undefined' && window.location?.hostname) {
    const current = normalizeDomain(window.location.hostname);
    if (current) hosts.add(current);
  }

  for (const anc of getAncestorOriginsHosts()) {
    hosts.add(anc);
  }

  if (typeof document !== 'undefined' && document.referrer) {
    const refHost = normalizeDomain(document.referrer);
    if (refHost) hosts.add(refHost);
  }

  return Array.from(hosts);
}

/**
 * Checks whether the current window (host + `ancestorOrigins`) is allowed for HDRezka extraction.
 */
export function isCurrentWindowAllowed(
  domains: readonly string[] = HDREZKA_ALL_DOMAINS,
  customMirrors: readonly string[] = configuredCustomMirrors
): boolean {
  if (typeof window === 'undefined' || !window.location?.hostname) {
    return false;
  }
  return matchesDomainList(
    window.location.hostname,
    getAncestorOriginsHosts(),
    domains,
    customMirrors
  );
}
