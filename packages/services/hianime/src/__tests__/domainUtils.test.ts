import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlayerMainWorldContext } from '@langai/contracts';
import {
  HIANIME_ALL_DOMAINS,
  HIANIME_DOMAINS,
  HIANIME_HOST_MATCHES,
  HIANIME_PLAYER_IFRAME_MATCHES,
  matchesDomainList,
  normalizeDomain
} from '../domainUtils';
import { hianimeService } from '../index';

describe('hianime domainUtils and service matching', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('excludes localhost and *://*/* and uses expected playerIframeMatches', () => {
    const allPatterns = [...HIANIME_HOST_MATCHES, ...HIANIME_PLAYER_IFRAME_MATCHES];
    expect(allPatterns.some((p) => p.includes('localhost'))).toBe(false);
    expect(allPatterns.some((p) => p.includes('127.0.0.1'))).toBe(false);
    expect(allPatterns).not.toContain('*://*/*');
    expect(HIANIME_DOMAINS).toEqual(
      expect.arrayContaining(['hianime.to', '9anime.to', '9animetv.to', '9anime.pl'])
    );
    expect(HIANIME_PLAYER_IFRAME_MATCHES).toEqual([
      '*://*.megacloud.tv/*',
      '*://*.megacloud.blog/*',
      '*://*.vidplay.site/*',
      '*://*.vidplay.online/*',
      '*://*.filemoon.sx/*',
      '*://*.rabbitstream.net/*'
    ]);
  });

  it('matches known anime domains, subdomains, embed iframes, and ancestorOrigins', () => {
    expect(normalizeDomain('https://www.HiAnime.to/watch/one-piece')).toBe('hianime.to');
    expect(matchesDomainList('hianime.to', [], HIANIME_ALL_DOMAINS)).toBe(true);
    expect(matchesDomainList('cdn.megacloud.tv', [], HIANIME_ALL_DOMAINS)).toBe(true);
    expect(matchesDomainList('megacloud.blog', [], HIANIME_ALL_DOMAINS)).toBe(true);
    expect(matchesDomainList('vidplay.site', [], HIANIME_ALL_DOMAINS)).toBe(true);
    expect(matchesDomainList('rabbitstream.net', ['hianime.to'], HIANIME_ALL_DOMAINS)).toBe(true);
    expect(matchesDomainList('unknown.embed.host', ['aniwatch.to'], HIANIME_ALL_DOMAINS)).toBe(true);
    expect(
      hianimeService.matchesUrl(new URL('https://megacloud.tv/embed-2/e-1/abc'), ['hianime.to'])
    ).toBe(true);
  });

  it('rejects arbitrary domains and localhost', () => {
    expect(matchesDomainList('localhost', [], HIANIME_ALL_DOMAINS)).toBe(false);
    expect(matchesDomainList('127.0.0.1', [], HIANIME_ALL_DOMAINS)).toBe(false);
    expect(matchesDomainList('example.com', [], HIANIME_ALL_DOMAINS)).toBe(false);
    expect(hianimeService.matchesUrl(new URL('http://localhost:8080/'), [])).toBe(false);
    expect(hianimeService.matchesUrl(new URL('https://youtube.com/watch?v=1'), [])).toBe(false);
  });

  it('returns no-op teardown immediately in initMainWorldExtractor on non-matching host', () => {
    const fetchSpy = vi.fn();
    class FakeXhr {
      open(): void {}
      send(): void {}
    }
    const mutationObserverSpy = vi.fn();

    vi.stubGlobal('window', {
      location: {
        hostname: 'example.com',
        href: 'https://example.com/',
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

    const teardown = hianimeService.initMainWorldExtractor?.(ctx);
    expect(typeof teardown).toBe('function');
    expect((globalThis.window as unknown as { fetch: unknown }).fetch).toBe(fetchSpy);
    expect(FakeXhr.prototype.open).toBe(origOpen);
    expect(FakeXhr.prototype.send).toBe(origSend);
    expect(mutationObserverSpy).not.toHaveBeenCalled();
  });
});
