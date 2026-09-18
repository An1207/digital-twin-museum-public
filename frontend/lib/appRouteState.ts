import {
  buildLibraryIndexHash,
  DEFAULT_LIBRARY_KEY,
  parseLibraryRoute,
  type LibraryRoute,
} from './libraryRoutes';

export type AppRouteKind =
  | 'home'
  | 'library-index'
  | 'library-space'
  | 'debug-recommendation'
  | 'debug-framed-glb'
  | 'debug-room-merge'
  | 'debug-storytelling'
  | 'debug-curator-space-management'
  | 'debug-curator-workspace'
  | 'unknown';

export interface AppRouteState {
  kind: AppRouteKind;
  hash: string;
  libraryRoute: LibraryRoute | null;
  normalizedHash: string | null;
  requiresAuth: boolean;
  isLibraryIndexPage: boolean;
  isLibrarySpacePage: boolean;
}

const HOME_HASHES = new Set(['', '#/']);

export const getAppRouteState = (hash: string): AppRouteState => {
  const libraryRoute = parseLibraryRoute(hash);
  const normalizedHash =
    hash === '#/library' || hash === '#/library/'
      ? buildLibraryIndexHash(DEFAULT_LIBRARY_KEY)
      : null;

  let kind: AppRouteKind = 'unknown';

  if (HOME_HASHES.has(hash)) {
    kind = 'home';
  } else if (libraryRoute?.spaceId != null) {
    kind = 'library-space';
  } else if (libraryRoute?.isIndex) {
    kind = 'library-index';
  } else if (hash.startsWith('#/debug/recommendation')) {
    kind = 'debug-recommendation';
  } else if (hash.startsWith('#/debug/framed-glb')) {
    kind = 'debug-framed-glb';
  } else if (
    hash.startsWith('#/debug/glb-room-merge-experiment') ||
    hash.startsWith('#/experiment')
  ) {
    kind = 'debug-room-merge';
  } else if (hash.startsWith('#/debug/storytelling')) {
    kind = 'debug-storytelling';
  } else if (hash.startsWith('#/debug/curator-space-management')) {
    kind = 'debug-curator-space-management';
  } else if (hash.startsWith('#/debug/curator-workspace')) {
    kind = 'debug-curator-workspace';
  }

  return {
    kind,
    hash,
    libraryRoute,
    normalizedHash,
    requiresAuth: kind !== 'home',
    isLibraryIndexPage: kind === 'library-index',
    isLibrarySpacePage: kind === 'library-space',
  };
};
