import { resolveSpaceThumbnailImageUrl } from '../../lib/imagePaths';

interface SpaceThumbnailMosaicProps {
  images: string[];
  alt: string;
  className?: string;
}

const SpaceThumbnailMosaic = ({ images, alt, className = '' }: SpaceThumbnailMosaicProps) => {
  const previewImage = images.find(Boolean);

  if (!previewImage) {
    return (
      <div className={`flex h-full w-full items-center justify-center bg-gradient-to-br from-stone-800 to-black text-stone-500 ${className}`}>
        No image
      </div>
    );
  }

  return (
    <img
      src={resolveSpaceThumbnailImageUrl(previewImage)}
      alt={alt}
      className={`h-full w-full object-cover ${className}`}
    />
  );
};

export default SpaceThumbnailMosaic;
