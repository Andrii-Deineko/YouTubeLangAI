import type { ServiceDescriptor, ServicePlugin } from '@langai/contracts';
import { hdrezkaService } from '@langai/service-hdrezka';
import { hianimeService } from '@langai/service-hianime';
import { netflixService } from '@langai/service-netflix';
import { urplayService } from '@langai/service-urplay';
import { youtubeService } from '@langai/service-youtube';

export const REGISTERED_SERVICES: readonly ServicePlugin[] = [
  youtubeService,
  netflixService,
  urplayService,
  hdrezkaService,
  hianimeService
];

export const SERVICE_DESCRIPTORS: readonly ServiceDescriptor[] = REGISTERED_SERVICES.map(
  ({
    id,
    name,
    badgeLabel,
    defaultSourceLang,
    hostMatches,
    playerIframeMatches,
    capabilities
  }) => ({
    id,
    name,
    badgeLabel,
    defaultSourceLang,
    hostMatches,
    playerIframeMatches,
    capabilities
  })
);
