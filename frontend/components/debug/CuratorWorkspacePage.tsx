import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { apiService } from '../../lib/api';
import { clearCachedRoomMergePreset } from '../../lib/roomMergePresetCache';
import { resolveArtworkImageUrl } from '../../lib/imagePaths';
import { useUiLocale } from '../../lib/uiLocale';
import { resolveWorkspaceRole, type WorkspaceRole } from '../../lib/workspaceRole';
import { FramedGlbPreviewSurface } from './FramedGlbPreviewSurface';
import { AuthorUploadModal } from '../author/AuthorUploadModal';
import type {
  CuratorWorkspaceArtwork,
  CuratorWorkspaceResponse,
  CuratorWorkspaceSpace,
  AuthorArtworkUpdateRequest,
  RoomMergeExperimentSnapshotResponse,
  RoomMergePresetResponse,
  StorytellingTtsAsset,
  StorytellingVersion,
} from '../../types/curation';

const formatDateTime = (value?: string | null) => {
  if (!value) return '알 수 없음';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed);
};

const formatCount = (value: number) => value.toString().padStart(2, '0');

const parseProfileSpaceIdFromHash = () => {
  const queryString = window.location.hash.split('?')[1] ?? '';
  const params = new URLSearchParams(queryString);
  const rawSpaceId = params.get('spaceId');
  if (!rawSpaceId) return null;
  const parsed = Number(rawSpaceId);
  return Number.isFinite(parsed) ? parsed : null;
};

const chipStyle =
  'inline-flex items-center rounded-full border border-white/10 bg-[#1b1812]/72 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#d8cbbb]';

const compactChipStyle =
  'inline-flex items-center rounded-full border border-white/10 bg-[#14130c]/82 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#d8cbbb]';

const statusStyle = (status: string) => {
  if (status === 'published' || status === 'ready' || status === 'success') {
    return 'border-[#7f9b5a]/35 bg-[#7f9b5a]/14 text-[#e8f0d5]';
  }
  if (status === 'generating' || status === 'queued') {
    return 'border-[#5fa8d3]/35 bg-[#25506f]/28 text-[#d9f1ff]';
  }
  if (status === 'failed' || status === 'error') {
    return 'border-[#b57d69]/35 bg-[#5b2c20]/30 text-[#f0d7cf]';
  }
  if (status === 'reviewed') {
    return 'border-[#d8cbbb]/25 bg-[#8c6745]/18 text-[#f4efe7]';
  }
  return 'border-white/10 bg-[#1b1812]/72 text-[#d8cbbb]';
};

const formatStatusLabel = (status: string) => {
  switch (status) {
    case 'draft':
      return '초안';
    case 'reviewed':
      return '검토 완료';
    case 'published':
      return '발행됨';
    case 'archived':
      return '보관됨';
    case 'success':
      return '성공';
    case 'failed':
      return '실패';
    case 'error':
      return '오류';
    case 'missing':
      return '생성 필요';
    case 'queued':
      return '생성 대기';
    case 'generating':
      return '생성 중';
    case 'ready':
      return '준비 완료';
    default:
      return status;
  }
};

const formatArtworkSourceLabel = (source?: string | null) => {
  switch ((source ?? '').trim().toLowerCase()) {
    case 'author_upload':
      return '직접 업로드';
    case 'public_domain':
      return '퍼블릭 도메인';
    case 'generated':
      return '생성 자산';
    case 'met':
      return '메트로폴리탄 미술관';
    default:
      return source ?? '출처 없음';
  }
};

const formatArtworkSourceDetail = (artwork: CuratorWorkspaceArtwork) => {
  const parts = [formatArtworkSourceLabel(artwork.source)];
  if (artwork.sourceObjectId) {
    parts.push(`No. ${artwork.sourceObjectId}`);
  }
  if (artwork.sourceQuery) {
    parts.push(artwork.sourceQuery.trim());
  }
  return parts.join(' · ');
};

const LAST_WORKSPACE_ROLE_KEY = 'digital-twin-last-workspace-role';
const WORKSPACE_ARTWORK_PAGE_SIZE = 5;

interface CuratorWorkspacePageProps {
  workspaceRoleHint?: WorkspaceRole | null;
}

const ProfileSection = ({
  title,
  subtitle,
  eyebrow,
  action,
  children,
}: {
  title: string;
  subtitle: string;
  eyebrow: string;
  action?: ReactNode;
  children: ReactNode;
}) => (
  <section className="rounded-[28px] border border-white/10 bg-[#1b1812]/72 p-5 shadow-[0_20px_70px_rgba(0,0,0,0.22)] backdrop-blur-xl">
    <div className="mb-4 flex items-start justify-between gap-4">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#7f9b5a]">{eyebrow}</p>
        <h2 className="mt-2 text-xl font-semibold text-[#f4efe7]">{title}</h2>
        <p className="mt-1 text-sm text-[#d8cbbb]">{subtitle}</p>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
    {children}
  </section>
);

const SnapshotRow = ({
  item,
  kind,
}: {
  item: RoomMergeExperimentSnapshotResponse | RoomMergePresetResponse;
  kind: 'snapshot' | 'preset';
}) => (
  <div className="rounded-2xl border border-white/10 bg-[#14130c]/72 p-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="text-sm font-semibold text-[#f4efe7]">
          {'presetName' in item ? item.presetName : `스냅샷 #${item.id}`}
        </p>
        <p className="mt-1 text-xs text-[#d8cbbb]">
          {kind === 'snapshot' ? '스냅샷' : '프리셋'} · {formatDateTime(item.createdAt)} · 공간 {item.spaceId ?? '연결 안 됨'}
        </p>
      </div>
      <span className={chipStyle}>{item.selectedKey ?? '선택 없음'}</span>
    </div>
    <p className="mt-3 text-xs leading-5 text-[#d8cbbb]">
      {item.memo || '메모 없음'}
    </p>
  </div>
);

const ArtworkSummaryRow = ({
  artwork,
  isActive,
  onSelect,
  onOpenGlb,
  onGenerateGlb,
  isGeneratingGlb,
}: {
  artwork: CuratorWorkspaceArtwork;
  isActive: boolean;
  onSelect: (artwork: CuratorWorkspaceArtwork) => void;
  onOpenGlb: (artwork: CuratorWorkspaceArtwork) => void;
  onGenerateGlb: (artwork: CuratorWorkspaceArtwork) => void;
  isGeneratingGlb: boolean;
}) => {
  const representative = artwork.currentStory ?? artwork.storyVersions[0] ?? null;
  const framedGlbStatus = artwork.framedGlbStatus ?? (artwork.framedGlbUrl ? 'ready' : 'missing');
  const canOpenGlb = framedGlbStatus === 'ready' && Boolean(artwork.framedGlbUrl);
  const isGlbPending = framedGlbStatus === 'queued' || framedGlbStatus === 'generating';
  const isGlbFailed = framedGlbStatus === 'failed';
  const isGlbMissing = framedGlbStatus === 'missing';
  const needsGeneration = !canOpenGlb && !isGlbPending;
  const glbActionLabel = isGeneratingGlb
    ? '생성 중...'
    : canOpenGlb
      ? '3D 보기'
      : isGlbFailed
        ? 'GLB 재생성'
        : 'GLB 생성';
  const glbStatusDescription = (() => {
    switch (framedGlbStatus) {
      case 'queued':
        return '업로드 완료 — 백그라운드 3D 생성 대기 중입니다.';
      case 'generating':
        return '3D 모델을 생성하는 중입니다. 잠시 기다려 주세요.';
      case 'ready':
        return '3D 보기로 바로 열 수 있습니다.';
      case 'failed':
        return '3D 생성에 실패했습니다. 아래 버튼으로 다시 시도하세요.';
      case 'missing':
        return '3D 파일이 아직 준비되지 않았습니다. 버튼을 눌러 생성하세요.';
      default:
        return '3D 파일 상태를 확인할 수 없습니다.';
    }
  })();
  const glbDescriptionColor = isGlbPending
    ? 'text-amber-100/90'
    : isGlbFailed
      ? 'text-red-300/80'
      : isGlbMissing
        ? 'text-[#d8cbbb]'
        : 'text-[#b29e8d]';

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(artwork)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect(artwork);
        }
      }}
      className={`w-full rounded-[24px] border px-4 py-4 text-left transition ${
        isActive
          ? 'border-[#7f9b5a]/50 bg-[#241f16] shadow-[0_18px_60px_rgba(0,0,0,0.24)] ring-1 ring-[#7f9b5a]/18'
          : 'border-white/10 bg-[#14130c]/72 hover:border-[#7f9b5a]/24 hover:bg-[#1b1812]/80'
      }`}
    >
      <div className={`flex flex-col gap-4 lg:flex-row lg:items-stretch lg:gap-5 ${isActive ? 'relative pl-3 lg:pl-4' : ''}`}>
        {isActive ? <div className="absolute left-0 top-4 bottom-4 w-1 rounded-full bg-[#7f9b5a]" /> : null}
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <div className="h-12 w-12 shrink-0 overflow-hidden rounded-2xl border border-white/10 bg-[#1b1812]/72">
            {artwork.imagePath ? (
              <img src={resolveArtworkImageUrl(artwork.imagePath)} alt="" className="h-full w-full object-cover" />
            ) : null}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate text-sm font-semibold text-[#f4efe7]">{artwork.title ?? `작품 ${artwork.id}`}</p>
              {representative ? (
                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] ${statusStyle(representative.status)}`}>
                  {representative.isCurrentRepresentative ? '대표본' : formatStatusLabel(representative.status)}
                </span>
              ) : null}
            </div>
            <p className="mt-1 truncate text-xs text-[#d8cbbb]">
              {artwork.artist ?? '작가 정보 없음'} · {artwork.era} · {artwork.eraYear}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <span className={compactChipStyle}>{`버전 ${formatCount(artwork.storyVersionCount)}`}</span>
              <span className={compactChipStyle}>{`TTS ${formatCount(artwork.ttsAssets.length)}`}</span>
              <span className={compactChipStyle}>{formatArtworkSourceLabel(artwork.source)}</span>
            </div>
          </div>
        </div>
        <div className="flex min-w-[220px] flex-1 items-stretch justify-end lg:max-w-[280px]">
          <div className={`flex w-full flex-col justify-between rounded-[22px] border border-dashed p-4 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.02)] ${
            isGlbFailed
              ? 'border-red-400/25 bg-red-950/20'
              : isGlbPending
                ? 'border-amber-400/25 bg-amber-950/15'
                : canOpenGlb
                  ? 'border-[#7f9b5a]/28 bg-[#14130c]/62'
                  : 'border-white/18 bg-[#14130c]/62'
          }`}>
            <div className="flex items-center justify-between gap-2">
              <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] ${statusStyle(framedGlbStatus)}`}>
                {formatStatusLabel(framedGlbStatus)}
              </span>
              {artwork.framedGlbGeneratedAt ? (
                <span className="text-[10px] text-[#b29e8d]">{formatDateTime(artwork.framedGlbGeneratedAt)}</span>
              ) : null}
              {isGlbPending ? (
                <span className="h-2 w-2 animate-pulse rounded-full bg-amber-400" />
              ) : null}
            </div>
            <p className={`mt-3 text-[11px] leading-5 ${glbDescriptionColor}`}>
              {glbStatusDescription}
            </p>
            <div className="mt-4 flex flex-1 items-center justify-center gap-2">
              {canOpenGlb ? (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpenGlb(artwork);
                  }}
                  className="rounded-full border border-[#7f9b5a]/30 bg-[#7f9b5a]/14 px-4 py-2 text-[12px] font-semibold text-[#f4efe7] transition hover:border-[#7f9b5a]/50 hover:bg-[#7f9b5a]/24"
                >
                  {glbActionLabel}
                </button>
              ) : null}
              {needsGeneration ? (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onGenerateGlb(artwork);
                  }}
                  disabled={isGeneratingGlb}
                  className={`rounded-full border px-4 py-2 text-[12px] font-semibold text-[#f4efe7] transition disabled:cursor-not-allowed disabled:opacity-60 ${
                    isGlbFailed
                      ? 'border-red-400/30 bg-red-900/20 hover:border-red-400/50 hover:bg-red-900/30'
                      : 'border-white/15 bg-[#7f9b5a]/14 hover:border-[#7f9b5a]/35 hover:bg-[#7f9b5a]/20'
                  }`}
                >
                  {isGeneratingGlb ? (
                    <span className="flex items-center gap-1.5">
                      <span className="h-2 w-2 animate-spin rounded-full border border-white/40 border-t-white" />
                      생성 중...
                    </span>
                  ) : glbActionLabel}
                </button>
              ) : null}
            </div>
            <p className="mt-3 text-[11px] leading-5 text-[#b29e8d]">
              {canOpenGlb
                ? '점선 박스에서 3D GLB를 마우스로 회전해 확인할 수 있습니다.'
                : isGlbPending
                  ? '완료되면 자동으로 갱신됩니다.'
                  : '업로드 후 자동 생성 — 실패 시 버튼으로 수동 재시도할 수 있습니다.'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

const ArtworkGlbModal = ({
  artwork,
  open,
  onClose,
}: {
  artwork: CuratorWorkspaceArtwork | null;
  open: boolean;
  onClose: () => void;
}) => {
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, open]);

  if (!open || !artwork) {
    return null;
  }

  const framedGlbUrl = artwork.framedGlbUrl ?? '';
  const applyLegacyRotationFix =
    artwork.framedGlbNotes?.rotation_fix_version !== 'baked_v1' ||
    artwork.framedGlbNotes?.fit_mode !== 'long_edge' ||
    artwork.framedGlbNotes?.generator_version !== 'fit_v2_front_v1';

  return (
    <div
      className="fixed inset-0 z-[220] flex items-stretch justify-center bg-black/72 p-3 backdrop-blur-xl sm:p-4 lg:p-6"
      onClick={onClose}
    >
      <div
        className="flex h-full w-full max-w-[1600px] flex-col gap-4 overflow-hidden rounded-[30px] border border-white/10 bg-[#14130c]/96 p-4 shadow-[0_30px_120px_rgba(0,0,0,0.55)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#7f9b5a]">3D Viewer</p>
            <h3 className="mt-2 text-2xl font-semibold text-[#f4efe7]">
              {artwork.title ?? `작품 ${artwork.id}`}
            </h3>
            <p className="mt-1 text-sm text-[#d8cbbb]">
              {artwork.artist ?? '작가 정보 없음'} · {artwork.era} · {artwork.eraYear}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-white/10 bg-[#1b1812]/80 px-4 py-2 text-sm text-[#f4efe7] transition hover:border-white/20 hover:bg-[#2a2417]"
          >
            닫기
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden rounded-[26px] border border-white/10 bg-black/40">
          {framedGlbUrl ? (
            <FramedGlbPreviewSurface
              assetUrl={framedGlbUrl}
              applyLegacyRotationFix={applyLegacyRotationFix}
              className="h-full min-h-0"
            />
          ) : (
            <div className="flex h-full min-h-[520px] items-center justify-center p-6 text-sm text-[#d8cbbb]">
              아직 GLB가 준비되지 않았습니다.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const StoryVersionItem = ({
  version,
  isActive,
  isRepresentative,
  ttsAsset,
  onSelect,
  onSetRepresentative,
  onGenerateTts,
  onDelete,
  onDragStart,
}: {
  version: StorytellingVersion;
  isActive: boolean;
  isRepresentative: boolean;
  ttsAsset?: StorytellingTtsAsset | null;
  onSelect: (version: StorytellingVersion) => void;
  onSetRepresentative: (version: StorytellingVersion) => void;
  onGenerateTts: (version: StorytellingVersion) => void;
  onDelete: (version: StorytellingVersion) => void;
  onDragStart: (version: StorytellingVersion) => void;
}) => (
  <div
    role="button"
    tabIndex={0}
    draggable
    onDragStart={() => onDragStart(version)}
    onClick={() => onSelect(version)}
    onKeyDown={(event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onSelect(version);
      }
    }}
    className={`cursor-grab rounded-[22px] border p-4 transition active:cursor-grabbing ${
      isActive
        ? 'border-[#7f9b5a]/40 bg-[#5b2c20]/28 shadow-[0_18px_60px_rgba(0,0,0,0.24)]'
        : 'border-white/10 bg-[#14130c]/72 hover:border-[#7f9b5a]/24 hover:bg-[#1b1812]/80'
    }`}
  >
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-sm font-semibold text-[#f4efe7]">{version.storyTitle}</p>
          {isRepresentative ? (
            <span className="rounded-full border border-[#7f9b5a]/28 bg-[#7f9b5a]/14 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#e8f0d5]">
              대표본
            </span>
          ) : null}
        </div>
        <p className="mt-1 text-xs text-[#d8cbbb]">
          v{version.versionNumber} · {formatDateTime(version.createdAt)}
        </p>
      </div>
      <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] ${statusStyle(version.status)}`}>
        {formatStatusLabel(version.status)}
      </span>
    </div>
    <p className="mt-3 line-clamp-3 whitespace-pre-wrap text-sm leading-6 text-[#f4efe7]">
      {version.storyText}
    </p>
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onSetRepresentative(version);
        }}
        disabled={version.status !== 'published'}
        className="rounded-full border border-white/10 bg-[#1b1812]/72 px-3 py-1.5 text-[11px] text-[#f4efe7] transition hover:bg-[#5b2c20]/28 disabled:cursor-not-allowed disabled:opacity-50"
      >
        설명용으로 지정
      </button>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onGenerateTts(version);
        }}
        disabled={version.status !== 'published'}
        className="rounded-full border border-[#7f9b5a]/20 bg-[#7f9b5a]/10 px-3 py-1.5 text-[11px] text-[#e8f0d5] transition hover:bg-[#7f9b5a]/16 disabled:cursor-not-allowed disabled:opacity-50"
      >
        TTS 생성
      </button>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onDelete(version);
        }}
        className="rounded-full border border-[#b57d69]/20 bg-[#5b2c20]/18 px-3 py-1.5 text-[11px] text-[#f0d7cf] transition hover:bg-[#5b2c20]/28"
      >
        삭제
      </button>
      {ttsAsset ? (
        <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] ${statusStyle(ttsAsset.status)}`}>
          TTS {formatStatusLabel(ttsAsset.status)}
        </span>
      ) : null}
    </div>
  </div>
);

