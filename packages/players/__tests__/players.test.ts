import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_PLAYER_PLUGINS,
  html5PlayerPlugin,
  isVideoVisible,
  jwplayerPlugin,
  playerjsPlugin,
  plyrPlugin,
  resolvePlayerPlugin,
  restorePlayerJsNativeNodes,
  syncPlayerJsSubtitles,
  videojsPlugin
} from '../src/index';

interface MockClassList {
  contains: (cls: string) => boolean;
}

interface MockStyle {
  display: string;
  visibility: string;
  opacity: string;
  cursor: string;
  pointerEvents: string;
  overflowY: string;
  overflow: string;
  textAlign: string;
  setProperty: (prop: string, value: string) => void;
  removeProperty: (prop: string) => void;
}

interface MockRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

function createMockStyle(initial: Partial<MockStyle> = {}): MockStyle {
  const store = new Map<string, string>();
  const style: MockStyle = {
    display: initial.display ?? 'block',
    visibility: initial.visibility ?? '',
    opacity: initial.opacity ?? '',
    cursor: initial.cursor ?? 'default',
    pointerEvents: initial.pointerEvents ?? 'auto',
    overflowY: initial.overflowY ?? 'visible',
    overflow: initial.overflow ?? 'visible',
    textAlign: initial.textAlign ?? 'left',
    setProperty(prop: string, value: string): void {
      store.set(prop, value);
      if (prop === 'visibility') style.visibility = value;
      if (prop === 'opacity') style.opacity = value;
    },
    removeProperty(prop: string): void {
      store.delete(prop);
      if (prop === 'visibility') style.visibility = '';
      if (prop === 'opacity') style.opacity = '';
    }
  };
  return style;
}

function createClassList(classes: readonly string[]): MockClassList {
  const set = new Set(classes);
  return {
    contains: (cls: string) => set.has(cls)
  };
}

interface MockElementOptions {
  id?: string;
  classes?: readonly string[];
  rect?: Partial<MockRect>;
  style?: Partial<MockStyle>;
  textContent?: string;
  isConnected?: boolean;
  queryMap?: Record<string, unknown>;
  queryAllMap?: Record<string, unknown[]>;
  parentElement?: HTMLElement | null;
}

function makeRect(partial: Partial<MockRect> = {}): MockRect {
  const left = partial.left ?? 0;
  const top = partial.top ?? 0;
  const width = partial.width ?? 800;
  const height = partial.height ?? 450;
  return {
    left,
    top,
    width,
    height,
    right: partial.right ?? left + width,
    bottom: partial.bottom ?? top + height
  };
}

function createMockElement(opts: MockElementOptions = {}): HTMLElement {
  const rect = makeRect(opts.rect);
  const style = createMockStyle(opts.style);
  const queryMap = opts.queryMap ?? {};
  const queryAllMap = opts.queryAllMap ?? {};

  const el = {
    id: opts.id ?? '',
    isConnected: opts.isConnected ?? true,
    classList: createClassList(opts.classes ?? []),
    style,
    textContent: opts.textContent ?? '',
    parentElement: opts.parentElement ?? null,
    getBoundingClientRect: vi.fn(() => rect),
    querySelector: vi.fn((selector: string) => queryMap[selector] ?? null),
    querySelectorAll: vi.fn((selector: string) => queryAllMap[selector] ?? []),
    contains: vi.fn(() => false),
    closest: vi.fn(() => null)
  };

  return el as unknown as HTMLElement;
}

function createMockVideo(opts: {
  isConnected?: boolean;
  rect?: Partial<MockRect>;
  style?: Partial<MockStyle>;
  paused?: boolean;
  readyState?: number;
  currentTime?: number;
  duration?: number;
  src?: string;
} = {}): HTMLVideoElement {
  const base = createMockElement({
    isConnected: opts.isConnected ?? true,
    rect: opts.rect ?? { width: 640, height: 360 },
    style: opts.style
  }) as unknown as Record<string, unknown>;

  base.paused = opts.paused ?? false;
  base.readyState = opts.readyState ?? 4;
  base.currentTime = opts.currentTime ?? 10;
  base.duration = opts.duration ?? 120;
  base.currentSrc = opts.src ?? 'https://example.com/video.mp4';
  base.src = opts.src ?? 'https://example.com/video.mp4';

  return base as unknown as HTMLVideoElement;
}

