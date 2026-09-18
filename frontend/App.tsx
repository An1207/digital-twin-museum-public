import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useCurationStore } from './hooks/useCurationStore';
import { CurationModal } from './components/curation/CurationModal';
import { EntranceModeSelection } from './components/curation/EntranceModeSelection';
import { AuthOverlay } from './components/auth/AuthOverlay';
import { Toast } from './components/ui/Toast';
import { PublicSpaceLibrary } from './components/library/PublicSpaceLibrary';
import { apiService } from './lib/api';
import { buildLibraryIndexHash, buildLibrarySpaceHash, DEFAULT_LIBRARY_KEY } from './lib/libraryRoutes';
import { getAppRouteState } from './lib/appRouteState';
import { resolveArtworkImageUrl } from './lib/imagePaths';
import { resolveWorkspaceRole } from './lib/workspaceRole';
import { useModalPointerPolicy } from './lib/useModalPointerPolicy';
import { useUiLocale } from './lib/uiLocale';
import type {
  Artwork,
  AuthUser,
  PublishedSpaceDetail,
  StorytellingTtsAsset,
  StorytellingVersion,
} from './types/curation';

const Gallery = lazy(async () => {
  const module = await import('./components/ui/Gallery');
  return { default: module.default };
});

const ThreeDViewer = lazy(async () => {
  const module = await import('./components/viewer/ThreeDViewer');
  return { default: module.ThreeDViewer };
});

const RecommendationDebugPage = lazy(() => import('./components/debug/RecommendationDebugPage'));
const FramedGlbViewerPage = lazy(() => import('./components/debug/FramedGlbViewerPage'));
const RoomMergeExperimentPage = lazy(() => import('./components/debug/RoomMergeExperimentPage'));
const StorytellingDashboardPage = lazy(() => import('./components/debug/StorytellingDashboardPage'));
const CuratorSpaceManagementPage = lazy(() => import('./components/debug/CuratorSpaceManagementPage'));
const CuratorWorkspacePage = lazy(() => import('./components/debug/CuratorWorkspacePage'));

const getLayoutSummary = (layout: NonNullable<ReturnType<typeof useCurationStore.getState>['layout']>) => {
  if (layout.layoutType === 'public_space') {
    return layout.spaceMeta?.title || layout.themeOption.labelKo;
  }
  if (layout.themeOption.optionKey === 'default') {
    return 'Default Exhibition';
  }

  return `${layout.themeOption.labelKo} · ${layout.eraOption.labelKo} · ${layout.emotionOption.labelKo}`;
};

const getArtworkPeriodLabel = (yearDisplay?: string, originPeriod?: string) => {
  if (yearDisplay && originPeriod) {
    return `${yearDisplay} · ${originPeriod}`;
  }
  return yearDisplay || originPeriod || 'Unknown year';
};

