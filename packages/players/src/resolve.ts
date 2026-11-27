import type { PlayerPlugin } from '@langai/contracts';
import { html5PlayerPlugin } from './plugins/html5';
import { jwplayerPlugin } from './plugins/jwplayer';
import { playerjsPlugin } from './plugins/playerjs';
import { plyrPlugin } from './plugins/plyr';
import { videojsPlugin } from './plugins/videojs';
import { isVideoVisible } from './shared/dom';

export interface ResolvedPlayer {
  plugin: PlayerPlugin;
  container: HTMLElement;
  video: HTMLVideoElement | null;
}

/**
 * Default ordered list of generic player plugins (most specific first, generic HTML5 last).
 */
export const DEFAULT_PLAYER_PLUGINS: readonly PlayerPlugin[] = [
  jwplayerPlugin,
  playerjsPlugin,
  videojsPlugin,
  plyrPlugin,
  html5PlayerPlugin
];

/**
 * Resolves the active PlayerPlugin and its container/video from an ordered list of plugins.
 * Prefers the first plugin whose container holds a visible video, falling back to the
 * first plugin with a detected container (with or without a video element yet).
 */
export function resolvePlayerPlugin(
  players: readonly PlayerPlugin[],
  root?: ParentNode
): ResolvedPlayer | null {
  let firstWithVideo: ResolvedPlayer | null = null;
  let firstContainerOnly: ResolvedPlayer | null = null;

  for (const plugin of players) {
    const container = plugin.detectContainer(root);
    if (!container) continue;

    const video = plugin.findVideo(container, root);
    if (video && isVideoVisible(video)) {
      return { plugin, container, video };
    }

    if (video && !firstWithVideo) {
      firstWithVideo = { plugin, container, video };
    } else if (!firstContainerOnly) {
      firstContainerOnly = { plugin, container, video: null };
    }
  }

  return firstWithVideo ?? firstContainerOnly;
}
