import { initContentRunner } from '../core/content/ContentRunner';
import { CinemaAdapter } from '../adapters/cinema/CinemaAdapter';

const adapter = new CinemaAdapter();
if (adapter.matchesLocation(window.location)) {
  initContentRunner(adapter);
}
