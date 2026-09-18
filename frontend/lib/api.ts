import type {
  CurationOptionsResponse,
  LayoutRequest,
  LayoutResponse,
  ApiError,
  RecommendationDebugResponse,
  RecommendationProviderStatus,
  GeneratedFramedAssetListResponse,
  AuthLoginRequest,
  AuthLogoutRequest,
  AuthMeResponse,
  AuthUser,
  AuthRefreshRequest,
  AuthRegisterRequest,
  AuthSessionResponse,
  AuthorArtworkCreateResponse,
  AuthorArtworkDeleteResponse,
  AuthorArtworkStatusResponse,
  AuthorArtworkUpdateRequest,
  PublishedSpaceDetail,
  PublishedSpaceListResponse,
  CuratorWorkspaceResponse,
  CuratorSpaceCreateRequest,
  CuratorSpaceDeleteResponse,
  CuratorSpaceUpdateRequest,
  CuratorSpaceFile,
  CuratorSpaceFileDeleteResponse,
  CuratorSpaceFileListResponse,
  CuratorSpaceListResponse,
  CuratorSpaceDetail,
  CuratorSpaceComponentsSaveRequest,
  CuratorSpaceSlotsSaveRequest,
  CuratorSpacePublishRequest,
  CuratorSpaceThumbnailUploadResponse,
  StorytellingArtworkListResponse,
  StorytellingCurrentResponse,
  StorytellingGenerateRequest,
  StorytellingGenerateResponse,
  StorytellingTtsGenerateRequest,
  StorytellingTtsGenerateResponse,
  StorytellingVersionListResponse,
  StorytellingVersionUpdateRequest,
  StorytellingVersionUpdateResponse,
  StorytellingCurrentVersionUpdateRequest,
  StorytellingCurrentVersionUpdateResponse,
  StorytellingVersionDeleteResponse,
  StorytellingVersionStatusUpdateRequest,
  StorytellingVersionStatusUpdateResponse,
  RoomMergeSnapshotCreateRequest,
  RoomMergeSnapshotCreateResponse,
  RoomMergePresetCreateRequest,
  RoomMergePresetDeleteResponse,
  RoomMergePresetListResponse,
  RoomMergePresetResponse,
  RoomMergeSnapshotListResponse,
  RoomMergeSnapshotLatestResponse,
} from '../types/curation';
import {
  MOCK_CURATION_OPTIONS,
  MOCK_LAYOUT_RESPONSE,
  MOCK_DEFAULT_LAYOUT,
} from './mockData';
import { resolveWorkspaceRole, type WorkspaceRole } from './workspaceRole';

const API_BASE = '/api/v1';
const AUTH_REQUIRED_EVENT = 'digital-twin-auth-required';
const AUTH_CHANGED_EVENT = 'digital-twin-auth-changed';
const LAST_WORKSPACE_ROLE_KEY = 'digital-twin-last-workspace-role';
const AUTH_USER_SNAPSHOT_KEY = 'digital-twin-auth-user-snapshot';

// Mock API 사용 여부 (VITE_USE_MOCK_API=true 설정)
const USE_MOCK_API = import.meta.env.VITE_USE_MOCK_API === 'true';

interface JwtPayload {
  exp?: unknown;
  roles?: unknown;
}

interface RequestError extends Error {
  status?: number;
}

const decodeBase64Url = (value: string) => {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = '='.repeat((4 - (normalized.length % 4)) % 4);
  return atob(normalized + padding);
};

const getJwtExpiry = (token: string | null): number | null => {
  if (!token) return null;

  const parts = token.split('.');
  if (parts.length !== 3) return null;

  try {
    const payload = JSON.parse(decodeBase64Url(parts[1])) as JwtPayload;
    return typeof payload.exp === 'number' ? payload.exp : null;
  } catch {
    return null;
  }
};

const isJwtExpired = (token: string | null) => {
  const exp = getJwtExpiry(token);
  if (exp === null) return false;
  return exp <= Math.floor(Date.now() / 1000);
};

