import { AnimatePresence } from 'framer-motion';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AuthorUploadModal } from '../author/AuthorUploadModal';
import { apiService } from '../../lib/api';
import { resolveArtworkImageUrl } from '../../lib/imagePaths';
import type { GeneratedFramedAsset } from '../../types/curation';
import { FramedGlbPreviewSurface } from './FramedGlbPreviewSurface';

const formatFileSize = (bytes?: number | null) => {
  if (!bytes || bytes <= 0) return 'Unknown size';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
};

const formatGeneratedAt = (value?: string | null) => {
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

const getArtworkIdFromHash = () => {
  const [, queryString = ''] = window.location.hash.split('?');
  const params = new URLSearchParams(queryString);
  const rawValue = params.get('artworkId');
  if (!rawValue) return null;
  const parsed = Number(rawValue);
  return Number.isFinite(parsed) ? parsed : null;
};

const FramedGlbViewerPage = () => {
  const [assets, setAssets] = useState<GeneratedFramedAsset[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(() => getArtworkIdFromHash());
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAuthorUpload, setShowAuthorUpload] = useState(false);

  const loadAssets = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiService.getGeneratedFramedGlbAssets();
      const visibleAssets = [...response.items].sort((left, right) => {
        const leftTime = left.generatedAt ? new Date(left.generatedAt).getTime() : 0;
        const rightTime = right.generatedAt ? new Date(right.generatedAt).getTime() : 0;
        if (leftTime !== rightTime) {
          return rightTime - leftTime;
        }
        return right.artworkId - left.artworkId;
      });
      setAssets(visibleAssets);
      setSelectedId((current) => {
        const preferred = getArtworkIdFromHash();
        if (preferred && visibleAssets.some((asset) => asset.artworkId === preferred)) {
          return preferred;
        }
        return current ?? visibleAssets[0]?.artworkId ?? null;
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'GLB 목록을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const syncSelectedFromHash = () => {
      const preferred = getArtworkIdFromHash();
      setSelectedId(preferred);
      if (preferred && !assets.some((asset) => asset.artworkId === preferred)) {
        void loadAssets();
      }
    };

    window.addEventListener('hashchange', syncSelectedFromHash);
    return () => window.removeEventListener('hashchange', syncSelectedFromHash);
  }, [assets, loadAssets]);

  useEffect(() => {
    void loadAssets();
  }, [loadAssets]);

  const filteredAssets = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return assets;
    return assets.filter((asset) => {
      const haystack = [
        asset.artworkId,
        asset.title,
        asset.artist,
        asset.source,
        asset.sourceQuery,
        asset.assetFolderName,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [assets, search]);

  const selectedAsset = useMemo(() => {
    if (!filteredAssets.length) return null;
    return filteredAssets.find((asset) => asset.artworkId === selectedId) ?? filteredAssets[0] ?? null;
  }, [filteredAssets, selectedId]);

  useEffect(() => {
    if (!selectedAsset) return;
    if (selectedId !== selectedAsset.artworkId) {
      setSelectedId(selectedAsset.artworkId);
    }
  }, [selectedAsset, selectedId]);

  const applyLegacyRotationFix =
    selectedAsset?.notes?.rotation_fix_version !== 'baked_v1' ||
    selectedAsset?.notes?.fit_mode !== 'long_edge' ||
    selectedAsset?.notes?.generator_version !== 'fit_v2_front_v1';

  return (
    <div className="min-h-screen bg-stone-950 text-stone-100">
      <AnimatePresence>
        {showAuthorUpload ? (
          <AuthorUploadModal
            onClose={() => setShowAuthorUpload(false)}
            onSuccess={async () => {
              await loadAssets();
            }}
          />
        ) : null}
      </AnimatePresence>

      <div className="mx-auto max-w-[1600px] px-6 py-8">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">Developer GLB Viewer</p>
            <h1 className="mt-2 text-3xl font-bold">생성된 작품 프레임 GLB 확인</h1>
            <p className="mt-2 text-sm text-stone-400">
              DB에 등록된 `framed_glb` 자산만 목록으로 보여주고, 클릭한 객체를 웹에서 바로 360도로 확인합니다.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <a
              href="#"
              className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-stone-200 transition hover:border-white/20 hover:bg-white/10"
            >
              메인으로
            </a>
            <a
              href="#/debug/recommendation"
              className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-stone-200 transition hover:border-white/20 hover:bg-white/10"
            >
              Recommendation Debug
            </a>
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-[420px_minmax(0,1fr)]">
          <section className="rounded-3xl border border-white/10 bg-white/5 p-4 shadow-2xl backdrop-blur">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-stone-500">Ready Assets</p>
                <p className="mt-2 text-lg font-semibold">{assets.length} items</p>
              </div>
              <button
                type="button"
                onClick={() => setShowAuthorUpload(true)}
                className="rounded-xl border border-cyan-300/20 bg-cyan-300/10 px-4 py-2 text-sm font-medium text-cyan-100 transition hover:border-cyan-300/35 hover:bg-cyan-300/15"
              >
                Author Upload
              </button>
            </div>

            <label className="block">
              <span className="sr-only">검색</span>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="작품명, 작가명, 출처 검색..."
                className="w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-stone-100 outline-none placeholder:text-stone-500 focus:border-cyan-300/35"
              />
            </label>

            <div className="mt-4 max-h-[70vh] space-y-3 overflow-y-auto pr-1">
              {loading ? (
                <div className="rounded-2xl border border-dashed border-white/10 bg-black/20 p-6 text-sm text-stone-400">
                  Loading assets...
                </div>
              ) : error ? (
                <div className="rounded-2xl border border-red-400/20 bg-red-500/10 p-4 text-sm text-red-100">
                  {error}
                </div>
              ) : filteredAssets.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-white/10 bg-black/20 p-6 text-sm text-stone-400">
                  표시할 GLB 자산이 없습니다.
                </div>
              ) : (
                filteredAssets.map((asset) => {
                  const isActive = asset.artworkId === selectedAsset?.artworkId;
                  return (
                    <button
                      key={asset.artworkId}
                      type="button"
                      onClick={() => setSelectedId(asset.artworkId)}
                      className={`w-full rounded-2xl border p-3 text-left transition ${
                        isActive
                          ? 'border-cyan-300/30 bg-cyan-300/10'
                          : 'border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/10'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div className="h-12 w-12 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-black/30">
                          {asset.imagePath ? (
                            <img src={resolveArtworkImageUrl(asset.imagePath)} alt="" className="h-full w-full object-cover" />
                          ) : null}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-stone-100">{asset.title ?? `Artwork ${asset.artworkId}`}</p>
                          <p className="mt-1 truncate text-xs text-stone-400">{asset.artist ?? 'Unknown Artist'}</p>
                          <p className="mt-2 text-xs text-stone-500">{asset.assetFolderName}</p>
                          <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-stone-400">
                            <span>{formatFileSize(asset.fileSizeBytes)}</span>
                            <span>{formatGeneratedAt(asset.generatedAt)}</span>
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </section>

          <section className="grid gap-4 lg:grid-rows-[minmax(0,1fr)_auto]">
            <div className="overflow-hidden rounded-3xl border border-white/10 bg-black/40 shadow-2xl">
              {!selectedAsset ? (
                <div className="flex h-[72vh] items-center justify-center text-sm text-stone-400">
                  선택된 자산이 없습니다.
                </div>
              ) : (
                <FramedGlbPreviewSurface
                  assetUrl={selectedAsset.glbUrl ?? ''}
                  applyLegacyRotationFix={applyLegacyRotationFix}
                  className="h-[72vh]"
                />
              )}
            </div>

            <div className="grid gap-4 lg:grid-cols-[1.3fr_0.7fr]">
              <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
                <p className="text-xs uppercase tracking-[0.18em] text-stone-500">Selected Asset</p>
                {selectedAsset ? (
                  <div className="mt-3 space-y-2 text-sm text-stone-300">
                    <p className="text-lg font-semibold text-stone-100">{selectedAsset.title ?? `Artwork ${selectedAsset.artworkId}`}</p>
                    <p>{selectedAsset.artist ?? 'Unknown Artist'}</p>
                    <p>Artwork ID: {selectedAsset.artworkId}</p>
                    <p>File: {selectedAsset.fileName}</p>
                    <p>Generated: {formatGeneratedAt(selectedAsset.generatedAt)}</p>
                    <p>Size: {formatFileSize(selectedAsset.fileSizeBytes)}</p>
                    <p>Folder: {selectedAsset.assetFolderName}</p>
                    <p className="break-all text-cyan-300">{selectedAsset.glbUrl}</p>
                    {selectedAsset.objectUrl ? (
                      <a href={selectedAsset.objectUrl} target="_blank" rel="noreferrer" className="inline-block text-sky-300 hover:text-sky-200">
                        원본 source 열기
                      </a>
                    ) : null}
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-stone-400">선택된 자산이 없습니다.</p>
                )}
              </div>

              <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
                <p className="text-xs uppercase tracking-[0.18em] text-stone-500">Metadata</p>
                {selectedAsset ? (
                  <div className="mt-3 space-y-2 text-sm text-stone-300">
                    <p>Source: {selectedAsset.source ?? 'unknown'}</p>
                    <p>Query: {selectedAsset.sourceQuery ?? 'n/a'}</p>
                    <p className="break-all">Object ID: {selectedAsset.sourceObjectId ?? 'n/a'}</p>
                    <p className="break-words">Notes: {selectedAsset.notes ? JSON.stringify(selectedAsset.notes) : 'n/a'}</p>
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-stone-400">표시할 메타데이터가 없습니다.</p>
                )}
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};

export default FramedGlbViewerPage;