const ArtworkStoryManager = ({
  artwork,
  onRefresh,
  onNotify,
  onDeleted,
  isKorean,
}: {
  artwork: CuratorWorkspaceArtwork;
  onRefresh: () => Promise<void>;
  onNotify: (message: string) => void;
  onDeleted: (artworkId: number) => void;
  isKorean: boolean;
}) => {
  const [selectedVersionId, setSelectedVersionId] = useState<number | null>(null);
  const [storyTitleDraft, setStoryTitleDraft] = useState('');
  const [storyTextDraft, setStoryTextDraft] = useState('');
  const [batchNameDraft, setBatchNameDraft] = useState('');
  const [globalNoteDraft, setGlobalNoteDraft] = useState('');
  const [artworkNoteDraft, setArtworkNoteDraft] = useState('');
  const [savingVersionId, setSavingVersionId] = useState<number | null>(null);
  const [editingArtwork, setEditingArtwork] = useState(false);
  const [artworkTitleDraft, setArtworkTitleDraft] = useState(artwork.title ?? '');
  const [artistDraft, setArtistDraft] = useState(artwork.artist ?? '');
  const [eraYearDraft, setEraYearDraft] = useState(String(artwork.eraYear));
  const [mainThemaDraft, setMainThemaDraft] = useState(artwork.mainThema ?? '');
  const [mainEmotionDraft, setMainEmotionDraft] = useState(artwork.mainEmotion ?? '');
  const [eraDraft, setEraDraft] = useState(artwork.era ?? '');
  const [savingArtwork, setSavingArtwork] = useState(false);
  const [deletingArtwork, setDeletingArtwork] = useState(false);
  const [generatingStory, setGeneratingStory] = useState(false);
  const [ttsGeneratingVersionId, setTtsGeneratingVersionId] = useState<number | null>(null);
  const [representativeSaving, setRepresentativeSaving] = useState(false);
  const [deletingVersionId, setDeletingVersionId] = useState<number | null>(null);

  const representativeVersion = artwork.currentStory ?? null;
  const versions = artwork.storyVersions;
  const selectedVersion = useMemo(
    () => versions.find((version) => version.id === selectedVersionId) ?? representativeVersion ?? versions[0] ?? null,
    [representativeVersion, selectedVersionId, versions],
  );
  const selectedVersionTtsAsset = useMemo(
    () => artwork.ttsAssets.find((asset) => asset.storytellingVersionId === selectedVersion?.id) ?? null,
    [artwork.ttsAssets, selectedVersion?.id],
  );
  const representativeTtsAsset = useMemo(
    () => artwork.ttsAssets.find((asset) => asset.storytellingVersionId === representativeVersion?.id) ?? null,
    [artwork.ttsAssets, representativeVersion?.id],
  );

  useEffect(() => {
    const nextSelectedId = representativeVersion?.id ?? versions[0]?.id ?? null;
    setSelectedVersionId((current) => {
      if (current !== null && versions.some((version) => version.id === current)) {
        return current;
      }
      return nextSelectedId;
    });
  }, [representativeVersion?.id, versions]);

  useEffect(() => {
    if (!selectedVersion) {
      setStoryTitleDraft('');
      setStoryTextDraft('');
      return;
    }

    setStoryTitleDraft(selectedVersion.storyTitle);
    setStoryTextDraft(selectedVersion.storyText);
  }, [selectedVersion?.id]);

  useEffect(() => {
    setBatchNameDraft(`${artwork.title ?? `작품 ${artwork.id}`} 스토리텔링`);
    setGlobalNoteDraft('');
    setArtworkNoteDraft('');
  }, [artwork.id, artwork.title]);

  useEffect(() => {
    setArtworkTitleDraft(artwork.title ?? '');
    setArtistDraft(artwork.artist ?? '');
    setEraYearDraft(String(artwork.eraYear));
    setMainThemaDraft(artwork.mainThema ?? '');
    setMainEmotionDraft(artwork.mainEmotion ?? '');
    setEraDraft(artwork.era ?? '');
    setEditingArtwork(false);
  }, [artwork.artist, artwork.era, artwork.eraYear, artwork.id, artwork.mainEmotion, artwork.mainThema, artwork.title]);

  const handleSelectVersion = useCallback((version: StorytellingVersion) => {
    setSelectedVersionId(version.id);
  }, []);

  const handleDragStart = useCallback((version: StorytellingVersion) => {
    setSelectedVersionId(version.id);
  }, []);

  const handleGenerateStory = useCallback(async () => {
    setGeneratingStory(true);
    try {
      const response = await apiService.generateStorytelling({
        artworkIds: [artwork.id],
        batchName: batchNameDraft.trim() || null,
        globalNote: globalNoteDraft.trim() || null,
        perArtworkNotes: {
          [String(artwork.id)]: artworkNoteDraft.trim(),
        },
      });
      const generatedVersion = response.items[0]?.version ?? null;
      onNotify(isKorean ? '스토리텔링 버전을 생성했습니다.' : 'Generated a storytelling version.');
      await onRefresh();
      if (generatedVersion) {
        setSelectedVersionId(generatedVersion.id);
      }
    } catch (error) {
      onNotify(error instanceof Error ? error.message : (isKorean ? '스토리텔링 생성에 실패했습니다.' : 'Failed to generate storytelling.'));
    } finally {
      setGeneratingStory(false);
    }
  }, [artwork.id, artworkNoteDraft, batchNameDraft, globalNoteDraft, isKorean, onNotify, onRefresh]);

  const handleSaveVersion = useCallback(async () => {
    if (!selectedVersion) return;
    setSavingVersionId(selectedVersion.id);
    try {
      await apiService.updateStorytellingVersion(selectedVersion.id, {
        storyTitle: storyTitleDraft.trim(),
        storyText: storyTextDraft.trim(),
      });
      onNotify(isKorean ? '스토리 텍스트를 저장했습니다.' : 'Saved the story text.');
      await onRefresh();
    } catch (error) {
      onNotify(error instanceof Error ? error.message : (isKorean ? '스토리 저장에 실패했습니다.' : 'Failed to save the story.'));
    } finally {
      setSavingVersionId(null);
    }
  }, [isKorean, onNotify, onRefresh, selectedVersion, storyTextDraft, storyTitleDraft]);

  const handleSaveArtwork = useCallback(async () => {
    const eraYear = Number(eraYearDraft);
    if (!Number.isFinite(eraYear)) {
      onNotify(isKorean ? '연도는 숫자여야 합니다.' : 'Era year must be numeric.');
      return;
    }

    setSavingArtwork(true);
    try {
      const payload: AuthorArtworkUpdateRequest = {
        title: artworkTitleDraft.trim(),
        artist: artistDraft.trim(),
        era_year: eraYear,
        main_thema: mainThemaDraft.trim(),
        main_emotion: mainEmotionDraft.trim(),
        era: eraDraft.trim(),
      };
      await apiService.updateAuthorArtwork(artwork.id, payload);
      onNotify(isKorean ? '작품 정보를 저장했습니다.' : 'Saved artwork metadata.');
      await onRefresh();
      setEditingArtwork(false);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : (isKorean ? '작품 저장에 실패했습니다.' : 'Failed to save artwork.'));
    } finally {
      setSavingArtwork(false);
    }
  }, [artistDraft, artwork.id, artworkTitleDraft, eraDraft, eraYearDraft, isKorean, mainEmotionDraft, mainThemaDraft, onNotify, onRefresh]);

  const handleDeleteArtwork = useCallback(async () => {
    const confirmed = window.confirm(
      isKorean
        ? `"${artwork.title ?? `작품 ${artwork.id}`}"을(를) 삭제할까요?\n\n이 작업은 작품 이미지, framed GLB, 스토리, TTS를 모두 제거합니다.`
        : `Delete "${artwork.title ?? `Artwork ${artwork.id}`}"?\n\nThis removes the image, framed GLB, stories, and TTS assets.`
    );
    if (!confirmed) return;

    setDeletingArtwork(true);
    try {
      await apiService.deleteAuthorArtwork(artwork.id);
      onNotify(isKorean ? '작품을 삭제했습니다.' : 'Deleted the artwork.');
      onDeleted(artwork.id);
      await onRefresh();
    } catch (error) {
      onNotify(error instanceof Error ? error.message : (isKorean ? '작품 삭제에 실패했습니다.' : 'Failed to delete the artwork.'));
    } finally {
      setDeletingArtwork(false);
    }
  }, [artwork.id, artwork.title, isKorean, onDeleted, onNotify, onRefresh]);

  const handleSetRepresentative = useCallback(async (version: StorytellingVersion) => {
    if (version.status !== 'published') {
      onNotify(isKorean ? '대표본은 published 상태의 버전만 지정할 수 있습니다.' : 'Only published versions can be designated as representative.');
      return;
    }
    setRepresentativeSaving(true);
    try {
      await apiService.updateStorytellingCurrentVersion(artwork.id, { versionId: version.id });
      onNotify(isKorean ? '대표본을 지정했습니다.' : 'Representative version updated.');
      await onRefresh();
      setSelectedVersionId(version.id);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : (isKorean ? '대표본 지정에 실패했습니다.' : 'Failed to update representative version.'));
    } finally {
      setRepresentativeSaving(false);
    }
  }, [artwork.id, isKorean, onNotify, onRefresh]);

  const handleGenerateTts = useCallback(async (version: StorytellingVersion) => {
    if (version.status !== 'published') {
      onNotify(isKorean ? 'published 상태의 버전만 TTS를 생성할 수 있습니다.' : 'TTS can only be generated for published versions.');
      return;
    }
    setTtsGeneratingVersionId(version.id);
    try {
      await apiService.generateStorytellingTts(version.id, {});
      onNotify(isKorean ? 'TTS를 생성했습니다.' : 'Generated TTS.');
      await onRefresh();
    } catch (error) {
      onNotify(error instanceof Error ? error.message : (isKorean ? 'TTS 생성에 실패했습니다.' : 'Failed to generate TTS.'));
    } finally {
      setTtsGeneratingVersionId(null);
    }
  }, [isKorean, onNotify, onRefresh]);

  const handleDeleteVersion = useCallback(async (version: StorytellingVersion) => {
    const confirmed = window.confirm(
      isKorean
        ? `"${version.storyTitle}" 버전을 삭제할까요?\n\nTTS도 함께 제거됩니다.`
        : `Delete "${version.storyTitle}"?\n\nThe TTS asset will also be removed.`
    );
    if (!confirmed) return;

    setDeletingVersionId(version.id);
    try {
      await apiService.deleteStorytellingVersion(version.id);
      onNotify(isKorean ? '스토리 버전을 삭제했습니다.' : 'Deleted the story version.');
      await onRefresh();
      if (selectedVersion?.id === version.id) {
        setSelectedVersionId(null);
      }
    } catch (error) {
      onNotify(error instanceof Error ? error.message : (isKorean ? '스토리 버전 삭제에 실패했습니다.' : 'Failed to delete the story version.'));
    } finally {
      setDeletingVersionId(null);
    }
  }, [isKorean, onNotify, onRefresh, selectedVersion?.id]);

  const handleUseRepresentativeText = useCallback(() => {
    if (!representativeVersion) {
      onNotify(isKorean ? '대표본이 없습니다.' : 'No representative version yet.');
      return;
    }
    setStoryTitleDraft(representativeVersion.storyTitle);
    setStoryTextDraft(representativeVersion.storyText);
    setSelectedVersionId(representativeVersion.id);
  }, [isKorean, onNotify, representativeVersion]);

  return (
    <div className="space-y-4">
      <div className="rounded-[28px] border border-white/10 bg-[#1b1812]/72 p-5 shadow-[0_20px_70px_rgba(0,0,0,0.22)] backdrop-blur-xl">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#7f9b5a]">{isKorean ? '보유 작품 관리' : 'Owned artwork management'}</p>
            <h3 className="mt-2 break-words font-display text-[1.7rem] font-normal leading-tight tracking-normal text-[#f4efe7] sm:text-[1.9rem]">{artwork.title ?? `작품 ${artwork.id}`}</h3>
            <p className="mt-2 break-words font-sans text-sm font-light leading-relaxed text-[#d8cbbb]">
              {artwork.artist ?? '작가 정보 없음'} · {artwork.era} · {artwork.eraYear}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setEditingArtwork((current) => !current)}
              className="rounded-full border border-white/10 bg-[#1b1812]/72 px-4 py-2 text-sm text-[#f4efe7] transition hover:bg-[#5b2c20]/28"
            >
              {editingArtwork ? (isKorean ? '편집 닫기' : 'Close editor') : (isKorean ? '작품 수정' : 'Edit artwork')}
            </button>
            <button
              type="button"
              onClick={handleDeleteArtwork}
              disabled={deletingArtwork}
              className="rounded-full border border-[#b57d69]/20 bg-[#5b2c20]/18 px-4 py-2 text-sm text-[#f0d7cf] transition hover:bg-[#5b2c20]/28 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {deletingArtwork ? (isKorean ? '삭제 중...' : 'Deleting...') : (isKorean ? '작품 삭제' : 'Delete artwork')}
            </button>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-2xl border border-white/10 bg-[#14130c]/72 p-4">
            <p className="font-sans text-[10px] uppercase tracking-[0.18em] text-[#b29e8d]">{isKorean ? '버전' : 'Versions'}</p>
            <p className="mt-2 font-display text-[2rem] font-normal leading-none text-[#f4efe7]">{formatCount(versions.length)}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-[#14130c]/72 p-4">
            <p className="font-sans text-[10px] uppercase tracking-[0.18em] text-[#b29e8d]">{isKorean ? 'TTS' : 'TTS'}</p>
            <p className="mt-2 font-display text-[2rem] font-normal leading-none text-[#f4efe7]">{formatCount(artwork.ttsAssets.length)}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-[#14130c]/72 p-4 sm:col-span-2 lg:col-span-1">
            <p className="font-sans text-[10px] uppercase tracking-[0.18em] text-[#b29e8d]">{isKorean ? '출처' : 'Source'}</p>
            <p className="mt-2 break-words font-sans text-[0.98rem] font-medium leading-relaxed text-[#f4efe7]">
              {formatArtworkSourceDetail(artwork)}
            </p>
          </div>
        </div>

        {editingArtwork ? (
          <div className="mt-4 grid gap-3">
            <div className="grid gap-3 md:grid-cols-2">
              <label className="block space-y-1">
                <span className="text-[11px] uppercase tracking-[0.22em] text-[#b29e8d]">{isKorean ? '작품명' : 'Title'}</span>
                <input
                  value={artworkTitleDraft}
                  onChange={(event) => setArtworkTitleDraft(event.target.value)}
                  className="w-full rounded-2xl border border-white/10 bg-[#14130c]/72 px-3 py-3 text-sm text-[#f4efe7] outline-none transition focus:border-[#7f9b5a]/40"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-[11px] uppercase tracking-[0.22em] text-[#b29e8d]">{isKorean ? '작가명' : 'Artist'}</span>
                <input
                  value={artistDraft}
                  onChange={(event) => setArtistDraft(event.target.value)}
                  className="w-full rounded-2xl border border-white/10 bg-[#14130c]/72 px-3 py-3 text-sm text-[#f4efe7] outline-none transition focus:border-[#7f9b5a]/40"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-[11px] uppercase tracking-[0.22em] text-[#b29e8d]">{isKorean ? '연도' : 'Era year'}</span>
                <input
                  type="number"
                  value={eraYearDraft}
                  onChange={(event) => setEraYearDraft(event.target.value)}
                  className="w-full rounded-2xl border border-white/10 bg-[#14130c]/72 px-3 py-3 text-sm text-[#f4efe7] outline-none transition focus:border-[#7f9b5a]/40"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-[11px] uppercase tracking-[0.22em] text-[#b29e8d]">{isKorean ? '시대' : 'Era'}</span>
                <input
                  value={eraDraft}
                  onChange={(event) => setEraDraft(event.target.value)}
                  className="w-full rounded-2xl border border-white/10 bg-[#14130c]/72 px-3 py-3 text-sm text-[#f4efe7] outline-none transition focus:border-[#7f9b5a]/40"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-[11px] uppercase tracking-[0.22em] text-[#b29e8d]">{isKorean ? '주제' : 'Theme'}</span>
                <input
                  value={mainThemaDraft}
                  onChange={(event) => setMainThemaDraft(event.target.value)}
                  className="w-full rounded-2xl border border-white/10 bg-[#14130c]/72 px-3 py-3 text-sm text-[#f4efe7] outline-none transition focus:border-[#7f9b5a]/40"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-[11px] uppercase tracking-[0.22em] text-[#b29e8d]">{isKorean ? '감정' : 'Emotion'}</span>
                <input
                  value={mainEmotionDraft}
                  onChange={(event) => setMainEmotionDraft(event.target.value)}
                  className="w-full rounded-2xl border border-white/10 bg-[#14130c]/72 px-3 py-3 text-sm text-[#f4efe7] outline-none transition focus:border-[#7f9b5a]/40"
                />
              </label>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void handleSaveArtwork()}
                disabled={savingArtwork}
                className="rounded-full border border-[#7f9b5a]/20 bg-[#7f9b5a]/10 px-4 py-2 text-sm font-medium text-[#e8f0d5] transition hover:bg-[#7f9b5a]/16 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {savingArtwork ? (isKorean ? '저장 중...' : 'Saving...') : (isKorean ? '작품 정보 저장' : 'Save artwork')}
              </button>
              <button
                type="button"
                onClick={() => setEditingArtwork(false)}
                className="rounded-full border border-white/10 bg-[#1b1812]/72 px-4 py-2 text-sm text-[#f4efe7] transition hover:bg-[#5b2c20]/28"
              >
                {isKorean ? '취소' : 'Cancel'}
              </button>
            </div>
          </div>
        ) : null}

        <div className="rounded-[28px] border border-white/10 bg-[#1b1812]/72 p-5 shadow-[0_20px_70px_rgba(0,0,0,0.22)] backdrop-blur-xl">
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#7f9b5a]">{isKorean ? '현재 대표본' : 'Current representative'}</p>
          {representativeVersion ? (
            <div className="mt-3 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-[#7f9b5a]/28 bg-[#7f9b5a]/14 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#e8f0d5]">
                  {isKorean ? '대표본' : 'Representative'}
                </span>
                <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] ${statusStyle(representativeVersion.status)}`}>
                  {formatStatusLabel(representativeVersion.status)}
                </span>
              </div>
              <h3 className="text-xl font-semibold text-[#f4efe7]">{representativeVersion.storyTitle}</h3>
              <p className="text-xs text-[#b29e8d]">
                v{representativeVersion.versionNumber} · {formatDateTime(representativeVersion.createdAt)}
              </p>
              <p className="whitespace-pre-wrap text-sm leading-6 text-[#f4efe7]">
                {representativeVersion.storyText}
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleUseRepresentativeText}
                  className="rounded-full border border-white/10 bg-[#1b1812]/72 px-3 py-1.5 text-xs text-[#f4efe7] transition hover:bg-[#5b2c20]/28"
                >
                  {isKorean ? '대표본 텍스트 가져오기' : 'Load representative text'}
                </button>
                {representativeTtsAsset ? (
                  <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] ${statusStyle(representativeTtsAsset.status)}`}>
                    TTS {formatStatusLabel(representativeTtsAsset.status)}
                  </span>
                ) : null}
              </div>
            </div>
          ) : (
            <p className="mt-3 text-sm text-[#d8cbbb]">
              {isKorean ? '아직 대표본이 없습니다. 아래 버전 중 하나를 설명용으로 지정하세요.' : 'No representative version yet. Pick one below.'}
            </p>
          )}
        </div>

        <div className="rounded-[28px] border border-white/10 bg-[#1b1812]/72 p-5 shadow-[0_20px_70px_rgba(0,0,0,0.22)] backdrop-blur-xl">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#7f9b5a]">{isKorean ? '스토리텔링 생성' : 'Storytelling composer'}</p>
              <h3 className="mt-2 text-xl font-semibold text-[#f4efe7]">{isKorean ? '새 버전 생성' : 'Create a new version'}</h3>
            </div>
            <button
              type="button"
              onClick={handleGenerateStory}
              disabled={generatingStory}
              className="rounded-full border border-[#7f9b5a]/20 bg-[#7f9b5a]/10 px-4 py-2 text-sm font-medium text-[#e8f0d5] transition hover:bg-[#7f9b5a]/16 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {generatingStory ? (isKorean ? '생성 중...' : 'Generating...') : (isKorean ? '스토리텔링 생성' : 'Generate storytelling')}
            </button>
          </div>

          <div className="mt-4 grid gap-3">
            <label className="block space-y-1">
              <span className="text-[11px] uppercase tracking-[0.22em] text-[#b29e8d]">{isKorean ? '배치 이름' : 'Batch name'}</span>
              <input
                value={batchNameDraft}
                onChange={(event) => setBatchNameDraft(event.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-[#14130c]/72 px-3 py-3 text-sm text-[#f4efe7] outline-none transition placeholder:text-[#b29e8d] focus:border-[#7f9b5a]/40"
                placeholder={isKorean ? '예: 봄 시즌 스토리텔링' : 'e.g. Spring storytelling batch'}
              />
            </label>
            <label className="block space-y-1">
              <span className="text-[11px] uppercase tracking-[0.22em] text-[#b29e8d]">{isKorean ? '공통 지시사항' : 'Global note'}</span>
              <textarea
                value={globalNoteDraft}
                onChange={(event) => setGlobalNoteDraft(event.target.value)}
                rows={3}
                className="w-full rounded-2xl border border-white/10 bg-[#14130c]/72 px-3 py-3 text-sm text-[#f4efe7] outline-none transition placeholder:text-[#b29e8d] focus:border-[#7f9b5a]/40"
                placeholder={isKorean ? '모든 작품에 공통으로 적용할 지시사항을 입력하세요.' : 'Shared instructions for all generated stories.'}
              />
            </label>
            <label className="block space-y-1">
              <span className="text-[11px] uppercase tracking-[0.22em] text-[#b29e8d]">{isKorean ? '작품 전용 요청' : 'Artwork-specific note'}</span>
              <textarea
                value={artworkNoteDraft}
                onChange={(event) => setArtworkNoteDraft(event.target.value)}
                rows={3}
                className="w-full rounded-2xl border border-white/10 bg-[#14130c]/72 px-3 py-3 text-sm text-[#f4efe7] outline-none transition placeholder:text-[#b29e8d] focus:border-[#7f9b5a]/40"
                placeholder={isKorean ? '이 작품에만 적용할 추가 요청을 입력하세요.' : 'Extra guidance for this specific artwork.'}
              />
            </label>
          </div>
        </div>

      </div>

      <div className="space-y-4">
        <div className="rounded-[28px] border border-white/10 bg-[#18160f]/82 p-5 shadow-[0_20px_70px_rgba(0,0,0,0.22)] backdrop-blur-xl">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#7f9b5a]">{isKorean ? '선택된 버전' : 'Selected version'}</p>
              <h3 className="mt-2 text-xl font-semibold text-[#f4efe7]">
                {selectedVersion ? selectedVersion.storyTitle : (isKorean ? '버전을 선택하세요' : 'Select a version')}
              </h3>
              {selectedVersion ? (
                <p className="mt-1 text-xs text-[#b29e8d]">
                  v{selectedVersion.versionNumber} · {formatDateTime(selectedVersion.createdAt)} · {selectedVersion.id}
                </p>
              ) : null}
            </div>
            {selectedVersion ? (
              <span className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] ${statusStyle(selectedVersion.status)}`}>
                {formatStatusLabel(selectedVersion.status)}
              </span>
            ) : null}
          </div>

          {selectedVersion ? (
            <>
              <div className="mt-4 grid gap-3">
                <label className="block space-y-1">
                  <span className="text-[11px] uppercase tracking-[0.22em] text-[#b29e8d]">{isKorean ? '제목' : 'Title'}</span>
                  <input
                    value={storyTitleDraft}
                    onChange={(event) => setStoryTitleDraft(event.target.value)}
                    className="w-full rounded-2xl border border-white/10 bg-[#14130c]/72 px-3 py-3 text-sm text-[#f4efe7] outline-none transition placeholder:text-[#b29e8d] focus:border-[#7f9b5a]/40"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-[11px] uppercase tracking-[0.22em] text-[#b29e8d]">{isKorean ? '본문' : 'Story text'}</span>
                  <textarea
                    value={storyTextDraft}
                    onChange={(event) => setStoryTextDraft(event.target.value)}
                    rows={12}
                    className="w-full rounded-2xl border border-white/10 bg-[#14130c]/72 px-3 py-3 text-sm leading-6 text-[#f4efe7] outline-none transition placeholder:text-[#b29e8d] focus:border-[#7f9b5a]/40"
                  />
                </label>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleSaveVersion}
                  disabled={savingVersionId === selectedVersion.id}
                  className="rounded-full border border-[#7f9b5a]/20 bg-[#7f9b5a]/10 px-4 py-2 text-sm font-medium text-[#e8f0d5] transition hover:bg-[#7f9b5a]/16 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {savingVersionId === selectedVersion.id ? (isKorean ? '저장 중...' : 'Saving...') : (isKorean ? '설명 저장' : 'Save description')}
                </button>
                <button
                  type="button"
                  onClick={() => handleSetRepresentative(selectedVersion)}
                  disabled={selectedVersion.status !== 'published' || representativeSaving}
                  className="rounded-full border border-white/10 bg-[#1b1812]/72 px-4 py-2 text-sm font-medium text-[#f4efe7] transition hover:bg-[#5b2c20]/28 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {representativeSaving ? (isKorean ? '지정 중...' : 'Updating...') : (isKorean ? '작품 설명용으로 지정' : 'Set as representative')}
                </button>
                <button
                  type="button"
                  onClick={() => handleGenerateTts(selectedVersion)}
                  disabled={selectedVersion.status !== 'published' || ttsGeneratingVersionId === selectedVersion.id}
                  className="rounded-full border border-[#b57d69]/20 bg-[#5b2c20]/18 px-4 py-2 text-sm font-medium text-[#f0d7cf] transition hover:bg-[#5b2c20]/28 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {ttsGeneratingVersionId === selectedVersion.id ? (isKorean ? 'TTS 생성 중...' : 'Generating TTS...') : (isKorean ? 'TTS 생성' : 'Generate TTS')}
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteVersion(selectedVersion)}
                  disabled={deletingVersionId === selectedVersion.id}
                  className="rounded-full border border-[#b57d69]/20 bg-[#5b2c20]/18 px-4 py-2 text-sm font-medium text-[#f0d7cf] transition hover:bg-[#5b2c20]/28 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {deletingVersionId === selectedVersion.id ? (isKorean ? '삭제 중...' : 'Deleting...') : (isKorean ? '버전 삭제' : 'Delete version')}
                </button>
              </div>
              {selectedVersion.status !== 'published' ? (
                <p className="mt-3 text-xs text-[#b29e8d]">
                  {isKorean ? '대표본 지정과 TTS 생성은 published 상태에서만 가능합니다.' : 'Representative selection and TTS generation require published status.'}
                </p>
              ) : null}
              {selectedVersionTtsAsset ? (
                <div className="mt-4 rounded-2xl border border-white/10 bg-[#14130c]/72 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-[#f4efe7]">{selectedVersionTtsAsset.providerName}</p>
                      <p className="mt-1 text-xs text-[#d8cbbb]">
                        {selectedVersionTtsAsset.modelName} · {selectedVersionTtsAsset.voiceId} · {selectedVersionTtsAsset.languageBoost}
                      </p>
                    </div>
                    <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] ${statusStyle(selectedVersionTtsAsset.status)}`}>
                      {formatStatusLabel(selectedVersionTtsAsset.status)}
                    </span>
                  </div>
                  <div className="mt-3 grid gap-2 text-xs text-[#d8cbbb] sm:grid-cols-2">
                    <div>{isKorean ? '생성' : 'Created'} {formatDateTime(selectedVersionTtsAsset.createdAt)}</div>
                    <div>{isKorean ? '수정' : 'Updated'} {formatDateTime(selectedVersionTtsAsset.updatedAt)}</div>
                    <div>{isKorean ? '형식' : 'Format'} {selectedVersionTtsAsset.outputFormat}</div>
                    <div>{isKorean ? '길이' : 'Length'} {selectedVersionTtsAsset.audioLength ?? 'n/a'} ms</div>
                  </div>
                  {selectedVersionTtsAsset.audioUrl ? (
                    <div className="mt-4 space-y-3">
                      <audio controls src={selectedVersionTtsAsset.audioUrl} className="w-full" />
                      <a
                        href={selectedVersionTtsAsset.audioUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex rounded-full border border-white/10 bg-[#1b1812]/72 px-3 py-1.5 text-xs text-[#f4efe7] transition hover:bg-[#5b2c20]/28"
                      >
                        {isKorean ? '오디오 열기' : 'Open audio'}
                      </a>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : (
            <div className="mt-4 rounded-2xl border border-dashed border-white/10 bg-[#14130c]/72 p-6 text-sm text-[#d8cbbb]">
              {isKorean ? '선택된 버전이 없습니다. 왼쪽 목록에서 버전을 선택하세요.' : 'No version selected. Pick one from the list.'}
            </div>
          )}
        </div>

        <div className="rounded-[28px] border border-white/10 bg-[#1b1812]/72 p-5 shadow-[0_20px_70px_rgba(0,0,0,0.22)] backdrop-blur-xl">
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#7f9b5a]">{isKorean ? '스토리 버전 목록' : 'Story version list'}</p>
          <p className="mt-1 text-sm text-[#d8cbbb]">
            {isKorean ? '카드를 클릭하거나 드래그하면 상세 조회 버전이 바뀝니다. 순서 재정렬은 하지 않습니다.' : 'Click or drag to switch the active version. No reordering.'}
          </p>
          <div className="mt-4 space-y-3">
            {versions.length > 0 ? (
              versions.map((version) => (
                <StoryVersionItem
                  key={version.id}
                  version={version}
                  isActive={selectedVersion?.id === version.id}
                  isRepresentative={Boolean(version.isCurrentRepresentative)}
                  ttsAsset={artwork.ttsAssets.find((asset) => asset.storytellingVersionId === version.id) ?? null}
                  onSelect={handleSelectVersion}
                  onSetRepresentative={handleSetRepresentative}
                  onGenerateTts={handleGenerateTts}
                  onDelete={handleDeleteVersion}
                  onDragStart={handleDragStart}
                />
              ))
            ) : (
              <div className="rounded-2xl border border-dashed border-white/10 bg-[#14130c]/72 p-5 text-sm text-[#d8cbbb]">
                {isKorean ? '아직 생성된 Storytelling 버전이 없습니다.' : 'No storytelling versions yet.'}
              </div>
            )}
          </div>
        </div>

        <div className="rounded-[28px] border border-white/10 bg-[#1b1812]/72 p-5 shadow-[0_20px_70px_rgba(0,0,0,0.22)] backdrop-blur-xl">
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#7f9b5a]">{isKorean ? 'TTS 자산' : 'TTS assets'}</p>
          <div className="mt-4 space-y-3">
            {artwork.ttsAssets.length > 0 ? (
              artwork.ttsAssets.map((asset) => {
                const version = versions.find((item) => item.id === asset.storytellingVersionId) ?? null;
                return (
                  <div key={asset.id} className="rounded-2xl border border-white/10 bg-[#14130c]/72 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-[#f4efe7]">
                          {version ? version.storyTitle : `#${asset.storytellingVersionId}`}
                        </p>
                        <p className="mt-1 text-xs text-[#d8cbbb]">
                          {asset.providerName} · {asset.modelName} · {asset.voiceId}
                        </p>
                      </div>
                      <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] ${statusStyle(asset.status)}`}>
                        {formatStatusLabel(asset.status)}
                      </span>
                    </div>
                    <p className="mt-3 text-xs text-[#b29e8d]">
                      {isKorean ? '오디오 길이' : 'Length'} {asset.audioLength ?? 'n/a'} ms · {formatDateTime(asset.createdAt)}
                    </p>
                    {asset.audioUrl ? (
                      <audio controls src={asset.audioUrl} className="mt-3 w-full" />
                    ) : null}
                  </div>
                );
              })
            ) : (
              <div className="rounded-2xl border border-dashed border-white/10 bg-[#14130c]/72 p-5 text-sm text-[#d8cbbb]">
                {isKorean ? '아직 생성된 TTS가 없습니다.' : 'No TTS assets yet.'}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const ProjectRow = ({
  space,
  onOpen,
  onEdit,
  onResume,
  onPublish,
  onDelete,
}: {
  space: CuratorWorkspaceSpace;
  onOpen: (space: CuratorWorkspaceSpace) => void;
  onEdit: (space: CuratorWorkspaceSpace) => void;
  onResume: (space: CuratorWorkspaceSpace) => void;
  onPublish: (space: CuratorWorkspaceSpace) => void;
  onDelete: (space: CuratorWorkspaceSpace) => void;
}) => {
  const publicProfile = space.publicProfile;
  const thumbnail = publicProfile?.thumbnailImagePath ?? null;
  const subtitle = publicProfile?.locationSummary ?? space.description ?? '설명이 없습니다';
  const lastUpdated = formatDateTime(space.updatedAt);
  const latestPreset = space.presets[0] ?? null;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onEdit(space)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onEdit(space);
        }
      }}
      className="group flex w-full items-center gap-3 rounded-[24px] border border-white/10 bg-[#1b1812]/72 px-3 py-3 text-left transition hover:border-[#7f9b5a]/24 hover:bg-[#5b2c20]/30"
    >
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-[#14130c]/72 text-[#e8f0d5]">
        {publicProfile ? '◫' : '□'}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-sm font-semibold text-[#f4efe7]">{space.name}</p>
          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] ${statusStyle(space.status)}`}>
            {formatStatusLabel(space.status)}
          </span>
        </div>
        <p className="mt-1 truncate text-xs text-[#d8cbbb]">{subtitle}</p>
        <p className="mt-1 text-[11px] text-[#b29e8d]">
          수정 {lastUpdated} · 슬롯 {space.slotCount}개 · 버전 {space.versions.length}개
        </p>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onOpen(space);
          }}
          className="rounded-full border border-white/10 bg-[#1b1812]/72 px-3 py-1.5 text-[11px] text-[#f4efe7] transition hover:bg-[#5b2c20]/28"
        >
          열기
        </button>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onResume(space);
          }}
          className="rounded-full border border-[#7f9b5a]/20 bg-[#7f9b5a]/10 px-3 py-1.5 text-[11px] text-[#e8f0d5] transition hover:bg-[#7f9b5a]/15"
        >
          이어서 작업
        </button>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onPublish(space);
          }}
          className="rounded-full border border-[#d8cbbb]/20 bg-[#1b1812]/72 px-3 py-1.5 text-[11px] text-[#d8cbbb] transition hover:bg-[#5b2c20]/28 hover:border-[#7f9b5a]/28"
        >
          {publicProfile ? '공개 관리' : '라이브러리로 공개'}
        </button>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onDelete(space);
          }}
          className="rounded-full border border-[#b57d69]/20 bg-[#5b2c20]/18 px-3 py-1.5 text-[11px] text-[#f0d7cf] transition hover:bg-[#5b2c20]/28"
        >
          삭제
        </button>
      </div>
      {thumbnail ? (
        <div className="hidden h-12 w-16 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-[#14130c]/90 md:block">
          <img src={thumbnail} alt="" className="h-full w-full object-cover" />
        </div>
      ) : null}
      {latestPreset ? (
        <div className="hidden min-w-[84px] rounded-xl border border-white/10 bg-[#14130c]/72 px-2 py-1 text-[10px] text-[#d8cbbb] md:block">
          <div className="uppercase tracking-[0.16em] text-[#b29e8d]">최신</div>
          <div className="mt-0.5 truncate text-[#f4efe7]">{latestPreset.presetName}</div>
        </div>
      ) : null}
    </div>
  );
};

const SavedLayoutRow = ({
  preset,
  onEdit,
  onDelete,
  onResume,
}: {
  preset: RoomMergePresetResponse;
  onEdit: (preset: RoomMergePresetResponse) => void;
  onDelete: (preset: RoomMergePresetResponse) => void;
  onResume: (preset: RoomMergePresetResponse) => void;
}) => (
  <div className="rounded-[24px] border border-white/10 bg-[#1b1812]/72 p-4 transition hover:border-[#7f9b5a]/20 hover:bg-[#5b2c20]/22">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-[#f4efe7]">{preset.presetName}</p>
        <p className="mt-1 text-xs text-[#d8cbbb]">
          {preset.memo || '설명 없음'} · {formatDateTime(preset.updatedAt)}
        </p>
        <p className="mt-1 text-[11px] text-[#b29e8d]">
          공간 {preset.spaceId ?? '연결 안 됨'} · 세션 {preset.sessionId}
        </p>
      </div>
      <span className="rounded-full border border-[#7f9b5a]/24 bg-[#7f9b5a]/12 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#e8f0d5]">
        저장됨
      </span>
    </div>
    <div className="mt-3 flex flex-wrap gap-2">
      <button
        type="button"
        onClick={() => onEdit(preset)}
        className="rounded-full border border-white/10 bg-[#1b1812]/72 px-3 py-1.5 text-[11px] text-[#f4efe7] transition hover:bg-[#5b2c20]/30"
      >
        편집
      </button>
      <button
        type="button"
        onClick={() => onResume(preset)}
        className="rounded-full border border-[#7f9b5a]/24 bg-[#7f9b5a]/12 px-3 py-1.5 text-[11px] text-[#e8f0d5] transition hover:bg-[#7f9b5a]/18"
      >
        불러오기
      </button>
      <button
        type="button"
        onClick={() => onDelete(preset)}
        className="rounded-full border border-[#b57d69]/24 bg-[#5b2c20]/18 px-3 py-1.5 text-[11px] text-[#f0d7cf] transition hover:bg-[#5b2c20]/28"
      >
        삭제
      </button>
    </div>
  </div>
);

const ProjectEditorDrawer = ({
  open,
  mode,
  selectedSpace,
  nameDraft,
  descriptionDraft,
  saving,
  error,
  onClose,
  onNameChange,
  onDescriptionChange,
  onSave,
  onCreateNew,
  onOpenSpaceManagement,
  onOpenArtworkPipeline,
  onOpenExperiment,
}: {
  open: boolean;
  mode: 'create' | 'edit';
  selectedSpace: CuratorWorkspaceSpace | null;
  nameDraft: string;
  descriptionDraft: string;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onNameChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onSave: () => void;
  onCreateNew: () => void;
  onOpenSpaceManagement: () => void;
  onOpenArtworkPipeline: () => void;
  onOpenExperiment: () => void;
}) => {
  const { locale } = useUiLocale();
  const isKorean = locale === 'ko';
  const drawerCopy = {
    projectEditorHeader: isKorean ? '프로젝트 편집기' : 'Project editor',
    projectEditorTitle: mode === 'create'
      ? (isKorean ? '공간 프로젝트 생성/편집' : 'Create or edit space project')
      : (isKorean ? '공간 프로젝트 편집' : 'Edit space project'),
    projectEditorEmpty: isKorean
      ? '새 공간 프로젝트를 만들거나 선택된 공간을 편집하세요.'
      : 'Create a new space project or edit the selected space.',
    close: isKorean ? '닫기' : 'Close',
    projectNameLabel: isKorean ? '프로젝트 이름' : 'Project name',
    projectNamePlaceholder: isKorean ? '임시 이름 입력' : 'Enter a temporary name',
    descriptionLabel: isKorean ? '설명' : 'Description',
    descriptionPlaceholder: isKorean ? '공간에 대한 자세한 설명을 입력하세요...' : 'Enter detailed information about this space...',
    saveButton: isKorean ? '저장 중...' : 'Saving...',
    saveProject: isKorean ? '프로젝트 저장' : 'Save project',
    createProject: isKorean ? '프로젝트 생성' : 'Create project',
    newDraft: isKorean ? '새 초안' : 'New draft',
    areaLabel: isKorean ? '구역' : 'Area',
    area1Title: isKorean ? '구역 1' : 'Area 1',
    area1Subtitle: isKorean ? '공간 업로드' : 'Space upload',
    area2Title: isKorean ? '구역 2' : 'Area 2',
    area2Subtitle: isKorean ? '3D 작품 업로드' : '3D artwork upload',
    area3Title: isKorean ? '구역 3' : 'Area 3',
    area3Subtitle: isKorean ? '공간 재배치' : 'Space rearrangement',
    open: isKorean ? '열기' : 'Open',
  } as const;
  const projectLabel = mode === 'create' ? '공간 프로젝트 생성/편집' : '공간 프로젝트 편집';
  const spaceStatus = selectedSpace?.status ?? 'draft';
  const sectorCards = [
    {
      title: drawerCopy.area1Title,
      subtitle: drawerCopy.area1Subtitle,
      action: onOpenSpaceManagement,
      tone: 'border-[#7f9b5a]/24 bg-[#7f9b5a]/12 text-[#e8f0d5]',
    },
    {
      title: drawerCopy.area2Title,
      subtitle: drawerCopy.area2Subtitle,
      action: onOpenArtworkPipeline,
      tone: 'border-[#8c6745]/24 bg-[#8c6745]/12 text-[#f4efe7]',
    },
    {
      title: drawerCopy.area3Title,
      subtitle: drawerCopy.area3Subtitle,
      action: onOpenExperiment,
      tone: 'border-[#2f3d20]/24 bg-[#2f3d20]/28 text-[#e8f0d5]',
    },
  ] as const;

  return (
    <motion.div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[180] flex justify-center px-4 pb-4 pt-10 sm:px-6"
      initial={false}
      animate={{ opacity: open ? 1 : 0, y: open ? 0 : 18 }}
      style={{ pointerEvents: open ? 'auto' : 'none' }}
    >
      <div className="w-full max-w-[720px] overflow-hidden rounded-[34px] border border-white/15 bg-[#1b1812]/84 shadow-[0_35px_120px_rgba(0,0,0,0.65)] backdrop-blur-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-white/10 px-5 py-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-[#7f9b5a]">{drawerCopy.projectEditorHeader}</p>
            <h2 className="mt-2 text-2xl font-semibold text-[#f4efe7]">{projectLabel}</h2>
            <p className="mt-1 text-sm text-[#d8cbbb]">
              {selectedSpace ? `${selectedSpace.name} · ${formatStatusLabel(spaceStatus)}` : drawerCopy.projectEditorEmpty}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-white/10 bg-[#1b1812]/72 px-3 py-2 text-sm text-[#f4efe7] transition hover:bg-[#5b2c20]/28"
          >
            {drawerCopy.close}
          </button>
        </div>

        <div className="grid gap-0 md:grid-cols-[1fr_0.92fr]">
          <div className="border-b border-white/10 p-5 md:border-b-0 md:border-r">
            <div className="space-y-3">
              <label className="block space-y-1">
                <span className="text-[11px] uppercase tracking-[0.22em] text-[#b29e8d]">{drawerCopy.projectNameLabel}</span>
                <input
                  value={nameDraft}
                  onChange={(event) => onNameChange(event.target.value)}
                  className="w-full rounded-2xl border border-white/10 bg-[#14130c]/72 px-3 py-3 text-sm text-[#f4efe7] outline-none transition placeholder:text-[#b29e8d] focus:border-[#7f9b5a]/40"
                  placeholder={drawerCopy.projectNamePlaceholder}
                />
              </label>
              <label className="block space-y-1">
                <span className="text-[11px] uppercase tracking-[0.22em] text-[#b29e8d]">{drawerCopy.descriptionLabel}</span>
                <textarea
                  value={descriptionDraft}
                  onChange={(event) => onDescriptionChange(event.target.value)}
                  rows={4}
                  className="w-full rounded-2xl border border-white/10 bg-[#14130c]/72 px-3 py-3 text-sm text-[#f4efe7] outline-none transition placeholder:text-[#b29e8d] focus:border-[#7f9b5a]/40"
                  placeholder={drawerCopy.descriptionPlaceholder}
                />
              </label>
              {error ? (
                <div className="rounded-2xl border border-[#b57d69]/20 bg-[#5b2c20]/20 px-3 py-2 text-sm text-[#f0d7cf]">
                  {error}
                </div>
              ) : null}
              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  onClick={onSave}
                  disabled={saving}
                  className="rounded-full border border-[#7f9b5a]/20 bg-[#7f9b5a]/10 px-4 py-2 text-sm font-medium text-[#e8f0d5] transition hover:bg-[#7f9b5a]/15 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saving ? drawerCopy.saveButton : mode === 'create' ? drawerCopy.createProject : drawerCopy.saveProject}
                </button>
                <button
                  type="button"
                  onClick={onCreateNew}
                  className="rounded-full border border-white/10 bg-[#1b1812]/72 px-4 py-2 text-sm font-medium text-[#f4efe7] transition hover:bg-[#5b2c20]/28"
                >
                  {drawerCopy.newDraft}
                </button>
              </div>
            </div>
          </div>

          <div className="p-5">
            <div className="space-y-3">
              <div className="rounded-[24px] border border-white/10 bg-[#1b1812]/70 p-4">
                <p className="text-[11px] uppercase tracking-[0.22em] text-[#b29e8d]">{drawerCopy.areaLabel}</p>
                <div className="mt-3 space-y-3">
                  {sectorCards.map((sector, index) => (
                    <button
                      key={sector.title}
                      type="button"
                      onClick={sector.action}
                      className={`flex w-full items-center justify-between rounded-[22px] border border-white/10 bg-[#14130c]/72 px-4 py-3 text-left transition hover:border-[#7f9b5a]/24 hover:bg-[#5b2c20]/28 ${index === 0 ? 'mt-0' : ''}`}
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-[#f4efe7]">{sector.title}</p>
                        <p className="mt-1 text-xs text-[#d8cbbb]">{sector.subtitle}</p>
                      </div>
                      <div className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] ${sector.tone}`}>
                        {drawerCopy.open}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
};

const CuratorWorkspacePage = ({ workspaceRoleHint = null }: CuratorWorkspacePageProps) => {
  const { locale } = useUiLocale();
  const isKorean = locale === 'ko';
  const workspaceCopy = useMemo(
    () => ({
      eyebrow: isKorean ? '큐레이터 작업공간' : 'Curator Workspace',
      title: isKorean ? '큐레이터 작업공간' : 'Curator Workspace',
      description: isKorean
        ? '본인이 만든 공간 프로젝트와 저장된 레이아웃을 한 화면에서 관리하는 소유자 대시보드입니다.'
        : 'Manage your own space projects and saved layouts in one place.',
      loading: isKorean ? '큐레이터 작업공간을 불러오는 중입니다...' : 'Loading curator workspace...',
      loadingLabel: isKorean ? '불러오는 중' : 'Loading',
      roleLabel: isKorean ? '역할' : 'Role',
      ownerLoadingLabel: isKorean ? '불러오는 중' : 'Loading',
      currentProjectsTitle: isKorean ? '현재 프로젝트와 저장된 레이아웃' : 'Current projects and saved layouts',
      currentProjectsSubtitle: isKorean
        ? '프로필의 첫 화면은 큐레이터가 자주 여는 프로젝트 목록과 experiment 진입점이다.'
        : 'This first screen is the curator’s project list and entry point into experiments.',
      emptyOwnedSpaces: isKorean ? '아직 소유한 공간이 없습니다.' : 'No owned spaces yet.',
      savedLayoutsTitle: isKorean ? '저장 레이아웃' : 'Saved layouts',
      savedLayoutsSubtitle: isKorean
        ? '구역 3에 저장된 배치 이름과 설명을 목록으로 관리합니다.'
        : 'Manage saved layout names and descriptions stored in zone 3.',
      emptySavedLayouts: isKorean ? '아직 저장된 레이아웃이 없습니다.' : 'No saved layouts yet.',
      historyTitle: isKorean ? '프로젝트 이력' : 'Project history',
      historySubtitle: isKorean
        ? '소유자 기준으로 저장된 스냅샷과 프리셋 이력을 확인합니다.'
        : 'Review saved snapshots and presets from the owner perspective.',
      emptySnapshots: isKorean ? '아직 스냅샷이 없습니다.' : 'No snapshots yet.',
      artworksTitle: isKorean ? '보유 작품' : 'Owned artworks',
      artworksSubtitle: isKorean
        ? '작품 기본정보, 현재 스토리, 버전 기록, TTS 생성 결과를 함께 보여줍니다.'
        : 'See artwork basics, current story, version history, and TTS outputs together.',
      emptyArtworks: isKorean ? '아직 보유한 작품이 없습니다.' : 'No owned artworks yet.',
      projectListLabel: isKorean ? '공간 프로젝트' : 'Space Projects',
      projectSectionTitle: isKorean ? '현재 프로젝트와 저장된 레이아웃' : 'Current projects and saved layouts',
      projectSectionSubtitle: isKorean
        ? '프로필의 첫 화면은 큐레이터가 자주 여는 프로젝트 목록과 experiment 진입점이다.'
        : 'This first screen is the curator’s project list and entry point into experiments.',
      projectEditorTitle: isKorean ? '공간 프로젝트 생성/편집' : 'Create or edit space project',
      projectEditorEmpty: isKorean ? '새 공간 프로젝트를 만들거나 선택된 공간을 편집하세요.' : 'Create a new space project or edit the selected space.',
      projectEditorHeader: isKorean ? '프로젝트 편집기' : 'Project editor',
      projectNameLabel: isKorean ? '프로젝트 이름' : 'Project name',
      projectNamePlaceholder: isKorean ? '임시 이름 입력' : 'Enter a temporary name',
      descriptionLabel: isKorean ? '설명' : 'Description',
      descriptionPlaceholder: isKorean ? '공간에 대한 자세한 설명을 입력하세요...' : 'Enter detailed information about this space...',
      saveButton: isKorean ? '저장 중...' : 'Saving...',
      saveProject: isKorean ? '프로젝트 저장' : 'Save project',
      createProject: isKorean ? '프로젝트 생성' : 'Create project',
      newDraft: isKorean ? '새 초안' : 'New draft',
      areaLabel: isKorean ? '구역' : 'Area',
      close: isKorean ? '닫기' : 'Close',
      projectListEmpty: isKorean ? '아직 소유한 공간이 없습니다.' : 'No owned spaces yet.',
      noSnapshotText: isKorean ? '아직 스냅샷이 없습니다.' : 'No snapshots yet.',
      noLayoutText: isKorean ? '아직 저장된 레이아웃이 없습니다.' : 'No saved layouts yet.',
      noArtworkText: isKorean ? '아직 보유한 작품이 없습니다.' : 'No owned artworks yet.',
      loadError: isKorean ? '큐레이터 작업공간을 불러오지 못했습니다.' : 'Unable to load curator workspace.',
      uploadEmpty: isKorean ? '아직 이 공간에 업로드된 GLB가 없습니다. 첫 자산을 업로드하면 공간 구성을 시작할 수 있습니다.' : 'No GLB files have been uploaded to this space yet. Upload the first asset to start building the space.',
      uploadLabel: isKorean ? 'GLB 업로드' : 'GLB Upload',
      uploadHint: isKorean ? '파일을 선택하면 즉시 업로드됩니다. 한 번에 최대 5개까지 선택할 수 있습니다.' : 'Choose files and they upload immediately. You can select up to 5 at once.',
      uploadSelected: isKorean ? '선택됨' : 'Selected',
      uploading: isKorean ? '업로드 중...' : 'Uploading...',
      uploadReady: isKorean ? '파일을 선택하면 즉시 업로드됩니다' : 'Files upload immediately after selection',
      spaceListLabel: isKorean ? '공간 목록' : 'Space list',
      spaceListTitle: isKorean ? '기존 공간을 선택하세요' : 'Select an existing space',
      spaceListSubtitle: isKorean
        ? '기존 공간은 여기서 관리합니다. 생성은 별도 패널에서만 처리해 이름이 편집 모드와 섞이지 않도록 했습니다.'
        : 'Manage existing spaces here. Creation stays in a separate panel so it never gets mixed with edit mode.',
      selectionHint: isKorean ? '공간을 선택하면 편집 작업 공간이 열립니다. 새 공간은 오른쪽 패널에서만 생성됩니다.' : 'Selecting a space opens the edit workspace. New spaces are created only in the right panel.',
      createPanelLabel: isKorean ? '공간 만들기' : 'Create space',
      createPanelTitle: isKorean ? '새 공간 초안' : 'New space draft',
      createPanelSubtitle: isKorean
        ? '이 폼은 항상 비어 있으며 선택된 공간과 완전히 분리됩니다.'
        : 'This form always starts empty and stays separate from the selected space.',
      reset: isKorean ? '초기화' : 'Reset',
      spaceNamePlaceholder: isKorean ? '공간 이름' : 'Space name',
      spaceDescriptionPlaceholder: isKorean ? '설명' : 'Description',
      createSpace: isKorean ? '공간 만들기' : 'Create space',
      creatingSpace: isKorean ? '생성 중...' : 'Creating...',
      createSpaceHint: isKorean
        ? '공간 이름은 소유자 기준으로 중복될 수 없습니다. 이 패널은 새 프로젝트 생성용이며 기존 공간 편집에는 사용하지 않습니다.'
        : 'Space names can duplicate only across owners. This panel is only for creating new projects, not editing existing ones.',
      selectedSpaceLabel: isKorean ? '선택된 공간' : 'Selected space',
      selectedSpaceEmpty: isKorean ? '선택된 공간이 없습니다.' : 'No space selected.',
      selectedSpaceEmptyHint: isKorean ? '구성요소와 발행 정보를 편집하려면 공간을 먼저 선택하세요.' : 'Select a space first to edit components and publish details.',
      editModeLabel: isKorean ? '작업 모드' : 'Edit mode',
      existingEditLabel: isKorean ? '기존 공간 편집' : 'Edit existing space',
      separateCreateLabel: isKorean ? '생성 패널 분리' : 'Separate create panel',
      statusLabel: isKorean ? '상태' : 'Status',
      saveChanges: isKorean ? '변경사항 저장' : 'Save changes',
      publishingSpace: isKorean ? '발행 중...' : 'Publishing...',
      publishSpace: isKorean ? '라이브러리에 공개' : 'Publish space',
      componentSectionLabel: isKorean ? '구성요소' : 'Components',
      componentSectionHelp: isKorean
        ? '각 구성요소는 정규화된 변환값을 보관하므로 조립된 공간을 그대로 복원할 수 있습니다.'
        : 'Each component stores normalized transforms so the assembled space can be restored exactly.',
      addComponent: isKorean ? '구성요소 추가' : 'Add component',
      saveComponents: isKorean ? '구성요소 저장' : 'Save components',
      componentEmpty: isKorean ? '구성요소를 추가하면 공간 조립을 시작할 수 있습니다.' : 'Add components to start assembling the space.',
      currentVersionLabel: isKorean ? '현재 버전' : 'Current versions',
      versionHint: isKorean ? '공간을 발행하면 버전 이력이 생성됩니다.' : 'Publishing the space creates version history.',
      summaryLabel: isKorean ? '선택된 공간 요약' : 'Selected space summary',
      summaryEmpty: isKorean ? '선택된 공간이 없습니다.' : 'No space selected.',
      summaryEmptyHint: isKorean ? '선택된 공간이 없습니다.' : 'No space selected.',
    }),
    [isKorean],
  );
  const [profile, setProfile] = useState<CuratorWorkspaceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [authTick, setAuthTick] = useState(0);
  const [routeSpaceId, setRouteSpaceId] = useState<number | null>(() => parseProfileSpaceIdFromHash());
  const [selectedSpaceId, setSelectedSpaceId] = useState<number | null>(() => parseProfileSpaceIdFromHash());
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<'create' | 'edit'>('create');
  const [nameDraft, setNameDraft] = useState('');
  const [descriptionDraft, setDescriptionDraft] = useState('');
  const [savingProject, setSavingProject] = useState(false);
  const [projectError, setProjectError] = useState<string | null>(null);
  const [projectToast, setProjectToast] = useState<string | null>(null);
  const [showAuthorUpload, setShowAuthorUpload] = useState(false);
  const [selectedArtworkId, setSelectedArtworkId] = useState<number | null>(null);
  const [selectedGlbArtworkId, setSelectedGlbArtworkId] = useState<number | null>(null);
  const [artworkPage, setArtworkPage] = useState(1);
  const [pendingFramedGlbArtworkIds, setPendingFramedGlbArtworkIds] = useState<Set<number>>(() => new Set());
  const attemptedFramedGlbSyncIdsRef = useRef<Set<number>>(new Set());
  const [lastWorkspaceRole, setLastWorkspaceRole] = useState<'writer' | 'curator' | null>(() => {
    if (typeof window === 'undefined') {
      return null;
    }
    const stored = window.localStorage.getItem(LAST_WORKSPACE_ROLE_KEY);
    return stored === 'writer' || stored === 'curator' ? stored : null;
  });
  const resolvedWorkspaceRole = profile
    ? resolveWorkspaceRole(profile.user.roles, profile.user.primaryRole)
    : workspaceRoleHint ?? null;
  const fetchWorkspaceRole = workspaceRoleHint ?? lastWorkspaceRole ?? null;
  const isWriterWorkspace = resolvedWorkspaceRole === 'writer';
  const isRoleResolved = resolvedWorkspaceRole !== null;
  const workspaceTitle = isWriterWorkspace
    ? (isKorean ? '작가 작업공간' : 'Writer Workspace')
    : isRoleResolved
      ? (isKorean ? '큐레이터 작업공간' : 'Curator Workspace')
      : (isKorean ? '작업공간' : 'Workspace');
  const workspaceDescription = isWriterWorkspace
    ? (isKorean
      ? '보유한 작품을 관리하고 스토리와 TTS를 확인하는 작가 대시보드입니다.'
      : 'Manage your owned artworks, stories, and TTS outputs in one place.')
    : isRoleResolved
      ? workspaceCopy.description
      : (isKorean
        ? '작업공간 역할을 확인하는 중입니다.'
        : 'Resolving workspace role...');
  const workspaceLoading = isWriterWorkspace
    ? (isKorean ? '작가 작업공간을 불러오는 중입니다...' : 'Loading writer workspace...')
    : isRoleResolved
      ? workspaceCopy.loading
      : (isKorean ? '작업공간을 불러오는 중입니다...' : 'Loading workspace...');
  const workspaceLoadError = isWriterWorkspace
    ? (isKorean ? '작가 작업공간을 불러오지 못했습니다.' : 'Unable to load writer workspace.')
    : isRoleResolved
      ? workspaceCopy.loadError
      : (isKorean ? '작업공간을 불러오지 못했습니다.' : 'Unable to load workspace.');
  const showSpaceProjectSections = isRoleResolved && !isWriterWorkspace;
  const sectionEyebrow = isWriterWorkspace
    ? workspaceTitle
    : isRoleResolved
      ? workspaceCopy.eyebrow
      : (isKorean ? '작업공간' : 'Workspace');

  useEffect(() => {
    setArtworkPage(1);
  }, [fetchWorkspaceRole]);

  const loadProfile = useCallback(async (options: { silent?: boolean; page?: number } = {}) => {
    const { silent = false, page = artworkPage } = options;
    if (!fetchWorkspaceRole) {
      if (!silent) {
        setLoading(true);
        setError(null);
      }
      return;
    }

    if (!silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const response = fetchWorkspaceRole === 'writer'
        ? await apiService.getWriterWorkspace(page, WORKSPACE_ARTWORK_PAGE_SIZE)
        : await apiService.getCuratorWorkspace(page, WORKSPACE_ARTWORK_PAGE_SIZE);
      setProfile(response);
      setArtworkPage(response.page);
      const nextRole = resolveWorkspaceRole(response.user.roles, response.user.primaryRole);
      setLastWorkspaceRole(nextRole);
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(LAST_WORKSPACE_ROLE_KEY, nextRole);
      }
    } catch (loadError) {
      if (!silent) {
        setError(loadError instanceof Error ? loadError.message : workspaceLoadError);
        setProfile(null);
      }
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, [artworkPage, fetchWorkspaceRole, workspaceLoadError]);

  const ensureFramedGlbForArtwork = useCallback(
    async (
      artwork: CuratorWorkspaceArtwork,
      options: {
        openAfterComplete?: boolean;
        refreshAfterComplete?: boolean;
        messageOnSuccess?: string;
        showToastOnSuccess?: boolean;
      } = {},
    ) => {
      const {
        openAfterComplete = false,
        refreshAfterComplete = true,
        messageOnSuccess,
        showToastOnSuccess = true,
      } = options;
      setPendingFramedGlbArtworkIds((current) => {
        const next = new Set(current);
        next.add(artwork.id);
        return next;
      });

      try {
        const response = await apiService.ensureAuthorArtworkFramedGlb(artwork.id);
        attemptedFramedGlbSyncIdsRef.current.add(artwork.id);
        if (refreshAfterComplete) {
          await loadProfile();
        }
        if (openAfterComplete && response.status === 'ready') {
          setSelectedGlbArtworkId(artwork.id);
        }
        if (messageOnSuccess) {
          setProjectToast(messageOnSuccess);
        } else if (showToastOnSuccess && response.status === 'ready') {
          setProjectToast(isKorean ? '3D GLB를 준비했습니다.' : 'Prepared the 3D GLB.');
        } else if (openAfterComplete && response.status !== 'ready') {
          setProjectToast(isKorean ? '3D GLB를 생성 중입니다. 완료 후 다시 열어보세요.' : 'The 3D GLB is still generating. Try again once it is ready.');
        }
        return response;
      } catch (error) {
        const message = error instanceof Error ? error.message : (isKorean ? '3D GLB 생성에 실패했습니다.' : 'Failed to generate the 3D GLB.');
        setProjectToast(message);
        throw error;
      } finally {
        setPendingFramedGlbArtworkIds((current) => {
          if (!current.has(artwork.id)) {
            return current;
          }
          const next = new Set(current);
          next.delete(artwork.id);
          return next;
        });
      }
    },
    [isKorean, loadProfile],
  );

  useEffect(() => {
    const handleAuthChange = () => setAuthTick((current) => current + 1);
    window.addEventListener('digital-twin-auth-changed', handleAuthChange);
    return () => window.removeEventListener('digital-twin-auth-changed', handleAuthChange);
  }, []);

  useEffect(() => {
    const handleHashChange = () => {
      const nextSpaceId = parseProfileSpaceIdFromHash();
      setRouteSpaceId(nextSpaceId);
      if (nextSpaceId !== null) {
        setSelectedSpaceId(nextSpaceId);
      }
    };

    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadProfile({ page: artworkPage });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [authTick, artworkPage, loadProfile]);

  useEffect(() => {
    if (!profile?.ownedSpaces.length) {
      setSelectedSpaceId(null);
      return;
    }

    setSelectedSpaceId((current) => {
      if (routeSpaceId !== null && profile.ownedSpaces.some((space) => space.id === routeSpaceId)) {
        return routeSpaceId;
      }

      if (current !== null) {
        return current;
      }

      if (editorOpen && editorMode === 'create') {
        return null;
      }

      return profile.ownedSpaces[0]?.id ?? null;
    });
  }, [editorMode, editorOpen, profile, routeSpaceId]);

  useEffect(() => {
    attemptedFramedGlbSyncIdsRef.current = new Set();
    setPendingFramedGlbArtworkIds(new Set());
    setSelectedGlbArtworkId(null);
  }, [profile?.user.id]);

  useEffect(() => {
    if (!isWriterWorkspace) {
      return;
    }

    const hasPendingGlb = (profile?.ownedArtworks ?? []).some((artwork) => {
      const status = (artwork.framedGlbStatus ?? '').trim().toLowerCase();
      // Poll while generating/queued, and also while missing so the UI updates once auto-sync completes.
      return status === 'queued' || status === 'generating' || (!artwork.framedGlbUrl && status !== 'ready');
    });

    if (!hasPendingGlb) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void loadProfile({ silent: true });
    }, 8000);

    return () => window.clearInterval(intervalId);
  }, [isWriterWorkspace, loadProfile, profile?.ownedArtworks]);

  useEffect(() => {
    if (!isWriterWorkspace) {
      return;
    }

    const ownedArtworks = profile?.ownedArtworks ?? [];
    if (!ownedArtworks.length) {
      return;
    }

    const candidates = ownedArtworks.filter((artwork) => {
      const needsGlb = artwork.framedGlbStatus !== 'ready' || !artwork.framedGlbUrl;
      return needsGlb && !attemptedFramedGlbSyncIdsRef.current.has(artwork.id);
    });

    if (!candidates.length) {
      return;
    }

    let cancelled = false;
    const queue = [...candidates];
    const concurrency = Math.min(3, queue.length);

    const run = async () => {
      setProjectToast(isKorean ? '작품 3D 자산을 동기화하는 중입니다...' : 'Syncing artwork 3D assets...');
      let cursor = 0;
      const worker = async () => {
        while (!cancelled) {
          const artwork = queue[cursor++];
          if (!artwork) {
            break;
          }
          attemptedFramedGlbSyncIdsRef.current.add(artwork.id);
          try {
            await ensureFramedGlbForArtwork(artwork, {
              refreshAfterComplete: false,
              showToastOnSuccess: false,
            });
          } catch (error) {
            if (!cancelled) {
              console.error('Failed to sync framed GLB for artwork', artwork.id, error);
            }
          }
        }
      };

      await Promise.all(Array.from({ length: concurrency }, () => worker()));
      if (!cancelled) {
        await loadProfile();
        setProjectToast(isKorean ? '작품 3D 자산 동기화가 완료되었습니다.' : 'Artwork 3D asset sync completed.');
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [ensureFramedGlbForArtwork, isKorean, isWriterWorkspace, loadProfile, profile?.ownedArtworks]);

  useEffect(() => {
    if (!projectToast) return;
    const timer = window.setTimeout(() => setProjectToast(null), 2600);
    return () => window.clearTimeout(timer);
  }, [projectToast]);

  const sections = useMemo(() => {
    const ownedSpaces = profile?.ownedSpaces ?? [];
    const ownedArtworks = [...(profile?.ownedArtworks ?? [])].sort((left, right) => right.id - left.id);
    const snapshots = profile?.roomMergeSnapshots ?? [];
    const presets = profile?.roomMergePresets ?? [];

    return { ownedSpaces, ownedArtworks, snapshots, presets };
  }, [profile]);

  useEffect(() => {
    if (sections.ownedArtworks.length === 0) {
      setSelectedArtworkId(null);
      return;
    }

    setSelectedArtworkId((current) => {
      if (current !== null && sections.ownedArtworks.some((artwork) => artwork.id === current)) {
        return current;
      }

      return sections.ownedArtworks[0]?.id ?? null;
    });
  }, [sections.ownedArtworks]);

  const selectedSpace = useMemo(
    () => sections.ownedSpaces.find((space) => space.id === selectedSpaceId) ?? null,
    [sections.ownedSpaces, selectedSpaceId],
  );
  const selectedArtwork = useMemo(
    () => sections.ownedArtworks.find((artwork) => artwork.id === selectedArtworkId) ?? null,
    [sections.ownedArtworks, selectedArtworkId],
  );
  const selectedGlbArtwork = useMemo(
    () => sections.ownedArtworks.find((artwork) => artwork.id === selectedGlbArtworkId) ?? null,
    [sections.ownedArtworks, selectedGlbArtworkId],
  );
  const activeSpaceId = selectedSpace?.id ?? selectedSpaceId;
  const activeSpaceFileCount = selectedSpace?.fileCount ?? null;

  const beginCreateProject = useCallback(() => {
    setEditorMode('create');
    setSelectedSpaceId(null);
    setNameDraft('');
    setDescriptionDraft('');
    setProjectError(null);
    setEditorOpen(true);
  }, []);

  const beginEditProject = useCallback((space: CuratorWorkspaceSpace) => {
    setSelectedSpaceId(space.id);
    setEditorMode('edit');
    setNameDraft(space.name);
    setDescriptionDraft(space.description ?? '');
    setProjectError(null);
    setEditorOpen(true);
  }, []);

  const openSpaceInExperiment = useCallback((space: CuratorWorkspaceSpace) => {
    if ((space.fileCount ?? 0) === 0) {
      setProjectToast('업로드한 glb파일이 없습니다.');
      return;
    }
    window.location.hash = `#/experiment?spaceId=${space.id}`;
  }, []);

  const openArtworkGlb = useCallback((artwork: CuratorWorkspaceArtwork) => {
    if (pendingFramedGlbArtworkIds.has(artwork.id)) {
      return;
    }
    if (artwork.framedGlbStatus === 'ready' && artwork.framedGlbUrl) {
      setSelectedGlbArtworkId(artwork.id);
      return;
    }
    void ensureFramedGlbForArtwork(artwork, {
      openAfterComplete: true,
      refreshAfterComplete: true,
    });
  }, [ensureFramedGlbForArtwork, pendingFramedGlbArtworkIds]);

  const generateArtworkGlb = useCallback((artwork: CuratorWorkspaceArtwork) => {
    if (pendingFramedGlbArtworkIds.has(artwork.id)) {
      return;
    }
    void ensureFramedGlbForArtwork(artwork, {
      openAfterComplete: false,
      refreshAfterComplete: true,
      showToastOnSuccess: true,
    });
  }, [ensureFramedGlbForArtwork, pendingFramedGlbArtworkIds]);

  const openResumeFromPreset = useCallback((preset: RoomMergePresetResponse) => {
    const spaceId = preset.spaceId ?? activeSpaceId;
    if (spaceId == null) {
      setProjectToast('먼저 프로젝트를 선택하세요.');
      return;
    }
    if (activeSpaceFileCount === 0) {
      setProjectToast('업로드한 glb파일이 없습니다.');
      return;
    }
    const query = new URLSearchParams();
    if (spaceId != null) query.set('spaceId', String(spaceId));
    query.set('presetId', String(preset.id));
    window.location.hash = `#/experiment?${query.toString()}`;
  }, [activeSpaceFileCount, activeSpaceId]);

  const openSpaceManagement = useCallback(() => {
    if (activeSpaceId == null) {
      setProjectToast('먼저 프로젝트를 선택하세요.');
      return;
    }
    const query = new URLSearchParams();
    query.set('spaceId', String(activeSpaceId));
    const hash = `#/debug/curator-space-management?${query.toString()}`;
    window.location.hash = hash;
  }, [activeSpaceId]);

  const openLibraryPublish = useCallback((space: CuratorWorkspaceSpace) => {
    const query = new URLSearchParams();
    query.set('spaceId', String(space.id));
    window.location.hash = `#/debug/curator-space-management?${query.toString()}`;
  }, []);

  const openArtworkPipeline = useCallback(() => {
    window.location.hash = '#/debug/framed-glb';
  }, []);

  const handleSaveProject = useCallback(async () => {
    setSavingProject(true);
    setProjectError(null);
    try {
      if (editorMode === 'create') {
        if (!nameDraft.trim()) {
          throw new Error('프로젝트 이름을 입력하세요.');
        }
        const created = await apiService.createCuratorSpace({
          name: nameDraft.trim(),
          description: descriptionDraft.trim() || null,
        });
        setProjectToast(`${created.name}을(를) 생성했습니다.`);
        setEditorMode('edit');
        setSelectedSpaceId(created.id);
        setNameDraft(created.name);
        setDescriptionDraft(created.description ?? '');
        await loadProfile();
      } else if (selectedSpace) {
        const updated = await apiService.updateCuratorSpace(selectedSpace.id, {
          name: nameDraft.trim() || selectedSpace.name,
          description: descriptionDraft.trim() || null,
          status: selectedSpace.status as 'draft' | 'reviewed' | 'published' | 'archived',
        });
        setProjectToast(`${updated.name}을(를) 저장했습니다.`);
        setSelectedSpaceId(updated.id);
        setNameDraft(updated.name);
        setDescriptionDraft(updated.description ?? '');
        await loadProfile();
      }
    } catch (saveError) {
      setProjectError(saveError instanceof Error ? saveError.message : '프로젝트를 저장하지 못했습니다.');
    } finally {
      setSavingProject(false);
    }
  }, [descriptionDraft, editorMode, loadProfile, nameDraft, selectedSpace]);

  const handleDeletePreset = useCallback(async (preset: RoomMergePresetResponse) => {
    try {
      await apiService.deleteRoomMergePreset(preset.id);
      clearCachedRoomMergePreset(preset.id);
      setProjectToast(`${preset.presetName}을(를) 삭제했습니다.`);
      await loadProfile();
    } catch (deleteError) {
      setProjectError(deleteError instanceof Error ? deleteError.message : '저장된 레이아웃을 삭제하지 못했습니다.');
    }
  }, [loadProfile]);

  const handleDeleteProject = useCallback(async (space: CuratorWorkspaceSpace) => {
    const confirmed = window.confirm(`"${space.name}"을(를) 삭제할까요?\n\n이 작업은 프로필에서 프로젝트를 숨깁니다.`);
    if (!confirmed) {
      return;
    }

    try {
      await apiService.deleteCuratorSpace(space.id);
      setProjectToast(`${space.name}을(를) 삭제했습니다.`);
      if (selectedSpaceId === space.id) {
        setSelectedSpaceId(null);
      }
      await loadProfile();
    } catch (deleteError) {
      setProjectError(deleteError instanceof Error ? deleteError.message : '프로젝트를 삭제하지 못했습니다.');
    }
  }, [loadProfile, selectedSpaceId]);

  const handleEditPreset = useCallback((preset: RoomMergePresetResponse) => {
    const matchingSpace = sections.ownedSpaces.find((space) => space.id === preset.spaceId) ?? null;
    if (preset.spaceId != null) {
      setSelectedSpaceId(preset.spaceId);
    }

    if (matchingSpace) {
      beginEditProject(matchingSpace);
      setNameDraft(preset.presetName);
      setDescriptionDraft(preset.memo ?? '');
      setEditorOpen(true);
      return;
    }

    setEditorMode('create');
    setNameDraft(preset.presetName);
    setDescriptionDraft(preset.memo ?? '');
    setProjectError(null);
    setEditorOpen(true);
  }, [beginEditProject, sections.ownedSpaces]);

  const currentProjectCount = sections.ownedSpaces.length;
  const currentLayoutCount = sections.presets.length;
  const currentSnapshotCount = sections.snapshots.length;
  const artworkTotalPages = profile?.totalPages ?? 1;
  const artworkTotalCount = profile?.total ?? profile?.summary.ownedArtworks ?? 0;
  const canGoToPreviousArtworkPage = artworkPage > 1 && !loading;
  const canGoToNextArtworkPage = artworkPage < artworkTotalPages && !loading;
  const headerMetrics = showSpaceProjectSections
    ? [
        { label: isKorean ? '프로젝트' : 'Projects', value: currentProjectCount },
        { label: isKorean ? '저장 레이아웃' : 'Saved layouts', value: currentLayoutCount },
        { label: isKorean ? '스냅샷' : 'Snapshots', value: currentSnapshotCount },
        { label: isKorean ? '작품' : 'Artworks', value: profile?.summary.ownedArtworks ?? 0 },
        { label: isKorean ? '생성형 TTS' : 'TTS', value: profile?.summary.ttsAssets ?? 0 },
      ]
    : [
        { label: isKorean ? '작품' : 'Artworks', value: profile?.summary.ownedArtworks ?? 0 },
        { label: isKorean ? '생성형 TTS' : 'TTS', value: profile?.summary.ttsAssets ?? 0 },
      ];

  const authorUploadAction = (
    <button
      type="button"
      onClick={() => setShowAuthorUpload(true)}
      className="inline-flex h-11 items-center rounded-full border border-[#b57d69]/28 bg-[#5b2c20]/20 px-4 text-sm font-medium text-[#f4efe7] transition hover:border-[#d1a293]/45 hover:bg-[#5b2c20]/28"
    >
      {isKorean ? '작품 업로드' : 'Upload artwork'}
    </button>
  );

  const goToPreviousArtworkPage = () => {
    setArtworkPage((current) => Math.max(1, current - 1));
  };

  const goToNextArtworkPage = () => {
    setArtworkPage((current) => Math.min(artworkTotalPages, current + 1));
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(127, 155, 90,0.18),transparent_26%),radial-gradient(circle_at_top_right,rgba(139,92,44,0.14),transparent_22%),linear-gradient(180deg,#14130c_0%,#1b1812_42%,#14130c_100%)] text-[#f4efe7]">
      <div className="mx-auto flex min-h-screen w-full max-w-[1640px] flex-col gap-6 px-4 py-5 sm:px-6 lg:px-8">
        {projectToast ? (
          <div className="fixed right-5 top-5 z-[200] rounded-2xl border border-[#7f9b5a]/24 bg-[#7f9b5a]/12 px-4 py-3 text-sm text-[#e8f0d5] shadow-2xl backdrop-blur-xl">
            {projectToast}
          </div>
        ) : null}
        <motion.header
          className="overflow-hidden rounded-[34px] border border-white/10 bg-[#1b1812]/84 p-6 shadow-[0_28px_100px_rgba(0,0,0,0.45)] backdrop-blur-2xl"
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-[#7f9b5a]">Gallery</p>
              <h1 className="mt-3 text-4xl font-semibold leading-[0.94] tracking-[-0.05em] text-[#f4efe7] sm:text-5xl">
                {profile?.user.displayName ?? (isKorean ? '큐레이터 이름' : 'Curator Name')}
                <br />
                {workspaceTitle}
              </h1>
              <p className="mt-4 max-w-2xl text-sm leading-7 text-[#d8cbbb]">
                {workspaceDescription}
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                <span className={chipStyle}>{profile?.user.displayName ?? workspaceCopy.loadingLabel}</span>
                <span className={chipStyle}>{isWriterWorkspace ? (isKorean ? '작가' : 'Writer') : (isKorean ? '큐레이터' : 'Curator')}</span>
                <span className={compactChipStyle}>{`P${artworkPage}/${artworkTotalPages}`}</span>
                <span className={compactChipStyle}>{`A${formatCount(profile?.summary.ownedArtworks ?? 0)}`}</span>
                <span className={compactChipStyle}>{`T${formatCount(profile?.summary.ttsAssets ?? 0)}`}</span>
              </div>
            </div>
            <div className={`grid gap-3 ${showSpaceProjectSections ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-2'}`}>
              {headerMetrics.map((item) => (
                <div
                  key={item.label}
                  className="rounded-[24px] border border-white/10 bg-[#14130c]/72 p-4 backdrop-blur-xl"
                >
                  <p className="text-[10px] uppercase tracking-[0.18em] text-[#b29e8d]">{item.label}</p>
                  <p className="mt-2 text-3xl font-semibold leading-none text-[#f4efe7]">{formatCount(item.value)}</p>
                </div>
              ))}
            </div>
          </div>
        </motion.header>

        {loading ? (
          <div className="rounded-[28px] border border-white/10 bg-[#1b1812]/72 p-8 text-center text-[#d8cbbb]">
            {workspaceLoading}
          </div>
        ) : error ? (
          <div className="rounded-[28px] border border-[#b57d69]/24 bg-[#5b2c20]/22 p-5 text-sm text-[#f0d7cf]">
            {error}
          </div>
        ) : profile ? (
          <>
            <div className="space-y-6">
                {showSpaceProjectSections ? (
                  <>
                    <section className="rounded-[34px] border border-white/10 bg-[#1b1812]/82 p-5 shadow-[0_28px_100px_rgba(0,0,0,0.35)] backdrop-blur-2xl">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#7f9b5a]">{workspaceCopy.projectListLabel}</p>
                          <h2 className="mt-2 text-2xl font-semibold text-[#f4efe7]">{workspaceCopy.projectSectionTitle}</h2>
                          <p className="mt-1 text-sm text-[#d8cbbb]">{workspaceCopy.projectSectionSubtitle}</p>
                        </div>
                        <button
                          type="button"
                          onClick={beginCreateProject}
                          className="flex h-12 w-12 items-center justify-center rounded-full border border-white/10 bg-[#7f9b5a]/14 text-2xl text-[#f4efe7] shadow-[0_15px_50px_rgba(0,0,0,0.35)] transition hover:bg-[#7f9b5a]/20"
                        >
                          +
                        </button>
                      </div>

                      <div className="mt-5 space-y-3">
                        {sections.ownedSpaces.length > 0 ? (
                          sections.ownedSpaces.map((space) => (
                            <ProjectRow
                              key={space.id}
                              space={space}
                              onOpen={openSpaceInExperiment}
                              onEdit={beginEditProject}
                              onPublish={openLibraryPublish}
                              onDelete={handleDeleteProject}
                              onResume={(rowSpace) => {
                                const latestPreset = sections.presets.find((preset) => preset.spaceId === rowSpace.id) ?? null;
                                if (latestPreset) {
                                  openResumeFromPreset(latestPreset);
                                  return;
                                }
                                openSpaceInExperiment(rowSpace);
                              }}
                            />
                          ))
                        ) : (
                          <div className="rounded-[24px] border border-dashed border-white/10 bg-[#14130c]/72 p-6 text-sm text-[#d8cbbb]">
                            {workspaceCopy.projectListEmpty}
                          </div>
                        )}
                      </div>
                    </section>

                    <div className="grid gap-6 xl:grid-cols-[1fr_0.95fr]">
                      <ProfileSection
                        title={workspaceCopy.savedLayoutsTitle}
                        subtitle={workspaceCopy.savedLayoutsSubtitle}
                        eyebrow={sectionEyebrow}
                      >
                        <div className="space-y-3">
                          {sections.presets.length > 0 ? (
                            sections.presets.map((preset) => (
                              <SavedLayoutRow
                                key={preset.id}
                                preset={preset}
                                onEdit={(rowPreset) => {
                                  handleEditPreset(rowPreset);
                                  openResumeFromPreset(rowPreset);
                                }}
                                onResume={openResumeFromPreset}
                                onDelete={handleDeletePreset}
                              />
                            ))
                          ) : (
                            <div className="rounded-2xl border border-dashed border-white/10 bg-[#14130c]/72 p-5 text-sm text-[#d8cbbb]">
                              {workspaceCopy.noLayoutText}
                            </div>
                          )}
                        </div>
                      </ProfileSection>

                      <ProfileSection
                        title={workspaceCopy.historyTitle}
                        subtitle={workspaceCopy.historySubtitle}
                        eyebrow={sectionEyebrow}
                      >
                        <div className="space-y-3">
                          {sections.snapshots.length > 0 ? (
                            sections.snapshots.map((snapshot) => (
                              <SnapshotRow key={snapshot.id} item={snapshot} kind="snapshot" />
                            ))
                          ) : (
                            <div className="rounded-2xl border border-dashed border-white/10 bg-[#14130c]/72 p-5 text-sm text-[#d8cbbb]">
                              {workspaceCopy.emptySnapshots}
                            </div>
                          )}
                        </div>
                      </ProfileSection>
                    </div>
                  </>
                ) : null}

                <ProfileSection
                  title={workspaceCopy.artworksTitle}
                  subtitle={workspaceCopy.artworksSubtitle}
                  eyebrow={sectionEyebrow}
                  action={isWriterWorkspace ? authorUploadAction : undefined}
                >
                  <div className="grid gap-6 xl:grid-cols-[0.94fr_1.06fr]">
                    <div>
                      <div className="mb-4 flex flex-col gap-3 border-b border-white/10 pb-4 sm:flex-row sm:items-center sm:justify-between">
                        <p className="text-xs text-[#b29e8d]">
                          {isKorean
                            ? `총 ${artworkTotalCount}개 중 ${artworkPage} / ${artworkTotalPages} 페이지`
                            : `Page ${artworkPage} of ${artworkTotalPages} from ${artworkTotalCount} total artworks`}
                        </p>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={goToPreviousArtworkPage}
                            disabled={!canGoToPreviousArtworkPage}
                            className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-[#f4efe7] transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            {isKorean ? '이전' : 'Prev'}
                          </button>
                          <button
                            type="button"
                            onClick={goToNextArtworkPage}
                            disabled={!canGoToNextArtworkPage}
                            className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-[#f4efe7] transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            {isKorean ? '다음' : 'Next'}
                          </button>
                        </div>
                      </div>
                      {sections.ownedArtworks.length > 0 ? (
                        <div className="space-y-3">
                          {sections.ownedArtworks.map((artwork) => (
                            <ArtworkSummaryRow
                              key={artwork.id}
                              artwork={artwork}
                              isActive={selectedArtwork?.id === artwork.id}
                              onSelect={(rowArtwork) => {
                                setSelectedArtworkId(rowArtwork.id);
                              }}
                              onOpenGlb={openArtworkGlb}
                              onGenerateGlb={generateArtworkGlb}
                              isGeneratingGlb={pendingFramedGlbArtworkIds.has(artwork.id)}
                            />
                          ))}
                        </div>
                      ) : (
                        <div className="rounded-2xl border border-dashed border-white/10 bg-[#14130c]/72 p-6 text-sm text-[#d8cbbb]">
                          {workspaceCopy.emptyArtworks}
                        </div>
                      )}
                    </div>

                    <div>
                      {selectedArtwork ? (
                        <section className="rounded-[34px] border border-white/10 bg-[#17140f]/86 p-5 shadow-[0_28px_100px_rgba(0,0,0,0.35)] backdrop-blur-2xl">
                          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#7f9b5a]">
                                {isKorean ? '선택된 작품 상세' : 'Selected artwork detail'}
                              </p>
                              <h2 className="mt-2 text-2xl font-semibold text-[#f4efe7]">
                                {selectedArtwork.title ?? `작품 ${selectedArtwork.id}`}
                              </h2>
                              <p className="mt-1 text-sm text-[#d8cbbb]">
                                {isKorean ? '리스트에서 선택한 작품의 정보, 스토리, TTS를 한 패널에서 바로 확인합니다.' : 'View artwork info, stories, and TTS in one panel without leaving the list.'}
                              </p>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className={compactChipStyle}>{`${artworkPage}/${artworkTotalPages}`}</span>
                              <button
                                type="button"
                                onClick={() => setSelectedArtworkId(null)}
                                className="rounded-full border border-white/10 bg-[#1b1812]/72 px-4 py-2 text-sm text-[#f4efe7] transition hover:bg-[#5b2c20]/28"
                              >
                                {isKorean ? '선택 해제' : 'Clear'}
                              </button>
                            </div>
                          </div>
                          <ArtworkStoryManager
                            artwork={selectedArtwork}
                            onRefresh={loadProfile}
                            onNotify={setProjectToast}
                            onDeleted={(artworkId) => {
                              setSelectedArtworkId((current) => (current === artworkId ? null : current));
                            }}
                            isKorean={isKorean}
                          />
                        </section>
                      ) : (
                        <div className="flex min-h-[320px] items-center rounded-[34px] border border-dashed border-white/10 bg-[#14130c]/72 p-6 text-sm text-[#d8cbbb]">
                          {isKorean
                            ? '작품을 선택하면 오른쪽에 상세 패널이 열립니다.'
                            : 'Select an artwork to open its detail panel on the right.'}
                        </div>
                      )}
                    </div>
                  </div>
                </ProfileSection>

            </div>
          </>
        ) : null}
      </div>
      <ArtworkGlbModal
        artwork={selectedGlbArtwork}
        open={Boolean(selectedGlbArtwork)}
        onClose={() => setSelectedGlbArtworkId(null)}
      />
      {showSpaceProjectSections ? (
        <ProjectEditorDrawer
          open={editorOpen}
          mode={editorMode}
          selectedSpace={selectedSpace}
          nameDraft={nameDraft}
          descriptionDraft={descriptionDraft}
          saving={savingProject}
          error={projectError}
          onClose={() => setEditorOpen(false)}
          onNameChange={setNameDraft}
          onDescriptionChange={setDescriptionDraft}
          onSave={() => {
            void handleSaveProject();
          }}
          onCreateNew={beginCreateProject}
          onOpenSpaceManagement={openSpaceManagement}
          onOpenArtworkPipeline={openArtworkPipeline}
          onOpenExperiment={() => {
            if (activeSpaceId == null) {
              setProjectToast('먼저 프로젝트를 선택하세요.');
              return;
            }
            if (activeSpaceFileCount === 0) {
              setProjectToast('업로드한 GLB 파일이 없습니다.');
              return;
            }
            window.location.hash = `#/experiment?spaceId=${activeSpaceId}`;
          }}
        />
      ) : null}
      <AnimatePresence>
        {showAuthorUpload ? (
          <AuthorUploadModal
            onClose={() => setShowAuthorUpload(false)}
            onSuccess={async (created) => {
              await loadProfile();
              setSelectedArtworkId(created.artworkId);
              setProjectToast(isKorean ? '새 작품을 업로드했습니다.' : 'Uploaded a new artwork.');
            }}
          />
        ) : null}
      </AnimatePresence>
    </div>
  );
};

export default CuratorWorkspacePage;
