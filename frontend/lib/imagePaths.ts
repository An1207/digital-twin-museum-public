export const FALLBACK_ARTWORK_IMAGE =
  '/images/artworks/museum_cma_001_katsushika-hokusai-japanese-17601849_south-wind-clear-sky-from-thirty-six-views-of-mount-fuji.jpg';

export const resolveArtworkImageUrl = (imagePath?: string | null) => {
  if (!imagePath) return FALLBACK_ARTWORK_IMAGE;
  if (imagePath.startsWith('/')) return imagePath;
  if (imagePath.startsWith('images/')) return `/${imagePath}`;
  if (imagePath.startsWith('artworks/')) return `/images/${imagePath}`;
  return `/images/artworks/${imagePath}`;
};

export const resolveSpaceThumbnailImageUrl = (imagePath?: string | null) => {
  if (!imagePath) return FALLBACK_ARTWORK_IMAGE;

  const normalized = imagePath.trim();
  if (!normalized) return FALLBACK_ARTWORK_IMAGE;
  if (normalized.startsWith('http://') || normalized.startsWith('https://')) return normalized;
  if (normalized.startsWith('/assets/') || normalized.startsWith('/images/')) return normalized;
  if (normalized.startsWith('curator-space-thumbnails/')) return `/assets/${normalized}`;
  if (normalized.startsWith('curator-space-files/')) return `/assets/${normalized}`;
  return resolveArtworkImageUrl(normalized);
};
