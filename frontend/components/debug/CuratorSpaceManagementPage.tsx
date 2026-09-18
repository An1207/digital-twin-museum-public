import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { apiService } from '../../lib/api';
import { useUiLocale } from '../../lib/uiLocale';
import SpaceThumbnailMosaic from '../library/SpaceThumbnailMosaic';
import type {
  CuratorSpaceComponentRequest,
  CuratorSpaceDetail,
  CuratorSpaceFile,
  CuratorSpacePublishRequest,
  CuratorSpaceSummary,
  SpaceVector3,
} from '../../types/curation';

type ComponentDraft = CuratorSpaceComponentRequest;

const emptyVector = (x = 0, y = 0, z = 0): SpaceVector3 => ({ x, y, z });

const createEmptyComponentDraft = (files: CuratorSpaceFile[]): ComponentDraft | null => {
  const firstFile = files[0];
  if (!firstFile) return null;

  return {
    componentKey: `component-${Date.now()}`,
    label: firstFile.originalFileName,
    spaceFileId: firstFile.id,
    position: emptyVector(),
    rotation: emptyVector(),
    scale: emptyVector(1, 1, 1),
    sortOrder: 0,
  };
};

const formatDate = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' });
};

const formatSpaceStatusLabel = (status: string) => {
  switch (status) {
    case 'draft':
      return '초안';
    case 'reviewed':
      return '검토 완료';
    case 'published':
      return '발행됨';
    case 'archived':
      return '보관됨';
    default:
      return status;
  }
};

const parseSpaceIdFromHash = () => {
  const queryString = window.location.hash.split('?')[1] ?? '';
  const params = new URLSearchParams(queryString);
  const rawSpaceId = params.get('spaceId');
  if (!rawSpaceId) return null;
  const parsed = Number(rawSpaceId);
  return Number.isFinite(parsed) ? parsed : null;
};

