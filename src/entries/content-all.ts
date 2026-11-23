import { initContentRunner } from '../core/content/ContentRunner';
import { YouTubeAdapter } from '../adapters/youtube/YouTubeAdapter';
import { CinemaAdapter } from '../adapters/cinema/CinemaAdapter';

const ytAdapter = new YouTubeAdapter();
const cinemaAdapter = new CinemaAdapter();

if (ytAdapter.matchesLocation(window.location)) {
  initContentRunner(ytAdapter);
} else if (cinemaAdapter.matchesLocation(window.location)) {
  initContentRunner(cinemaAdapter);
}
