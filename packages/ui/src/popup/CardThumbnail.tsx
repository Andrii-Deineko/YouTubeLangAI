import { useEffect, useState, type ReactElement } from 'react';
import type { VocabularyCard } from '@langai/contracts';
import { getCardMediaDataUrl } from '@langai/storage';

export interface CardThumbnailProps {
  card: VocabularyCard;
  alt: string;
  className?: string;
}

/**
 * Hydrates a card's screenshot from `screenshotBase64` or IndexedDB `mediaBlobKey`.
 */
export function useCardMediaUrl(card: VocabularyCard | null): string | null {
  const [hydratedUrl, setHydratedUrl] = useState<string | null>(
    card?.screenshotBase64 ?? null
  );

  useEffect(() => {
    if (!card) {
      setHydratedUrl(null);
      return;
    }
    if (card.screenshotBase64) {
      setHydratedUrl(card.screenshotBase64);
      return;
    }
    if (!card.mediaBlobKey) {
      setHydratedUrl(null);
      return;
    }

    let cancelled = false;
    setHydratedUrl(null);
    void getCardMediaDataUrl(card.mediaBlobKey)
      .then((url) => {
        if (!cancelled) {
          setHydratedUrl(url);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setHydratedUrl(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [card, card?.id, card?.mediaBlobKey, card?.screenshotBase64]);

  return hydratedUrl;
}

export function CardThumbnail({ card, alt, className = '' }: CardThumbnailProps): ReactElement | null {
  const src = useCardMediaUrl(card);
  if (!src) return null;
  return <img src={src} alt={alt} className={className} />;
}
