import { initYouTubeInterceptor } from '../adapters/youtube/youtubeInterceptor';
import { initCinemaInterceptor } from '../adapters/cinema/cinemaInterceptor';

const host = window.location.hostname;
if (host.includes('youtube.com')) {
  initYouTubeInterceptor();
} else {
  initCinemaInterceptor();
}
