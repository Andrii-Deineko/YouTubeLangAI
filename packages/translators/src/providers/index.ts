import type { TranslationProvider, TranslationProviderPlugin } from '@langai/contracts';
import { deeplProvider } from './deepl';
import { googleDictProvider } from './googleDict';
import { googleGtxProvider } from './googleGtx';
import { myMemoryProvider } from './mymemory';

export { deeplProvider } from './deepl';
export { googleDictProvider } from './googleDict';
export { googleGtxProvider } from './googleGtx';
export { myMemoryProvider } from './mymemory';

export const ALL_TRANSLATION_PROVIDERS: readonly TranslationProviderPlugin[] = [
  googleDictProvider,
  googleGtxProvider,
  deeplProvider,
  myMemoryProvider
];

const PROVIDER_MAP = new Map<string, TranslationProviderPlugin>(
  ALL_TRANSLATION_PROVIDERS.map((provider) => [provider.id, provider])
);

export function getTranslationProvider(
  id: TranslationProvider | string
): TranslationProviderPlugin {
  return PROVIDER_MAP.get(id) ?? googleDictProvider;
}
