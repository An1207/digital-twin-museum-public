import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { apiService } from '../../lib/api';
import { resolveArtworkImageUrl } from '../../lib/imagePaths';
import { GlassButton } from '../ui/GlassButton';
import { GlassCard } from '../ui/GlassCard';
import type {
  StorytellingArtworkSummary,
  StorytellingTtsAsset,
  StorytellingVersion,
} from '../../types/curation';

interface StorytellingDashboardPageProps {
  onToast?: (type: 'success' | 'error' | 'info', message: string) => void;
}

const MAX_SELECTION = 10;
const PAGE_SIZE = 20;

const formatDateTime = (value?: string | null) => {
  if (!value) return 'Unknown time';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
};

const StoryModal = ({
  version,
  artwork,
  ttsAsset,
  ttsLoading,
  onClose,
  onUpdateStatus,
  onGenerateTts,
}: {
  version: StorytellingVersion;
  artwork?: StorytellingArtworkSummary | null;
  ttsAsset?: StorytellingTtsAsset | null;
  ttsLoading?: boolean;
  onClose: () => void;
  onUpdateStatus?: (versionId: number, status: 'draft' | 'reviewed' | 'published' | 'archived') => void;
  onGenerateTts?: (version: StorytellingVersion) => void;
}) => (
  <div className="fixed inset-0 z-[260] flex items-center justify-center p-4">
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 bg-black/70 backdrop-blur-md"
      onClick={onClose}
    />
    <motion.div
      initial={{ opacity: 0, scale: 0.96, y: 12 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96, y: 12 }}
      className="relative z-10 w-full max-w-4xl overflow-hidden rounded-[28px] border border-white/10 bg-stone-950/95 shadow-[0_25px_100px_rgba(0,0,0,0.45)]"
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(245,158,11,0.16),transparent_38%),linear-gradient(180deg,rgba(255,255,255,0.05),transparent)] pointer-events-none" />
      <div className="relative flex items-center justify-between border-b border-white/10 px-6 py-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-amber-300">Story Preview</p>
          <h2 className="mt-2 text-2xl font-bold text-stone-100">{version.storyTitle}</h2>
          <p className="mt-1 text-sm text-stone-400">
            {artwork ? `${artwork.title ?? `Artwork ${artwork.id}`} · ${artwork.artist ?? 'Unknown Artist'}` : `Artwork ${version.artworkId}`} · 버전 {version.versionNumber}
          </p>
        </div>
        <GlassButton variant="ghost" size="sm" onClick={onClose}>
          닫기
        </GlassButton>
      </div>
      <div className="grid gap-6 px-6 py-6 lg:grid-cols-[280px_minmax(0,1fr)]">
        <img
          src={artwork ? resolveArtworkImageUrl(artwork.imagePath) : ''}
          alt={version.storyTitle}
          className="h-[280px] w-full rounded-3xl object-cover ring-1 ring-white/10"
        />
        <div className="space-y-4">
          <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
            <p className="text-xs uppercase tracking-[0.18em] text-stone-500">Story</p>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-stone-200">{version.storyText}</p>
          </div>
          {onUpdateStatus ? (
            <div className="flex flex-wrap gap-2">
              {(['draft', 'reviewed', 'published', 'archived'] as const).map((status) => (
                <GlassButton
                  key={status}
                  variant={version.status === status ? 'primary' : 'secondary'}
                  size="sm"
                  onClick={() => onUpdateStatus(version.id, status)}
                >
                  {status}
                </GlassButton>
              ))}
            </div>
          ) : null}
          {onGenerateTts ? (
            <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.16em] text-stone-500">TTS</p>
                  <p className="mt-1 text-sm text-stone-300">
                    {version.status === 'published'
                      ? '게시된 스토리 버전의 TTS를 생성하거나 갱신합니다.'
                      : 'TTS는 published 상태의 버전에서만 생성할 수 있습니다.'}
                  </p>
                </div>
                <GlassButton
                  variant="primary"
                  size="sm"
                  isLoading={Boolean(ttsLoading)}
                  disabled={version.status !== 'published'}
                  onClick={() => onGenerateTts(version)}
                >
                  Generate TTS
                </GlassButton>
              </div>
              {ttsAsset ? (
                <div className="mt-4 rounded-2xl border border-white/10 bg-stone-950/60 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-stone-100">{ttsAsset.providerName}</p>
                      <p className="mt-1 text-xs text-stone-400">
                        {ttsAsset.modelName} · {ttsAsset.voiceId} · {ttsAsset.languageBoost}
                      </p>
                    </div>
                    <span className={`rounded-full border px-3 py-1 text-xs uppercase tracking-[0.16em] ${ttsAsset.status === 'ready' ? 'border-emerald-400/20 bg-emerald-500/10 text-emerald-100' : 'border-rose-400/20 bg-rose-500/10 text-rose-100'}`}>
                      {ttsAsset.status}
                    </span>
                  </div>
                  <div className="mt-3 grid gap-2 text-xs text-stone-400 md:grid-cols-2">
                    <div>Created {formatDateTime(ttsAsset.createdAt)}</div>
                    <div>Updated {formatDateTime(ttsAsset.updatedAt)}</div>
                    <div>Format {ttsAsset.outputFormat}</div>
                    <div>Length {ttsAsset.audioLength ?? 'n/a'} ms</div>
                  </div>
                  {ttsAsset.audioUrl ? (
                    <div className="mt-4 space-y-3">
                      <audio controls src={ttsAsset.audioUrl} className="w-full" />
                      <a
                        href={ttsAsset.audioUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-stone-100 transition hover:bg-white/10"
                      >
                        Open audio
                      </a>
                    </div>
                  ) : null}
                  {ttsAsset.errorMessage ? (
                    <p className="mt-3 rounded-2xl border border-rose-400/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
                      {ttsAsset.errorMessage}
                    </p>
                  ) : null}
                </div>
              ) : (
                <p className="mt-4 text-xs text-stone-500">아직 생성된 TTS가 없습니다.</p>
              )}
            </div>
          ) : null}
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-black/25 p-4 text-sm text-stone-300">
              <p className="text-[11px] uppercase tracking-[0.16em] text-stone-500">Provider</p>
              <p className="mt-1 text-stone-100">{version.providerName}</p>
              <p className="mt-1 text-stone-400">{version.modelName}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/25 p-4 text-sm text-stone-300">
              <p className="text-[11px] uppercase tracking-[0.16em] text-stone-500">Generated</p>
              <p className="mt-1 text-stone-100">{formatDateTime(version.createdAt)}</p>
              <p className="mt-1 text-stone-400">{version.status}</p>
            </div>
          </div>
          {Array.isArray((version.generationMetadataJson as { highlights?: unknown } | undefined)?.highlights) ? (
            <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
              <p className="text-[11px] uppercase tracking-[0.16em] text-stone-500">Highlights</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {((version.generationMetadataJson as { highlights?: string[] } | undefined)?.highlights ?? []).map((item) => (
                  <span key={item} className="rounded-full border border-amber-400/20 bg-amber-500/10 px-3 py-1 text-xs text-amber-100">
                    {item}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </motion.div>
  </div>
);

export const StorytellingDashboardPage = ({ onToast }: StorytellingDashboardPageProps) => {
  const [artworks, setArtworks] = useState<StorytellingArtworkSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [activeArtworkId, setActiveArtworkId] = useState<number | null>(null);
  const [selectedArtworkIds, setSelectedArtworkIds] = useState<number[]>([]);
  const [currentVersion, setCurrentVersion] = useState<StorytellingVersion | null>(null);
  const [currentTtsAssets, setCurrentTtsAssets] = useState<StorytellingTtsAsset[]>([]);
  const [versionHistory, setVersionHistory] = useState<StorytellingVersion[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [generationLoading, setGenerationLoading] = useState(false);
  const [ttsGeneratingVersionId, setTtsGeneratingVersionId] = useState<number | null>(null);
  const [storyModalVersion, setStoryModalVersion] = useState<StorytellingVersion | null>(null);
  const [batchName, setBatchName] = useState('');
  const [globalNote, setGlobalNote] = useState('');
  const [perArtworkNotes, setPerArtworkNotes] = useState<Record<number, string>>({});
  const [authTick, setAuthTick] = useState(0);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  const activeArtwork = useMemo(
    () => artworks.find((item) => item.id === activeArtworkId) ?? null,
    [activeArtworkId, artworks]
  );

  const currentVersionTtsAsset = useMemo(() => {
    if (!currentVersion) return null;
    return currentTtsAssets.find((asset) => asset.storytellingVersionId === currentVersion.id) ?? null;
  }, [currentTtsAssets, currentVersion]);

  const modalTtsAsset = useMemo(() => {
    if (!storyModalVersion) return null;
    return currentTtsAssets.find((asset) => asset.storytellingVersionId === storyModalVersion.id) ?? null;
  }, [currentTtsAssets, storyModalVersion]);

  const selectedArtworks = useMemo(
    () => selectedArtworkIds
      .map((id) => artworks.find((item) => item.id === id))
      .filter(Boolean) as StorytellingArtworkSummary[],
    [artworks, selectedArtworkIds]
  );

  useEffect(() => {
    const handleAuthChange = () => setAuthTick((current) => current + 1);
    window.addEventListener('digital-twin-auth-changed', handleAuthChange);
    return () => window.removeEventListener('digital-twin-auth-changed', handleAuthChange);
  }, []);

  const loadArtworks = useCallback(
    async (nextOffset: number, mode: 'replace' | 'append' = 'replace') => {
      if (mode === 'replace') {
        setLoading(true);
      } else {
        setLoadingMore(true);
      }
      setError(null);
      try {
        const response = await apiService.listStorytellingArtworks(query, PAGE_SIZE, nextOffset);
        setArtworks((current) => (
          mode === 'replace'
            ? response.items
            : [
                ...current,
                ...response.items.filter((item) => !current.some((existing) => existing.id === item.id)),
              ]
        ));
        setOffset(nextOffset + response.items.length);
        setHasMore(response.items.length === PAGE_SIZE);
        if (mode === 'replace') {
          setActiveArtworkId((current) =>
            response.items.some((item) => item.id === current) ? current : response.items[0]?.id ?? null
          );
        } else {
          setActiveArtworkId((current) => current ?? response.items[0]?.id ?? null);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : '스토리텔링 작품 목록을 불러오지 못했습니다.');
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [query]
  );

  useEffect(() => {
    setArtworks([]);
    setSelectedArtworkIds([]);
    setStoryModalVersion(null);
    setActiveArtworkId(null);
    setCurrentVersion(null);
    setCurrentTtsAssets([]);
    setVersionHistory([]);
    setOffset(0);
    setHasMore(true);
    const timer = window.setTimeout(() => {
      void loadArtworks(0, 'replace');
    }, 160);

    return () => {
      window.clearTimeout(timer);
    };
  }, [authTick, query, loadArtworks]);

  useEffect(() => {
    if (!activeArtworkId) {
      setCurrentVersion(null);
      setCurrentTtsAssets([]);
      setVersionHistory([]);
      return;
    }

    let cancelled = false;
    const loadCurrent = async () => {
      setHistoryLoading(true);
      try {
        const [currentResponse, historyResponse] = await Promise.all([
          apiService.getStorytellingCurrent(activeArtworkId),
          apiService.listStorytellingVersions(activeArtworkId, 10),
        ]);
        if (cancelled) return;
        setCurrentVersion(currentResponse.currentVersion ?? null);
        setCurrentTtsAssets(currentResponse.ttsAssets ?? []);
        setVersionHistory(historyResponse.items);
      } catch (err) {
        if (cancelled) return;
        setCurrentVersion(null);
        setCurrentTtsAssets([]);
        setVersionHistory([]);
        setError(err instanceof Error ? err.message : '스토리 히스토리를 불러오지 못했습니다.');
      } finally {
        if (!cancelled) {
          setHistoryLoading(false);
        }
      }
    };

    void loadCurrent();
    return () => {
      cancelled = true;
    };
  }, [activeArtworkId, authTick]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (!entry?.isIntersecting || loading || loadingMore || !hasMore) return;
        void loadArtworks(offset, 'append');
      },
      { root: null, rootMargin: '300px 0px 300px 0px', threshold: 0.01 }
    );

    const sentinel = loadMoreRef.current;
    if (sentinel) {
      observer.observe(sentinel);
    }

    return () => {
      observer.disconnect();
    };
  }, [hasMore, loadArtworks, loading, loadingMore, offset]);

  const toggleSelection = (artworkId: number) => {
    setSelectedArtworkIds((current) => {
      if (current.includes(artworkId)) {
        return current.filter((id) => id !== artworkId);
      }
      if (current.length >= MAX_SELECTION) {
        onToast?.('error', `최대 ${MAX_SELECTION}개까지 선택할 수 있습니다.`);
        return current;
      }
      return [...current, artworkId];
    });
  };

  const handleGenerate = async () => {
    if (selectedArtworkIds.length === 0) {
      onToast?.('error', '최소 1개 작품을 선택해야 합니다.');
      return;
    }
    setGenerationLoading(true);
    try {
      const response = await apiService.generateStorytelling({
        artworkIds: selectedArtworkIds,
        globalNote: globalNote.trim() || null,
        batchName: batchName.trim() || null,
        perArtworkNotes: Object.fromEntries(
          Object.entries(perArtworkNotes).map(([key, value]) => [key, value.trim()])
        ),
      });
      onToast?.('success', `${response.items.length}개의 스토리텔링을 저장했습니다.`);
      setArtworks((current) =>
        current.map((artwork) => {
          const generated = response.items.find((item) => item.artworkId === artwork.id);
          if (!generated) return artwork;
          return {
            ...artwork,
            currentStorytellingVersionId: generated.version.id,
            currentStorytellingTitle: generated.version.storyTitle,
            currentStorytellingText: generated.version.storyText,
            currentStorytellingStatus: generated.version.status,
            currentStorytellingGeneratedAt: generated.version.createdAt,
            storyVersionCount: (artwork.storyVersionCount ?? 0) + 1,
          };
        })
      );
      const focusArtworkId = response.items[0]?.artworkId ?? selectedArtworkIds[0];
      setActiveArtworkId(focusArtworkId);
      setSelectedArtworkIds([]);
      setPerArtworkNotes({});
      setGlobalNote('');
      setBatchName('');
      if (response.items[0]) {
        setStoryModalVersion(response.items[0].version);
      }
      if (focusArtworkId) {
        const refreshed = await apiService.getStorytellingCurrent(focusArtworkId);
        setCurrentVersion(refreshed.currentVersion ?? null);
      }
    } catch (err) {
      onToast?.('error', err instanceof Error ? err.message : '스토리텔링 생성에 실패했습니다.');
    } finally {
      setGenerationLoading(false);
    }
  };

  const handleUpdateStoryStatus = async (
    versionId: number,
    status: 'draft' | 'reviewed' | 'published' | 'archived'
  ) => {
    try {
      const response = await apiService.updateStorytellingVersionStatus(versionId, { status });
      const nextVersion = response.version;
      const nextCurrentVersion = response.currentVersion ?? null;
      setVersionHistory((current) =>
        current.map((item) => (item.id === nextVersion.id ? nextVersion : item))
      );
      setStoryModalVersion(nextVersion);
      setCurrentVersion(nextCurrentVersion);
      setArtworks((current) =>
        current.map((artwork) => {
          if (artwork.id !== response.artworkId) return artwork;
          return {
            ...artwork,
            currentStorytellingVersionId: response.currentVersionId ?? artwork.currentStorytellingVersionId ?? null,
            currentStorytellingTitle: nextCurrentVersion?.storyTitle ?? null,
            currentStorytellingText: nextCurrentVersion?.storyText ?? null,
            currentStorytellingStatus: nextCurrentVersion?.status ?? null,
            currentStorytellingGeneratedAt: nextCurrentVersion?.createdAt ?? null,
          };
        })
      );
      onToast?.('success', `스토리 상태를 ${status}로 변경했습니다.`);
    } catch (err) {
      onToast?.('error', err instanceof Error ? err.message : '스토리 상태 변경에 실패했습니다.');
    }
  };

  const handleGenerateTts = async (version: StorytellingVersion) => {
    if (version.status !== 'published') {
      onToast?.('error', 'TTS는 published 상태의 스토리 버전에서만 생성할 수 있습니다.');
      return;
    }

    setTtsGeneratingVersionId(version.id);
    try {
      const response = await apiService.generateStorytellingTts(version.id);
      const asset = response.ttsAsset;
      setCurrentTtsAssets((current) => {
        const next = current.filter((item) => item.storytellingVersionId !== asset.storytellingVersionId);
        return [asset, ...next];
      });
      onToast?.(
        response.status === 'success' ? 'success' : 'error',
        response.status === 'success'
          ? 'TTS를 생성했습니다.'
          : `TTS 생성이 완료되지 않았습니다: ${asset.errorMessage ?? 'unknown error'}`
      );
      if (activeArtworkId) {
        const refreshed = await apiService.getStorytellingCurrent(activeArtworkId);
        setCurrentVersion(refreshed.currentVersion ?? null);
        setCurrentTtsAssets(refreshed.ttsAssets ?? []);
      }
    } catch (err) {
      onToast?.('error', err instanceof Error ? err.message : 'TTS 생성에 실패했습니다.');
    } finally {
      setTtsGeneratingVersionId(null);
    }
  };

  return (
    <div className="min-h-screen bg-stone-950 text-stone-100">
      <div className="mx-auto flex min-h-screen max-w-[1600px] flex-col gap-6 px-6 py-6">
        <div className="flex flex-col gap-4 rounded-[28px] border border-white/10 bg-white/5 p-6 shadow-[0_20px_80px_rgba(0,0,0,0.35)] backdrop-blur-xl lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-300">Storytelling Dashboard</p>
            <h1 className="mt-2 text-3xl font-bold text-stone-50">작품별 스토리텔링 생성 패널</h1>
            <p className="mt-2 max-w-3xl text-sm text-stone-400">
              작품을 다중 선택하고 큐레이터 요청사항을 반영해 스토리를 생성합니다. 생성된 스토리는 작품별 버전으로 저장되며,
              현재 게시본은 작품 상세와 3D 모달에서 재사용됩니다.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <GlassButton variant="secondary" size="sm" onClick={() => void loadArtworks(0, 'replace')}>
              새로고침
            </GlassButton>
            <GlassButton
              variant="primary"
              size="sm"
              isLoading={generationLoading}
              onClick={() => void handleGenerate()}
            >
              Generate & Publish
            </GlassButton>
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
          <div className="space-y-4">
            <GlassCard padding="md" className="border-white/10 bg-white/5">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-stone-500">Artwork Library</p>
                  <p className="mt-1 text-sm text-stone-400">{artworks.length} / {loading ? '...' : 'loaded'}</p>
                </div>
                <label className="w-full md:max-w-sm">
                  <span className="mb-1 block text-xs text-stone-500">작품명 / 작가 / 시대 검색</span>
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="예: Monet, 자연, 18-19세기"
                    className="w-full rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm text-stone-100 outline-none transition focus:border-amber-400/40"
                  />
                </label>
              </div>
            </GlassCard>

            {error ? (
              <GlassCard padding="lg" className="border-red-400/20 bg-red-500/10 text-red-100">
                {error}
              </GlassCard>
            ) : null}

            <div className="grid gap-3">
              {loading ? (
                <GlassCard padding="lg" className="text-stone-400">
                  불러오는 중...
                </GlassCard>
              ) : artworks.length === 0 ? (
                <GlassCard padding="lg" className="text-stone-400">
                  조건에 맞는 작품이 없습니다.
                </GlassCard>
              ) : (
                artworks.map((artwork) => {
                  const selected = selectedArtworkIds.includes(artwork.id);
                  const active = activeArtworkId === artwork.id;
                  return (
                    <button
                      key={artwork.id}
                      type="button"
                      onClick={() => {
                        setActiveArtworkId(artwork.id);
                        toggleSelection(artwork.id);
                      }}
                      className="text-left"
                    >
                      <GlassCard
                        selected={selected}
                        interactive
                        padding="md"
                        className={[
                          active ? 'ring-1 ring-cyan-400/50' : '',
                        ].join(' ')}
                      >
                        <div className="grid gap-4 md:grid-cols-[120px_minmax(0,1fr)]">
                          <img
                            src={resolveArtworkImageUrl(artwork.imagePath)}
                            alt={artwork.title ?? `Artwork ${artwork.id}`}
                            className="h-[120px] w-full rounded-2xl object-cover ring-1 ring-white/10"
                          />
                          <div className="min-w-0">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="text-lg font-semibold text-stone-50">{artwork.title ?? `Artwork ${artwork.id}`}</p>
                                <p className="mt-1 text-sm text-stone-400">{artwork.artist ?? 'Unknown Artist'}</p>
                                <p className="mt-2 text-xs text-stone-500">
                                  {artwork.eraYear} · {artwork.era} · {artwork.mainThema} · {artwork.mainEmotion}
                                </p>
                              </div>
                              <span className={`rounded-full border px-3 py-1 text-xs ${selected ? 'border-amber-400/30 bg-amber-500/15 text-amber-100' : 'border-white/10 bg-white/5 text-stone-300'}`}>
                                {selected ? 'Selected' : 'Tap to select'}
                              </span>
                            </div>
                            <p className="mt-3 line-clamp-3 text-sm leading-6 text-stone-300">
                              {artwork.currentStorytellingText ?? '아직 저장된 스토리텔링이 없습니다. 선택 후 생성해보세요.'}
                            </p>
                            <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-stone-500">
                              <span>Version {artwork.storyVersionCount}</span>
                              <span>·</span>
                              <span>{artwork.currentStorytellingStatus ?? 'draft'}</span>
                              <span>·</span>
                              <span>{artwork.currentStorytellingGeneratedAt ? formatDateTime(artwork.currentStorytellingGeneratedAt) : 'No publish yet'}</span>
                            </div>
                          </div>
                        </div>
                      </GlassCard>
                    </button>
                  );
                })
              )}
              {loadingMore ? (
                <GlassCard padding="md" className="text-stone-400">
                  다음 20개를 불러오는 중...
                </GlassCard>
              ) : null}
              <div ref={loadMoreRef} className="h-10" aria-hidden="true" />
              {!hasMore && artworks.length > 0 ? (
                <p className="pb-4 text-center text-xs uppercase tracking-[0.18em] text-stone-500">
                  End of list
                </p>
              ) : null}
            </div>
          </div>

          <div className="space-y-4">
            <GlassCard padding="lg" className="border-amber-400/20 bg-amber-500/10">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-amber-300">Selected</p>
                  <p className="mt-1 text-sm text-stone-200">{selectedArtworkIds.length} / {MAX_SELECTION}</p>
                </div>
                <GlassButton variant="ghost" size="sm" onClick={() => setSelectedArtworkIds([])}>
                  Clear
                </GlassButton>
              </div>

              <label className="mt-4 block">
                <span className="mb-1 block text-xs text-stone-400">Batch name</span>
                <input
                  value={batchName}
                  onChange={(event) => setBatchName(event.target.value)}
                  placeholder="예: 봄 시즌 전시 스토리"
                  className="w-full rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm text-stone-100 outline-none transition focus:border-amber-400/40"
                />
              </label>

              <label className="mt-4 block">
                <span className="mb-1 block text-xs text-stone-400">Global note</span>
                <textarea
                  value={globalNote}
                  onChange={(event) => setGlobalNote(event.target.value)}
                  rows={4}
                  placeholder="이야기 톤, 관람객 대상, 강조할 관점"
                  className="w-full rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm text-stone-100 outline-none transition focus:border-amber-400/40"
                />
              </label>
            </GlassCard>

            <GlassCard padding="lg" className="border-white/10 bg-white/5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-stone-500">Per Artwork Notes</p>
                  <p className="mt-1 text-sm text-stone-400">각 작품에 반영할 추가 요청을 개별 입력합니다.</p>
                </div>
              </div>
              <div className="mt-4 space-y-3">
                {selectedArtworks.length === 0 ? (
                  <p className="text-sm text-stone-500">선택된 작품이 없습니다.</p>
                ) : (
                  selectedArtworks.map((artwork) => (
                    <label key={artwork.id} className="block">
                      <span className="mb-1 block text-xs text-stone-400">
                        {artwork.title ?? `Artwork ${artwork.id}`}
                      </span>
                      <textarea
                        value={perArtworkNotes[artwork.id] ?? ''}
                        onChange={(event) => {
                          const nextValue = event.target.value;
                          setPerArtworkNotes((current) => ({
                            ...current,
                            [artwork.id]: nextValue,
                          }));
                        }}
                        rows={2}
                        placeholder="선택 작품에만 적용할 보정 요청"
                        className="w-full rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm text-stone-100 outline-none transition focus:border-amber-400/40"
                      />
                    </label>
                  ))
                )}
              </div>
            </GlassCard>

            <GlassCard padding="lg" className="border-cyan-400/20 bg-cyan-500/10">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-cyan-300">Current Story</p>
                  <p className="mt-1 text-sm text-stone-200">{activeArtwork ? activeArtwork.title ?? `Artwork ${activeArtwork.id}` : 'No artwork selected'}</p>
                </div>
                <div className="flex items-center gap-2">
                  {currentVersion?.status === 'published' ? (
                    <GlassButton
                      variant="primary"
                      size="sm"
                      isLoading={ttsGeneratingVersionId === currentVersion.id}
                      onClick={() => void handleGenerateTts(currentVersion)}
                    >
                      Generate TTS
                    </GlassButton>
                  ) : null}
                  {currentVersion ? (
                    <GlassButton variant="ghost" size="sm" onClick={() => setStoryModalVersion(currentVersion)}>
                      Open
                    </GlassButton>
                  ) : null}
                </div>
              </div>
              {historyLoading ? (
                <p className="mt-4 text-sm text-stone-400">히스토리를 불러오는 중...</p>
              ) : currentVersion ? (
                <div className="mt-4 space-y-4">
                  <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
                    <p className="text-sm font-semibold text-stone-100">{currentVersion.storyTitle}</p>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-stone-300">{currentVersion.storyText}</p>
                  </div>
                  {currentVersionTtsAsset ? (
                    <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-xs uppercase tracking-[0.16em] text-stone-500">TTS asset</p>
                          <p className="mt-1 text-sm text-stone-100">{currentVersionTtsAsset.providerName}</p>
                          <p className="mt-1 text-xs text-stone-400">
                            {currentVersionTtsAsset.modelName} · {currentVersionTtsAsset.voiceId} · {currentVersionTtsAsset.languageBoost}
                          </p>
                        </div>
                        <span className={`rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.16em] ${currentVersionTtsAsset.status === 'ready' ? 'border-emerald-400/20 bg-emerald-500/10 text-emerald-100' : 'border-rose-400/20 bg-rose-500/10 text-rose-100'}`}>
                          {currentVersionTtsAsset.status}
                        </span>
                      </div>
                      {currentVersionTtsAsset.audioUrl ? (
                        <audio controls src={currentVersionTtsAsset.audioUrl} className="mt-3 w-full" />
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : (
                <p className="mt-4 text-sm text-stone-400">아직 공개된 스토리가 없습니다.</p>
              )}

              <div className="mt-4 flex flex-wrap gap-2">
                {versionHistory.map((version) => (
                  <button
                    key={version.id}
                    type="button"
                    onClick={() => setStoryModalVersion(version)}
                    className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-stone-200 transition hover:bg-white/10"
                  >
                    v{version.versionNumber}
                  </button>
                ))}
              </div>
            </GlassCard>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {storyModalVersion ? (
          <StoryModal
            version={storyModalVersion}
            artwork={artworks.find((item) => item.id === storyModalVersion.artworkId) ?? null}
            ttsAsset={modalTtsAsset}
            ttsLoading={ttsGeneratingVersionId === storyModalVersion.id}
            onClose={() => setStoryModalVersion(null)}
            onUpdateStatus={handleUpdateStoryStatus}
            onGenerateTts={(version) => void handleGenerateTts(version)}
          />
        ) : null}
      </AnimatePresence>
    </div>
  );
};

export default StorytellingDashboardPage;
