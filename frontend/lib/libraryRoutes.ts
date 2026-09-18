export const DEFAULT_LIBRARY_KEY = 'public-space';

export interface LibraryRoute {
  libraryKey: string;
  spaceId: number | null;
  isIndex: boolean;
}

const parseSpaceId = (value: string | undefined): number | null => {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

export const buildLibraryIndexHash = (libraryKey: string = DEFAULT_LIBRARY_KEY) =>
  `#/library/${libraryKey}`;

export const buildLibrarySpaceHash = (libraryKey: string, spaceId: number) =>
  `#/library/${libraryKey}/spaces/${spaceId}`;

export const parseLibraryRoute = (hash: string): LibraryRoute | null => {
  const normalizedHash = hash.startsWith('#') ? hash.slice(1) : hash;
  const [pathPart] = normalizedHash.split('?');
  const path = pathPart.replace(/^\/+/, '');
  const parts = path.split('/').filter(Boolean);

  if (parts[0] !== 'library') {
    return null;
  }

  const libraryKey = parts[1] || DEFAULT_LIBRARY_KEY;
  const isIndex = parts.length <= 2;

  if (isIndex) {
    return {
      libraryKey,
      spaceId: null,
      isIndex: true,
    };
  }

  if (parts[2] === 'spaces') {
    return {
      libraryKey,
      spaceId: parseSpaceId(parts[3]),
      isIndex: false,
    };
  }

  return {
    libraryKey,
    spaceId: null,
    isIndex: true,
  };
};
