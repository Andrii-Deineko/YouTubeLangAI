import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CapturedTrackPayload } from '@langai/contracts';
import { netflixPlayerPlugin, netflixService } from '../index';

interface ListenerRegistry {
  addEventListener: (type: string, cb: () => void, options?: { once?: boolean }) => void;
  removeEventListener: (type: string, cb: () => void) => void;
  dispatch: (type: string) => void;
}

function createListenerRegistry(): ListenerRegistry {
  const map = new Map<string, Set<() => void>>();
  return {
    addEventListener(type: string, cb: () => void): void {
      let set = map.get(type);
      if (!set) {
        set = new Set();
        map.set(type, set);
      }
      set.add(cb);
    },
    removeEventListener(type: string, cb: () => void): void {
      map.get(type)?.delete(cb);
    },
    dispatch(type: string): void {
      const set = map.get(type);
      if (!set) return;
      for (const cb of Array.from(set)) {
        cb();
      }
    }
  };
}

describe('netflixService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    Reflect.deleteProperty(globalThis, 'window');
    Reflect.deleteProperty(globalThis, 'document');
    Reflect.deleteProperty(globalThis, 'MutationObserver');
  });

  it('exposes expected descriptor and capabilities', () => {
    expect(netflixService.id).toBe('netflix');
    expect(netflixService.name).toBe('Netflix');
    expect(netflixService.badgeLabel).toBe('Netflix');
    expect(netflixService.hostMatches).toEqual(['*://*.netflix.com/*', '*://netflix.com/*']);
    expect(netflixService.capabilities).toEqual({
      cueSeeking: false,
      nativeTranslatedTrack: false,
      dynamicModule: true
    });
    expect(netflixService.needsMainWorldInterceptor).toBe(false);
    expect(netflixService.players.map((p) => p.id)).toEqual(['netflix-cadmium', 'html5']);
  });

  it('matches only Netflix watch URLs', () => {
    expect(netflixService.matchesUrl(new URL('https://www.netflix.com/watch/80057281'), [])).toBe(true);
    expect(netflixService.matchesUrl(new URL('https://netflix.com/watch/12345?trackId=99'), [])).toBe(true);
    expect(netflixService.matchesUrl(new URL('https://www.netflix.com/browse'), [])).toBe(false);
    expect(netflixService.matchesUrl(new URL('https://example.com/watch/80057281'), [])).toBe(false);
  });

  it('resolves MediaIdentity with canonicalUrl and buildTimestampUrl', () => {
    const doc = { title: 'Dark | Netflix' } as Document;
    const identity = netflixService.resolveMediaIdentity(
      new URL('https://www.netflix.com/watch/80100172?trackId=14277281'),
      doc
    );

    expect(identity).not.toBeNull();
    expect(identity?.mediaId).toBe('netflix-80100172');
    expect(identity?.serviceId).toBe('netflix');
    expect(identity?.badgeLabel).toBe('Netflix');
    expect(identity?.title).toBe('Dark');
    expect(identity?.canonicalUrl).toBe('https://www.netflix.com/watch/80100172');
    expect(identity?.buildTimestampUrl?.(125.9)).toBe('https://www.netflix.com/watch/80100172?t=125');

    expect(
      netflixService.resolveMediaIdentity(new URL('https://www.netflix.com/browse'), doc)
    ).toBeNull();
  });

  it('ignores query param changes in observeNavigation and cleans up on teardown', () => {
    vi.useFakeTimers();
    const events = createListenerRegistry();
    const loc = {
      hostname: 'www.netflix.com',
      pathname: '/watch/80057281',
      href: 'https://www.netflix.com/watch/80057281?trackId=1'
    };

    const mockWindow = {
      location: loc,
      setInterval: globalThis.setInterval.bind(globalThis),
      clearInterval: globalThis.clearInterval.bind(globalThis),
      addEventListener: events.addEventListener,
      removeEventListener: events.removeEventListener
    };
    Object.defineProperty(globalThis, 'window', { value: mockWindow, configurable: true });

    const onNavigate = vi.fn();
    const teardown = netflixService.observeNavigation!(onNavigate);

    // Query parameter change on same /watch/<id> must NOT trigger onNavigate
    loc.href = 'https://www.netflix.com/watch/80057281?trackId=2&t=45';
    vi.advanceTimersByTime(1000);
    events.dispatch('popstate');
    expect(onNavigate).not.toHaveBeenCalled();

    // Navigating to a different /watch/<id> MUST trigger onNavigate
    loc.pathname = '/watch/80057282';
    loc.href = 'https://www.netflix.com/watch/80057282';
    vi.advanceTimersByTime(1000);
    expect(onNavigate).toHaveBeenCalledTimes(1);

    // Navigating away from /watch/<id> MUST trigger onNavigate
    loc.pathname = '/browse';
    loc.href = 'https://www.netflix.com/browse';
    events.dispatch('popstate');
    expect(onNavigate).toHaveBeenCalledTimes(2);

    // After teardown, subsequent changes must NOT fire onNavigate
    teardown();
    loc.pathname = '/watch/99999999';
    vi.advanceTimersByTime(5000);
    events.dispatch('popstate');
    events.dispatch('hashchange');
    expect(onNavigate).toHaveBeenCalledTimes(2);
  });

  it('emits incremental primaryCueUpdates and liveCueBoundary from DOM captions', () => {
    vi.useFakeTimers();
    const events = createListenerRegistry();
    const loc = {
      hostname: 'www.netflix.com',
      pathname: '/watch/80057281',
      href: 'https://www.netflix.com/watch/80057281'
    };

    let currentCaptionLines: Array<{ textContent: string }> = [];
    const videoEl = {
      currentTime: 10,
      isConnected: true,
      addEventListener: events.addEventListener,
      removeEventListener: events.removeEventListener,
      getBoundingClientRect: () => ({ width: 1280, height: 720 })
    } as unknown as HTMLVideoElement;

    const captionRoot = { nodeName: 'DIV' } as unknown as Element;
    const styleById = new Map<string, { remove: () => void }>();

    const mockWindow = {
      location: loc,
      setInterval: globalThis.setInterval.bind(globalThis),
      clearInterval: globalThis.clearInterval.bind(globalThis),
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis)
    };
    const mockDocument = {
      head: { appendChild: vi.fn() },
      documentElement: { appendChild: vi.fn() },
      getElementById: (id: string) => styleById.get(id) ?? null,
      querySelector: (selector: string) => {
        if (selector === '.player-timedtext') return captionRoot;
        if (selector === 'video') return videoEl;
        return null;
      },
      querySelectorAll: (selector: string) => {
        if (selector === '.player-timedtext-text-container') return currentCaptionLines;
        if (selector === 'video') return [videoEl];
        return [];
      }
    };

    const observerCallbacks: Array<() => void> = [];
    const disconnectSpy = vi.fn();
    class MockMutationObserver {
      constructor(cb: () => void) {
        observerCallbacks.push(cb);
      }
      observe(): void {}
      disconnect(): void {
        disconnectSpy();
      }
    }

    Object.defineProperty(globalThis, 'window', { value: mockWindow, configurable: true });
    Object.defineProperty(globalThis, 'document', { value: mockDocument, configurable: true });
    Object.defineProperty(globalThis, 'MutationObserver', {
      value: MockMutationObserver,
      configurable: true
    });

    const payloads: CapturedTrackPayload[] = [];
    const teardown = netflixService.initIsolatedSession({
      onTracksLoaded: (data) => payloads.push(data)
    });

    // First caption appears
    currentCaptionLines = [{ textContent: 'Hello world' }];
    observerCallbacks.forEach((cb) => cb());
    vi.advanceTimersByTime(50);

    expect(payloads).toHaveLength(1);
    expect(payloads[0]?.resetPrimaryCues).toBe(true);
    expect(payloads[0]?.liveCueBoundary).toBe(false);
    expect(payloads[0]?.skipTranslation).toBe(false);
    expect(payloads[0]?.primaryCueUpdates).toHaveLength(1);
    expect(payloads[0]?.primaryCueUpdates?.[0]?.text).toBe('Hello world');

    // Second caption closes previous cue and opens next cue
    (videoEl as { currentTime: number }).currentTime = 12;
    currentCaptionLines = [{ textContent: 'Next line' }];
    observerCallbacks.forEach((cb) => cb());
    vi.advanceTimersByTime(50);

    expect(payloads).toHaveLength(2);
    expect(payloads[1]?.resetPrimaryCues).toBe(false);
    expect(payloads[1]?.liveCueBoundary).toBe(true);
    expect(payloads[1]?.skipTranslation).toBe(false);
    expect(payloads[1]?.primaryCueUpdates).toHaveLength(2);
    expect(payloads[1]?.primaryCueUpdates?.[0]?.text).toBe('Hello world');
    expect(payloads[1]?.primaryCueUpdates?.[0]?.endTime).toBeCloseTo(11.99, 2);
    expect(payloads[1]?.primaryCueUpdates?.[1]?.text).toBe('Next line');

    teardown();
    expect(disconnectSpy).toHaveBeenCalled();
  });
});

