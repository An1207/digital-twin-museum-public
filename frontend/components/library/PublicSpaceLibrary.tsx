import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useMemo, useRef, useState } from 'react';
import { apiService } from '../../lib/api';
import { resolveSpaceThumbnailImageUrl } from '../../lib/imagePaths';
import { useCurationStore } from '../../hooks/useCurationStore';
import { useUiLocale } from '../../lib/uiLocale';
import type { PublishedSpaceDetail, PublishedSpaceSummary } from '../../types/curation';

type SortMode = 'featured' | 'newest' | 'title' | 'curator';
type FilterMode = 'all' | 'featured' | 'default';

const PAGE_SIZE_OPTIONS = [2, 4, 8, 12, 24];

interface PublicSpaceLibraryProps {
  libraryKey: string;
  onEnterSpace: (space: PublishedSpaceDetail, libraryKey: string) => void;
}

const formatPieceCount = (count: number) => `${count.toString().padStart(2, '0')} pieces`;

const PublicSpaceEntranceModeModal = ({
  space,
  onClose,
  onDefaultViewing,
  onSelectionViewing,
}: {
  space: PublishedSpaceDetail | null;
  onClose: () => void;
  onDefaultViewing: () => void;
  onSelectionViewing: (space: PublishedSpaceDetail) => void;
}) => {
  const { locale } = useUiLocale();
  const isKorean = locale === 'ko';
  if (!space) return null;
  const placementCount = space.viewerLayout.placements.length;
  const copy = {
    title: isKorean ? '관람 모드 선택' : 'Choose viewing mode',
    close: isKorean ? '닫기' : 'Close',
    guidance: isKorean
      ? '저장된 공간을 그대로 보거나, 취향 옵션으로 재정렬된 관람 흐름으로 들어갈 수 있습니다.'
      : 'You can enter the saved space as-is or switch to a preference-based viewing flow.',
    defaultViewing: isKorean ? '기본관람' : 'Default viewing',
    defaultTitle: isKorean ? '저장된 공간 그대로 입장' : 'Enter the saved space as-is',
    defaultDesc: isKorean
      ? `슬롯 ${placementCount}개에 맞춰 배치된 3D 작품을 큐레이터가 지정한 위치와 방향 그대로 감상합니다.`
      : `View ${placementCount} framed 3D artworks in the curator-defined positions and directions.`,
    defaultStart: isKorean ? '기본관람 시작' : 'Start default viewing',
    optionViewing: isKorean ? '취향 선택' : 'Preference selection',
    optionTitle: isKorean ? '취향 선택으로 다시 입장' : 'Re-enter with preference options',
    optionDesc: isKorean
      ? `테마, 시대, 감정을 고른 뒤 선택한 공간의 슬롯 ${placementCount}개에 맞춰 유사도 순 작품을 순차 배치합니다.`
      : `Choose theme, era, and emotion, then place artworks sequentially into the space's ${placementCount} slots by similarity.`,
    optionStart: isKorean ? '취향 선택 시작' : 'Start preference selection',
  } as const;
  return (
    <motion.div
      className="fixed inset-0 z-[260] flex items-center justify-center bg-[radial-gradient(circle_at_top,rgba(127, 155, 90,0.18),transparent_36%),radial-gradient(circle_at_bottom_right,rgba(91,44,32,0.18),transparent_26%),linear-gradient(180deg,rgba(20,19,12,0.84),rgba(20,19,12,0.92))] px-4 py-6 backdrop-blur-[6px]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="relative w-full max-w-4xl overflow-hidden rounded-[30px] border border-white/10 bg-[#1b1812]/96 p-6 text-[#f4efe7] shadow-[0_30px_90px_rgba(0,0,0,0.58)] backdrop-blur-2xl sm:p-8"
        initial={{ scale: 0.96, y: 16 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.96, y: 16 }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,rgba(127, 155, 90,0.12),transparent_30%,rgba(91,44,32,0.08)_72%,transparent_100%)]" />
        <div className="pointer-events-none absolute left-1/2 top-0 h-px w-3/4 -translate-x-1/2 bg-gradient-to-r from-transparent via-white/25 to-transparent" />
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#7f9b5a]">
              {copy.title}
            </p>
            <h2 className="mt-2 font-display text-3xl font-normal tracking-normal text-[#f4efe7]">
              {space.title}
            </h2>
            <p className="mt-2 text-sm leading-6 text-[#d8cbbb]">
              {copy.guidance}
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

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <button
            type="button"
            onClick={onDefaultViewing}
            data-testid="public-space-default-viewing"
            className="group min-h-[210px] rounded-[26px] border border-[#7f9b5a]/35 bg-[linear-gradient(180deg,rgba(127, 155, 90,0.18),rgba(27,24,18,0.84))] p-5 text-left transition duration-300 hover:-translate-y-0.5 hover:border-[#9db680]/60 hover:bg-[linear-gradient(180deg,rgba(127, 155, 90,0.24),rgba(27,24,18,0.92))] focus:outline-none focus:ring-2 focus:ring-[#7f9b5a]/35"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-[#e8f0d5]/15 bg-[#e8f0d5]/10 text-[#e8f0d5] transition group-hover:bg-[#e8f0d5]/14">
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M4 12h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                  <path d="M12 4v16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              </div>
              <span className="rounded-full border border-[#e8f0d5]/18 bg-[#e8f0d5]/8 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-[#e8f0d5]">
                {copy.defaultViewing}
              </span>
            </div>
            <h3 className="mt-4 font-display text-2xl font-normal tracking-normal text-[#f4efe7]">
              {copy.defaultTitle}
            </h3>
            <p className="mt-3 text-sm leading-6 text-[#d8cbbb]">
              {copy.defaultDesc}
            </p>
            <p className="mt-6 text-sm font-semibold text-[#e8f0d5]">
              {copy.defaultStart}
            </p>
          </button>

          <button
            type="button"
            data-testid="public-space-option-viewing"
            onClick={() => onSelectionViewing(space)}
            className="group min-h-[210px] rounded-[26px] border border-[#b57d69]/30 bg-[linear-gradient(180deg,rgba(91,44,32,0.28),rgba(27,24,18,0.9))] p-5 text-left transition duration-300 hover:-translate-y-0.5 hover:border-[#d1a293]/60 hover:bg-[linear-gradient(180deg,rgba(91,44,32,0.36),rgba(27,24,18,0.94))] focus:outline-none focus:ring-2 focus:ring-[#b57d69]/35"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-[#f0d7cf]/15 bg-[#f0d7cf]/10 text-[#f0d7cf] transition group-hover:bg-[#f0d7cf]/14">
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M6 7h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                  <path d="M6 12h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                  <path d="M6 17h8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              </div>
              <span className="rounded-full border border-[#f0d7cf]/18 bg-[#f0d7cf]/8 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-[#f0d7cf]">
                {copy.optionViewing}
              </span>
            </div>
            <h3 className="mt-4 font-display text-2xl font-normal tracking-normal text-[#f4efe7]">
              {copy.optionTitle}
            </h3>
            <p className="mt-3 text-sm leading-6 text-[#d8cbbb]">
              {copy.optionDesc}
            </p>
            <p className="mt-6 text-sm font-semibold text-[#f0d7cf]">
              {copy.optionStart}
            </p>
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
};

const PublicSpaceDetailModal = ({
  space,
  loading,
  libraryKey,
  onClose,
  onEnter,
}: {
  space: PublishedSpaceSummary | PublishedSpaceDetail | null;
  loading: boolean;
  libraryKey: string;
  onClose: () => void;
  onEnter: (space: PublishedSpaceDetail, libraryKey: string) => void;
}) => {
  const { locale } = useUiLocale();
  const isKorean = locale === 'ko';
  if (!space) return null;

  const detailSpace = space as PublishedSpaceDetail;
  const canEnter = !loading && 'viewerLayout' in detailSpace;
  const thumbnailImagePath = space.thumbnailImagePath ?? null;
  const copy = {
    defaultBadge: isKorean ? '기본' : 'Default',
    featuredBadge: isKorean ? '추천' : 'Featured',
    publicSpace: isKorean ? '공개 공간' : 'Public Space',
    close: isKorean ? '닫기' : 'Close',
    curator: isKorean ? '큐레이터' : 'Curator',
    pieces: isKorean ? '작품 수' : 'Pieces',
    description: isKorean ? '설명' : 'Description',
    loadingDetail: isKorean ? '상세를 불러오는 중...' : 'Loading detail...',
    searchKeywords: isKorean ? '검색 키워드' : 'Search Keywords',
    enter: isKorean ? '입장하기' : 'Enter',
    noPieces: isKorean ? '00 작품' : '00 pieces',
    noPreview: isKorean ? '미리보기 이미지 없음' : 'No preview image',
  } as const;

  return (
    <motion.div
      className="fixed inset-0 z-[240] flex items-center justify-center bg-[#14130c]/78 px-4 py-6 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="relative w-full max-w-5xl overflow-hidden rounded-[32px] border border-white/10 bg-[#1b1812]/96 shadow-[0_30px_90px_rgba(0,0,0,0.58)] backdrop-blur-2xl"
        initial={{ scale: 0.96, y: 18 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.96, y: 18 }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="grid gap-0 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="relative min-h-[280px] bg-[#14130c]/90">
            {thumbnailImagePath ? (
              <img
                src={resolveSpaceThumbnailImageUrl(thumbnailImagePath)}
                alt={space.title}
                className="h-full min-h-[280px] w-full object-cover"
              />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-[#b29e8d]">
                {copy.noPreview}
              </div>
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black via-black/20 to-transparent" />
            <div className="absolute left-5 top-5 flex flex-wrap gap-2">
              {space.isDefault ? (
                <span className="rounded-full border border-[#7f9b5a]/28 bg-[#7f9b5a]/16 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#e8f0d5]">
                  {copy.defaultBadge}
                </span>
              ) : null}
              {space.isFeatured ? (
                <span className="rounded-full border border-[#d8cbbb]/20 bg-[#5b2c20]/18 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#f4efe7]">
                  {copy.featuredBadge}
                </span>
              ) : null}
            </div>
            <div className="absolute bottom-5 left-5 right-5">
              <p className="font-sans text-[11px] font-medium uppercase tracking-widest text-[#e8f0d5]">
                {space.locationSummary}
              </p>
              <h3 className="mt-2 font-display text-3xl font-normal tracking-normal text-[#f4efe7]">{space.title}</h3>
              <p className="mt-2 max-w-xl font-sans text-sm font-light leading-relaxed text-[#d8cbbb]">
                {space.summary}
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-5 p-5 sm:p-7">
            <div className="flex items-start justify-between gap-4">
              <div>
              <p className="font-sans text-[11px] font-medium uppercase tracking-widest text-[#7f9b5a]">
                  {copy.publicSpace}
                </p>
                <h2 className="mt-2 font-display text-2xl font-normal tracking-normal text-[#f4efe7]">{space.title}</h2>
                <p className="mt-2 font-sans text-sm font-light leading-relaxed text-[#d8cbbb]">
                  {isKorean ? 'by' : 'by'} {space.curatorDisplayName} · {space.locationSummary}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl border border-white/10 bg-[#1b1812]/72 px-3 py-2 text-sm font-semibold text-[#f4efe7] transition hover:bg-[#5b2c20]/30"
              >
                {copy.close}
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-2xl border border-white/10 bg-[#1b1812]/70 p-4">
                <p className="font-sans text-[11px] font-medium uppercase tracking-widest text-[#7f9b5a]">{copy.curator}</p>
                <p className="mt-2 font-sans text-lg font-medium text-[#f4efe7]">{space.curatorDisplayName}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-[#1b1812]/70 p-4">
                <p className="font-sans text-[11px] font-medium uppercase tracking-widest text-[#7f9b5a]">{copy.pieces}</p>
                <p className="mt-2 font-sans text-lg font-medium text-[#f4efe7]">
                  {'pieceCount' in detailSpace ? formatPieceCount(detailSpace.pieceCount) : copy.noPieces}
                </p>
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-[#1b1812]/70 p-5">
              <p className="font-sans text-[11px] font-medium uppercase tracking-widest text-[#7f9b5a]">{copy.description}</p>
              <p className="mt-3 whitespace-pre-wrap font-sans text-sm font-light leading-relaxed text-[#f4efe7]">
                {loading ? copy.loadingDetail : ('description' in detailSpace ? detailSpace.description : space.summary)}
              </p>
            </div>

            <div className="rounded-2xl border border-white/10 bg-[#1b1812]/70 p-5">
              <p className="font-sans text-[11px] font-medium uppercase tracking-widest text-[#7f9b5a]">{copy.searchKeywords}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {(detailSpace.searchKeywords?.length ? detailSpace.searchKeywords : [space.curatorDisplayName, space.locationSummary, space.title])
                  .slice(0, 12)
                  .map((keyword) => (
                    <span key={keyword} className="font-sans rounded-full border border-white/10 bg-[#14130c]/90 px-3 py-1 text-xs font-medium uppercase tracking-widest text-[#d8cbbb]">
                      {keyword}
                    </span>
                  ))}
              </div>
            </div>

            <div className="mt-auto flex gap-3">
              <button
                type="button"
                disabled={!canEnter}
                onClick={(event) => {
                  event.stopPropagation();
                  onEnter(detailSpace, libraryKey);
                }}
                className="flex-1 rounded-2xl border border-[#7f9b5a]/35 bg-[#7f9b5a]/18 px-4 py-3 text-sm font-semibold text-[#e8f0d5] transition hover:bg-[#7f9b5a]/28 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-[#1b1812]/60 disabled:text-[#b29e8d]"
              >
                {copy.enter}
              </button>
            </div>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
};

export const PublicSpaceLibrary = ({ libraryKey, onEnterSpace }: PublicSpaceLibraryProps) => {
  const { openAxisSelection, clearSelection, setSelectionTargetSpace } = useCurationStore();
  const { locale } = useUiLocale();
  const isKorean = locale === 'ko';
  const [spaces, setSpaces] = useState<PublishedSpaceSummary[]>([]);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortMode>('featured');
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(8);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSpace, setSelectedSpace] = useState<PublishedSpaceSummary | PublishedSpaceDetail | null>(null);
  const [selectedSpaceLoading, setSelectedSpaceLoading] = useState(false);
  const [selectedSpaceDetail, setSelectedSpaceDetail] = useState<PublishedSpaceDetail | null>(null);
  const [pendingEntranceSpace, setPendingEntranceSpace] = useState<PublishedSpaceDetail | null>(null);
  const requestIdRef = useRef(0);
  const detailRequestIdRef = useRef(0);

  const pageCount = useMemo(() => Math.max(1, Math.ceil(total / pageSize)), [pageSize, total]);

  useEffect(() => {
    setPage(1);
  }, [filterMode, query, sort, pageSize]);

  useEffect(() => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setIsLoading(true);
    setError(null);

    const timeoutId = window.setTimeout(() => {
      void apiService
        .listPublishedSpaces({
          query: query.trim() || undefined,
          featuredOnly: filterMode === 'featured',
          defaultOnly: filterMode === 'default',
          sort,
          limit: pageSize,
          offset: (page - 1) * pageSize,
        })
        .then((response) => {
          if (requestIdRef.current !== requestId) return;
          setSpaces(response.items);
          setTotal(response.total);
        })
        .catch((loadError: unknown) => {
          if (requestIdRef.current !== requestId) return;
          setError(loadError instanceof Error ? loadError.message : (isKorean ? '공개 공간을 불러오지 못했습니다.' : 'Failed to load public spaces.'));
        })
        .finally(() => {
          if (requestIdRef.current !== requestId) return;
          setIsLoading(false);
        });
    }, 180);

    return () => window.clearTimeout(timeoutId);
  }, [filterMode, page, pageSize, query, sort]);

  useEffect(() => {
    if (page <= pageCount) return;
    setPage(pageCount);
  }, [page, pageCount]);

  const openDetail = async (space: PublishedSpaceSummary) => {
    const requestId = detailRequestIdRef.current + 1;
    detailRequestIdRef.current = requestId;
    setSelectedSpace(space);
    setSelectedSpaceDetail(null);
    setSelectedSpaceLoading(true);
    setError(null);
    try {
      const detail = await apiService.getPublishedSpace(space.id);
      if (detailRequestIdRef.current !== requestId) return;
      setSelectedSpaceDetail(detail);
      setSelectedSpace(detail);
    } catch (loadError: unknown) {
      if (detailRequestIdRef.current !== requestId) return;
      setError(loadError instanceof Error ? loadError.message : (isKorean ? '공간 상세를 불러오지 못했습니다.' : 'Failed to load space detail.'));
    } finally {
      if (detailRequestIdRef.current === requestId) {
        setSelectedSpaceLoading(false);
      }
    }
  };

  const closeDetail = () => {
    detailRequestIdRef.current += 1;
    setSelectedSpace(null);
    setSelectedSpaceDetail(null);
    setSelectedSpaceLoading(false);
  };

  const handleEnter = (space: PublishedSpaceDetail) => {
    setPendingEntranceSpace(space);
    closeDetail();
  };

  const closeEntranceMode = () => {
    setPendingEntranceSpace(null);
  };

  const enterDefaultViewing = () => {
    if (!pendingEntranceSpace) return;
    setSelectionTargetSpace(null);
    onEnterSpace(pendingEntranceSpace, libraryKey);
    setPendingEntranceSpace(null);
  };

  const enterSelectionViewing = (space: PublishedSpaceDetail) => {
    setSelectionTargetSpace(space);
    setPendingEntranceSpace(null);
    clearSelection();
    window.location.hash = '#/';
    void openAxisSelection();
  };

  const goToPreviousPage = () => {
    setPage((current) => Math.max(1, current - 1));
  };

  const goToNextPage = () => {
    setPage((current) => Math.min(pageCount, current + 1));
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#09090b] text-stone-100">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.12),_transparent_34%),radial-gradient(circle_at_80%_20%,_rgba(245,158,11,0.08),_transparent_22%),linear-gradient(180deg,_rgba(255,255,255,0.03),_transparent_45%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.025)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.025)_1px,transparent_1px)] bg-[size:72px_72px] opacity-[0.22]" />

      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-[1700px] flex-col px-12 py-4 sm:px-16 lg:px-20">
        <header className="flex flex-col gap-4 border-b border-white/10 pb-5 pt-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-[#7f9b5a]">
              Digital Twin Museum
            </p>
            <h1 className="mt-2 text-3xl font-semibold text-white sm:text-4xl">
              Public Space Library
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-stone-400">
              {isKorean
                ? '큐레이터가 공개로 설정한 공간만 표시합니다. 카드에서 공간 이름과 축소 이미지를 확인하고, 상세 모달에서 입장합니다.'
                : 'Only curator-published spaces are shown. Check each card for the title and preview, then enter from the detail modal.'}
            </p>
          </div>
        </header>

        <section className="mt-5 flex flex-col gap-3 rounded-[28px] border border-white/10 bg-black/30 p-4 shadow-[0_30px_80px_rgba(0,0,0,0.35)] backdrop-blur-2xl sm:flex-row sm:items-center sm:justify-between">
          <label className="flex flex-1 items-center gap-3 rounded-2xl border border-white/10 bg-black/30 px-4 py-3">
            <svg className="h-5 w-5 text-cyan-300" viewBox="0 0 24 24" fill="none">
              <path d="M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Z" stroke="currentColor" strokeWidth="1.6" />
              <path d="M16.5 16.5 21 21" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={isKorean ? '큐레이터, 공간, 위치, 설명 검색...' : 'Search curator, space, location, description...'}
                className="w-full bg-transparent text-sm text-white outline-none placeholder:text-stone-500"
                data-testid="public-space-search"
              />
            </label>

          <div className="flex flex-wrap gap-2">
            {([
              { value: 'all', label: isKorean ? '전체' : 'All' },
              { value: 'featured', label: isKorean ? '추천' : 'Featured' },
              { value: 'default', label: isKorean ? '디폴트' : 'Default' },
            ] as const).map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setFilterMode(option.value)}
                data-testid={`public-space-filter-${option.value}`}
                className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${
                  filterMode === option.value
                    ? 'border-amber-300/40 bg-amber-500/20 text-amber-50'
                    : 'border-white/10 bg-white/5 text-stone-300 hover:bg-white/10'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            {([
              { value: 'featured', label: isKorean ? '추천 순' : 'Featured' },
              { value: 'newest', label: isKorean ? '최신 순' : 'Newest' },
              { value: 'title', label: isKorean ? '이름 순' : 'Title' },
              { value: 'curator', label: isKorean ? '큐레이터 순' : 'Curator' },
            ] as const).map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setSort(option.value)}
                data-testid={`public-space-sort-${option.value}`}
                className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${
                  sort === option.value
                    ? 'border-cyan-300/40 bg-cyan-500/20 text-cyan-50'
                    : 'border-white/10 bg-white/5 text-stone-300 hover:bg-white/10'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </section>

        <section className="mt-4 flex flex-col gap-3 rounded-[24px] border border-white/10 bg-black/25 px-4 py-3 shadow-[0_20px_60px_rgba(0,0,0,0.25)] backdrop-blur-xl sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-stone-300">
              <span className="text-stone-500">{isKorean ? '결과' : 'Results'}</span>{' '}
              <span className="font-semibold text-stone-100">{total}</span>
            </div>
            <label className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-stone-300">
              <span className="text-stone-500">{isKorean ? '페이지 크기' : 'Page size'}</span>
              <select
                value={pageSize}
                onChange={(event) => setPageSize(Number(event.target.value))}
                data-testid="public-space-page-size"
                className="bg-transparent text-stone-100 outline-none"
              >
                {PAGE_SIZE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={goToPreviousPage}
              disabled={page <= 1 || isLoading}
              data-testid="public-space-prev-page"
              className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-stone-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isKorean ? '이전' : 'Prev'}
            </button>
            <div
              data-testid="public-space-page-indicator"
              className="rounded-full border border-white/10 bg-black/30 px-4 py-2 text-sm text-stone-300"
            >
              Page <span className="font-semibold text-stone-100">{page}</span> / {pageCount}
            </div>
            <button
              type="button"
              onClick={goToNextPage}
              disabled={page >= pageCount || isLoading}
              data-testid="public-space-next-page"
              className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-stone-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isKorean ? '다음' : 'Next'}
            </button>
          </div>
        </section>

        <main className="mt-5 flex-1">
          {error ? (
            <div className="rounded-[24px] border border-rose-400/20 bg-rose-500/10 px-4 py-4 text-sm text-rose-100">
              {error}
            </div>
          ) : null}

          {isLoading ? (
            <div className="grid gap-4 pt-4 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }).map((_, index) => (
                <div
                  key={index}
                  className="h-[360px] animate-pulse rounded-[28px] border border-white/10 bg-white/5"
                />
              ))}
            </div>
          ) : spaces.length === 0 ? (
            <div className="mt-4 rounded-[28px] border border-white/10 bg-black/30 px-6 py-14 text-center">
              <p className="text-lg font-semibold text-white">No published spaces</p>
              <p className="mt-2 text-sm text-stone-400">
                {isKorean
                  ? '현재 조건에 맞는 공개 공간이 없습니다. 검색어나 필터를 바꿔보세요.'
                  : 'No public spaces match the current filters. Try another search or filter.'}
              </p>
            </div>
          ) : (
            <div className="grid gap-4 pt-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {spaces.map((space) => (
                <motion.button
                  key={space.id}
                  type="button"
                  whileHover={{ y: -4 }}
                  whileTap={{ scale: 0.99 }}
                  onClick={() => void openDetail(space)}
                  className="group overflow-hidden rounded-[28px] border border-white/10 bg-black/35 text-left shadow-[0_24px_70px_rgba(0,0,0,0.35)] transition hover:border-white/20 hover:bg-black/50"
                  data-testid={`public-space-card-${space.id}`}
                >
                  <div className="relative aspect-[4/3] overflow-hidden">
                    {space.thumbnailImagePath ? (
                      <img
                        src={resolveSpaceThumbnailImageUrl(space.thumbnailImagePath)}
                        alt={space.title}
                        className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center bg-gradient-to-br from-stone-800 to-black text-stone-500">
                        {isKorean ? '이미지 없음' : 'No image'}
                      </div>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-black via-black/25 to-transparent" />
                    <div className="absolute left-4 top-4 flex flex-wrap gap-2">
                      {space.isDefault ? (
                        <span className="rounded-full border border-amber-300/30 bg-amber-500/20 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-100">
                          {isKorean ? '기본' : 'Default'}
                        </span>
                      ) : null}
                      {space.isFeatured ? (
                        <span className="rounded-full border border-cyan-300/25 bg-cyan-500/20 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-100">
                          {isKorean ? '추천' : 'Featured'}
                        </span>
                      ) : null}
                    </div>
                    <div className="absolute bottom-4 left-4 right-4">
                      <p className="text-[11px] uppercase tracking-[0.2em] text-stone-300">
                        {space.locationSummary}
                      </p>
                      <h2 className="mt-1 text-2xl font-semibold text-white">{space.title}</h2>
                      <p className="mt-2 line-clamp-2 text-sm leading-6 text-stone-300">
                        {space.summary}
                      </p>
                    </div>
                  </div>

                  <div className="space-y-3 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-xs uppercase tracking-[0.18em] text-cyan-300">{isKorean ? '큐레이터' : 'Curator'}</p>
                        <p className="mt-1 text-sm font-semibold text-white">{space.curatorDisplayName}</p>
                      </div>
                      <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-stone-300">
                        {space.publishedAt ? new Date(space.publishedAt).getFullYear() : (isKorean ? '지금' : 'Now')}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {space.locationSummary.split('·').map((part) => part.trim()).filter(Boolean).slice(0, 3).map((part) => (
                        <span
                          key={part}
                          className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] text-stone-300"
                        >
                          {part}
                        </span>
                      ))}
                    </div>
                  </div>
                </motion.button>
              ))}
            </div>
          )}
        </main>
      </div>

      <AnimatePresence>
        {selectedSpace ? (
      <PublicSpaceDetailModal
        space={selectedSpaceDetail ?? selectedSpace}
        loading={selectedSpaceLoading}
        libraryKey={libraryKey}
        onClose={closeDetail}
        onEnter={handleEnter}
      />
        ) : null}
      </AnimatePresence>
      <AnimatePresence>
        {pendingEntranceSpace ? (
          <PublicSpaceEntranceModeModal
            space={pendingEntranceSpace}
            onClose={closeEntranceMode}
            onDefaultViewing={enterDefaultViewing}
            onSelectionViewing={enterSelectionViewing}
          />
        ) : null}
      </AnimatePresence>
    </div>
  );
};

export default PublicSpaceLibrary;
