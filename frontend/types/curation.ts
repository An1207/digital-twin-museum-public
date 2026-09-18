// ============================================================
// Curation Types - 3개 조합 선택 (테마 + 시대 + 감정)
// ============================================================

export type Category = 'theme' | 'era' | 'emotion';

// 축 (Axis) - 테마, 시대, 감정
export interface CurationOption {
  id: number;
  optionKey: string;
  labelKo: string;
  sortOrder: number;
  displayDescription: string;
  yearRangeLabel?: string;
  algorithmValue?: string;
}

export interface CurationAxis {
  category: Category;
  label: string;
  options: CurationOption[];
}

// 3개 조합 선택 상태
export interface SelectionState {
  themeOptionId: number | null;
  eraOptionId: number | null;
  emotionOptionId: number | null;
}

// API 응답 타입
export interface CurationOptionsResponse {
  axes: CurationAxis[];
}

// 배치 결과
export interface ArtworkPosition {
  x: number;
  y: number;
  z: number;
  rotationY: number;
  rotation?: SpaceVector3;
}

export interface Artwork {
  id: string;
  ownerUserId?: number | null;
  title: string;
  artist: string;
  originPeriod: string;
  eraYear: number;
  estimatedYear?: number | null;
  yearDisplay?: string;
  descriptionDefault: string;
  imagePath?: string;
  framedGlbUrl?: string | null;
  source?: string | null;
  sourceObjectId?: string | null;
  sourceQuery?: string | null;
  objectUrl?: string | null;
  providerMeta?: {
    visualProvider?: string | null;
    metaProvider?: string | null;
    metadataSource?: string | null;
  };
  recommendationReasons?: string[];
  estimatedYearReason?: string | null;
  scoreBreakdown?: {
    visual: number;
    theme: number;
    era: number;
    emotion: number;
    final: number;
  };
  recommendationReady?: boolean;
  recommendationSourceVersion?: string;
}

export interface Placement {
  slotNumber: number;
  slotKey?: string;
  slotSize?: {
    width: number;
    height: number;
    depth: number;
  };
  artwork: Artwork;
  position: ArtworkPosition;
  sortValue: number;
}

export interface GalleryInfo {
  mapUrl: string;
  entrySlotNumber: number;
}

export interface SelectedCurationOption {
  id: number;
  category: Category;
  optionKey: string;
  labelKo: string;
  yearRangeLabel?: string;
}

export interface LayoutResponse {
  layoutType: 'combined_options' | 'public_space';
  themeOption: SelectedCurationOption;
  eraOption: SelectedCurationOption;
  emotionOption: SelectedCurationOption;
  gallery: GalleryInfo;
  placements: Placement[];
  spaceComponents?: CuratorSpaceComponent[];
  presentationMode?: 'immediate' | 'sequential';
  spaceMeta?: {
    spaceKey: string;
    title: string;
    curatorDisplayName: string;
    locationSummary: string;
  };
}

export interface RecommendationProviderStatus {
  openaiConfigured: boolean;
  openaiPackageInstalled: boolean;
  clipAvailable: boolean;
  torchInstalled: boolean;
  transformersInstalled: boolean;
  visualProviderReady: boolean;
  metaProviderReady: boolean;
  visualProviderName?: string | null;
  metaProviderName?: string | null;
  featureCount?: number;
  readyCount?: number;
  featureVersion?: string;
  manifestPath?: string | null;
}

export interface RecommendationDebugItem extends Artwork {
  slotNumber: number;
  sortValue: number;
}

export interface RecommendationDebugResponse {
  status: string;
  featureVersion: string;
  selection: {
    themeOption: SelectedCurationOption;
    eraOption: SelectedCurationOption;
    emotionOption: SelectedCurationOption;
  };
  providerStatus: RecommendationProviderStatus;
  totalCount: number;
  items: RecommendationDebugItem[];
}

export interface GeneratedFramedAsset {
  artworkId: number;
  title?: string | null;
  artist?: string | null;
  assetFolderName: string;
  imagePath?: string | null;
  glbUrl?: string | null;
  generatedAt?: string | null;
  fileSizeBytes?: number | null;
  fileName: string;
  source?: string | null;
  sourceObjectId?: string | null;
  sourceQuery?: string | null;
  objectUrl?: string | null;
  notes?: {
    fit_mode?: string;
    generator_version?: string;
    rotation_fix_version?: string;
    image_orientation?: string;
    [key: string]: unknown;
  } | null;
}

