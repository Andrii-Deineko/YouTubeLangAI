import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlayerMainWorldContext } from '@langai/contracts';
import {
  HDREZKA_ALL_DOMAINS,
  HDREZKA_DOMAINS,
  HDREZKA_HOST_MATCHES,
  HDREZKA_PLAYER_IFRAME_MATCHES,
  matchesDomainList,
  normalizeDomain
} from '../domainUtils';
import { hdrezkaService } from '../index';

describe('hdrezka domainUtils and service matching', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('normalizes URLs, protocols, ports, www prefixes, and rejects global wildcards', () => {
    expect(normalizeDomain('https://www.HDRezka.ag/films/123.html')).toBe('hdrezka.ag');
    expect(normalizeDomain('http://m.hdrezka.me:8080/series/')).toBe('m.hdrezka.me');
    expect(normalizeDomain('*://*.voidboost.tv/*')).toBe('voidboost.tv');
    expect(normalizeDomain('*://*/*')).toBe('');
    expect(normalizeDomain('*')).toBe('');
    expect(normalizeDomain('<all_urls>')).toBe('');
  });

  it('excludes localhost, 127.0.0.1, and *://*/* from hostMatches and playerIframeMatches', () => {
    const allPatterns = [...HDREZKA_HOST_MATCHES, ...HDREZKA_PLAYER_IFRAME_MATCHES];
    expect(allPatterns.some((p) => p.includes('localhost'))).toBe(false);
    expect(allPatterns.some((p) => p.includes('127.0.0.1'))).toBe(false);
    expect(allPatterns).not.toContain('*://*/*');
    expect(HDREZKA_DOMAINS).not.toContain('localhost');
    expect(HDREZKA_DOMAINS).not.toContain('127.0.0.1');
    expect(HDREZKA_PLAYER_IFRAME_MATCHES).toEqual([
      '*://*.voidboost.tv/*',
      '*://*.voidboost.net/*',
      '*://*.voidboost.cc/*',
      '*://*.streamguard.cc/*'
    ]);
  });

  it('matches known HDRezka domains and subdomains', () => {
    expect(matchesDomainList('hdrezka.ag', [], HDREZKA_ALL_DOMAINS)).toBe(true);
    expect(matchesDomainList('rezka.ag', [], HDREZKA_ALL_DOMAINS)).toBe(true);
    expect(matchesDomainList('m.hdrezka.me', [], HDREZKA_ALL_DOMAINS)).toBe(true);
    expect(matchesDomainList('www.hdrezka.tv', [], HDREZKA_ALL_DOMAINS)).toBe(true);
    expect(matchesDomainList('cdn.voidboost.net', [], HDREZKA_ALL_DOMAINS)).toBe(true);
    expect(matchesDomainList('streamguard.cc', [], HDREZKA_ALL_DOMAINS)).toBe(true);
    expect(matchesDomainList('evilhdrezka.ag', [], HDREZKA_ALL_DOMAINS)).toBe(false);
  });

  it('matches embedded player iframes via ancestorOrigins frame chains', () => {
    expect(
      matchesDomainList('unknown-cdn.example', ['hdrezka.ag'], HDREZKA_ALL_DOMAINS)
    ).toBe(true);
    expect(
      matchesDomainList('player.example.org', ['m.hdrezka.cm'], HDREZKA_ALL_DOMAINS)
    ).toBe(true);
    expect(
      hdrezkaService.matchesUrl(new URL('https://player.example.org/embed/1'), ['hdrezka.me'])
    ).toBe(true);
  });

  it('supports customMirrors for user-configured mirror domains and subdomains', () => {
    const mirrors = ['https://my-rezka-mirror.org/watch', 'cinema.custom.tv'];
    expect(
      matchesDomainList('my-rezka-mirror.org', [], HDREZKA_ALL_DOMAINS, mirrors)
    ).toBe(true);
    expect(
      matchesDomainList('sub.cinema.custom.tv', [], HDREZKA_ALL_DOMAINS, mirrors)
    ).toBe(true);
    expect(
      matchesDomainList('cdn.random.net', ['my-rezka-mirror.org'], HDREZKA_ALL_DOMAINS, mirrors)
    ).toBe(true);
    expect(
      matchesDomainList('unrelated.org', [], HDREZKA_ALL_DOMAINS, mirrors)
    ).toBe(false);
  });

  it('rejects arbitrary domains and localhost even with no fallback', () => {
    expect(matchesDomainList('localhost', [], HDREZKA_ALL_DOMAINS)).toBe(false);
    expect(matchesDomainList('127.0.0.1', [], HDREZKA_ALL_DOMAINS)).toBe(false);
    expect(matchesDomainList('youtube.com', [], HDREZKA_ALL_DOMAINS)).toBe(false);
    expect(matchesDomainList('example.com', ['other-site.com'], HDREZKA_ALL_DOMAINS)).toBe(false);
    expect(hdrezkaService.matchesUrl(new URL('http://localhost:3000/video'), [])).toBe(false);
    expect(hdrezkaService.matchesUrl(new URL('https://example.com/watch'), [])).toBe(false);
  });

  it('returns no-op teardown immediately in initMainWorldExtractor on non-matching host without patching fetch/XHR or creating MutationObserver', () => {
    const fetchSpy = vi.fn();
    class FakeXhr {
      open(): void {}
      send(): void {}
    }
    const mutationObserverSpy = vi.fn();

    vi.stubGlobal('window', {
      location: {
        hostname: 'localhost',
        href: 'http://localhost:3000/',
        pathname: '/',
        search: '',
        ancestorOrigins: []
      },
      fetch: fetchSpy
    });
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    vi.stubGlobal('MutationObserver', mutationObserverSpy);

    const origOpen = FakeXhr.prototype.open;
    const origSend = FakeXhr.prototype.send;
    const ctx: PlayerMainWorldContext = {
      emitTracks: vi.fn(),
      log: vi.fn()
    };

    const teardown = hdrezkaService.initMainWorldExtractor?.(ctx);
    expect(typeof teardown).toBe('function');
    expect((globalThis.window as unknown as { fetch: unknown }).fetch).toBe(fetchSpy);
    expect(FakeXhr.prototype.open).toBe(origOpen);
    expect(FakeXhr.prototype.send).toBe(origSend);
    expect(mutationObserverSpy).not.toHaveBeenCalled();

    // Also test arbitrary domain with non-matching ancestorOrigins
    vi.stubGlobal('window', {
      location: {
        hostname: 'arbitrary-site.com',
        href: 'https://arbitrary-site.com/watch',
        pathname: '/watch',
        search: '',
        ancestorOrigins: ['https://another-site.com']
      },
      fetch: fetchSpy
    });
    const teardown2 = hdrezkaService.initMainWorldExtractor?.(ctx);
    expect(typeof teardown2).toBe('function');
    expect((globalThis.window as unknown as { fetch: unknown }).fetch).toBe(fetchSpy);
    expect(FakeXhr.prototype.open).toBe(origOpen);
    expect(FakeXhr.prototype.send).toBe(origSend);
    expect(mutationObserverSpy).not.toHaveBeenCalled();
  });
});