const parseAuthUserSnapshot = (value: string | null): AuthUser | null => {
  if (!value) {
    return null;
  }

  try {
    const payload = JSON.parse(value) as Partial<AuthUser> & { roles?: unknown };
    const id = typeof payload.id === 'number' ? payload.id : null;
    const username = typeof payload.username === 'string' ? payload.username : null;
    const email = typeof payload.email === 'string' ? payload.email : null;
    const displayName = typeof payload.displayName === 'string' ? payload.displayName : null;
    const primaryRole = typeof payload.primaryRole === 'string' ? payload.primaryRole : null;
    const roles = Array.isArray(payload.roles) && payload.roles.every((role) => typeof role === 'string')
      ? payload.roles
      : null;

    if (
      id === null ||
      username === null ||
      email === null ||
      displayName === null ||
      primaryRole === null ||
      roles === null
    ) {
      return null;
    }

    return {
      id,
      username,
      email,
      displayName,
      roles,
      primaryRole,
    };
  } catch {
    return null;
  }
};

const parseJwtRoles = (token: string | null): string[] | null => {
  if (!token) {
    return null;
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    return null;
  }

  try {
    const payload = JSON.parse(decodeBase64Url(parts[1])) as JwtPayload;
    if (!Array.isArray(payload.roles) || !payload.roles.every((role) => typeof role === 'string')) {
      return null;
    }
    return payload.roles;
  } catch {
    return null;
  }
};

const createSessionId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  const randomPart = Array.from({ length: 4 }, () =>
    Math.floor(Math.random() * 0xffff)
      .toString(16)
      .padStart(4, '0')
  ).join('');

  return `session-${Date.now()}-${randomPart}`;
};

const dispatchAuthRequired = (message?: string) => {
  if (typeof window === 'undefined') return;

  window.dispatchEvent(
    new CustomEvent(AUTH_REQUIRED_EVENT, {
      detail: { message },
    })
  );
};

const logBackendResponse = (label: string, payload: unknown) => {
  if (!import.meta.env.DEV) return;

  const maybeLayout = payload as Partial<LayoutResponse>;
  if (Array.isArray(maybeLayout.placements)) {
    console.info(`[backend->frontend] ${label}`, {
      selection:
        maybeLayout.themeOption && maybeLayout.eraOption && maybeLayout.emotionOption
          ? `${maybeLayout.themeOption.labelKo} / ${maybeLayout.eraOption.labelKo} / ${maybeLayout.emotionOption.labelKo}`
          : 'unknown',
      placementCount: maybeLayout.placements.length,
      firstPlacements: maybeLayout.placements.slice(0, 5).map((placement) => ({
        slot: placement.slotNumber,
        id: placement.artwork.id,
        title: placement.artwork.title,
        era: placement.artwork.originPeriod,
      })),
    });
    return;
  }

  const maybeOptions = payload as Partial<CurationOptionsResponse>;
  if (Array.isArray(maybeOptions.axes)) {
    console.info(`[backend->frontend] ${label}`, {
      axes: maybeOptions.axes.map((axis) => ({
        category: axis.category,
        optionCount: axis.options.length,
        labels: axis.options.map((option) => option.labelKo),
      })),
    });
  }
};

class ApiService {
  private sessionId: string;
  private accessToken: string | null;
  private refreshToken: string | null;
  private authRequired = false;
  private authRequiredMessage: string | null = null;

  constructor() {
    this.sessionId = this.getOrCreateSessionId();
    this.accessToken = localStorage.getItem('digital_twin_access_token');
    this.refreshToken = localStorage.getItem('digital_twin_refresh_token');

    if (this.refreshToken && isJwtExpired(this.refreshToken)) {
      this.invalidateSession();
    }
  }

  private getOrCreateSessionId(): string {
    const stored = sessionStorage.getItem('artmuseum_session_id');
    if (stored) return stored;

    const newId = createSessionId();
    sessionStorage.setItem('artmuseum_session_id', newId);
    return newId;
  }