export interface GeneratedFramedAssetListResponse {
  status: string;
  count: number;
  items: GeneratedFramedAsset[];
}

export interface AuthCuratorWorkspace {
  planStatus?: string | null;
  planKey?: string | null;
  quotaStoryGenerationsMonthly?: number | null;
  quotaTtsGenerationsMonthly?: number | null;
}

export interface AuthUser {
  id: number;
  username: string;
  email: string;
  displayName: string;
  roles: string[];
  primaryRole: string;
  curatorWorkspace?: AuthCuratorWorkspace | null;
}

export interface AuthSessionResponse {
  status: string;
  tokenType: string;
  accessToken: string;
  accessTokenExpiresIn: number;
  refreshToken: string;
  refreshTokenExpiresIn: number;
  user: AuthUser;
}

export interface AuthMeResponse {
  status: string;
  user: AuthUser;
}

export interface PublishedSpaceSummary {
  id: number;
  spaceKey: string;
  title: string;
  curatorUserId: number;
  curatorDisplayName: string;
  summary: string;
  locationSummary: string;
  thumbnailImagePath?: string | null;
  isFeatured: boolean;
  isDefault: boolean;
  publishedAt?: string | null;
  displayOrder: number;
}

export interface PublishedSpaceDetail extends PublishedSpaceSummary {
  description: string;
  searchKeywords: string[];
  viewerLayout: LayoutResponse;
  pieceCount: number;
}