const CurationResultPanel = () => {
  const { layout } = useCurationStore();

  if (!layout || layout.placements.length === 0) {
    return null;
  }

  return (
    <aside
      data-testid="gallery-curation-summary"
      className="absolute left-6 bottom-6 z-[120] w-[320px] max-h-[42vh] overflow-hidden rounded-xl border border-white/15 bg-[#1b1812]/84 text-[#f4efe7] shadow-2xl backdrop-blur-xl"
    >
      <div className="border-b border-white/10 px-4 py-3">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#7f9b5a]">
          Backend Sorted Artworks
        </p>
        <p className="mt-1 text-xs text-[#d8cbbb]">
          {getLayoutSummary(layout)}
        </p>
      </div>
      <ol className="max-h-[calc(42vh-64px)] overflow-y-auto px-2 py-2">
        {layout.placements.map((placement) => (
          <li
            key={`${placement.slotNumber}-${placement.artwork.id}`}
            className="grid grid-cols-[36px_42px_1fr] gap-2 rounded-lg px-2 py-2 text-sm"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-[#7f9b5a]/20 text-xs font-bold text-[#e8f0d5]">
              {placement.slotNumber}
            </span>
            <img
              src={resolveArtworkImageUrl(placement.artwork.imagePath)}
              alt=""
              className="h-10 w-10 rounded-md object-cover ring-1 ring-[#7f9b5a]/20"
              loading="lazy"
            />
            <div className="min-w-0">
              <div className="flex items-start justify-between gap-2">
                <p className="truncate font-medium text-[#f4efe7]">{placement.artwork.title}</p>
                {placement.artwork.scoreBreakdown && (
                  <span className="shrink-0 rounded bg-[#7f9b5a]/20 px-2 py-0.5 text-[11px] font-semibold text-[#e8f0d5]">
                    {placement.artwork.scoreBreakdown.final.toFixed(2)}
                  </span>
                )}
              </div>
              <p className="truncate text-xs text-[#d8cbbb]">
                {getArtworkPeriodLabel(placement.artwork.yearDisplay, placement.artwork.originPeriod)} · ID {placement.artwork.id}
              </p>
              {placement.artwork.recommendationReasons?.length ? (
                <p className="mt-1 text-[11px] text-[#d8cbbb]">
                  {placement.artwork.recommendationReasons.join(' · ')}
                </p>
              ) : null}
              {placement.artwork.estimatedYearReason ? (
                <p className="mt-1 text-[10px] text-[#b29e8d]">
                  {placement.artwork.estimatedYearReason}
                </p>
              ) : null}
              {placement.artwork.scoreBreakdown ? (
                <p className="mt-1 text-[10px] uppercase tracking-[0.12em] text-[#b29e8d]">
                  V {placement.artwork.scoreBreakdown.visual.toFixed(2)}
                  {' '}T {placement.artwork.scoreBreakdown.theme.toFixed(2)}
                  {' '}E {placement.artwork.scoreBreakdown.era.toFixed(2)}
                  {' '}M {placement.artwork.scoreBreakdown.emotion.toFixed(2)}
                </p>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </aside>
  );
};

const ArtworkStoryModal = ({
  artwork,
  story,
  ttsAssets,
  loading,
  error,
  onClose,
}: {
  artwork: Artwork | null;
  story: StorytellingVersion | null;
  ttsAssets: StorytellingTtsAsset[];
  loading: boolean;
  error: string | null;
  onClose: () => void;
}) => {
  const { locale } = useUiLocale();
  const isKorean = locale === 'ko';
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playError, setPlayError] = useState<string | null>(null);

  const currentTitle = story?.storyTitle?.trim() || artwork?.title || (isKorean ? '작품 스토리' : 'Artwork story');
  const currentText = story?.storyText?.trim() || artwork?.descriptionDefault || (isKorean ? '아직 저장된 스토리텔링이 없습니다.' : 'No story has been saved yet.');
  const currentStatus = story?.status || 'draft';
  const currentArtist = artwork?.artist || (isKorean ? '알 수 없는 작가' : 'Unknown artist');
  const currentPeriod = getArtworkPeriodLabel(artwork?.yearDisplay, artwork?.originPeriod);
  const currentTtsAsset = useMemo(
    () => ttsAssets.find((asset) => asset.status === 'ready' && Boolean(asset.audioUrl)) ?? null,
    [ttsAssets]
  );
  const copy = {
    titleLabel: isKorean ? '작품 스토리' : 'Artwork Story',
    close: isKorean ? '닫기' : 'Close',
    version: isKorean ? '버전' : 'Version',
    noPublishedStory: isKorean ? '게시된 스토리가 없습니다.' : 'No published story',
    pending: isKorean ? '대기 중' : 'Pending',
    loading: isKorean ? '스토리텔링을 불러오는 중입니다...' : 'Loading storytelling...',
    continue: isKorean ? '계속 보기' : 'Continue viewing',
    playStory: isKorean ? '직접 듣는 스토리' : 'Listen to the story',
    pauseStory: isKorean ? '일시정지' : 'Pause',
    playStoryLoading: isKorean ? '오디오를 준비하는 중입니다...' : 'Preparing audio...',
    playStoryUnavailable: isKorean ? '현재 들을 수 있는 TTS가 없습니다.' : 'No ready TTS audio is available.',
  } as const;

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    audio.pause();
    audio.currentTime = 0;
    audio.src = currentTtsAsset?.audioUrl ?? '';
    audio.load();
    setIsPlaying(false);
    setPlayError(null);
  }, [currentTtsAsset?.audioUrl]);

  useEffect(() => {
    const audio = audioRef.current;
    return () => {
      if (!audio) return;
      audio.pause();
      audio.currentTime = 0;
    };
  }, []);

  if (!artwork) return null;

  const handlePlayStory = async () => {
    const audio = audioRef.current;
    if (!audio || !currentTtsAsset?.audioUrl) return;

    try {
      setPlayError(null);
      if (audio.paused) {
        await audio.play();
      } else {
        audio.pause();
      }
    } catch (err) {
      setIsPlaying(false);
      setPlayError(err instanceof Error ? err.message : copy.playStoryUnavailable);
    }
  };

  return (
    <motion.div
      className="absolute inset-0 z-[220] flex items-center justify-center bg-[#14130c]/72 px-6 py-8 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="relative w-full max-w-4xl overflow-hidden rounded-[30px] border border-white/15 bg-[#1b1812]/90 shadow-[0_30px_80px_rgba(0,0,0,0.55)] backdrop-blur-2xl"
        initial={{ scale: 0.96, y: 16 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.96, y: 16 }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="grid gap-0 md:grid-cols-[280px_1fr]">
          <div className="relative min-h-[260px] border-b border-white/10 bg-[#5b2c20]/18 md:border-b-0 md:border-r">
            <img
              src={resolveArtworkImageUrl(artwork.imagePath)}
              alt={artwork.title}
              className="h-full w-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black via-black/15 to-transparent" />
          </div>

          <div className="flex flex-col gap-5 p-6 md:p-8">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#7f9b5a]">
                  {copy.titleLabel}
                </p>
                <h2 className="mt-2 text-2xl font-semibold text-[#f4efe7] md:text-3xl">
                  {currentTitle}
                </h2>
                <p className="mt-2 text-sm text-[#d8cbbb]">
                  {currentArtist} · {currentPeriod} · ID {artwork.id}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
              className="rounded-xl border border-white/10 bg-[#1b1812]/72 px-3 py-2 text-sm font-semibold text-[#f4efe7] transition hover:bg-[#5b2c20]/28"
              >
                {copy.close}
              </button>
            </div>

            <div className="flex flex-wrap gap-2 text-xs font-semibold uppercase tracking-[0.14em]">
              <span className="rounded-full border border-[#7f9b5a]/25 bg-[#7f9b5a]/15 px-3 py-1 text-[#e8f0d5]">
                {currentStatus}
              </span>
              <span className="rounded-full border border-white/10 bg-[#1b1812]/72 px-3 py-1 text-[#d8cbbb]">
                {story ? `${copy.version} ${story.versionNumber}` : copy.noPublishedStory}
              </span>
              <span className="rounded-full border border-white/10 bg-[#1b1812]/72 px-3 py-1 text-[#d8cbbb]">
                {story?.createdAt ?? copy.pending}
              </span>
            </div>

            <div className="rounded-2xl border border-white/10 bg-[#1b1812]/68 p-5">
              <p className="whitespace-pre-wrap text-[15px] leading-7 text-[#f4efe7]">
                {loading ? copy.loading : currentText}
              </p>
            </div>

            {error ? (
              <div className="rounded-2xl border border-[#b57d69]/24 bg-[#5b2c20]/22 px-4 py-3 text-sm text-[#f0d7cf]">
                {error}
              </div>
            ) : null}

            <div className="rounded-2xl border border-white/10 bg-[#1b1812]/68 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7f9b5a]">
                    {copy.playStory}
                  </p>
                  <p className="mt-1 text-xs text-[#d8cbbb]">
                    {isKorean ? '재생바에서 일시정지, 재생, 시간 이동을 할 수 있습니다.' : 'Use the player bar to pause, play, and scrub through the story.'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void handlePlayStory()}
                  disabled={!currentTtsAsset?.audioUrl || loading}
                  className="rounded-xl border border-[#7f9b5a]/24 bg-[#7f9b5a]/14 px-4 py-3 text-sm font-semibold text-[#e8f0d5] transition hover:bg-[#7f9b5a]/20 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/5 disabled:text-[#b29e8d]"
                >
                  {loading
                    ? copy.playStoryLoading
                    : isPlaying
                      ? copy.pauseStory
                      : copy.playStory}
                </button>
              </div>
              {!currentTtsAsset?.audioUrl && !loading ? (
                <p className="mt-3 text-xs text-[#b29e8d]">{copy.playStoryUnavailable}</p>
              ) : null}
              <audio
                ref={audioRef}
                className="mt-4 w-full"
                preload="metadata"
                controls
                controlsList="nodownload noplaybackrate"
                aria-label={currentTitle}
                src={currentTtsAsset?.audioUrl ?? undefined}
                onEnded={() => setIsPlaying(false)}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                onError={() => {
                  setIsPlaying(false);
                  setPlayError(copy.playStoryUnavailable);
                }}
              />
            </div>
            {playError ? (
              <div className="rounded-2xl border border-[#b57d69]/24 bg-[#5b2c20]/22 px-4 py-3 text-sm text-[#f0d7cf]">
                {playError}
              </div>
            ) : null}
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
};

const AppSectionLoader = ({ message }: { message: string }) => (
  <div className="flex h-full min-h-screen items-center justify-center bg-[#14130c] text-[#f4efe7]">
    <div className="flex flex-col items-center gap-4 rounded-2xl border border-white/10 bg-[#1b1812]/80 px-8 py-6 backdrop-blur-xl">
      <div className="h-12 w-12 animate-spin rounded-full border-4 border-[#7f9b5a]/70 border-t-transparent" />
      <p className="text-sm font-medium tracking-[0.08em] text-[#d8cbbb]">{message}</p>
    </div>
  </div>
);

function App() {
  const { modalState, layout, setLayout, setModalState } = useCurationStore();
  const { locale } = useUiLocale();
  const isKorean = locale === 'ko';
  const backLabel = isKorean ? '뒤로가기' : 'Back';
  const homeButtonLabel = isKorean ? '홈' : 'Home';
  const copy = useMemo(() => ({
    loginRequired: isKorean ? '로그인이 필요합니다.' : 'Login is required.',
    sessionExpiredLoginRequired: isKorean ? '세션이 만료되었습니다. 다시 로그인해 주세요.' : 'Your session has expired. Please sign in again.',
    ownedArtworkList: isKorean ? '소유한 작품 리스트' : 'Owned artworks list',
    curatorWorkspaceLoginRequired: isKorean ? '큐레이터 작업공간은 로그인 후 사용할 수 있습니다.' : 'The curator workspace is available after sign in.',
    curationLoginRequired: isKorean ? '큐레이션은 로그인 후 사용할 수 있습니다.' : 'Curation is available after sign in.',
    artworkIdError: isKorean ? '작품 ID를 해석할 수 없습니다.' : 'Unable to parse the artwork ID.',
    storytellingLoadError: isKorean ? '스토리텔링을 불러오지 못했습니다.' : 'Failed to load storytelling.',
    spaceLoadError: isKorean ? '공간을 불러오지 못했습니다.' : 'Failed to load the space.',
    libraryViewerErrorTitle: isKorean ? '라이브러리 뷰어 오류' : 'Library viewer error',
    home: isKorean ? '홈으로 돌아가기' : 'Go back home',
    libraryList: isKorean ? '라이브러리 목록' : 'Library list',
  }), [isKorean]);
  const [showEntranceMode, setShowEntranceMode] = useState(false);
  const [currentHash, setCurrentHash] = useState(() => window.location.hash);
  const [toast, setToast] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(() => apiService.getStoredAuthUserSnapshot());
  const [selectedArtwork, setSelectedArtwork] = useState<Artwork | null>(null);
  const [selectedArtworkStory, setSelectedArtworkStory] = useState<StorytellingVersion | null>(null);
  const [selectedArtworkTtsAssets, setSelectedArtworkTtsAssets] = useState<StorytellingTtsAsset[]>([]);
  const [selectedArtworkStoryLoading, setSelectedArtworkStoryLoading] = useState(false);
  const [selectedArtworkStoryError, setSelectedArtworkStoryError] = useState<string | null>(null);
  const [showArtworkStoryModal, setShowArtworkStoryModal] = useState(false);
  const [libraryViewerLoading, setLibraryViewerLoading] = useState(false);
  const [libraryViewerError, setLibraryViewerError] = useState<string | null>(null);
  const [activeLibrarySpaceId, setActiveLibrarySpaceId] = useState<number | null>(null);
  const [loginPromptMessage, setLoginPromptMessage] = useState<string | null>(null);
  const [loginPromptRequestId, setLoginPromptRequestId] = useState(0);
  const [authHeaderToggleRequestId, setAuthHeaderToggleRequestId] = useState(0);
  const [loginPromptForceOpen, setLoginPromptForceOpen] = useState(false);
  const storyRequestIdRef = useRef(0);
  const libraryRequestIdRef = useRef(0);

  const navigateToHash = useCallback((nextHash: string) => {
    if (window.location.hash !== nextHash) {
      window.location.hash = nextHash;
    }
  }, [copy.artworkIdError, copy.storytellingLoadError]);
  const bootstrapWorkspaceRoleHint = apiService.getStoredWorkspaceRoleHint();
  const workspaceRoleHint = currentUser
    ? resolveWorkspaceRole(currentUser.roles, currentUser.primaryRole)
    : bootstrapWorkspaceRoleHint;

  useEffect(() => {
    if (!currentUser) {
      return;
    }

    apiService.clearAuthRequiredPrompt();
    setLoginPromptMessage(null);
    setLoginPromptForceOpen(false);
    setLoginPromptRequestId(0);
  }, [currentUser]);

  const handleGoBack = useCallback(() => {
    if (window.history.length > 1) {
      window.history.back();
      return;
    }

    navigateToHash('#/');
  }, [navigateToHash]);
  const showCurationModal =
    modalState === 'ENTRY_SELECTION' ||
    modalState === 'AXIS_SELECTION' ||
    modalState === 'LOADING';

  useEffect(() => {
    const handleHashChange = () => setCurrentHash(window.location.hash);
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  useEffect(() => {
    if (apiService.hasAuthRequiredPrompt()) {
      setLoginPromptMessage(apiService.getAuthRequiredMessage() ?? copy.sessionExpiredLoginRequired);
      setLoginPromptForceOpen(true);
      setLoginPromptRequestId((current) => current + 1);
      setCurrentUser(null);
    }

    const handleAuthChanged = () => {
      if (apiService.hasAuthTokens()) {
        apiService.clearAuthRequiredPrompt();
        setLoginPromptForceOpen(false);
        setLoginPromptMessage(null);
        return;
      }

      setCurrentUser(null);
    };

    const handleAuthRequired = (event: Event) => {
      const detail = event instanceof CustomEvent ? (event.detail as { message?: string | null } | undefined) : undefined;
      setLoginPromptMessage(detail?.message ?? copy.sessionExpiredLoginRequired);
      setLoginPromptForceOpen(true);
      setLoginPromptRequestId((current) => current + 1);
      setCurrentUser(null);
    };

    window.addEventListener('digital-twin-auth-changed', handleAuthChanged);
    window.addEventListener('digital-twin-auth-required', handleAuthRequired as EventListener);
    return () => {
      window.removeEventListener('digital-twin-auth-changed', handleAuthChanged);
      window.removeEventListener('digital-twin-auth-required', handleAuthRequired as EventListener);
    };
  }, [copy.sessionExpiredLoginRequired]);

  const routeState = useMemo(() => getAppRouteState(currentHash), [currentHash]);
  const libraryRoute = routeState.libraryRoute;
  const isDebugPage = routeState.kind === 'debug-recommendation';
  const isFramedGlbPage = routeState.kind === 'debug-framed-glb';
  const isRoomMergeExperimentPage = routeState.kind === 'debug-room-merge';
  const isStorytellingPage = routeState.kind === 'debug-storytelling';
  const isCuratorSpaceManagementPage = routeState.kind === 'debug-curator-space-management';
  const isCuratorWorkspacePage = routeState.kind === 'debug-curator-workspace';
  const isLibraryIndexPage = routeState.isLibraryIndexPage;
  const isLibrarySpacePage = routeState.isLibrarySpacePage;
  const hasStoredAuth = apiService.hasAuthTokens();
  const canAccessProtectedPages = Boolean(currentUser) || hasStoredAuth;
  const userRoles = currentUser?.roles ?? (bootstrapWorkspaceRoleHint ? [bootstrapWorkspaceRoleHint === 'writer' ? 'writer' : 'paid_curator'] : []);
  const isWriterMember = userRoles.includes('writer') && !userRoles.includes('paid_curator');
  const workspaceLoginRequiredLabel = isWriterMember
    ? (isKorean ? '작가 작업공간은 로그인 후 사용할 수 있습니다.' : 'The writer workspace is available after sign in.')
    : (isKorean ? '큐레이터 작업공간은 로그인 후 사용할 수 있습니다.' : 'The curator workspace is available after sign in.');
  const protectedRoutePromptMessage = useMemo(() => {
    if (routeState.kind === 'debug-curator-workspace') {
      return workspaceLoginRequiredLabel;
    }
    return copy.loginRequired;
  }, [copy.loginRequired, routeState.kind, workspaceLoginRequiredLabel]);
  const handleToast = (type: 'success' | 'error' | 'info', message: string) => {
    setToast({ type, message });
  };

  const requireAuth = useCallback(
    (fallbackMessage: string = copy.loginRequired) => {
      if (canAccessProtectedPages) {
        return true;
      }

      setLoginPromptMessage(fallbackMessage);
      setLoginPromptForceOpen(false);
      setLoginPromptRequestId((current) => current + 1);
      navigateToHash('#/');
      return false;
    },
    [canAccessProtectedPages, copy.loginRequired, navigateToHash]
  );

  const handleArtworkClick = useCallback((artwork: Artwork) => {
    setSelectedArtwork(artwork);
    setSelectedArtworkStory(null);
    setSelectedArtworkTtsAssets([]);
    setSelectedArtworkStoryError(null);
    setSelectedArtworkStoryLoading(true);
    setShowArtworkStoryModal(true);
    const requestId = storyRequestIdRef.current + 1;
    storyRequestIdRef.current = requestId;

    const artworkId = Number(artwork.id);
    if (!Number.isFinite(artworkId)) {
      setSelectedArtworkStoryError(copy.artworkIdError);
      setSelectedArtworkStoryLoading(false);
      return;
    }

    void apiService
      .getPublicStorytellingCurrent(artworkId)
      .then((response) => {
        if (storyRequestIdRef.current !== requestId) return;
        setSelectedArtworkStory(response.currentVersion ?? null);
        setSelectedArtworkTtsAssets(response.ttsAssets ?? []);
      })
      .catch((error: unknown) => {
        if (storyRequestIdRef.current !== requestId) return;
        setSelectedArtworkStoryError(error instanceof Error ? error.message : copy.storytellingLoadError);
        setSelectedArtworkTtsAssets([]);
      })
      .finally(() => {
        if (storyRequestIdRef.current !== requestId) return;
        setSelectedArtworkStoryLoading(false);
      });
  }, []);

  const handleArtworkStoryClose = useCallback(() => {
    storyRequestIdRef.current += 1;
    setShowArtworkStoryModal(false);
    setSelectedArtwork(null);
    setSelectedArtworkStory(null);
    setSelectedArtworkTtsAssets([]);
    setSelectedArtworkStoryError(null);
    setSelectedArtworkStoryLoading(false);
  }, []);

  useModalPointerPolicy(showArtworkStoryModal);

  useEffect(() => {
    if (!showArtworkStoryModal) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      handleArtworkStoryClose();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleArtworkStoryClose, showArtworkStoryModal]);

  const applyPublicSpaceViewerLayout = useCallback((space: PublishedSpaceDetail) => {
    setLayout({
      ...space.viewerLayout,
      presentationMode: 'immediate',
    });
    setModalState('3D_VIEWER');
    setActiveLibrarySpaceId(space.id);
  }, [setLayout, setModalState]);

  const handleEnterPublicSpace = useCallback((space: PublishedSpaceDetail, libraryKey: string) => {
    applyPublicSpaceViewerLayout(space);
    navigateToHash(buildLibrarySpaceHash(libraryKey, space.id));
    setShowEntranceMode(false);
  }, [applyPublicSpaceViewerLayout, navigateToHash]);

  const navigateToHome = useCallback(() => {
    navigateToHash('#/');
  }, [navigateToHash]);

  const navigateToLibrary = useCallback(() => {
    if (!requireAuth(copy.loginRequired)) return;
    window.location.hash = buildLibraryIndexHash(DEFAULT_LIBRARY_KEY);
  }, [copy.loginRequired, requireAuth]);

  const navigateToCuratorWorkspace = useCallback(() => {
    if (!requireAuth(workspaceLoginRequiredLabel)) return;
    navigateToHash('#/debug/curator-workspace');
  }, [navigateToHash, requireAuth, workspaceLoginRequiredLabel]);

  const resetProtectedRouteState = useCallback(() => {
    setShowEntranceMode(false);
    setShowArtworkStoryModal(false);
    setSelectedArtwork(null);
    setSelectedArtworkStory(null);
    setSelectedArtworkTtsAssets([]);
    setSelectedArtworkStoryError(null);
    setSelectedArtworkStoryLoading(false);
    setLibraryViewerLoading(false);
    setLibraryViewerError(null);
    setActiveLibrarySpaceId(null);
    storyRequestIdRef.current += 1;
    libraryRequestIdRef.current += 1;
    setLayout(null);
    setModalState('CLOSED');
  }, [setLayout, setModalState]);

  useEffect(() => {
    if (!routeState.normalizedHash) {
      return;
    }

    navigateToHash(routeState.normalizedHash);
  }, [navigateToHash, routeState.normalizedHash]);

  useEffect(() => {
    if (canAccessProtectedPages || !routeState.requiresAuth) {
      return;
    }

    setLoginPromptMessage(protectedRoutePromptMessage);
    setLoginPromptForceOpen(true);
    setLoginPromptRequestId((current) => current + 1);
    resetProtectedRouteState();
    navigateToHash('#/');
  }, [canAccessProtectedPages, navigateToHash, protectedRoutePromptMessage, resetProtectedRouteState, routeState.requiresAuth]);

  useEffect(() => {
    if (!isLibrarySpacePage || !libraryRoute?.spaceId) {
      if (activeLibrarySpaceId != null) {
        setActiveLibrarySpaceId(null);
        setLibraryViewerLoading(false);
        setLibraryViewerError(null);
        if (modalState === '3D_VIEWER') {
          setModalState('CLOSED');
          setLayout(null);
        }
      }
      return;
    }

    const requestId = libraryRequestIdRef.current + 1;
    libraryRequestIdRef.current = requestId;
    setLibraryViewerLoading(true);
    setLibraryViewerError(null);

    void apiService
      .getPublishedSpace(libraryRoute.spaceId)
      .then((space) => {
        if (libraryRequestIdRef.current !== requestId) return;
        applyPublicSpaceViewerLayout(space);
      })
      .catch((error: unknown) => {
        if (libraryRequestIdRef.current !== requestId) return;
        setLibraryViewerError(error instanceof Error ? error.message : copy.spaceLoadError);
      })
      .finally(() => {
        if (libraryRequestIdRef.current !== requestId) return;
        setLibraryViewerLoading(false);
      });
  }, [activeLibrarySpaceId, applyPublicSpaceViewerLayout, copy.spaceLoadError, isLibrarySpacePage, libraryRoute?.spaceId, modalState, setLayout, setModalState]);

  const authOverlay = (
    <AuthOverlay
      onToast={handleToast}
      onChange={setCurrentUser}
      onOpenCuratorWorkspace={navigateToCuratorWorkspace}
      showTriggerButton={false}
      loginPromptMessage={loginPromptMessage}
      loginPromptRequestId={loginPromptRequestId}
      toggleRequestId={authHeaderToggleRequestId}
      forceOpen={loginPromptForceOpen}
    />
  );

  const openAuthPanel = useCallback(() => {
    setLoginPromptForceOpen(false);
    setLoginPromptMessage(currentUser ? null : copy.loginRequired);
    setAuthHeaderToggleRequestId((current) => current + 1);
  }, [copy.loginRequired, currentUser]);

  const fixedHeader = (
    <header className="fixed inset-x-0 top-0 z-[330] pointer-events-none">
      <div className="flex items-start justify-end gap-2 px-4 py-4 sm:px-6 sm:py-6 lg:px-8 lg:py-8">
        <button
          type="button"
          onClick={handleGoBack}
          aria-label={backLabel}
          title={backLabel}
          className="pointer-events-auto rounded-lg border border-white/12 bg-[#1b1812]/82 px-4 py-3 text-sm font-semibold text-[#f4efe7] shadow-[0_18px_50px_rgba(0,0,0,0.35)] backdrop-blur-xl transition hover:border-[#7f9b5a]/30 hover:bg-[#5b2c20]/35 focus:outline-none focus:ring-2 focus:ring-[#7f9b5a]/35"
        >
          <span className="mr-2 text-base leading-none">←</span>
          {backLabel}
        </button>
        <button
          type="button"
          onClick={navigateToHome}
          aria-label={isKorean ? '홈으로 이동' : 'Go home'}
          title={homeButtonLabel}
          className="pointer-events-auto rounded-lg border border-white/12 bg-[#1b1812]/82 px-4 py-3 text-sm font-semibold text-[#f4efe7] shadow-[0_18px_50px_rgba(0,0,0,0.35)] backdrop-blur-xl transition hover:border-[#7f9b5a]/30 hover:bg-[#5b2c20]/35 focus:outline-none focus:ring-2 focus:ring-[#7f9b5a]/35"
        >
          {homeButtonLabel}
        </button>
        <button
          type="button"
          onClick={openAuthPanel}
          aria-label={currentUser ? (isKorean ? '계정 열기' : 'Open account') : (isKorean ? '로그인 모달 열기' : 'Open login modal')}
          className="pointer-events-auto rounded-lg border border-white/12 bg-[#1b1812]/82 px-4 py-3 text-sm font-semibold text-[#f4efe7] shadow-[0_18px_50px_rgba(0,0,0,0.35)] backdrop-blur-xl transition hover:border-[#7f9b5a]/30 hover:bg-[#5b2c20]/35 focus:outline-none focus:ring-2 focus:ring-[#7f9b5a]/35"
        >
          {currentUser ? (isKorean ? '계정' : 'Account') : (isKorean ? '로그인' : 'Login')}
        </button>
      </div>
    </header>
  );

  const nonViewerShell = (content: ReactNode) => (
    <div className="relative min-h-screen overflow-x-hidden bg-[#14130c]">
      {fixedHeader}
      {authOverlay}
      <div className="relative z-0">
        {content}
      </div>
    </div>
  );

  if (isDebugPage) {
    return (
      <>
        {nonViewerShell(
          <Suspense fallback={<AppSectionLoader message="Loading recommendation debugger..." />}>
            <RecommendationDebugPage />
          </Suspense>
        )}
        {toast ? (
          <Toast
            message={toast.message}
            type={toast.type}
            duration={4200}
            onClose={() => setToast(null)}
          />
        ) : null}
      </>
    );
  }

  if (isFramedGlbPage) {
    return (
      <>
        {nonViewerShell(
          <Suspense fallback={<AppSectionLoader message="Loading GLB viewer..." />}>
            <FramedGlbViewerPage />
          </Suspense>
        )}
        {toast ? (
          <Toast
            message={toast.message}
            type={toast.type}
            duration={4200}
            onClose={() => setToast(null)}
          />
        ) : null}
      </>
    );
  }

  if (isRoomMergeExperimentPage) {
    return (
      <>
        {nonViewerShell(
          <Suspense fallback={<AppSectionLoader message="Loading room merge experiment..." />}>
            <RoomMergeExperimentPage />
          </Suspense>
        )}
        {toast ? (
          <Toast
            message={toast.message}
            type={toast.type}
            duration={4200}
            onClose={() => setToast(null)}
          />
        ) : null}
      </>
    );
  }

  if (isStorytellingPage) {
    return (
      <>
        {nonViewerShell(
          <Suspense fallback={<AppSectionLoader message="Loading storytelling dashboard..." />}>
            <StorytellingDashboardPage onToast={handleToast} />
          </Suspense>
        )}
        {toast ? (
          <Toast
            message={toast.message}
            type={toast.type}
            duration={4200}
            onClose={() => setToast(null)}
          />
        ) : null}
      </>
    );
  }

  if (isCuratorSpaceManagementPage) {
    return (
      <>
        {nonViewerShell(
          <Suspense fallback={<AppSectionLoader message="Loading curator space management..." />}>
            <CuratorSpaceManagementPage />
          </Suspense>
        )}
        {toast ? (
          <Toast
            message={toast.message}
            type={toast.type}
            duration={4200}
            onClose={() => setToast(null)}
          />
        ) : null}
      </>
    );
  }

  if (isCuratorWorkspacePage) {
    return (
      <>
        {nonViewerShell(
          <Suspense fallback={<AppSectionLoader message="Loading curator workspace..." />}>
            <CuratorWorkspacePage workspaceRoleHint={workspaceRoleHint} />
          </Suspense>
        )}
        {toast ? (
          <Toast
            message={toast.message}
            type={toast.type}
            duration={4200}
            onClose={() => setToast(null)}
          />
        ) : null}
      </>
    );
  }

  if (isLibrarySpacePage && libraryViewerLoading) {
    return (
      <>
        {nonViewerShell(
          <div data-testid="app-library-viewer-loading">
            <AppSectionLoader message="Loading public space viewer..." />
          </div>
        )}
        {toast ? (
          <Toast
            message={toast.message}
            type={toast.type}
            duration={4200}
            onClose={() => setToast(null)}
          />
        ) : null}
      </>
    );
  }

  if (isLibrarySpacePage && libraryViewerError) {
    return (
      <>
        {nonViewerShell(
          <div data-testid="app-library-viewer-error" className="flex min-h-screen items-center justify-center px-4 py-10">
            <div className="max-w-xl rounded-[28px] border border-white/10 bg-[#1b1812]/88 px-6 py-5 text-[#f4efe7] shadow-[0_24px_70px_rgba(0,0,0,0.32)] backdrop-blur-xl">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-rose-300">
                {copy.libraryViewerErrorTitle}
              </p>
              <h2 className="mt-2 text-2xl font-semibold">{copy.spaceLoadError}</h2>
              <p className="mt-3 text-sm leading-6 text-[#d8cbbb]">{libraryViewerError}</p>
              <div className="mt-5 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={navigateToHome}
                  className="rounded-xl border border-white/10 bg-[#1b1812]/72 px-4 py-2 text-sm font-semibold text-[#f4efe7] transition hover:bg-[#5b2c20]/28"
                >
                  {copy.home}
                </button>
                <button
                  type="button"
                  onClick={navigateToLibrary}
                  className="rounded-xl border border-[#7f9b5a]/25 bg-[#7f9b5a]/15 px-4 py-2 text-sm font-semibold text-[#e8f0d5] transition hover:bg-[#7f9b5a]/25"
                >
                  {copy.libraryList}
                </button>
              </div>
            </div>
          </div>
        )}
        {toast ? (
          <Toast
            message={toast.message}
            type={toast.type}
            duration={4200}
            onClose={() => setToast(null)}
          />
        ) : null}
      </>
    );
  }

  // 3D Gallery View
  if (modalState === '3D_VIEWER' && (!libraryRoute || isLibrarySpacePage)) {
    return (
      <div className="relative h-screen w-screen overflow-hidden bg-[#14130c]">
        {fixedHeader}
        {authOverlay}

        {/* 3D Viewer */}
        <Suspense fallback={<AppSectionLoader message="Loading exhibition viewer..." />}>
          <ThreeDViewer
            placements={layout?.placements || []}
            spaceComponents={layout?.spaceComponents || []}
            entrySlotNumber={layout?.gallery.entrySlotNumber || 1}
            presentationMode={layout?.presentationMode ?? 'immediate'}
            onArtworkClick={handleArtworkClick}
            suppressSpeedPrompt={showArtworkStoryModal}
          />
        </Suspense>
        {layout?.layoutType === 'public_space' ? null : <CurationResultPanel />}
        <AnimatePresence>
          {showArtworkStoryModal ? (
          <ArtworkStoryModal
              artwork={selectedArtwork}
              story={selectedArtworkStory}
              ttsAssets={selectedArtworkTtsAssets}
              loading={selectedArtworkStoryLoading}
              error={selectedArtworkStoryError}
              onClose={handleArtworkStoryClose}
            />
          ) : null}
        </AnimatePresence>

        <AnimatePresence>
          {showEntranceMode && (
            <EntranceModeSelection
              onClose={() => setShowEntranceMode(false)}
              onGeneralUserEntry={() => {}}
              onAuthorEntry={() => {}}
              canAuthorEntry={false}
            />
          )}
        </AnimatePresence>
        {toast ? (
          <Toast
            message={toast.message}
            type={toast.type}
            duration={4200}
            onClose={() => setToast(null)}
          />
        ) : null}
      </div>
    );
  }

  if (isLibraryIndexPage) {
    return (
      <>
        {nonViewerShell(
          <Suspense fallback={<AppSectionLoader message="Loading public space library..." />}>
            <PublicSpaceLibrary
              libraryKey={libraryRoute?.libraryKey ?? DEFAULT_LIBRARY_KEY}
              onEnterSpace={handleEnterPublicSpace}
            />
          </Suspense>
        )}

        <AnimatePresence>
          {showEntranceMode && (
            <EntranceModeSelection
              onClose={() => setShowEntranceMode(false)}
              onGeneralUserEntry={() => {}}
              onAuthorEntry={() => {}}
              canAuthorEntry={false}
            />
          )}
        </AnimatePresence>

        <AnimatePresence>
          {showCurationModal && (
            <CurationModal />
          )}
        </AnimatePresence>
        {toast ? (
          <Toast
            message={toast.message}
            type={toast.type}
            duration={4200}
            onClose={() => setToast(null)}
          />
        ) : null}
      </>
    );
  }

  if (isLibrarySpacePage) {
    return (
      <>
        {nonViewerShell(
          <div data-testid="app-library-viewer-pending">
            <AppSectionLoader message={libraryViewerError ?? 'Loading public space viewer...'} />
          </div>
        )}
        {toast ? (
          <Toast
            message={toast.message}
            type={toast.type}
            duration={4200}
            onClose={() => setToast(null)}
          />
        ) : null}
      </>
    );
  }

  // Landing / Home Screen - Gallery (R3F 3D)
  return (
    <>
      {nonViewerShell(
        <Suspense fallback={<AppSectionLoader message="Loading gallery..." />}>
          <Gallery
            onStartExhibition={navigateToLibrary}
          />
        </Suspense>,
      )}

      {/* Modals */}
      <AnimatePresence>
        {showEntranceMode && (
          <EntranceModeSelection
            onClose={() => setShowEntranceMode(false)}
            onGeneralUserEntry={() => {}}
            onAuthorEntry={() => {}}
            canAuthorEntry={false}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showCurationModal && (
          <CurationModal />
        )}
      </AnimatePresence>
      {toast ? (
        <Toast
          message={toast.message}
          type={toast.type}
          duration={4200}
          onClose={() => setToast(null)}
        />
      ) : null}
    </>
  );
}

export default App;