  private shouldAttemptAuthRecovery(url: string) {
    return !['/auth/login', '/auth/register', '/auth/logout', '/auth/refresh'].some((endpoint) =>
      url.startsWith(endpoint)
    );
  }

  private createRequestError(response: Response, payload: unknown): RequestError {
    let message = '알 수 없는 오류가 발생했습니다.';

    if (payload && typeof payload === 'object') {
      const detail = 'detail' in payload ? (payload as { detail?: unknown }).detail : payload;
      if (typeof detail === 'string') {
        message = detail;
      } else if (detail && typeof detail === 'object' && 'message' in detail) {
        message = String((detail as { message?: unknown }).message);
      }
    }

    const error = new Error(message) as RequestError;
    error.status = response.status;
    return error;
  }

  private markAuthRequired(message?: string | null) {
    this.authRequired = true;
    this.authRequiredMessage = message ?? null;
    dispatchAuthRequired(message ?? undefined);
  }

  private emitAuthChanged() {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(AUTH_CHANGED_EVENT));
    }
  }

  private storeAuthTokens(accessToken: string | null, refreshToken: string | null) {
    this.accessToken = accessToken;
    this.refreshToken = refreshToken;

    if (accessToken) {
      localStorage.setItem('digital_twin_access_token', accessToken);
    } else {
      localStorage.removeItem('digital_twin_access_token');
    }

    if (refreshToken) {
      localStorage.setItem('digital_twin_refresh_token', refreshToken);
    } else {
      localStorage.removeItem('digital_twin_refresh_token');
    }
  }

  private storeAuthUserSnapshot(user: AuthUser | null) {
    if (typeof window === 'undefined') {
      return;
    }

    if (user) {
      localStorage.setItem(AUTH_USER_SNAPSHOT_KEY, JSON.stringify(user));
      return;
    }

    localStorage.removeItem(AUTH_USER_SNAPSHOT_KEY);
  }

  private invalidateSession(message?: string | null) {
    this.storeAuthTokens(null, null);
    this.storeAuthUserSnapshot(null);
    localStorage.removeItem(LAST_WORKSPACE_ROLE_KEY);
    this.markAuthRequired(message);
    this.emitAuthChanged();
  }

  private getAuthHeaders(headers: HeadersInit | undefined, isFormData: boolean) {
    return {
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      ...(this.accessToken ? { Authorization: `Bearer ${this.accessToken}` } : {}),
      ...(headers || {}),
    };
  }

  getAssetHeaders(url: string): Record<string, string> {
    const target = new URL(url, window.location.href);
    if (target.origin !== window.location.origin || !target.pathname.startsWith('/assets/curator-space-files/')) {
      return {};
    }
    return this.accessToken ? { Authorization: `Bearer ${this.accessToken}` } : {};
  }

  hasAuthRequiredPrompt(): boolean {
    return this.authRequired;
  }

  getAuthRequiredMessage(): string | null {
    return this.authRequiredMessage;
  }

  clearAuthRequiredPrompt() {
    this.authRequired = false;
    this.authRequiredMessage = null;
  }

  private async request<T>(
    url: string,
    options?: RequestInit,
    attempt = 0
  ): Promise<T> {
    const isFormData = options?.body instanceof FormData;
    const executeFetch = (headers: HeadersInit) =>
      fetch(`${API_BASE}${url}`, {
        ...options,
        headers,
      });

    const requestHeaders = this.getAuthHeaders(options?.headers, isFormData);
    const response = await executeFetch(requestHeaders);

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      if (response.status === 401 && attempt === 0 && this.shouldAttemptAuthRecovery(url)) {
        if (this.refreshToken && !isJwtExpired(this.refreshToken)) {
          try {
            const refreshed = await this.refresh({ refreshToken: this.refreshToken });
            const retryHeaders = {
              ...(options?.headers || {}),
              Authorization: `Bearer ${refreshed.accessToken}`,
            };
            const retryResponse = await executeFetch(
              this.getAuthHeaders(retryHeaders, isFormData)
            );

            if (retryResponse.ok) {
              const retryPayload = await retryResponse.json();
              logBackendResponse(url, retryPayload);
              return retryPayload;
            }

            const retryPayload = await retryResponse.json().catch(() => null);
            if (retryResponse.status === 401) {
              this.invalidateSession();
            }
            throw this.createRequestError(retryResponse, retryPayload);
          } catch (error) {
            const authError = error as RequestError;
            if (authError.status === 401) {
              this.invalidateSession();
            }
            throw error;
          }
        } else {
          this.invalidateSession();
        }
      }

      const error: ApiError = {
        error: 'UNKNOWN_ERROR',
        message: '알 수 없는 오류가 발생했습니다.',
        retryable: false,
      };
      throw this.createRequestError(response, payload ?? error);
    }

    const payload = await response.json();
    logBackendResponse(url, payload);
    return payload;
  }

  private persistAuthTokens(accessToken: string, refreshToken: string) {
    this.storeAuthTokens(accessToken, refreshToken);
    this.clearAuthRequiredPrompt();
    this.emitAuthChanged();
  }

  getStoredAuthUserSnapshot(): AuthUser | null {
    if (typeof window === 'undefined') {
      return null;
    }

    return parseAuthUserSnapshot(localStorage.getItem(AUTH_USER_SNAPSHOT_KEY));
  }

  getStoredWorkspaceRoleHint(): WorkspaceRole | null {
    const snapshot = this.getStoredAuthUserSnapshot();
    if (snapshot) {
      return resolveWorkspaceRole(snapshot.roles, snapshot.primaryRole);
    }

    const roles = parseJwtRoles(this.accessToken);
    if (roles) {
      return resolveWorkspaceRole(roles, roles[0] ?? null);
    }

    return null;
  }

  private persistAuthSnapshot(user: AuthUser | null) {
    this.storeAuthUserSnapshot(user);
  }

  clearAuthTokens() {
    this.storeAuthTokens(null, null);
    localStorage.removeItem('digital_twin_access_token');
    localStorage.removeItem('digital_twin_refresh_token');
    localStorage.removeItem(LAST_WORKSPACE_ROLE_KEY);
    localStorage.removeItem(AUTH_USER_SNAPSHOT_KEY);
    this.emitAuthChanged();
  }

  hasAuthTokens(): boolean {
    return Boolean(this.refreshToken && !isJwtExpired(this.refreshToken));
  }

  getStoredRefreshToken(): string | null {
    return this.refreshToken;
  }

  async login(request: AuthLoginRequest): Promise<AuthSessionResponse> {
    const payload = await this.request<AuthSessionResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(request),
    });
    this.persistAuthTokens(payload.accessToken, payload.refreshToken);
    this.persistAuthSnapshot(payload.user);
    return payload;
  }

  async register(request: AuthRegisterRequest): Promise<AuthSessionResponse> {
    const payload = await this.request<AuthSessionResponse>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(request),
    });
    this.persistAuthTokens(payload.accessToken, payload.refreshToken);
    this.persistAuthSnapshot(payload.user);
    return payload;
  }

  async me(): Promise<AuthMeResponse> {
    return this.request<AuthMeResponse>('/auth/me');
  }

  async restoreSession(): Promise<AuthMeResponse | null> {
    if (!this.refreshToken || isJwtExpired(this.refreshToken)) {
      this.clearAuthTokens();
      return null;
    }

    try {
      const refreshed = await this.refresh({ refreshToken: this.refreshToken });
      const payload = await this.request<AuthMeResponse>('/auth/me', {
        headers: {
          Authorization: `Bearer ${refreshed.accessToken}`,
        },
      });
      this.persistAuthSnapshot(payload.user);
      return payload;
    } catch {
      this.invalidateSession();
      return null;
    }
  }

  async getCuratorWorkspace(page = 1, pageSize = 5): Promise<CuratorWorkspaceResponse> {
    return this.request<CuratorWorkspaceResponse>(`/workspace/curator?page=${page}&pageSize=${pageSize}`);
  }

  async getWriterWorkspace(page = 1, pageSize = 5): Promise<CuratorWorkspaceResponse> {
    return this.request<CuratorWorkspaceResponse>(`/workspace/writer?page=${page}&pageSize=${pageSize}`);
  }

  async refresh(request?: AuthRefreshRequest): Promise<AuthSessionResponse> {
    const refreshToken = request?.refreshToken ?? this.refreshToken;
    if (!refreshToken) {
      this.invalidateSession();
      throw new Error('Refresh token이 없습니다.');
    }
    try {
      const payload = await this.request<AuthSessionResponse>('/auth/refresh', {
        method: 'POST',
        body: JSON.stringify({ refreshToken }),
      });
      this.persistAuthTokens(payload.accessToken, payload.refreshToken);
      this.persistAuthSnapshot(payload.user);
      return payload;
    } catch (error) {
      const authError = error as RequestError;
      if (authError.status === 401) {
        this.invalidateSession();
      }
      throw error;
    }
  }

  async logout(request?: AuthLogoutRequest): Promise<void> {
    const refreshToken = request?.refreshToken ?? this.refreshToken;
    if (!refreshToken) {
      this.clearAuthTokens();
      return;
    }
    await this.request<{ status: string }>('/auth/logout', {
      method: 'POST',
      body: JSON.stringify({ refreshToken }),
    });
    this.clearAuthTokens();
  }

  // Mock API 딜레이 시뮬레이션
  private async mockDelay(ms: number = 800): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // 축/옵션 목록 조회
  async getCurationOptions(): Promise<CurationOptionsResponse> {
    if (USE_MOCK_API) {
      await this.mockDelay(600);
      return MOCK_CURATION_OPTIONS;
    }
    return this.request<CurationOptionsResponse>('/curation/options');
  }

  // 3개 조합 기준 작품 배치 결과 조회
  async getLayout(request: LayoutRequest): Promise<LayoutResponse> {
    if (USE_MOCK_API) {
      await this.mockDelay(1200);
      return MOCK_LAYOUT_RESPONSE;
    }
    return this.request<LayoutResponse>('/curation/layouts', {
      method: 'POST',
      body: JSON.stringify({
        ...request,
        sessionId: this.sessionId,
      }),
    });
  }

  // 세션 ID 반환
  getSessionId(): string {
    return this.sessionId;
  }

  // 기본 갤러리 조회 (테마 선택 없이)
  async getDefaultLayout(): Promise<LayoutResponse> {
    if (USE_MOCK_API) {
      await this.mockDelay(800);
      return MOCK_DEFAULT_LAYOUT;
    }
    return this.request<LayoutResponse>('/curation/default');
  }

  async listPublishedSpaces(params: {
    query?: string;
    curator?: string;
    location?: string;
    featuredOnly?: boolean;
    defaultOnly?: boolean;
    sort?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<PublishedSpaceListResponse> {
    const search = new URLSearchParams();
    if (params.query) search.set('query', params.query);
    if (params.curator) search.set('curator', params.curator);
    if (params.location) search.set('location', params.location);
    if (params.featuredOnly) search.set('featuredOnly', 'true');
    if (params.defaultOnly) search.set('defaultOnly', 'true');
    if (params.sort) search.set('sort', params.sort);
    search.set('limit', String(params.limit ?? 24));
    search.set('offset', String(params.offset ?? 0));
    return this.request<PublishedSpaceListResponse>(`/spaces/published?${search.toString()}`);
  }

  async getPublishedSpace(spaceId: number): Promise<PublishedSpaceDetail> {
    return this.request<PublishedSpaceDetail>(`/spaces/published/${spaceId}`);
  }

  async getDefaultPublishedSpace(): Promise<PublishedSpaceDetail> {
    return this.request<PublishedSpaceDetail>('/spaces/published/default');
  }

  async uploadCuratorSpaceFile(spaceId: number, file: File): Promise<CuratorSpaceFile> {
    const formData = new FormData();
    formData.append('file', file);
    return this.request<CuratorSpaceFile>(`/curator/spaces/${spaceId}/files`, {
      method: 'POST',
      body: formData,
    });
  }

  async uploadCuratorSpaceThumbnail(file: File): Promise<CuratorSpaceThumbnailUploadResponse> {
    const formData = new FormData();
    formData.append('image', file);
    return this.request<CuratorSpaceThumbnailUploadResponse>('/curator/space-thumbnails', {
      method: 'POST',
      body: formData,
    });
  }

  async listCuratorSpaceFiles(spaceId: number): Promise<CuratorSpaceFileListResponse> {
    return this.request<CuratorSpaceFileListResponse>(`/curator/spaces/${spaceId}/files`);
  }

  async deleteCuratorSpaceFile(spaceId: number, fileId: number): Promise<CuratorSpaceFileDeleteResponse> {
    return this.request<CuratorSpaceFileDeleteResponse>(`/curator/spaces/${spaceId}/files/${fileId}`, {
      method: 'DELETE',
    });
  }

  async createCuratorSpace(request: CuratorSpaceCreateRequest): Promise<CuratorSpaceDetail> {
    return this.request<CuratorSpaceDetail>('/curator/spaces', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  async listCuratorSpaces(): Promise<CuratorSpaceListResponse> {
    return this.request<CuratorSpaceListResponse>('/curator/spaces');
  }

  async getCuratorSpace(spaceId: number): Promise<CuratorSpaceDetail> {
    return this.request<CuratorSpaceDetail>(`/curator/spaces/${spaceId}`);
  }

  async updateCuratorSpace(spaceId: number, request: CuratorSpaceUpdateRequest): Promise<CuratorSpaceDetail> {
    return this.request<CuratorSpaceDetail>(`/curator/spaces/${spaceId}`, {
      method: 'PUT',
      body: JSON.stringify(request),
    });
  }

  async deleteCuratorSpace(spaceId: number): Promise<CuratorSpaceDeleteResponse> {
    return this.request<CuratorSpaceDeleteResponse>(`/curator/spaces/${spaceId}`, {
      method: 'DELETE',
    });
  }

  async saveCuratorSpaceComponents(
    spaceId: number,
    request: CuratorSpaceComponentsSaveRequest
  ): Promise<CuratorSpaceDetail> {
    return this.request<CuratorSpaceDetail>(`/curator/spaces/${spaceId}/components`, {
      method: 'PUT',
      body: JSON.stringify(request),
    });
  }

  async saveCuratorSpaceSlots(
    spaceId: number,
    request: CuratorSpaceSlotsSaveRequest
  ): Promise<CuratorSpaceDetail> {
    return this.request<CuratorSpaceDetail>(`/curator/spaces/${spaceId}/slots`, {
      method: 'PUT',
      body: JSON.stringify(request),
    });
  }

  async publishCuratorSpace(
    spaceId: number,
    request: CuratorSpacePublishRequest
  ): Promise<CuratorSpaceDetail> {
    return this.request<CuratorSpaceDetail>(`/curator/spaces/${spaceId}/publish`, {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  async getRecommendationDebugResults(request: LayoutRequest): Promise<RecommendationDebugResponse> {
    const search = new URLSearchParams({
      themeOptionId: String(request.themeOptionId),
      eraOptionId: String(request.eraOptionId),
      emotionOptionId: String(request.emotionOptionId),
    });
    return this.request<RecommendationDebugResponse>(`/recommendation/debug-results?${search.toString()}`);
  }

  async getRecommendationStatus(): Promise<RecommendationProviderStatus> {
    return this.request<RecommendationProviderStatus>('/recommendation/features/status');
  }

  async getGeneratedFramedGlbAssets(): Promise<GeneratedFramedAssetListResponse> {
    return this.request<GeneratedFramedAssetListResponse>('/generated-assets/framed-glb');
  }

  async listStorytellingArtworks(query = '', limit = 50, offset = 0): Promise<StorytellingArtworkListResponse> {
    const search = new URLSearchParams({
      query,
      limit: String(limit),
      offset: String(offset),
    });
    return this.request<StorytellingArtworkListResponse>(`/storytelling/artworks?${search.toString()}`);
  }

  async getStorytellingCurrent(artworkId: number): Promise<StorytellingCurrentResponse> {
    return this.request<StorytellingCurrentResponse>(`/storytelling/artworks/${artworkId}/current`);
  }

  async getPublicStorytellingCurrent(artworkId: number): Promise<StorytellingCurrentResponse> {
    return this.request<StorytellingCurrentResponse>(`/public/storytelling/artworks/${artworkId}/current`);
  }

  async listStorytellingVersions(artworkId: number, limit = 10): Promise<StorytellingVersionListResponse> {
    const search = new URLSearchParams({
      limit: String(limit),
    });
    return this.request<StorytellingVersionListResponse>(
      `/storytelling/artworks/${artworkId}/versions?${search.toString()}`
    );
  }

  async generateStorytelling(request: StorytellingGenerateRequest): Promise<StorytellingGenerateResponse> {
    return this.request<StorytellingGenerateResponse>('/storytelling/generate', {
      method: 'POST',
      body: JSON.stringify({
        artworkIds: request.artworkIds,
        globalNote: request.globalNote ?? null,
        batchName: request.batchName ?? null,
        perArtworkNotes: request.perArtworkNotes ?? {},
      }),
    });
  }

  async updateStorytellingVersionStatus(
    versionId: number,
    request: StorytellingVersionStatusUpdateRequest
  ): Promise<StorytellingVersionStatusUpdateResponse> {
    return this.request<StorytellingVersionStatusUpdateResponse>(`/storytelling/versions/${versionId}/status`, {
      method: 'POST',
      body: JSON.stringify({
        status: request.status,
      }),
    });
  }

  async updateStorytellingVersion(
    versionId: number,
    request: StorytellingVersionUpdateRequest
  ): Promise<StorytellingVersionUpdateResponse> {
    return this.request<StorytellingVersionUpdateResponse>(`/storytelling/versions/${versionId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        storyTitle: request.storyTitle ?? null,
        storyText: request.storyText ?? null,
      }),
    });
  }

  async updateStorytellingCurrentVersion(
    artworkId: number,
    request: StorytellingCurrentVersionUpdateRequest
  ): Promise<StorytellingCurrentVersionUpdateResponse> {
    return this.request<StorytellingCurrentVersionUpdateResponse>(
      `/storytelling/artworks/${artworkId}/current-version`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          versionId: request.versionId ?? null,
        }),
      }
    );
  }

  async deleteStorytellingVersion(versionId: number): Promise<StorytellingVersionDeleteResponse> {
    return this.request<StorytellingVersionDeleteResponse>(`/storytelling/versions/${versionId}`, {
      method: 'DELETE',
    });
  }

  async generateStorytellingTts(
    versionId: number,
    request: StorytellingTtsGenerateRequest = {}
  ): Promise<StorytellingTtsGenerateResponse> {
    return this.request<StorytellingTtsGenerateResponse>(`/storytelling/versions/${versionId}/tts`, {
      method: 'POST',
      body: JSON.stringify({
        voiceId: request.voiceId ?? null,
        modelName: request.modelName ?? null,
        languageBoost: request.languageBoost ?? null,
        forceRebuild: request.forceRebuild ?? false,
      }),
    });
  }

  async createAuthorArtwork(formData: FormData): Promise<AuthorArtworkCreateResponse> {
    return this.request<AuthorArtworkCreateResponse>('/author/artworks', {
      method: 'POST',
      body: formData,
    });
  }

  async getAuthorArtwork(artworkId: number): Promise<AuthorArtworkStatusResponse> {
    return this.request<AuthorArtworkStatusResponse>(`/author/artworks/${artworkId}`);
  }

  async ensureAuthorArtworkFramedGlb(artworkId: number): Promise<AuthorArtworkStatusResponse> {
    return this.request<AuthorArtworkStatusResponse>(`/author/artworks/${artworkId}/framed-glb`, {
      method: 'POST',
    });
  }

  async updateAuthorArtwork(
    artworkId: number,
    request: AuthorArtworkUpdateRequest
  ): Promise<AuthorArtworkCreateResponse> {
    return this.request<AuthorArtworkCreateResponse>(`/author/artworks/${artworkId}`, {
      method: 'PATCH',
      body: JSON.stringify(request),
    });
  }

  async deleteAuthorArtwork(artworkId: number): Promise<AuthorArtworkDeleteResponse> {
    return this.request<AuthorArtworkDeleteResponse>(`/author/artworks/${artworkId}`, {
      method: 'DELETE',
    });
  }

  async getLatestRoomMergeSnapshot(
    experimentKey: string = 'glb-room-merge-experiment'
  ): Promise<RoomMergeSnapshotLatestResponse> {
    const search = new URLSearchParams({
      experimentKey,
      sessionId: this.sessionId,
    });
    return this.request<RoomMergeSnapshotLatestResponse>(
      `/debug/room-merge/snapshots/latest?${search.toString()}`
    );
  }

  async listRoomMergeSnapshots(
    experimentKey: string = 'glb-room-merge-experiment',
    limit: number = 12
  ): Promise<RoomMergeSnapshotListResponse> {
    const search = new URLSearchParams({
      experimentKey,
      limit: String(limit),
    });
    return this.request<RoomMergeSnapshotListResponse>(
      `/debug/room-merge/snapshots?${search.toString()}`
    );
  }

  async saveRoomMergeSnapshot(
    request: RoomMergeSnapshotCreateRequest
  ): Promise<RoomMergeSnapshotCreateResponse> {
    return this.request<RoomMergeSnapshotCreateResponse>('/debug/room-merge/snapshots', {
      method: 'POST',
      body: JSON.stringify({
        experimentKey: request.experimentKey ?? 'glb-room-merge-experiment',
        spaceId: request.spaceId ?? null,
        sessionId: request.sessionId ?? this.sessionId,
        selectedKey: request.selectedKey,
        memo: request.memo ?? null,
        snapshot: request.snapshot,
      }),
    });
  }

  async listRoomMergePresets(
    experimentKey: string = 'glb-room-merge-experiment',
    limit: number = 20
  ): Promise<RoomMergePresetListResponse> {
    const search = new URLSearchParams({
      experimentKey,
      limit: String(limit),
    });
    return this.request<RoomMergePresetListResponse>(
      `/debug/room-merge/presets?${search.toString()}`
    );
  }

  async getRoomMergePreset(presetId: number): Promise<RoomMergePresetResponse> {
    return this.request<RoomMergePresetResponse>(`/debug/room-merge/presets/${presetId}`);
  }

  async saveRoomMergePreset(
    request: RoomMergePresetCreateRequest
  ): Promise<RoomMergePresetResponse> {
    return this.request<RoomMergePresetResponse>('/debug/room-merge/presets', {
      method: 'POST',
      body: JSON.stringify({
        experimentKey: request.experimentKey ?? 'glb-room-merge-experiment',
        spaceId: request.spaceId ?? null,
        sessionId: request.sessionId ?? this.sessionId,
        presetName: request.presetName,
        selectedKey: request.selectedKey,
        memo: request.memo ?? null,
        snapshot: request.snapshot,
      }),
      });
  }

  async deleteRoomMergePreset(presetId: number): Promise<RoomMergePresetDeleteResponse> {
    return this.request<RoomMergePresetDeleteResponse>(`/debug/room-merge/presets/${presetId}`, {
      method: 'DELETE',
    });
  }
}

export const apiService = new ApiService();
