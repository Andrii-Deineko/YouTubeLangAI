/**
 * Domain normalization and frame-chain matching utilities for HiAnime / AniWatch / Zoro & anime embed hosts.
 */

export const HIANIME_DOMAINS: readonly string[] = [
  'hianime.to',
  'hianime.sx',
  'hianime.mn',
  'hianime.nz',
  'aniwatchtv.to',
  'aniwatch.to',
  '9anime.to',
  '9animetv.to',
  '9anime.pl',
  'zoro.to'
];

export const HIANIME_PLAYER_IFRAME_DOMAINS: readonly string[] = [
  'megacloud.tv',
  'megacloud.blog',
  'vidplay.site',
  'vidplay.online',
  'filemoon.sx',
  'rabbitstream.net'
];

export const HIANIME_ALL_DOMAINS: readonly string[] = [
  ...HIANIME_DOMAINS,
  ...HIANIME_PLAYER_IFRAME_DOMAINS
];

export const HIANIME_HOST_MATCHES: readonly string[] = HIANIME_DOMAINS.map(
  (domain) => `*://*.${domain}/*`
);

export const HIANIME_PLAYER_IFRAME_MATCHES: readonly string[] = [
  '*://*.megacloud.tv/*',
  '*://*.megacloud.blog/*',
  '*://*.vidplay.site/*',
  '*://*.vidplay.online/*',
  '*://*.filemoon.sx/*',
  '*://*.rabbitstream.net/*'
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
  domains: readonly string[] = HIANIME_ALL_DOMAINS,
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
 * Checks whether the current window (host + `ancestorOrigins`) is allowed for HiAnime extraction.
 */
export function isCurrentWindowAllowed(
  domains: readonly string[] = HIANIME_ALL_DOMAINS,
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
