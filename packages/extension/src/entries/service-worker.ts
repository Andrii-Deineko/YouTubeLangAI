import { initServiceWorker } from '@langai/core/background';
import { REGISTERED_SERVICES } from '../registry';

initServiceWorker(REGISTERED_SERVICES);