export interface StorytellingTtsAsset {
  id: number;
  storytellingVersionId: number;
  providerName: string;
  modelName: string;
  voiceId: string;
  languageBoost: string;
  outputFormat: string;
  status: string;
  audioUrl?: string | null;
  audioPath?: string | null;
  traceId?: string | null;
  audioLength?: number | null;
  audioSizeBytes?: number | null;
  errorMessage?: string | null;
  providerMetadata?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface CuratorWorkspaceSummary {
  ownedSpaces: number;
  ownedArtworks: number;
  storytellingVersions: number;
  ttsAssets: number;
  roomMergeSnapshots: number;
  roomMergePresets: number;
}

export interface CuratorWorkspaceArtwork {
  id: number;
  ownerUserId?: number | null;
  title?: string | null;
  artist?: string | null;
  createdAt: string;
  era: string;
  eraYear: number;
  mainThema: string;
  mainEmotion: string;
  imagePath?: string | null;
  source?: string | null;
  sourceObjectId?: string | null;
  sourceQuery?: string | null;
  objectUrl?: string | null;
  framedGlbStatus?: string | null;
  framedGlbUrl?: string | null;
  framedGlbGeneratedAt?: string | null;
  framedGlbNotes?: Record<string, unknown> | null;
  currentStory?: StorytellingVersion | null;
  storyVersions: StorytellingVersion[];
  ttsAssets: StorytellingTtsAsset[];
  storyVersionCount: number;
}

export interface CuratorWorkspaceSpace {
  id: number;
  ownerUserId: number;
  name: string;
  description?: string | null;
  thumbnailImagePath?: string | null;
  status: string;
  currentVersionId?: number | null;
  componentCount: number;
  slotCount: number;
  fileCount: number;
  publicProfile?: CuratorSpacePublicProfile | null;
  versions: CuratorSpaceVersion[];
  snapshots: RoomMergeExperimentSnapshotResponse[];
  presets: RoomMergePresetResponse[];
  createdAt: string;
  updatedAt: string;
}

export interface CuratorWorkspaceResponse {
  status: string;
  user: AuthUser;
  summary: CuratorWorkspaceSummary;
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  ownedSpaces: CuratorWorkspaceSpace[];
  ownedArtworks: CuratorWorkspaceArtwork[];
  roomMergeSnapshots: RoomMergeExperimentSnapshotResponse[];
  roomMergePresets: RoomMergePresetResponse[];
}

export interface SpaceVector3 {
  x: number;
  y: number;
  z: number;
}

export interface CuratorSpaceFile {
  id: number;
  ownerUserId: number;
  spaceId?: number | null;
  originalFileName: string;
  storedFilePath: string;
  fileUrl: string;
  checksumSha256: string;
  fileSizeBytes: number;
  mimeType?: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface CuratorSpaceFileDeleteResponse {
  status: string;
  fileId: number;
  deletedAt: string;
}

export interface CuratorSpaceComponent {
  id: number;
  spaceId: number;
  spaceFileId: number;
  entityTypeId: number;
  componentKey: string;
  label: string;
  position: SpaceVector3;
  rotation: SpaceVector3;
  scale: SpaceVector3;
  sortOrder: number;
  file?: CuratorSpaceFile | null;
  createdAt: string;
  updatedAt: string;
}

export interface ArtworkSlot {
  id: number;
  spaceId: number;
  entityTypeId: number;
  slotKey: string;
  name: string;
  sizePreset: string;
  width: number;
  height: number;
  depth: number;
  position: SpaceVector3;
  rotation: SpaceVector3;
  status: string;
  sortOrder: number;
  artworkId?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface CuratorSpaceVersion {
  id: number;
  spaceId: number;
  createdByUserId: number;
  versionName?: string | null;
  memo?: string | null;
  versionSnapshot: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CuratorSpacePublicProfile {
  id: number;
  spaceId: number;
  displayName: string;
  summary?: string | null;
  locationSummary?: string | null;
  thumbnailImagePath?: string | null;
  searchKeywords: string[];
  isFeatured: boolean;
  isDefault: boolean;
  displayOrder: number;
  publishedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CuratorSpaceSummary {
  id: number;
  ownerUserId: number;
  name: string;
  description?: string | null;
  thumbnailImagePath?: string | null;
  status: string;
  currentVersionId?: number | null;
  componentCount: number;
  slotCount: number;
  fileCount: number;
  publicProfile?: CuratorSpacePublicProfile | null;
  createdAt: string;
  updatedAt: string;
}

export interface CuratorSpaceDetail extends CuratorSpaceSummary {
  files: CuratorSpaceFile[];
  components: CuratorSpaceComponent[];
  slots: ArtworkSlot[];
  versions: CuratorSpaceVersion[];
}

export interface CuratorSpaceDeleteResponse {
  status: string;
  spaceId: number;
  deletedAt?: string | null;
}

export interface CuratorSpaceFileListResponse {
  status: string;
  count: number;
  items: CuratorSpaceFile[];
}

export interface CuratorSpaceListResponse {
  status: string;
  count: number;
  items: CuratorSpaceSummary[];
}

export interface CuratorSpaceCreateRequest {
  name: string;
  description?: string | null;
  thumbnailImagePath?: string | null;
}

export interface CuratorSpaceUpdateRequest {
  name?: string | null;
  description?: string | null;
  status?: string | null;
  thumbnailImagePath?: string | null;
}

export interface CuratorSpaceComponentRequest {
  componentKey: string;
  label: string;
  spaceFileId: number;
  position: SpaceVector3;
  rotation?: SpaceVector3;
  scale?: SpaceVector3;
  sortOrder?: number;
}

export interface CuratorSpaceComponentsSaveRequest {
  components: CuratorSpaceComponentRequest[];
}

export interface ArtworkSlotRequest {
  slotKey: string;
  name: string;
  sizePreset: string;
  width: number;
  height: number;
  depth: number;
  position: SpaceVector3;
  rotation?: SpaceVector3;
  status?: string;
  sortOrder?: number;
  artworkId?: number | null;
}

export interface CuratorSpaceSlotsSaveRequest {
  slots: ArtworkSlotRequest[];
}

export interface CuratorSpacePublishRequest {
  versionName?: string | null;
  memo?: string | null;
  displayName?: string | null;
  summary?: string | null;
  locationSummary?: string | null;
  thumbnailImagePath?: string | null;
  searchKeywords?: string[];
  isFeatured?: boolean;
  isDefault?: boolean;
  displayOrder?: number;
  publishedAt?: string | null;
}

export interface CuratorSpaceThumbnailUploadResponse {
  status: string;
  thumbnailImagePath: string;
  thumbnailImageUrl: string;
  originalFileName: string;
  fileSizeBytes: number;
}

export interface PublishedSpaceListResponse {
  status: string;
  count: number;
  total: number;
  page: number;
  pageSize: number;
  query?: string | null;
  sort: string;
  curator?: string | null;
  location?: string | null;
  featuredOnly: boolean;
  defaultOnly: boolean;
  items: PublishedSpaceSummary[];
}

export interface AuthLoginRequest {
  identifier: string;
  password: string;
}

export interface AuthRegisterRequest {
  username: string;
  email: string;
  password: string;
  passwordConfirmation: string;
  role: 'visitor' | 'curator' | 'writer';
}

export interface AuthRefreshRequest {
  refreshToken: string;
}

export interface AuthLogoutRequest {
  refreshToken: string;
}

export interface AuthorArtworkCreateRequest {
  image: File;
  title: string;
  artist: string;
  era_year: number;
  main_thema: string;
  main_emotion: string;
  era: string;
}

export interface AuthorArtworkCreateResponse extends GeneratedFramedAsset {
  status: string;
}

export interface AuthorArtworkUpdateRequest {
  title: string;
  artist: string;
  era_year: number;
  main_thema: string;
  main_emotion: string;
  era: string;
}

export interface AuthorArtworkDeleteResponse {
  status: string;
  artworkId: number;
  deletedAt: string;
}

export interface StorytellingArtworkSummary {
  id: number;
  ownerUserId?: number | null;
  title?: string | null;
  artist?: string | null;
  era: string;
  eraYear: number;
  mainThema: string;
  mainEmotion: string;
  imagePath?: string | null;
  currentStorytellingVersionId?: number | null;
  currentStorytellingTitle?: string | null;
  currentStorytellingText?: string | null;
  currentStorytellingStatus?: string | null;
  currentStorytellingGeneratedAt?: string | null;
  storyVersionCount: number;
}

export interface StorytellingVersion {
  id: number;
  artworkId: number;
  batchId: number;
  versionNumber: number;
  status: string;
  isCurrentRepresentative?: boolean;
  storyTitle: string;
  storyText: string;
  requestNote?: string | null;
  globalNote?: string | null;
  providerName: string;
  modelName: string;
  promptJson: Record<string, unknown>;
  generationMetadataJson?: Record<string, unknown> | null;
  publishedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StorytellingArtworkListResponse {
  status: string;
  count: number;
  items: StorytellingArtworkSummary[];
}

export interface StorytellingGenerateRequest {
  artworkIds: number[];
  globalNote?: string | null;
  batchName?: string | null;
  perArtworkNotes?: Record<string, string>;
}

export interface StorytellingGenerateItem {
  artworkId: number;
  version: StorytellingVersion;
}

export interface StorytellingBatch {
  id: number;
  batchName?: string | null;
  globalNote?: string | null;
  createdByUserId: number;
  providerName: string;
  modelName: string;
  status: string;
  resultCount: number;
  selectedArtworkIds: number[];
  createdAt: string;
  updatedAt: string;
}

export interface StorytellingGenerateResponse {
  status: string;
  batch: StorytellingBatch;
  items: StorytellingGenerateItem[];
}

export interface StorytellingVersionStatusUpdateRequest {
  status: 'draft' | 'reviewed' | 'published' | 'archived';
}

export interface StorytellingVersionStatusUpdateResponse {
  status: string;
  artworkId: number;
  currentVersionId?: number | null;
  version: StorytellingVersion;
  currentVersion?: StorytellingVersion | null;
  requestedBy?: number | null;
}

export interface StorytellingVersionUpdateRequest {
  storyTitle?: string | null;
  storyText?: string | null;
}

export interface StorytellingVersionUpdateResponse {
  status: string;
  artworkId: number;
  currentVersionId?: number | null;
  version: StorytellingVersion;
  currentVersion?: StorytellingVersion | null;
  requestedBy?: number | null;
}

export interface StorytellingCurrentVersionUpdateRequest {
  versionId?: number | null;
}

export interface StorytellingCurrentVersionUpdateResponse {
  status: string;
  artworkId: number;
  currentVersionId?: number | null;
  version?: StorytellingVersion | null;
  currentVersion?: StorytellingVersion | null;
  requestedBy?: number | null;
}

export interface StorytellingVersionDeleteResponse {
  status: string;
  artworkId: number;
  deletedVersionId: number;
  currentVersionId?: number | null;
  currentVersion?: StorytellingVersion | null;
  requestedBy?: number | null;
}

export interface StorytellingTtsGenerateRequest {
  voiceId?: string | null;
  modelName?: string | null;
  languageBoost?: string | null;
  forceRebuild?: boolean;
}

export interface StorytellingTtsGenerateResponse {
  status: string;
  artworkId: number;
  versionId: number;
  ttsAsset: StorytellingTtsAsset;
  requestedVoiceId: string;
  requestedModelName: string;
  requestedLanguageBoost: string;
  requestedBy?: number | null;
}

export interface StorytellingVersionListResponse {
  status: string;
  count: number;
  artworkId: number;
  currentVersionId?: number | null;
  items: StorytellingVersion[];
}

export interface StorytellingCurrentResponse {
  status: string;
  artworkId: number;
  currentVersion?: StorytellingVersion | null;
  ttsAssets: StorytellingTtsAsset[];
}

export interface AuthorArtworkStatusResponse extends GeneratedFramedAsset {
  status: string;
}

export interface RoomMergeAssemblyPieceState {
  position: [number, number, number];
  rotation: [number, number, number];
}

export interface RoomMergeAssemblySnapshot {
  selectedKey: string | null;
  pieces: Record<string, RoomMergeAssemblyPieceState>;
}

export interface RoomMergeExperimentSnapshotResponse {
  id: number;
  experimentKey: string;
  spaceId?: number | null;
  ownerUserId: number;
  sessionId: string;
  selectedKey: string | null;
  memo?: string | null;
  snapshot: RoomMergeAssemblySnapshot;
  createdAt: string;
  updatedAt: string;
}

export interface RoomMergeSnapshotLatestResponse {
  status: string;
  snapshot: RoomMergeExperimentSnapshotResponse | null;
}

export interface RoomMergeSnapshotListResponse {
  status: string;
  count: number;
  items: RoomMergeExperimentSnapshotResponse[];
}

export interface RoomMergeSnapshotCreateRequest {
  experimentKey?: string;
  spaceId?: number | null;
  sessionId?: string;
  selectedKey: string | null;
  memo?: string | null;
  snapshot: RoomMergeAssemblySnapshot;
}

export interface RoomMergeSnapshotCreateResponse {
  status: string;
  snapshot: RoomMergeExperimentSnapshotResponse;
}

export interface RoomMergePresetCreateRequest {
  experimentKey?: string;
  spaceId?: number | null;
  sessionId?: string;
  presetName: string;
  selectedKey: string | null;
  memo?: string | null;
  snapshot: RoomMergeAssemblySnapshot;
}

export interface RoomMergePresetResponse {
  id: number;
  experimentKey: string;
  spaceId?: number | null;
  ownerUserId: number;
  sessionId: string;
  presetName: string;
  selectedKey: string | null;
  memo?: string | null;
  snapshot: RoomMergeAssemblySnapshot;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

export interface RoomMergePresetDeleteResponse {
  status: string;
  presetId: number;
  deletedAt?: string | null;
}

export interface RoomMergePresetListResponse {
  status: string;
  count: number;
  items: RoomMergePresetResponse[];
}

// API 에러
export interface ApiError {
  error: string;
  message: string;
  retryable: boolean;
}

// Request
export interface LayoutRequest {
  themeOptionId: number;
  eraOptionId: number;
  emotionOptionId: number;
  sessionId: string;
}

// 유효성 검사
export const isSelectionComplete = (selection: SelectionState): boolean => {
  return (
    selection.themeOptionId !== null &&
    selection.eraOptionId !== null &&
    selection.emotionOptionId !== null
  );
};

export const getUnselectedCount = (selection: SelectionState): number => {
  let count = 0;
  if (selection.themeOptionId === null) count++;
  if (selection.eraOptionId === null) count++;
  if (selection.emotionOptionId === null) count++;
  return count;
};