describe('netflixPlayerPlugin', () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'document');
  });

  it('has id netflix-cadmium and returns bottom offset 72', () => {
    expect(netflixPlayerPlugin.id).toBe('netflix-cadmium');
    const mockContainer = {
      classList: { contains: () => false }
    } as unknown as HTMLElement;
    expect(netflixPlayerPlugin.getSubtitleBottomOffset(mockContainer)).toBe(72);
  });

  it('detects passive/inactive controls state', () => {
    const active = {
      classList: { contains: (cls: string) => cls === 'active' },
      querySelector: () => null
    } as unknown as HTMLElement;
    const passive = {
      classList: { contains: (cls: string) => cls === 'passive' },
      querySelector: () => null
    } as unknown as HTMLElement;

    expect(netflixPlayerPlugin.isControlsHidden(active)).toBe(false);
    expect(netflixPlayerPlugin.isControlsHidden(passive)).toBe(true);
  });

  it('suppresses and restores native .player-timedtext captions', () => {
    let appendedStyle: { id: string; textContent: string; remove: () => void } | null = null;
    const mockDoc = {
      head: {
        appendChild: (el: { id: string; textContent: string; remove: () => void }) => {
          appendedStyle = el;
        }
      },
      documentElement: null,
      getElementById: (id: string) => (appendedStyle?.id === id ? appendedStyle : null),
      createElement: () => ({
        id: '',
        textContent: '',
        remove: () => {
          appendedStyle = null;
        }
      })
    };
    Object.defineProperty(globalThis, 'document', { value: mockDoc, configurable: true });

    const container = {} as HTMLElement;
    const restore = netflixPlayerPlugin.suppressNativeCaptions!(container, true);
    expect(appendedStyle).not.toBeNull();
    expect((appendedStyle as { textContent: string } | null)?.textContent).toContain('.player-timedtext');

    restore();
    expect(appendedStyle).toBeNull();
  });
});
