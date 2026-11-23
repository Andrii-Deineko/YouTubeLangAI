import { initContentRunner } from '../core/content/ContentRunner';
import { YouTubeAdapter } from '../adapters/youtube/YouTubeAdapter';

const adapter = new YouTubeAdapter();
if (adapter.matchesLocation(window.location)) {
  initContentRunner(adapter);
}
