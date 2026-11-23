/**
 * Domain normalization and chain-matching utilities for Cinema targets.
 */

export const DEFAULT_CINEMA_DOMAINS = [
  'rezka.ag',
  'hdrezka.ag',
  'hdrezka.me',
  'hdrezka.cm',
  'hdrezka.app',
  'hdrezka.re',
  'hdrezka-ag.com',
  '9anime.to',
  '9animetv.to',
  'hianime.to',
  'megacloud.tv',
  'vidplay.online',
  'filemoon.sx',
  'rabbitstream.net'
];

/**
 * Normalizes a domain/URL string into a clean lowercase hostname without protocol, www., path, query, or port.
 */
export function normalizeDomain(input: string): string {
  if (!input) return '';
  let str = input.trim().toLowerCase();

  // Strip protocol if present
  if (str.startsWith('http://') || str.startsWith('https://') || str.includes('://')) {
    try {
      const parsed = new URL(str);
      str = parsed.hostname;
    } catch {
      str = str.replace(/^[a-z]+:\/\//, '');
    }
  }

  // Strip path, query, hash
  str = str.split('/')[0].split('?')[0].split('#')[0];
  // Strip port
  str = str.split(':')[0];
  // Strip leading www.
  if (str.startsWith('www.')) {
    str = str.slice(4);
  }

  return str.trim();
}

/**
 * Checks whether a given hostname matches any domain in the list,
 * supporting exact match and subdomain match (e.g. m.hdrezka.me matches hdrezka.me).
 */
export function matchesDomainList(hostname: string, list: string[]): boolean {
  if (!hostname || !list || list.length === 0) return false;
  const cleanHost = normalizeDomain(hostname);
  if (!cleanHost) return false;

  return list.some((item) => {
    const cleanItem = normalizeDomain(item);
    if (!cleanItem) return false;
    return cleanHost === cleanItem || cleanHost.endsWith('.' + cleanItem);
  });
}

/**
 * Collects all domain names across the frame chain:
 * - current hostname
 * - document.referrer hostname
 * - window.location.ancestorOrigins hostnames
 */
export function getFrameChainHosts(): string[] {
  const hosts = new Set<string>();

  if (typeof window !== 'undefined' && window.location?.hostname) {
    const current = normalizeDomain(window.location.hostname);
    if (current) hosts.add(current);
  }

  if (typeof document !== 'undefined' && document.referrer) {
    try {
      const refHost = normalizeDomain(new URL(document.referrer).hostname);
      if (refHost) hosts.add(refHost);
    } catch {
      const refHost = normalizeDomain(document.referrer);
      if (refHost) hosts.add(refHost);
    }
  }

  if (typeof window !== 'undefined' && window.location) {
    try {
      const ancestors = Array.from(window.location.ancestorOrigins ?? []);
      for (const origin of ancestors) {
        try {
          const ancHost = normalizeDomain(new URL(origin).hostname);
          if (ancHost) hosts.add(ancHost);
        } catch {
          const ancHost = normalizeDomain(origin);
          if (ancHost) hosts.add(ancHost);
        }
      }
    } catch {
      // ignore
    }
  }

  return Array.from(hosts);
}

export function shouldActivateCinema(options: {
  allowedDomains?: string[];
  blacklistedDomains?: string[];
  hasLongVideo?: boolean;
  currentHost?: string;
  chainHosts?: string[];
  isTopWindow?: boolean;
}): boolean {
  const {
    allowedDomains = DEFAULT_CINEMA_DOMAINS,
    blacklistedDomains = [],
    hasLongVideo = false,
    currentHost = typeof window !== 'undefined' && window.location?.hostname
      ? normalizeDomain(window.location.hostname)
      : '',
    chainHosts = getFrameChainHosts(),
    isTopWindow = typeof window !== 'undefined' ? window === window.top : true
  } = options;

  const allHosts = new Set<string>(chainHosts);
  if (currentHost) allHosts.add(currentHost);
  const allHostsList = Array.from(allHosts);

  // 1. Blacklist Priority: If ANY host in chain matches blacklistedDomains -> false
  const isBlacklisted = allHostsList.some((h) => matchesDomainList(h, blacklistedDomains));
  if (isBlacklisted) {
    return false;
  }

  // 2. Top Window: strictly only if currentHost is in allowedDomains
  if (isTopWindow) {
    return matchesDomainList(currentHost, allowedDomains);
  }

  // 3. Nested Iframe
  const matchesAllowedInChain = allHostsList.some((h) => matchesDomainList(h, allowedDomains));
  if (matchesAllowedInChain) {
    return true;
  }

  // Fallback for CDN iframes on mirrors where referrer was stripped
  if (hasLongVideo) {
    return true;
  }

  return false;
}