describe('@langai/players', () => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;

  afterEach(() => {
    restorePlayerJsNativeNodes();
    if (originalWindow === undefined) {
      delete (globalThis as Record<string, unknown>).window;
    } else {
      globalThis.window = originalWindow;
    }
    if (originalDocument === undefined) {
      delete (globalThis as Record<string, unknown>).document;
    } else {
      globalThis.document = originalDocument;
    }
    vi.restoreAllMocks();
  });

  it('exports the 5 PlayerPlugin implementations in DEFAULT_PLAYER_PLUGINS with html5 last', () => {
    expect(DEFAULT_PLAYER_PLUGINS.map((p) => p.id)).toEqual([
      'jwplayer',
      'playerjs',
      'videojs',
      'plyr',
      'html5'
    ]);
    expect(DEFAULT_PLAYER_PLUGINS[DEFAULT_PLAYER_PLUGINS.length - 1]).toBe(html5PlayerPlugin);
  });

  it('computes controls hidden state and bottom offsets per player', () => {
    const jwBar = createMockElement({ rect: { height: 50 } });
    const jwActive = createMockElement({
      classes: ['jwplayer'],
      queryMap: { '.jw-controlbar': jwBar }
    });
    const jwHidden = createMockElement({ classes: ['jwplayer', 'jw-flag-user-inactive'] });
    expect(jwplayerPlugin.isControlsHidden(jwActive)).toBe(false);
    expect(jwplayerPlugin.isControlsHidden(jwHidden)).toBe(true);
    expect(jwplayerPlugin.getSubtitleBottomOffset(jwActive)).toBe(66);
    expect(jwplayerPlugin.getSubtitleBottomOffset(jwHidden)).toBe(28);

    const vjsBar = createMockElement({ rect: { height: 30 } });
    const vjsActive = createMockElement({
      classes: ['video-js'],
      queryMap: { '.vjs-control-bar': vjsBar }
    });
    const vjsHidden = createMockElement({ classes: ['video-js', 'vjs-user-inactive'] });
    expect(videojsPlugin.isControlsHidden(vjsActive)).toBe(false);
    expect(videojsPlugin.isControlsHidden(vjsHidden)).toBe(true);
    expect(videojsPlugin.getSubtitleBottomOffset(vjsActive)).toBe(60);
    expect(videojsPlugin.getSubtitleBottomOffset(vjsHidden)).toBe(28);

    const plyrBar = createMockElement({ rect: { height: 52 } });
    const plyrActive = createMockElement({
      classes: ['plyr'],
      queryMap: { '.plyr__controls': plyrBar }
    });
    const plyrHidden = createMockElement({ classes: ['plyr', 'plyr--hide-controls'] });
    expect(plyrPlugin.isControlsHidden(plyrActive)).toBe(false);
    expect(plyrPlugin.isControlsHidden(plyrHidden)).toBe(true);
    expect(plyrPlugin.getSubtitleBottomOffset(plyrActive)).toBe(68);
    expect(plyrPlugin.getSubtitleBottomOffset(plyrHidden)).toBe(28);

    const pjsContainer = createMockElement({ id: 'oframecdnplayer' });
    expect(playerjsPlugin.isControlsHidden(pjsContainer)).toBe(false);
    expect(playerjsPlugin.getSubtitleBottomOffset(pjsContainer)).toBe(48);

    const html5Container = createMockElement();
    expect(html5PlayerPlugin.isControlsHidden(html5Container)).toBe(false);
    expect(html5PlayerPlugin.getSubtitleBottomOffset(html5Container)).toBe(48);
  });

  it('checks video visibility accurately', () => {
    globalThis.window = {
      getComputedStyle: (el: Element) => (el as unknown as { style: MockStyle }).style
    } as unknown as Window & typeof globalThis;

    expect(isVideoVisible(createMockVideo())).toBe(true);
    expect(isVideoVisible(createMockVideo({ isConnected: false }))).toBe(false);
    expect(isVideoVisible(createMockVideo({ rect: { width: 0, height: 0 } }))).toBe(false);
    expect(isVideoVisible(createMockVideo({ style: { display: 'none' } }))).toBe(false);
    expect(isVideoVisible(createMockVideo({ style: { visibility: 'hidden' } }))).toBe(false);
    expect(isVideoVisible(createMockVideo({ style: { opacity: '0' } }))).toBe(false);
  });

  it('resolves the matching PlayerPlugin from a root node', () => {
    globalThis.window = {
      getComputedStyle: (el: Element) => (el as unknown as { style: MockStyle }).style
    } as unknown as Window & typeof globalThis;

    const plyrVideo = createMockVideo();
    const plyrEl = createMockElement({
      classes: ['plyr'],
      queryMap: { video: plyrVideo }
    });

    const mockRoot = {
      querySelectorAll: (selector: string) => (selector === '.plyr' ? [plyrEl] : []),
      querySelector: (selector: string) => (selector === '.plyr' ? plyrEl : null)
    } as unknown as ParentNode;

    const resolved = resolvePlayerPlugin(DEFAULT_PLAYER_PLUGINS, mockRoot);
    expect(resolved).not.toBeNull();
    expect(resolved?.plugin).toBe(plyrPlugin);
    expect(resolved?.container).toBe(plyrEl);
    expect(resolved?.video).toBe(plyrVideo);
  });

  it('syncPlayerJsSubtitles skips already-matched pjsdiv nodes and avoids currentCues[0] fallback during cue pauses', () => {
    const getComputedStyleSpy = vi.fn((el: Element) => (el as unknown as { style: MockStyle }).style);
    globalThis.window = {
      getComputedStyle: getComputedStyleSpy
    } as unknown as Window & typeof globalThis;
    globalThis.document = {
      body: null,
      documentElement: null,
      querySelector: () => null
    } as unknown as Document;

    const subNode = createMockElement({
      rect: { left: 200, top: 360, width: 400, height: 40 },
      style: { pointerEvents: 'none', textAlign: 'center' },
      textContent: 'Hello world'
    });
    const unrelatedNode = createMockElement({
      rect: { left: 50, top: 100, width: 200, height: 30 },
      style: { pointerEvents: 'auto', textAlign: 'left' },
      textContent: 'First cue text'
    });

    const container = createMockElement({
      id: 'oframecdnplayer',
      rect: { left: 0, top: 0, width: 800, height: 450 },
      queryAllMap: {
        pjsdiv: [subNode, unrelatedNode]
      },
      queryMap: {
        pjsdiv: subNode
      }
    });
    (subNode as unknown as { parentElement: HTMLElement }).parentElement = container;
    (unrelatedNode as unknown as { parentElement: HTMLElement }).parentElement = container;

    // 1. Active cue matches subNode -> hides subNode and caches it in knownSubtitleContainers
    syncPlayerJsSubtitles(container, true, { primaryText: 'Hello world' });
    expect(subNode.style.visibility).toBe('hidden');
    expect(subNode.style.opacity).toBe('0');
    expect(unrelatedNode.style.visibility).toBe('');

    const subRectSpy = subNode.getBoundingClientRect as ReturnType<typeof vi.fn>;
    const callsAfterFirstSync = subRectSpy.mock.calls.length;
    expect(callsAfterFirstSync).toBe(1);

    // 2. Subsequent sync (simulating timeupdate during cue pause with activeCue = undefined):
    //    - subNode hits early return `if (matchedNodes.has(el)) return;` -> no repeated getBoundingClientRect/getComputedStyle
    //    - unrelatedNode is NOT falsely matched against any cue[0] fallback
    getComputedStyleSpy.mockClear();
    syncPlayerJsSubtitles(container, true, undefined);
    expect(subRectSpy.mock.calls.length).toBe(callsAfterFirstSync);
    expect(getComputedStyleSpy).not.toHaveBeenCalledWith(subNode);
    expect(subNode.style.visibility).toBe('hidden');
    expect(unrelatedNode.style.visibility).toBe('');

    // 3. Restoring native nodes clears hidden styles
    syncPlayerJsSubtitles(container, false);
    expect(subNode.style.visibility).toBe('');
    expect(subNode.style.opacity).toBe('');
  });
});