const NumberField = ({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) => (
  <label className="space-y-1">
    <div className="text-[11px] uppercase tracking-[0.18em] text-stone-500">{label}</div>
    <input
      type="number"
      step="0.01"
      value={value}
      onChange={(event) => onChange(Number(event.target.value))}
      className="w-full rounded-2xl border border-white/10 bg-black/35 px-3 py-2 text-sm text-stone-100 outline-none transition focus:border-cyan-300/40"
    />
  </label>
);

export default function CuratorSpaceManagementPage() {
  const { locale } = useUiLocale();
  const isKorean = locale === 'ko';
  const copy = useMemo(
    () => ({
      headerEyebrow: isKorean ? '큐레이터 운영' : 'Curator operations',
      title: isKorean ? 'GLB 공간 관리' : 'GLB Space Management',
      subtitle: isKorean
        ? 'GLB 파일을 업로드하고, 운영용 공간을 만들고, 구성요소를 저장한 뒤 공개 프로필로 발행합니다.'
        : 'Upload GLB files, create operational spaces, save components, and publish the result to the public profile.',
      spacesLabel: isKorean ? '공간 수' : 'Spaces',
      spacesSub: isKorean ? '운영 중인 공간' : 'Operational spaces',
      filesLabel: isKorean ? '파일 수' : 'Files',
      filesSub: isKorean ? '선택된 공간의 파일' : 'Files in the selected space',
      selectedLabel: isKorean ? '선택됨' : 'Selected',
      selectedSub: isKorean ? '버전' : 'versions',
      uploadTitle: isKorean ? 'GLB 업로드' : 'GLB Upload',
      uploadHint: isKorean ? '파일을 선택하면 즉시 업로드됩니다. 한 번에 최대 5개까지 선택할 수 있습니다.' : 'Choose files and they upload immediately. You can select up to 5 at once.',
      uploadImmediate: isKorean ? '파일을 선택하면 즉시 업로드됩니다' : 'Files upload immediately after selection',
      uploadEmpty: isKorean
        ? '아직 이 공간에 업로드된 GLB가 없습니다. 첫 자산을 업로드하면 공간 구성을 시작할 수 있습니다.'
        : 'No GLB files have been uploaded to this space yet. Upload the first asset to start building the space.',
      spaceListLabel: isKorean ? '공간 목록' : 'Space list',
      spaceListTitle: isKorean ? '기존 공간을 선택하세요' : 'Select an existing space',
      spaceListSub: isKorean
        ? '기존 공간은 여기서 관리합니다. 생성은 별도 패널에서만 처리해 이름이 편집 모드와 섞이지 않도록 했습니다.'
        : 'Manage existing spaces here. Creation stays in a separate panel so it never gets mixed with edit mode.',
      spacePickerHint: isKorean ? '공간을 선택하면 편집 작업 공간이 열립니다. 새 공간은 오른쪽 패널에서만 생성됩니다.' : 'Selecting a space opens the edit workspace. New spaces are created only in the right panel.',
      createTitle: isKorean ? '새 공간 초안' : 'New space draft',
      createSub: isKorean ? '이 폼은 항상 비어 있으며 선택된 공간과 완전히 분리됩니다.' : 'This form always starts empty and stays separate from the selected space.',
      reset: isKorean ? '초기화' : 'Reset',
      createButton: isKorean ? '공간 만들기' : 'Create space',
      creating: isKorean ? '생성 중...' : 'Creating...',
      namePlaceholder: isKorean ? '공간 이름' : 'Space name',
      descriptionPlaceholder: isKorean ? '설명' : 'Description',
      createHint: isKorean
        ? '공간 이름은 소유자 기준으로 중복될 수 없습니다. 이 패널은 새 프로젝트 생성용이며 기존 공간 편집에는 사용하지 않습니다.'
        : 'Space names can duplicate only across owners. This panel is only for creating new projects, not editing existing ones.',
      selectedSpaceLabel: isKorean ? '선택된 공간' : 'Selected space',
      publicLabel: isKorean ? '공개' : 'Public',
      modeLabel: isKorean ? '작업 모드' : 'Edit mode',
      existingEdit: isKorean ? '기존 공간 편집' : 'Edit existing space',
      separateCreate: isKorean ? '생성 패널 분리' : 'Separate create panel',
      selectedNamePlaceholder: isKorean ? '선택된 공간 이름' : 'Selected space name',
      locationPlaceholder: isKorean ? '위치 요약' : 'Location summary',
      thumbnailLabel: isKorean ? '썸네일' : 'Thumbnail',
      thumbnailHelp: isKorean
        ? '이미지를 업로드하면 공개 라이브러리와 발행 프로필에 사용됩니다. 지정하지 않으면 작품 이미지 조합이 자동으로 적용됩니다.'
        : 'Upload an image to use in the public library and published profile. If omitted, artwork images are combined automatically.',
      thumbnailUpload: isKorean ? '썸네일 업로드' : 'Upload thumbnail',
      thumbnailClear: isKorean ? '지우기' : 'Clear',
      thumbnailUploading: isKorean ? '업로드 중...' : 'Uploading...',
      thumbnailAutoHelp: isKorean
        ? '썸네일이 비어 있으면 발행 시 작품 이미지가 자동 대표 이미지로 사용됩니다.'
        : 'If left blank, the publish step will use artwork images as the automatic preview.',
      selectedDescPlaceholder: isKorean ? '선택된 공간 설명' : 'Selected space description',
      summaryPlaceholder: isKorean ? '공개 요약' : 'Public summary',
      versionPlaceholder: isKorean ? '버전 이름' : 'Version name',
      memoPlaceholder: isKorean ? '발행 메모' : 'Publish memo',
      displayPlaceholder: isKorean ? '표시 이름' : 'Display name',
      keywordPlaceholder: isKorean ? '키워드, 쉼표로 구분' : 'Keywords, separated by commas',
      saveChanges: isKorean ? '변경사항 저장' : 'Save changes',
      publishing: isKorean ? '발행 중...' : 'Publishing...',
      publishButton: isKorean ? '라이브러리에 공개' : 'Publish space',
      statusLabel: isKorean ? '상태' : 'Status',
      componentsLabel: isKorean ? '구성요소' : 'Components',
      componentsHelp: isKorean
        ? '각 구성요소는 정규화된 변환값을 보관하므로 조립된 공간을 그대로 복원할 수 있습니다.'
        : 'Each component stores normalized transforms so the assembled space can be restored exactly.',
      addComponent: isKorean ? '구성요소 추가' : 'Add component',
      saveComponents: isKorean ? '구성요소 저장' : 'Save components',
      componentHint: isKorean ? '구성요소를 추가하면 공간 조립을 시작할 수 있습니다.' : 'Add components to start assembling the space.',
      currentVersions: isKorean ? '현재 버전' : 'Current versions',
      versionHint: isKorean ? '공간을 발행하면 버전 이력이 생성됩니다.' : 'Publishing the space creates version history.',
      summaryTitle: isKorean ? '선택된 공간 요약' : 'Selected space summary',
      summaryEmpty: isKorean ? '선택된 공간이 없습니다.' : 'No space selected.',
      noDescription: isKorean ? '설명이 없습니다' : 'No description',
      fileLabel: isKorean ? '파일' : 'Files',
      componentLabel: isKorean ? '구성요소' : 'Components',
      slotLabel: isKorean ? '슬롯' : 'Slots',
      featured: isKorean ? '추천' : 'Featured',
      defaultLabel: isKorean ? '기본' : 'Default',
      orderLabel: isKorean ? '순서' : 'Order',
    }),
    [isKorean],
  );
  const [spaces, setSpaces] = useState<CuratorSpaceSummary[]>([]);
  const [selectedSpace, setSelectedSpace] = useState<CuratorSpaceDetail | null>(null);
  const [selectedSpaceId, setSelectedSpaceId] = useState<number | null>(() => parseSpaceIdFromHash());
  const [newSpaceName, setNewSpaceName] = useState('');
  const [newSpaceDescription, setNewSpaceDescription] = useState('');
  const [newSpaceThumbnailPath, setNewSpaceThumbnailPath] = useState<string | null>(null);
  const [spaceName, setSpaceName] = useState('');
  const [spaceDescription, setSpaceDescription] = useState('');
  const [spaceStatus, setSpaceStatus] = useState<'draft' | 'reviewed' | 'published' | 'archived'>('draft');
  const [componentDrafts, setComponentDrafts] = useState<ComponentDraft[]>([]);
  const [publishForm, setPublishForm] = useState<CuratorSpacePublishRequest>({
    versionName: '',
    memo: '',
    displayName: '',
    summary: '',
    locationSummary: '',
    thumbnailImagePath: '',
    searchKeywords: [],
    isFeatured: false,
    isDefault: false,
    displayOrder: 0,
  });
  const [keywordInput, setKeywordInput] = useState('');
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [newSpaceThumbnailUploading, setNewSpaceThumbnailUploading] = useState(false);
  const [publishThumbnailUploading, setPublishThumbnailUploading] = useState(false);
  const [savingSpace, setSavingSpace] = useState(false);
  const [savingComponents, setSavingComponents] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const newThumbnailInputRef = useRef<HTMLInputElement | null>(null);
  const publishThumbnailInputRef = useRef<HTMLInputElement | null>(null);

  const selectedSpaceSummary = useMemo(
    () => spaces.find((space) => space.id === selectedSpaceId) ?? null,
    [spaces, selectedSpaceId],
  );
  const selectedSpaceVersionCount = selectedSpace?.versions.length ?? 0;
  const selectedSpaceStatus = selectedSpace?.status ?? 'draft';
  const selectedSpaceFiles = selectedSpace?.files ?? [];
  const fileUsageMap = useMemo(() => {
    const usage = new Map<number, number>();
    for (const component of selectedSpace?.components ?? []) {
      usage.set(component.spaceFileId, (usage.get(component.spaceFileId) ?? 0) + 1);
    }
    return usage;
  }, [selectedSpace?.components]);

  const refresh = async (nextSelectedSpaceId?: number | null) => {
    const spaceResult = await apiService.listCuratorSpaces();
    setSpaces(spaceResult.items);

    const candidateId =
      nextSelectedSpaceId ??
      selectedSpaceId ??
      parseSpaceIdFromHash() ??
      spaceResult.items[0]?.id ??
      null;
    if (candidateId !== null) {
      setSelectedSpaceId(candidateId);
      const nextHash = `#/debug/curator-space-management?spaceId=${candidateId}`;
      if (window.location.hash !== nextHash) {
        window.history.replaceState(null, '', nextHash);
      }
      const detail = await apiService.getCuratorSpace(candidateId);
      setSelectedSpace(detail);
      setSpaceName(detail.name);
      setSpaceDescription(detail.description ?? '');
      setSpaceStatus(detail.status as 'draft' | 'reviewed' | 'published' | 'archived');
      setComponentDrafts(
        detail.components.map((component) => ({
          componentKey: component.componentKey,
          label: component.label,
          spaceFileId: component.spaceFileId,
          position: component.position,
          rotation: component.rotation,
          scale: component.scale,
          sortOrder: component.sortOrder,
        })),
      );
      setPublishForm({
        versionName: detail.versions[0]?.versionName ?? '',
        memo: detail.versions[0]?.memo ?? '',
        displayName: detail.publicProfile?.displayName ?? detail.name,
        summary: detail.publicProfile?.summary ?? detail.description ?? '',
        locationSummary: detail.publicProfile?.locationSummary ?? '큐레이터 공간',
        thumbnailImagePath: detail.publicProfile?.thumbnailImagePath ?? detail.thumbnailImagePath ?? '',
        searchKeywords: detail.publicProfile?.searchKeywords ?? [],
        isFeatured: detail.publicProfile?.isFeatured ?? false,
        isDefault: detail.publicProfile?.isDefault ?? false,
        displayOrder: detail.publicProfile?.displayOrder ?? 0,
      });
      setKeywordInput((detail.publicProfile?.searchKeywords ?? []).join(', '));
    } else {
      setSelectedSpace(null);
      setSelectedSpaceId(null);
      setSpaceName('');
      setSpaceDescription('');
      setSpaceStatus('draft');
      setComponentDrafts([]);
      setNewSpaceThumbnailPath(null);
    }
  };

  useEffect(() => {
    void refresh().catch((loadError: unknown) => {
      setError(loadError instanceof Error ? loadError.message : '공간 목록을 불러오지 못했습니다.');
    });
  }, []);

  useEffect(() => {
    if (selectedSpaceId !== null) {
      return;
    }

    const routeSpaceId = parseSpaceIdFromHash();
    if (routeSpaceId !== null) {
      setSelectedSpaceId(routeSpaceId);
    }
  }, [selectedSpaceId]);

  useEffect(() => {
    if (!keywordInput.trim()) {
      setPublishForm((current) => ({ ...current, searchKeywords: [] }));
      return;
    }
    setPublishForm((current) => ({
      ...current,
      searchKeywords: keywordInput
        .split(',')
        .map((token) => token.trim())
        .filter(Boolean),
    }));
  }, [keywordInput]);

  const handleUpload = async (filesToUpload: File[]) => {
    if (filesToUpload.length === 0) {
      setError('업로드할 GLB 파일을 선택하세요.');
      return;
    }
    if (!selectedSpace) {
      setError('먼저 공간을 선택하세요.');
      return;
    }
    if (uploading) {
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const uploadedNames: string[] = [];
      for (const file of filesToUpload.slice(0, 5)) {
        // Upload sequentially so a single failure does not drop the whole batch.
        await apiService.uploadCuratorSpaceFile(selectedSpace.id, file);
        uploadedNames.push(file.name);
      }
      setSelectedFiles([]);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      setToast(`${uploadedNames.length} GLB file${uploadedNames.length === 1 ? '' : 's'} uploaded.`);
      await refresh(selectedSpace.id);
    } catch (uploadError: unknown) {
      setError(uploadError instanceof Error ? uploadError.message : '파일 업로드에 실패했습니다.');
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteFile = async (file: CuratorSpaceFile) => {
    if (!selectedSpace) {
      setError('먼저 공간을 선택하세요.');
      return;
    }
    if ((fileUsageMap.get(file.id) ?? 0) > 0) {
      setError('이 GLB는 component에서 사용 중이어서 삭제할 수 없습니다.');
      return;
    }
    const confirmed = window.confirm(`"${file.originalFileName}" GLB 파일을 삭제할까요?`);
    if (!confirmed) {
      return;
    }

    try {
      await apiService.deleteCuratorSpaceFile(selectedSpace.id, file.id);
      setToast(`${file.originalFileName} 파일을 삭제했습니다.`);
      await refresh(selectedSpace.id);
    } catch (deleteError: unknown) {
      setError(deleteError instanceof Error ? deleteError.message : '파일 삭제에 실패했습니다.');
    }
  };

  const handleCreateSpace = async () => {
    if (!newSpaceName.trim()) {
      setError('공간 이름을 입력하세요.');
      return;
    }
    setSavingSpace(true);
    setError(null);
    try {
      const detail = await apiService.createCuratorSpace({
        name: newSpaceName.trim(),
        description: newSpaceDescription.trim() || null,
        thumbnailImagePath: newSpaceThumbnailPath,
      });
      setToast('공간을 생성했습니다.');
      setNewSpaceName('');
      setNewSpaceDescription('');
      setNewSpaceThumbnailPath(null);
      if (newThumbnailInputRef.current) {
        newThumbnailInputRef.current.value = '';
      }
      await refresh(detail.id);
    } catch (createError: unknown) {
      setError(createError instanceof Error ? createError.message : '공간 생성에 실패했습니다.');
    } finally {
      setSavingSpace(false);
    }
  };

  const handleUpdateSpace = async () => {
    if (!selectedSpace) return;
    setSavingSpace(true);
    setError(null);
    try {
      const detail = await apiService.updateCuratorSpace(selectedSpace.id, {
        name: spaceName.trim() || selectedSpace.name,
        description: spaceDescription.trim() || null,
        status: spaceStatus,
        thumbnailImagePath: publishForm.thumbnailImagePath?.trim() || null,
      });
      setSelectedSpace(detail);
      setToast('공간을 저장했습니다.');
      await refresh(detail.id);
    } catch (updateError: unknown) {
      setError(updateError instanceof Error ? updateError.message : '공간 저장에 실패했습니다.');
    } finally {
      setSavingSpace(false);
    }
  };

  const handleSaveComponents = async () => {
    if (!selectedSpace) {
      setError('먼저 공간을 선택하세요.');
      return;
    }
    setSavingComponents(true);
    setError(null);
    try {
      const detail = await apiService.saveCuratorSpaceComponents(selectedSpace.id, { components: componentDrafts });
      setSelectedSpace(detail);
      setToast('구성요소를 저장했습니다.');
      await refresh(detail.id);
    } catch (saveError: unknown) {
      setError(saveError instanceof Error ? saveError.message : 'component 저장에 실패했습니다.');
    } finally {
      setSavingComponents(false);
    }
  };

  const handlePublish = async () => {
    if (!selectedSpace) {
      setError('먼저 공간을 선택하세요.');
      return;
    }
    setPublishing(true);
    setError(null);
    try {
      const detail = await apiService.publishCuratorSpace(selectedSpace.id, {
        versionName: publishForm.versionName?.trim() || null,
        memo: publishForm.memo?.trim() || null,
        displayName: publishForm.displayName?.trim() || selectedSpace.name,
        summary: publishForm.summary?.trim() || null,
        locationSummary: publishForm.locationSummary?.trim() || null,
        thumbnailImagePath: publishForm.thumbnailImagePath?.trim() || null,
        searchKeywords: publishForm.searchKeywords ?? [],
        isFeatured: publishForm.isFeatured ?? false,
        isDefault: publishForm.isDefault ?? false,
        displayOrder: publishForm.displayOrder ?? 0,
      });
      setSelectedSpace(detail);
      setToast('공간을 발행했습니다.');
      await refresh(detail.id);
    } catch (publishError: unknown) {
      setError(publishError instanceof Error ? publishError.message : '공간 publish에 실패했습니다.');
    } finally {
      setPublishing(false);
    }
  };

  const handleThumbnailUpload = async (file: File, target: 'create' | 'publish') => {
    if (file.type && !file.type.startsWith('image/')) {
      setError('썸네일은 이미지 파일만 업로드할 수 있습니다.');
      return;
    }

    if (target === 'create') {
      setNewSpaceThumbnailUploading(true);
    } else {
      setPublishThumbnailUploading(true);
    }
    setError(null);

    try {
      const uploaded = await apiService.uploadCuratorSpaceThumbnail(file);
      if (target === 'create') {
        setNewSpaceThumbnailPath(uploaded.thumbnailImagePath);
        if (newThumbnailInputRef.current) {
          newThumbnailInputRef.current.value = '';
        }
      } else {
        setPublishForm((current) => ({ ...current, thumbnailImagePath: uploaded.thumbnailImagePath }));
        if (publishThumbnailInputRef.current) {
          publishThumbnailInputRef.current.value = '';
        }
      }
      setToast('썸네일을 업로드했습니다.');
    } catch (uploadError: unknown) {
      setError(uploadError instanceof Error ? uploadError.message : '썸네일 업로드에 실패했습니다.');
    } finally {
      if (target === 'create') {
        setNewSpaceThumbnailUploading(false);
      } else {
        setPublishThumbnailUploading(false);
      }
    }
  };

  const addComponent = () => {
    const draft = createEmptyComponentDraft(selectedSpaceFiles);
    if (!draft) {
      setError('먼저 GLB 파일을 업로드하세요.');
      return;
    }
    setComponentDrafts((current) => [
      ...current,
      {
        ...draft,
        componentKey: `component-${current.length + 1}`,
        sortOrder: current.length,
      },
    ]);
  };

  const updateComponent = (index: number, next: Partial<ComponentDraft>) => {
    setComponentDrafts((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index
          ? {
              ...item,
              ...next,
              position: next.position ? { ...item.position, ...next.position } : item.position,
              rotation: next.rotation ? { ...item.rotation, ...next.rotation } : item.rotation,
              scale: next.scale ? { ...item.scale, ...next.scale } : item.scale,
            }
          : item,
      ),
    );
  };

  const removeComponent = (index: number) => {
    setComponentDrafts((current) => current.filter((_, itemIndex) => itemIndex !== index));
  };

  const handleFileSelection = async (event: ChangeEvent<HTMLInputElement>) => {
    const nextFiles = Array.from(event.target.files ?? []).filter((file) => {
      const name = file.name.toLowerCase();
      return name.endsWith('.glb') || name.endsWith('.gltf');
    });

    if (nextFiles.length === 0) {
      setSelectedFiles([]);
      setError('GLB 또는 GLTF 파일을 선택하세요.');
      event.target.value = '';
      return;
    }

    if (nextFiles.length > 5) {
      nextFiles.length = 5;
      setToast('최대 5개까지 업로드됩니다.');
    }

    setSelectedFiles(nextFiles);
    event.target.value = '';
    await handleUpload(nextFiles);
  };

  return (
    <div className="min-h-screen bg-[#09090b] text-stone-100">
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-4 rounded-[28px] border border-white/10 bg-black/35 p-5 backdrop-blur-2xl lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-[0.28em] text-[color:var(--color-accent)]">
              {copy.headerEyebrow}
            </p>
            <h1 className="mt-2 text-3xl font-semibold text-white">{copy.title}</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-stone-400">{copy.subtitle}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-white/10 bg-black/35 px-4 py-3 backdrop-blur-xl">
              <p className="text-[11px] uppercase tracking-[0.2em] text-amber-300">{copy.spacesLabel}</p>
              <p className="mt-1 text-2xl font-semibold text-white">{spaces.length.toString().padStart(2, '0')}</p>
              <p className="text-xs text-stone-400">{copy.spacesSub}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/35 px-4 py-3 backdrop-blur-xl">
              <p className="text-[11px] uppercase tracking-[0.2em] text-[color:var(--color-accent)]">{copy.filesLabel}</p>
              <p className="mt-1 text-2xl font-semibold text-white">{selectedSpaceFiles.length.toString().padStart(2, '0')}</p>
              <p className="text-xs text-stone-400">{copy.filesSub}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/35 px-4 py-3 backdrop-blur-xl">
              <p className="text-[11px] uppercase tracking-[0.2em] text-emerald-300">{copy.selectedLabel}</p>
              <p className="mt-1 text-2xl font-semibold text-white">{selectedSpaceVersionCount.toString().padStart(2, '0')}</p>
              <p className="text-xs text-stone-400">
                {formatSpaceStatusLabel(selectedSpaceStatus)} · {copy.selectedSub}
              </p>
            </div>
          </div>
        </header>

        {error ? (
          <div className="rounded-2xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
            {error}
          </div>
        ) : null}

        <section className="grid gap-4 xl:grid-cols-[0.92fr_1.08fr]">
          <div className="space-y-4">
            <div className="rounded-[28px] border border-white/10 bg-black/35 p-5 backdrop-blur-2xl">
              <p className="text-[11px] uppercase tracking-[0.22em] text-[color:var(--color-accent)]">GLB 업로드</p>
              <div className="mt-4 space-y-3">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".glb,.gltf"
                  multiple
                  onChange={(event) => {
                    void handleFileSelection(event);
                  }}
                  className="block w-full text-sm text-stone-300 file:mr-4 file:rounded-xl file:border-0 file:bg-white/10 file:px-4 file:py-2 file:text-stone-100 hover:file:bg-white/15"
                />
                <p className="text-xs text-stone-500">
                  파일을 선택하면 즉시 업로드됩니다. 한 번에 최대 5개까지 선택할 수 있습니다.
                </p>
                {selectedFiles.length > 0 ? (
                  <div className="rounded-2xl border border-white/10 bg-black/25 px-3 py-2 text-xs text-stone-300">
                    선택됨: {selectedFiles.map((file) => file.name).join(', ')}
                  </div>
                ) : null}
                <div className="rounded-2xl border border-cyan-300/20 bg-cyan-300/10 px-4 py-2 text-sm font-medium text-[color:var(--color-text-accent)]">
                  {uploading ? '업로드 중...' : '파일을 선택하면 즉시 업로드됩니다'}
                </div>
              </div>

              <div className="mt-5 grid gap-3">
                {selectedSpaceFiles.length > 0 ? (
                  selectedSpaceFiles.map((file) => (
                    <div key={file.id} className="rounded-2xl border border-white/10 bg-white/5 p-4 transition hover:border-cyan-300/20 hover:bg-white/10">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-medium text-white">{file.originalFileName}</p>
                          <p className="mt-1 break-all text-[11px] text-stone-500">{file.fileUrl}</p>
                        </div>
                        <div className="flex flex-col items-end gap-2">
                          <span className="rounded-full border border-white/10 bg-black/30 px-2 py-1 text-[11px] text-stone-300">
                            {Math.round(file.fileSizeBytes / 1024)} KB
                          </span>
                          <button
                            type="button"
                            onClick={() => void handleDeleteFile(file)}
                            disabled={(fileUsageMap.get(file.id) ?? 0) > 0}
                            className="rounded-full border border-rose-400/20 bg-rose-500/10 px-3 py-1 text-[11px] text-rose-100 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                            title={(fileUsageMap.get(file.id) ?? 0) > 0 ? '구성요소에서 사용 중이라 삭제할 수 없습니다.' : '파일 삭제'}
                          >
                            {(fileUsageMap.get(file.id) ?? 0) > 0 ? '사용 중' : '삭제'}
                          </button>
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-stone-500">
                        <span className="rounded-full border border-white/10 bg-black/20 px-2 py-1">{file.mimeType || 'unknown'}</span>
                        <span className="rounded-full border border-white/10 bg-black/20 px-2 py-1">{formatDate(file.createdAt)}</span>
                        {(fileUsageMap.get(file.id) ?? 0) > 0 ? (
                          <span className="rounded-full border border-amber-300/20 bg-amber-300/10 px-2 py-1 text-amber-100">
                            구성요소 {(fileUsageMap.get(file.id) ?? 0)}개에서 사용 중
                          </span>
                        ) : null}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-3xl border border-dashed border-white/10 bg-black/20 p-5 text-sm text-stone-400">
                    아직 이 공간에 업로드된 GLB가 없습니다. 첫 자산을 업로드하면 공간 구성을 시작할 수 있습니다.
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-[28px] border border-white/10 bg-black/35 p-5 backdrop-blur-2xl">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.22em] text-amber-300">{copy.spaceListLabel}</p>
                  <h2 className="mt-2 text-xl font-semibold text-white">{copy.spaceListTitle}</h2>
                  <p className="mt-1 text-sm text-stone-400">{copy.spaceListSub}</p>
                </div>
              </div>

              <div className="mt-5 flex flex-wrap gap-2">
                {spaces.map((space) => (
                  <button
                    key={space.id}
                    type="button"
                    onClick={() => void refresh(space.id)}
                    className={`rounded-2xl border px-3 py-2 text-left text-xs transition ${
                      selectedSpaceId === space.id
                        ? 'border-cyan-300/40 bg-cyan-300/15 text-[color:var(--color-text-accent)]'
                        : 'border-white/10 bg-white/5 text-stone-300 hover:bg-white/10'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium text-white">{space.name}</span>
                      <span className="rounded-full border border-white/10 bg-black/25 px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] text-stone-300">
                        {space.status}
                      </span>
                    </div>
                    <div className="mt-1 text-[11px] text-stone-500">
                      {space.componentCount} comps · {space.slotCount} slots
                    </div>
                  </button>
                ))}
              </div>

              <div className="mt-4 rounded-3xl border border-white/10 bg-white/5 p-4 text-sm text-stone-400">
                {copy.spacePickerHint}
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-[28px] border border-white/10 bg-black/35 p-5 backdrop-blur-2xl">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.22em] text-emerald-300">{copy.createTitle}</p>
                  <h2 className="mt-2 text-xl font-semibold text-white">{copy.createTitle}</h2>
                  <p className="mt-1 text-sm text-stone-400">{copy.createSub}</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setNewSpaceName('');
                    setNewSpaceDescription('');
                    setNewSpaceThumbnailPath(null);
                    if (newThumbnailInputRef.current) {
                      newThumbnailInputRef.current.value = '';
                    }
                  }}
                  className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-stone-200 transition hover:bg-white/10"
                >
                  {copy.reset}
                </button>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <input
                  value={newSpaceName}
                  onChange={(event) => setNewSpaceName(event.target.value)}
                  placeholder={copy.namePlaceholder}
                  className="rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none placeholder:text-stone-500"
                />
                <input
                  value={newSpaceDescription}
                  onChange={(event) => setNewSpaceDescription(event.target.value)}
                  placeholder={copy.descriptionPlaceholder}
                  className="rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none placeholder:text-stone-500"
                />
              </div>

              <div className="mt-3 rounded-3xl border border-white/10 bg-white/5 p-4">
                <p className="text-[11px] uppercase tracking-[0.18em] text-stone-500">{copy.thumbnailLabel}</p>
                <p className="mt-2 text-xs leading-5 text-stone-400">{copy.thumbnailHelp}</p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <input
                    ref={newThumbnailInputRef}
                    type="file"
                    accept="image/*"
                    disabled={newSpaceThumbnailUploading}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = '';
                      if (file) {
                        void handleThumbnailUpload(file, 'create');
                      }
                    }}
                    className="block max-w-full text-sm text-stone-300 file:mr-4 file:rounded-xl file:border-0 file:bg-white/10 file:px-4 file:py-2 file:text-stone-100 hover:file:bg-white/15"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setNewSpaceThumbnailPath(null);
                      if (newThumbnailInputRef.current) {
                        newThumbnailInputRef.current.value = '';
                      }
                    }}
                    disabled={newSpaceThumbnailUploading}
                    className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-stone-200 transition hover:bg-white/10"
                  >
                    {copy.thumbnailClear}
                  </button>
                </div>
                {newSpaceThumbnailPath ? (
                  <div className="mt-3 overflow-hidden rounded-2xl border border-white/10 bg-black/30">
                    <SpaceThumbnailMosaic images={[newSpaceThumbnailPath]} alt={newSpaceName || copy.thumbnailLabel} className="h-36 w-full" />
                    <div className="flex items-center justify-between gap-3 px-3 py-2 text-[11px] text-stone-400">
                      <span className="truncate">{newSpaceThumbnailPath}</span>
                      <span>{copy.thumbnailUpload}</span>
                    </div>
                  </div>
                ) : (
                  <p className="mt-3 text-xs leading-5 text-stone-500">{copy.thumbnailAutoHelp}</p>
                )}
                {newSpaceThumbnailUploading ? (
                  <p className="mt-2 text-xs text-amber-200">{copy.thumbnailUploading}</p>
                ) : null}
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void handleCreateSpace()}
                  disabled={savingSpace}
                  className="rounded-2xl border border-emerald-300/20 bg-emerald-300/10 px-4 py-2 text-sm font-medium text-emerald-50 transition hover:bg-emerald-300/15 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {savingSpace ? copy.creating : copy.createButton}
                </button>
              </div>

              <p className="mt-3 text-xs text-stone-500">
                {copy.createHint}
              </p>
            </div>

            {selectedSpace ? (
              <div className="rounded-[28px] border border-white/10 bg-black/35 p-5 backdrop-blur-2xl">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.22em] text-[color:var(--color-accent)]">{copy.selectedSpaceLabel}</p>
                  <h2 className="mt-1 text-2xl font-semibold text-white">{selectedSpace.name}</h2>
                  <p className="mt-2 text-sm text-stone-400">{selectedSpace.description || copy.noDescription}</p>
                </div>
                <div className="flex items-start gap-3">
                  {selectedSpace.publicProfile ? (
                    <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-right">
                      <p className="text-[11px] uppercase tracking-[0.18em] text-amber-300">{copy.publicLabel}</p>
                      <p className="mt-1 text-sm text-white">{selectedSpace.publicProfile.displayName}</p>
                    </div>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => void handleUpdateSpace()}
                    disabled={!selectedSpace || savingSpace}
                    className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-stone-100 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {savingSpace ? copy.creating : copy.saveChanges}
                  </button>
                </div>
                </div>

                <div className="mt-4 rounded-3xl border border-white/10 bg-white/5 p-4">
                  <p className="text-[11px] uppercase tracking-[0.2em] text-stone-500">{copy.modeLabel}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <span className="rounded-full border border-white/10 bg-black/30 px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-stone-300">
                      {copy.existingEdit}
                    </span>
                    <span className="rounded-full border border-white/10 bg-black/30 px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-stone-300">
                      {copy.separateCreate}
                    </span>
                  </div>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <input
                    value={spaceName}
                    onChange={(event) => setSpaceName(event.target.value)}
                    placeholder={copy.selectedNamePlaceholder}
                    className="rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none placeholder:text-stone-500"
                  />
                  <input
                    value={publishForm.locationSummary ?? ''}
                    onChange={(event) => setPublishForm((current) => ({ ...current, locationSummary: event.target.value }))}
                    placeholder={copy.locationPlaceholder}
                    className="rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none placeholder:text-stone-500"
                  />
                  <div className="rounded-2xl border border-white/10 bg-black/40 px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-[11px] uppercase tracking-[0.16em] text-stone-500">{copy.thumbnailLabel}</p>
                        <p className="mt-1 text-xs text-stone-400">{copy.thumbnailHelp}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setPublishForm((current) => ({ ...current, thumbnailImagePath: '' }));
                          if (publishThumbnailInputRef.current) {
                            publishThumbnailInputRef.current.value = '';
                          }
                        }}
                        disabled={publishThumbnailUploading}
                        className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-stone-200 transition hover:bg-white/10"
                      >
                        {copy.thumbnailClear}
                      </button>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <input
                        ref={publishThumbnailInputRef}
                        type="file"
                        accept="image/*"
                        disabled={publishThumbnailUploading}
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          event.target.value = '';
                          if (file) {
                            void handleThumbnailUpload(file, 'publish');
                          }
                        }}
                        className="block max-w-full text-sm text-stone-300 file:mr-4 file:rounded-xl file:border-0 file:bg-white/10 file:px-4 file:py-2 file:text-stone-100 hover:file:bg-white/15"
                      />
                      <span className="text-xs text-stone-500">
                        {publishThumbnailUploading ? copy.thumbnailUploading : copy.thumbnailUpload}
                      </span>
                    </div>
                    {publishForm.thumbnailImagePath ? (
                      <div className="mt-3 overflow-hidden rounded-2xl border border-white/10 bg-black/30">
                        <SpaceThumbnailMosaic
                          images={[publishForm.thumbnailImagePath]}
                          alt={publishForm.displayName || selectedSpace.name}
                          className="h-36 w-full"
                        />
                        <div className="flex items-center justify-between gap-3 px-3 py-2 text-[11px] text-stone-400">
                          <span className="truncate">{publishForm.thumbnailImagePath}</span>
                          <span>{copy.thumbnailLabel}</span>
                        </div>
                      </div>
                    ) : (
                      <p className="mt-3 text-xs leading-5 text-stone-500">{copy.thumbnailAutoHelp}</p>
                    )}
                  </div>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <textarea
                    value={spaceDescription}
                    onChange={(event) => setSpaceDescription(event.target.value)}
                    placeholder={copy.selectedDescPlaceholder}
                    rows={3}
                    className="rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none placeholder:text-stone-500"
                  />
                  <textarea
                    value={publishForm.summary ?? ''}
                    onChange={(event) => setPublishForm((current) => ({ ...current, summary: event.target.value }))}
                    placeholder={copy.summaryPlaceholder}
                    rows={3}
                    className="rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none placeholder:text-stone-500"
                  />
                </div>

                <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <input
                    value={publishForm.versionName ?? ''}
                    onChange={(event) => setPublishForm((current) => ({ ...current, versionName: event.target.value }))}
                    placeholder={copy.versionPlaceholder}
                    className="rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none placeholder:text-stone-500"
                  />
                  <textarea
                    value={publishForm.memo ?? ''}
                    onChange={(event) => setPublishForm((current) => ({ ...current, memo: event.target.value }))}
                    placeholder={copy.memoPlaceholder}
                    rows={3}
                    className="rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none placeholder:text-stone-500"
                  />
                  <input
                    value={publishForm.displayName ?? ''}
                    onChange={(event) => setPublishForm((current) => ({ ...current, displayName: event.target.value }))}
                    placeholder={copy.displayPlaceholder}
                    className="rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none placeholder:text-stone-500"
                  />
                  <input
                    value={keywordInput}
                    onChange={(event) => setKeywordInput(event.target.value)}
                    placeholder={copy.keywordPlaceholder}
                    className="rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none placeholder:text-stone-500"
                  />
                  <input
                    type="number"
                    value={publishForm.displayOrder ?? 0}
                    onChange={(event) =>
                      setPublishForm((current) => ({ ...current, displayOrder: Number(event.target.value) }))
                    }
                    className="rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none placeholder:text-stone-500"
                  />
                  <label className="flex items-center gap-2 rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-stone-300">
                    <input
                      type="checkbox"
                      checked={publishForm.isFeatured ?? false}
                      onChange={(event) => setPublishForm((current) => ({ ...current, isFeatured: event.target.checked }))}
                    />
                    {copy.featured}
                  </label>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <label className="flex items-center gap-2 rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-stone-300">
                    <input
                      type="checkbox"
                      checked={publishForm.isDefault ?? false}
                      onChange={(event) => setPublishForm((current) => ({ ...current, isDefault: event.target.checked }))}
                    />
                    {copy.defaultLabel}
                  </label>
                  <label className="flex items-center gap-2 rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-stone-300">
                    <span>상태</span>
                    <select
                      value={spaceStatus}
                      onChange={(event) => setSpaceStatus(event.target.value as typeof spaceStatus)}
                      className="bg-transparent text-stone-100 outline-none"
                    >
                      <option value="draft">초안</option>
                      <option value="reviewed">검토 완료</option>
                      <option value="published">발행됨</option>
                      <option value="archived">보관됨</option>
                    </select>
                  </label>
                  <button
                    type="button"
                    onClick={() => void handlePublish()}
                    disabled={publishing}
                    className="rounded-2xl border border-amber-300/20 bg-amber-300/10 px-4 py-2 text-sm font-medium text-amber-50 transition hover:bg-amber-300/15 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {publishing ? copy.publishing : copy.publishButton}
                  </button>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-stone-300">
                    {selectedSpace.status}
                  </span>
                  <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] text-stone-300">
                    {selectedSpace.components.length}{copy.componentLabel}
                  </span>
                  <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] text-stone-300">
                    {selectedSpace.slots.length}개 슬롯
                  </span>
                  <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] text-stone-300">
                    {selectedSpaceVersionCount}개 버전
                  </span>
                </div>

                <div className="mt-5 grid gap-3">
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.18em] text-stone-500">{copy.componentsLabel}</p>
                    <p className="mt-1 text-xs text-stone-500">{copy.componentsHelp}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={addComponent}
                      className="rounded-2xl border border-cyan-300/20 bg-cyan-300/10 px-4 py-2 text-sm font-medium text-[color:var(--color-text-accent)]"
                    >
                      {copy.addComponent}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleSaveComponents()}
                      disabled={savingComponents}
                      className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-stone-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {savingComponents ? copy.creating : copy.saveComponents}
                    </button>
                  </div>
                  <div className="space-y-3">
                    {componentDrafts.map((component, index) => (
                      <div key={component.componentKey} className="rounded-3xl border border-white/10 bg-white/5 p-4">
                        <div className="grid gap-3 lg:grid-cols-[1fr_1fr_0.8fr]">
                          <label className="space-y-1">
                            <div className="text-[11px] uppercase tracking-[0.18em] text-stone-500">키</div>
                            <input
                              value={component.componentKey}
                              onChange={(event) => updateComponent(index, { componentKey: event.target.value })}
                              className="w-full rounded-2xl border border-white/10 bg-black/35 px-3 py-2 text-sm text-white outline-none"
                            />
                          </label>
                          <label className="space-y-1">
                            <div className="text-[11px] uppercase tracking-[0.18em] text-stone-500">이름표</div>
                            <input
                              value={component.label}
                              onChange={(event) => updateComponent(index, { label: event.target.value })}
                              className="w-full rounded-2xl border border-white/10 bg-black/35 px-3 py-2 text-sm text-white outline-none"
                            />
                          </label>
                          <label className="space-y-1">
                            <div className="text-[11px] uppercase tracking-[0.18em] text-stone-500">파일</div>
                            <select
                              value={component.spaceFileId}
                              onChange={(event) => updateComponent(index, { spaceFileId: Number(event.target.value) })}
                              className="w-full rounded-2xl border border-white/10 bg-black/35 px-3 py-2 text-sm text-white outline-none"
                            >
                              {selectedSpaceFiles.map((file) => (
                                <option key={file.id} value={file.id}>
                                  {file.originalFileName}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>

                        <div className="mt-3 grid gap-3 md:grid-cols-3">
                          <NumberField label="Position X" value={component.position.x} onChange={(value) => updateComponent(index, { position: { ...component.position, x: value } })} />
                          <NumberField label="Position Y" value={component.position.y} onChange={(value) => updateComponent(index, { position: { ...component.position, y: value } })} />
                          <NumberField label="Position Z" value={component.position.z} onChange={(value) => updateComponent(index, { position: { ...component.position, z: value } })} />
                          <NumberField label="Rotation X" value={component.rotation?.x ?? 0} onChange={(value) => updateComponent(index, { rotation: { ...(component.rotation ?? emptyVector()), x: value } })} />
                          <NumberField label="Rotation Y" value={component.rotation?.y ?? 0} onChange={(value) => updateComponent(index, { rotation: { ...(component.rotation ?? emptyVector()), y: value } })} />
                          <NumberField label="Rotation Z" value={component.rotation?.z ?? 0} onChange={(value) => updateComponent(index, { rotation: { ...(component.rotation ?? emptyVector()), z: value } })} />
                          <NumberField label="Scale X" value={component.scale?.x ?? 1} onChange={(value) => updateComponent(index, { scale: { ...(component.scale ?? emptyVector(1, 1, 1)), x: value } })} />
                          <NumberField label="Scale Y" value={component.scale?.y ?? 1} onChange={(value) => updateComponent(index, { scale: { ...(component.scale ?? emptyVector(1, 1, 1)), y: value } })} />
                          <NumberField label="Scale Z" value={component.scale?.z ?? 1} onChange={(value) => updateComponent(index, { scale: { ...(component.scale ?? emptyVector(1, 1, 1)), z: value } })} />
                        </div>

                        <div className="mt-3 flex items-center justify-between">
                          <p className="text-xs text-stone-500">sortOrder {component.sortOrder}</p>
                          <button
                            type="button"
                            onClick={() => removeComponent(index)}
                            className="rounded-full border border-rose-300/20 bg-rose-300/10 px-3 py-1.5 text-xs text-rose-100"
                          >
                            삭제
                          </button>
                        </div>
                      </div>
                    ))}
                    {componentDrafts.length === 0 ? (
                      <div className="rounded-3xl border border-white/10 bg-black/20 p-4 text-sm text-stone-400">
                        {copy.componentHint}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-[28px] border border-white/10 bg-black/35 p-5 text-sm text-stone-400 backdrop-blur-2xl">
                {copy.summaryEmpty}
              </div>
            )}
          </div>
        </section>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-[28px] border border-white/10 bg-black/35 p-5 backdrop-blur-2xl">
            <p className="text-[11px] uppercase tracking-[0.22em] text-[color:var(--color-accent)]">{copy.currentVersions}</p>
            <div className="mt-4 grid gap-3">
              {selectedSpace?.versions.map((version) => (
                <div key={version.id} className="rounded-3xl border border-white/10 bg-white/5 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-lg font-medium text-white">{version.versionName || `버전 ${version.id}`}</p>
                      <p className="mt-1 text-xs text-stone-500">{formatDate(version.createdAt)}</p>
                    </div>
                    <span className="rounded-full border border-white/10 bg-black/30 px-3 py-1 text-xs text-stone-300">
                      #{version.id}
                    </span>
                  </div>
                  {version.memo ? <p className="mt-3 text-sm text-stone-300">{version.memo}</p> : null}
                </div>
              ))}
              {selectedSpace?.versions.length ? null : (
                <div className="rounded-3xl border border-white/10 bg-black/20 p-4 text-sm text-stone-400">
                  {copy.versionHint}
                </div>
              )}
            </div>
          </div>

          <div className="rounded-[28px] border border-white/10 bg-black/35 p-5 backdrop-blur-2xl">
            <p className="text-[11px] uppercase tracking-[0.22em] text-amber-300">{copy.summaryTitle}</p>
            {selectedSpaceSummary ? (
              <div className="mt-4 rounded-3xl border border-white/10 bg-white/5 p-4">
                <p className="text-xl font-medium text-white">{selectedSpaceSummary.name}</p>
                <p className="mt-2 text-sm text-stone-300">{selectedSpaceSummary.description || copy.noDescription}</p>
                <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-stone-400">
                  <span>{copy.fileLabel} {selectedSpaceSummary.fileCount}</span>
                  <span>{copy.componentLabel} {selectedSpaceSummary.componentCount}</span>
                  <span>{copy.slotLabel} {selectedSpaceSummary.slotCount}</span>
                </div>
                {selectedSpaceSummary.publicProfile ? (
                  <div className="mt-4 rounded-2xl border border-cyan-300/20 bg-cyan-300/10 p-3 text-sm text-[color:var(--color-text-accent)]">
                    <p className="font-medium">{selectedSpaceSummary.publicProfile.displayName}</p>
                    <p className="mt-1 text-[rgba(232,240,213,0.8)]">{selectedSpaceSummary.publicProfile.locationSummary}</p>
                    <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-[rgba(232,240,213,0.9)]">
                      {selectedSpaceSummary.publicProfile.isFeatured ? (
                        <span className="rounded-full border border-cyan-200/25 bg-black/20 px-2 py-0.5">{copy.featured}</span>
                      ) : null}
                      {selectedSpaceSummary.publicProfile.isDefault ? (
                        <span className="rounded-full border border-cyan-200/25 bg-black/20 px-2 py-0.5">{copy.defaultLabel}</span>
                      ) : null}
                      <span className="rounded-full border border-cyan-200/25 bg-black/20 px-2 py-0.5">
                        {copy.orderLabel} {selectedSpaceSummary.publicProfile.displayOrder}
                      </span>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="mt-4 rounded-3xl border border-white/10 bg-white/5 p-4 text-sm text-stone-400">
                {copy.summaryEmpty}
              </div>
            )}
          </div>
        </div>
      </div>

      {toast ? (
        <div className="fixed bottom-5 right-5 z-50 rounded-2xl border border-white/10 bg-black/70 px-4 py-3 text-sm text-stone-100 backdrop-blur-xl">
          {toast}
        </div>
      ) : null}
    </div>
  );
}
