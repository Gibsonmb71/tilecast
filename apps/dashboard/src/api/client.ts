import type {
  AuthStatus,
  LoginInput,
  PairingRequest,
  Screen,
  SetupInput,
  User,
  Asset,
  AssetList,
  UploadSession,
  Playlist,
  PlaylistAssignment,
  PlaylistItemInput,
  PlaylistList,
  ScreenGroup,
  ScreenGroupList,
  Schedule,
  ScheduleInput,
  ScheduleList,
  SchedulePreview,
  WebsiteInput,
  WebsiteDiagnostics,
  WidgetInput,
  DataSourceDetail,
  DataSourceInput,
  DataSourceListResult,
  PlayerCommand,
  EmergencyTakeover,
  SettingsDocument,
  PolicyDocument,
  EffectivePolicy,
  SystemStatus,
  PlayerReleaseList,
  PlayerReleaseImport,
  GitHubDeviceStart,
  GitHubDevicePoll,
  UpdateDeployment,
  ReliabilityStatus,
  PowerAssistResults,
  CalendarConfig,
  CalendarPreview,
  DataSourceProvider,
  SourceRefreshDiagnostics,
  ContentFolder,
  ContentCollection,
  ContentTag,
  BulkOrganizeInput,
  StructuredSourceConfig,
  StructuredPreview,
  ManualSourceConfig,
  WeatherSourceConfig,
  TypedRecordData,
  TypedDatasetPayload,
  TransitSourceConfig,
  CAPAlertsSourceConfig,
  AirQualitySourceConfig,
  Layout,
  LayoutDocument,
  LayoutList,
  LayoutRevision,
  LayoutRevisionList,
  ProviderCatalog,
  ContentDefinitionCatalog,
  WidgetPresentation,
  BackupList,
  BackupJob,
  BackupRestorePlan,
} from "./types";

type DataResponse<T> = { data: T };
type ErrorResponse = { error?: { code?: string; message?: string } };

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    ...init,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ErrorResponse;
    throw new ApiError(
      body.error?.message ?? "Tilecast could not complete the request.",
      response.status,
      body.error?.code ?? "unknown_error",
    );
  }
  if (response.status === 204) return undefined as T;
  return ((await response.json()) as DataResponse<T>).data;
}

function normalizeScreenGroup(group: ScreenGroup): ScreenGroup {
  return {
    ...group,
    screens: Array.isArray(group.screens) ? group.screens : [],
  };
}

export function normalizeScreen(screen: Screen | null | undefined): Screen {
  const source = screen ?? ({} as Screen);
  return {
    ...source,
    deviceManufacturer:
      typeof source.deviceManufacturer === "string"
        ? source.deviceManufacturer
        : "",
  };
}

export function normalizePlaylistAssignment(
  assignment: PlaylistAssignment | null | undefined,
): PlaylistAssignment {
  const source = assignment ?? ({} as PlaylistAssignment);
  return {
    ...source,
    synchronizationStatus:
      typeof source.synchronizationStatus === "string"
        ? source.synchronizationStatus
        : "not_reported",
    groups: Array.isArray(source.groups) ? source.groups : [],
    relevantSchedules: Array.isArray(source.relevantSchedules)
      ? source.relevantSchedules
      : [],
  };
}

export function normalizeProviderCatalog(
  catalog: ProviderCatalog | null | undefined,
): ProviderCatalog {
  const source = catalog ?? ({} as ProviderCatalog);
  return {
    ...source,
    providers: Array.isArray(source.providers) ? source.providers : [],
  };
}

export function normalizeContentDefinitionCatalog(
  catalog: ContentDefinitionCatalog | null | undefined,
): ContentDefinitionCatalog {
  const source = catalog ?? ({} as ContentDefinitionCatalog);
  return {
    ...source,
    widgets: Array.isArray(source.widgets) ? source.widgets : [],
    dataSources: Array.isArray(source.dataSources) ? source.dataSources : [],
  };
}

export function normalizePlaylist(
  playlist: Playlist | null | undefined,
): Playlist {
  const source = playlist ?? ({} as Playlist);
  return {
    ...source,
    items: Array.isArray(source.items) ? source.items : [],
    warnings: Array.isArray(source.warnings) ? source.warnings : [],
    layoutUsage: Array.isArray(source.layoutUsage) ? source.layoutUsage : [],
  };
}

function normalizeLayoutDocument(
  document: LayoutDocument | null | undefined,
  layout: Pick<Layout, "orientation" | "canvasWidth" | "canvasHeight">,
): LayoutDocument {
  const fallback: LayoutDocument = {
    schemaVersion: 2,
    canvas: {
      width: layout.canvasWidth,
      height: layout.canvasHeight,
      orientation: layout.orientation,
      backgroundColor: "#0E141B",
      safeAreaPercent: 5,
    },
    placements: [],
  };
  if (!document) return fallback;
  return {
    ...document,
    schemaVersion: document.schemaVersion ?? fallback.schemaVersion,
    canvas: { ...fallback.canvas, ...(document.canvas ?? {}) },
    placements: Array.isArray(document.placements) ? document.placements : [],
  };
}

export function normalizeLayout(layout: Layout | null | undefined): Layout {
  const source = layout ?? ({} as Layout);
  return {
    ...source,
    draft: normalizeLayoutDocument(source.draft, source),
    dependencies: Array.isArray(source.dependencies) ? source.dependencies : [],
    usage: {
      screens: Array.isArray(source.usage?.screens) ? source.usage.screens : [],
      schedules: Array.isArray(source.usage?.schedules)
        ? source.usage.schedules
        : [],
    },
  };
}

function normalizePlaylistList(
  result: PlaylistList | null | undefined,
): PlaylistList {
  const source = result ?? ({} as PlaylistList);
  return {
    ...source,
    items: (Array.isArray(source.items) ? source.items : []).map(
      normalizePlaylist,
    ),
  };
}

function normalizeLayoutList(
  result: LayoutList | null | undefined,
): LayoutList {
  const source = result ?? ({} as LayoutList);
  return {
    ...source,
    items: Array.isArray(source.items) ? source.items : [],
  };
}

async function requestPlaylist(path: string, init?: RequestInit) {
  return normalizePlaylist(await request<Playlist>(path, init));
}

async function requestLayout(path: string, init?: RequestInit) {
  return normalizeLayout(await request<Layout>(path, init));
}

async function apiFailure(response: Response): Promise<never> {
  const body = (await response.json().catch(() => ({}))) as ErrorResponse;
  throw new ApiError(
    body.error?.message ?? "Tilecast could not complete the request.",
    response.status,
    body.error?.code ?? "unknown_error",
  );
}

type SessionResult = { user: User; csrfToken: string };

export const api = {
  providerCatalog: async () =>
    normalizeProviderCatalog(
      await request<ProviderCatalog | null>("/provider-catalog"),
    ),
  contentDefinitions: async () =>
    normalizeContentDefinitionCatalog(
      await request<ContentDefinitionCatalog | null>("/content-definitions"),
    ),
  compileWidgetPreview: (
    provider: WidgetInput["provider"],
    configuration: WidgetInput["configuration"],
    csrfToken: string,
  ) =>
    request<WidgetPresentation>("/widgets/compile-preview", {
      method: "POST",
      headers: { "X-CSRF-Token": csrfToken },
      body: JSON.stringify({ provider, configuration }),
    }),
  layouts: async (search = "") => {
    const result = await request<LayoutList | null>(
      `/layouts?${new URLSearchParams({ search, page: "1", pageSize: "100" })}`,
    );
    return normalizeLayoutList(result);
  },
  layout: (id: string) => requestLayout(`/layouts/${id}`),
  createLayout: (
    input: {
      name: string;
      description: string;
      orientation: string;
      canvasWidth: number;
      canvasHeight: number;
    },
    csrfToken: string,
  ) =>
    requestLayout("/layouts", {
      method: "POST",
      headers: { "X-CSRF-Token": csrfToken },
      body: JSON.stringify(input),
    }),
  updateLayout: (
    id: string,
    input: { name: string; description: string },
    csrfToken: string,
  ) =>
    requestLayout(`/layouts/${id}`, {
      method: "PATCH",
      headers: { "X-CSRF-Token": csrfToken },
      body: JSON.stringify(input),
    }),
  saveLayoutDraft: (
    id: string,
    expectedDraftRevision: number,
    document: LayoutDocument,
    csrfToken: string,
  ) =>
    requestLayout(`/layouts/${id}/draft`, {
      method: "PUT",
      headers: { "X-CSRF-Token": csrfToken },
      body: JSON.stringify({ expectedDraftRevision, document }),
    }),
  publishLayout: (
    id: string,
    expectedDraftRevision: number,
    csrfToken: string,
  ) =>
    request<LayoutRevision>(`/layouts/${id}/publish`, {
      method: "POST",
      headers: { "X-CSRF-Token": csrfToken },
      body: JSON.stringify({ expectedDraftRevision }),
    }),
  duplicateLayout: (id: string, csrfToken: string) =>
    requestLayout(`/layouts/${id}/duplicate`, {
      method: "POST",
      headers: { "X-CSRF-Token": csrfToken },
    }),
  deleteLayout: (id: string, csrfToken: string) =>
    request<void>(`/layouts/${id}`, {
      method: "DELETE",
      headers: { "X-CSRF-Token": csrfToken },
    }),
  layoutRevisions: (id: string) =>
    request<LayoutRevisionList>(`/layouts/${id}/revisions?page=1&pageSize=100`),
  restoreLayoutRevision: (
    id: string,
    revisionId: string,
    expectedDraftRevision: number,
    csrfToken: string,
  ) =>
    requestLayout(`/layouts/${id}/revisions/${revisionId}/restore`, {
      method: "POST",
      headers: { "X-CSRF-Token": csrfToken },
      body: JSON.stringify({ expectedDraftRevision }),
    }),
  playerReleases: () => request<PlayerReleaseList>("/player-releases"),
  checkPlayerReleases: (csrfToken: string) =>
    request<{ checked: boolean }>("/player-releases/check", {
      method: "POST",
      headers: { "X-CSRF-Token": csrfToken },
    }),
  startGitHubDeviceAuthorization: (csrfToken: string) =>
    request<GitHubDeviceStart>("/player-releases/github/device", {
      method: "POST",
      headers: { "X-CSRF-Token": csrfToken },
    }),
  pollGitHubDeviceAuthorization: (flowId: string, csrfToken: string) =>
    request<GitHubDevicePoll>("/player-releases/github/device/poll", {
      method: "POST",
      headers: { "X-CSRF-Token": csrfToken },
      body: JSON.stringify({ flowId }),
    }),
  disconnectGitHub: (csrfToken: string) =>
    request<void>("/player-releases/github", {
      method: "DELETE",
      headers: { "X-CSRF-Token": csrfToken },
    }),
  cachePlayerRelease: (id: string, csrfToken: string) =>
    request<{ id: string; cacheStatus: string }>(
      `/player-releases/${id}/cache`,
      { method: "POST", headers: { "X-CSRF-Token": csrfToken } },
    ),
  uploadPlayerRelease: (
    files: File[],
    csrfToken: string,
    onProgress: (percent: number) => void,
  ) =>
    new Promise<PlayerReleaseImport>((resolve, reject) => {
      const contentTypes: Record<string, string> = {
        "tilecast-player.apk": "application/vnd.android.package-archive",
        "tilecast-player-update.json": "application/json",
        "tilecast-player-update.json.sig": "text/plain",
      };
      const form = new FormData();
      for (const file of files)
        form.append(
          "files",
          new Blob([file], { type: contentTypes[file.name] }),
          file.name,
        );
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/v1/player-releases/upload");
      xhr.withCredentials = true;
      xhr.setRequestHeader("X-CSRF-Token", csrfToken);
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable)
          onProgress(Math.round((event.loaded / event.total) * 100));
      };
      xhr.onerror = () =>
        reject(new ApiError("Release upload failed.", 0, "network_error"));
      xhr.onload = () => {
        let body: DataResponse<PlayerReleaseImport> | ErrorResponse = {};
        try {
          body = JSON.parse(xhr.responseText || "{}") as
            DataResponse<PlayerReleaseImport> | ErrorResponse;
        } catch {
          // A proxy may replace a bounded API error with a non-JSON response.
        }
        if (xhr.status < 200 || xhr.status >= 300) {
          const error = body as ErrorResponse;
          reject(
            new ApiError(
              error.error?.message ?? "Release upload failed.",
              xhr.status,
              error.error?.code ?? "unknown_error",
            ),
          );
          return;
        }
        resolve((body as DataResponse<PlayerReleaseImport>).data);
      };
      xhr.send(form);
    }),
  updateDeployments: () =>
    request<{ items: UpdateDeployment[] }>("/update-deployments"),
  createUpdateDeployment: (
    input: {
      releaseId: string;
      name: string;
      mode: string;
      screenIds: string[];
      groupIds: string[];
      canarySize?: number;
      maintenanceWindowStart?: string;
    },
    csrfToken: string,
  ) =>
    request<{ id: string; targetCount: number }>("/update-deployments", {
      method: "POST",
      headers: { "X-CSRF-Token": csrfToken },
      body: JSON.stringify(input),
    }),
  cancelUpdateDeployment: (id: string, csrfToken: string) =>
    request<{ id: string; status: string }>(
      `/update-deployments/${id}/cancel`,
      { method: "POST", headers: { "X-CSRF-Token": csrfToken } },
    ),
  settings: () => request<SettingsDocument>("/settings"),
  users: () => request<{ items: User[]; total: number }>("/users"),
  updateSettings: (
    revision: number,
    values: Record<string, unknown>,
    csrfToken: string,
  ) =>
    request<SettingsDocument>("/settings", {
      method: "PATCH",
      headers: { "X-CSRF-Token": csrfToken },
      body: JSON.stringify({ revision, values }),
    }),
  resetSettings: (revision: number, category: string, csrfToken: string) =>
    request<SettingsDocument>("/settings/reset", {
      method: "POST",
      headers: { "X-CSRF-Token": csrfToken },
      body: JSON.stringify({ revision, category }),
    }),
  preferences: () => request<SettingsDocument>("/me/preferences"),
  updatePreferences: (
    revision: number,
    values: Record<string, unknown>,
    csrfToken: string,
  ) =>
    request<SettingsDocument>("/me/preferences", {
      method: "PATCH",
      headers: { "X-CSRF-Token": csrfToken },
      body: JSON.stringify({ revision, values }),
    }),
  groupPolicy: (id: string) =>
    request<PolicyDocument>(`/screen-groups/${id}/policy`),
  putGroupPolicy: (
    id: string,
    revision: number,
    priority: number,
    values: Record<string, unknown>,
    csrfToken: string,
  ) =>
    request<PolicyDocument>(`/screen-groups/${id}/policy`, {
      method: "PUT",
      headers: { "X-CSRF-Token": csrfToken },
      body: JSON.stringify({ revision, priority, values }),
    }),
  deleteGroupPolicy: (id: string, csrfToken: string) =>
    request<void>(`/screen-groups/${id}/policy`, {
      method: "DELETE",
      headers: { "X-CSRF-Token": csrfToken },
    }),
  screenPolicy: (id: string) =>
    request<PolicyDocument>(`/screens/${id}/policy`),
  putScreenPolicy: (
    id: string,
    revision: number,
    values: Record<string, unknown>,
    csrfToken: string,
  ) =>
    request<PolicyDocument>(`/screens/${id}/policy`, {
      method: "PUT",
      headers: { "X-CSRF-Token": csrfToken },
      body: JSON.stringify({ revision, values }),
    }),
  deleteScreenPolicy: (id: string, csrfToken: string) =>
    request<void>(`/screens/${id}/policy`, {
      method: "DELETE",
      headers: { "X-CSRF-Token": csrfToken },
    }),
  effectivePolicy: (id: string) =>
    request<EffectivePolicy>(`/screens/${id}/effective-policy`),
  systemStatus: () => request<SystemStatus>("/system/status"),
  backups: () => request<BackupList>("/system/backups"),
  createBackup: (csrfToken: string) =>
    request<BackupJob>("/system/backups", {
      method: "POST",
      headers: { "X-CSRF-Token": csrfToken },
    }),
  verifyBackup: (id: string, csrfToken: string) =>
    request<BackupJob>(`/system/backups/${id}/verify`, {
      method: "POST",
      headers: { "X-CSRF-Token": csrfToken },
    }),
  backupRestorePlan: (id: string) =>
    request<BackupRestorePlan>(`/system/backups/${id}/plan`),
  restoreBackup: (
    id: string,
    confirmIdentityMismatch: boolean,
    csrfToken: string,
  ) =>
    request<BackupJob>(`/system/backups/${id}/restore`, {
      method: "POST",
      headers: { "X-CSRF-Token": csrfToken },
      body: JSON.stringify({ confirmIdentityMismatch }),
    }),
  deleteBackup: (id: string, force: boolean, csrfToken: string) =>
    request<{ deleted: boolean }>(
      `/system/backups/${id}${force ? "?force=true" : ""}`,
      { method: "DELETE", headers: { "X-CSRF-Token": csrfToken } },
    ),
  runMaintenance: (action: string, csrfToken: string) =>
    request<{ action: string; status: string }>(
      `/system/maintenance/${action}`,
      { method: "POST", headers: { "X-CSRF-Token": csrfToken } },
    ),
  exportSettings: () =>
    request<Record<string, unknown>>("/system/settings/export"),
  previewSettingsImport: (document: unknown, csrfToken: string) =>
    request<{
      valid: boolean;
      changedKeys: string[];
      groupPolicyCount: number;
      screenPolicyCount: number;
      requiresConfirmation: boolean;
    }>("/system/settings/import/preview", {
      method: "POST",
      headers: { "X-CSRF-Token": csrfToken },
      body: JSON.stringify(document),
    }),
  applySettingsImport: (document: unknown, csrfToken: string) =>
    request<SettingsDocument>("/system/settings/import/apply", {
      method: "POST",
      headers: { "X-CSRF-Token": csrfToken },
      body: JSON.stringify(document),
    }),
  authStatus: () => request<AuthStatus>("/auth/status"),
  setup: (input: SetupInput) =>
    request<SessionResult>("/auth/setup", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  login: (input: LoginInput) =>
    request<SessionResult>("/auth/login", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  logout: (csrfToken: string) =>
    request<void>("/auth/logout", {
      method: "POST",
      headers: { "X-CSRF-Token": csrfToken },
    }),
  screens: async () => {
    const result = await request<{
      items?: Screen[];
      total?: number;
    } | null>("/screens");
    return {
      ...(result ?? {}),
      items: (Array.isArray(result?.items) ? result.items : []).map(
        normalizeScreen,
      ),
      total: result?.total ?? 0,
    };
  },
  pendingPairings: () =>
    request<{ items: PairingRequest[]; total: number }>(
      "/screens/pairing/pending",
    ),
  screen: async (id: string) =>
    normalizeScreen(await request<Screen | null>(`/screens/${id}`)),
  screenReliability: (id: string) =>
    request<ReliabilityStatus>(`/screens/${id}/reliability`),
  confirmPowerAssist: (
    id: string,
    results: PowerAssistResults,
    csrfToken: string,
  ) =>
    request<{ screenId: string; lastTestedAt: string }>(
      `/screens/${id}/power-assist`,
      {
        method: "PUT",
        headers: { "X-CSRF-Token": csrfToken },
        body: JSON.stringify(results),
      },
    ),
  resolvePairing: (code: string) =>
    request<PairingRequest>("/screens/pairing/resolve", {
      method: "POST",
      body: JSON.stringify({ code }),
    }),
  approvePairing: (
    id: string,
    input: {
      name: string;
      location: string;
      description: string;
      replaceExistingCredential: boolean;
    },
    csrfToken: string,
  ) =>
    request<Screen>(`/screens/pairing/${id}/approve`, {
      method: "POST",
      headers: { "X-CSRF-Token": csrfToken },
      body: JSON.stringify(input),
    }),
  rejectPairing: (id: string, reason: string, csrfToken: string) =>
    request<void>(`/screens/pairing/${id}/reject`, {
      method: "POST",
      headers: { "X-CSRF-Token": csrfToken },
      body: JSON.stringify({ reason }),
    }),
  updateScreen: (
    id: string,
    input: { name: string; location: string; description: string },
    csrfToken: string,
  ) =>
    request<Screen>(`/screens/${id}`, {
      method: "PATCH",
      headers: { "X-CSRF-Token": csrfToken },
      body: JSON.stringify(input),
    }),
  setScreenEnabled: (id: string, enabled: boolean, csrfToken: string) =>
    request<void>(`/screens/${id}/${enabled ? "enable" : "disable"}`, {
      method: "POST",
      headers: { "X-CSRF-Token": csrfToken },
    }),
  revokeScreen: (id: string, reason: string, csrfToken: string) =>
    request<void>(`/screens/${id}/revoke`, {
      method: "POST",
      headers: { "X-CSRF-Token": csrfToken },
      body: JSON.stringify({ reason }),
    }),
  screenCommands: (id: string) =>
    request<{ items: PlayerCommand[]; total: number }>(
      `/screens/${id}/commands`,
    ),
  createScreenCommand: (
    id: string,
    type: string,
    payload: Record<string, number>,
    csrfToken: string,
  ) =>
    request<{ id: string; state: string; expiresAt: string }>(
      `/screens/${id}/commands`,
      {
        method: "POST",
        headers: { "X-CSRF-Token": csrfToken },
        body: JSON.stringify({ type, payload }),
      },
    ),
  cancelScreenCommand: (
    screenId: string,
    commandId: string,
    csrfToken: string,
  ) =>
    request<{ id: string; state: string }>(
      `/screens/${screenId}/commands/${commandId}/cancel`,
      { method: "POST", headers: { "X-CSRF-Token": csrfToken } },
    ),
  emergencies: () =>
    request<{ items: EmergencyTakeover[]; total: number }>("/emergencies"),
  activateEmergency: (
    input: {
      name: string;
      description: string;
      playlistId: string;
      screenIds: string[];
      groupIds: string[];
      expiresAt: string;
      password?: string;
    },
    csrfToken: string,
  ) =>
    request<{
      id: string;
      status: string;
      affectedCount: number;
      expiresAt: string;
    }>("/emergencies", {
      method: "POST",
      headers: { "X-CSRF-Token": csrfToken },
      body: JSON.stringify(input),
    }),
  cancelEmergency: (id: string, reason: string, csrfToken: string) =>
    request<{ id: string; status: string }>(`/emergencies/${id}/cancel`, {
      method: "POST",
      headers: { "X-CSRF-Token": csrfToken },
      body: JSON.stringify({ reason }),
    }),
  assets: (params: URLSearchParams) =>
    request<AssetList>(`/assets?${params.toString()}`),
  contentFolders: () => request<ContentFolder[]>("/content-folders"),
  createContentFolder: (
    input: { name: string; description: string; parentId?: string },
    csrfToken: string,
  ) =>
    request<ContentFolder>("/content-folders", {
      method: "POST",
      headers: { "X-CSRF-Token": csrfToken },
      body: JSON.stringify(input),
    }),
  updateContentFolder: (
    id: string,
    input: { name: string; description: string; parentId?: string },
    csrfToken: string,
  ) =>
    request<ContentFolder>(`/content-folders/${id}`, {
      method: "PATCH",
      headers: { "X-CSRF-Token": csrfToken },
      body: JSON.stringify(input),
    }),
  deleteContentFolder: (id: string, csrfToken: string) =>
    request<void>(`/content-folders/${id}`, {
      method: "DELETE",
      headers: { "X-CSRF-Token": csrfToken },
    }),
  contentCollections: () =>
    request<ContentCollection[]>("/content-collections"),
  createContentCollection: (
    input: { name: string; description: string },
    csrfToken: string,
  ) =>
    request<ContentCollection>("/content-collections", {
      method: "POST",
      headers: { "X-CSRF-Token": csrfToken },
      body: JSON.stringify(input),
    }),
  updateContentCollection: (
    id: string,
    input: { name: string; description: string },
    csrfToken: string,
  ) =>
    request<ContentCollection>(`/content-collections/${id}`, {
      method: "PATCH",
      headers: { "X-CSRF-Token": csrfToken },
      body: JSON.stringify(input),
    }),
  deleteContentCollection: (id: string, csrfToken: string) =>
    request<void>(`/content-collections/${id}`, {
      method: "DELETE",
      headers: { "X-CSRF-Token": csrfToken },
    }),
  contentTags: () => request<ContentTag[]>("/content-tags"),
  createContentTag: (
    input: { name: string; color: string },
    csrfToken: string,
  ) =>
    request<ContentTag>("/content-tags", {
      method: "POST",
      headers: { "X-CSRF-Token": csrfToken },
      body: JSON.stringify(input),
    }),
  updateContentTag: (
    id: string,
    input: { name: string; color: string },
    csrfToken: string,
  ) =>
    request<ContentTag>(`/content-tags/${id}`, {
      method: "PATCH",
      headers: { "X-CSRF-Token": csrfToken },
      body: JSON.stringify(input),
    }),
  deleteContentTag: (id: string, csrfToken: string) =>
    request<void>(`/content-tags/${id}`, {
      method: "DELETE",
      headers: { "X-CSRF-Token": csrfToken },
    }),
  bulkOrganize: (input: BulkOrganizeInput, csrfToken: string) =>
    request<{ updated: number }>("/assets/bulk-organize", {
      method: "POST",
      headers: { "X-CSRF-Token": csrfToken },
      body: JSON.stringify(input),
    }),
  asset: (id: string) => request<Asset>(`/assets/${id}`),
  assetPreviewUrl: (id: string) =>
    `/api/v1/assets/${encodeURIComponent(id)}/preview`,
  updateAsset: (
    id: string,
    input: { name?: string; description?: string },
    csrfToken: string,
  ) =>
    request<Asset>(`/assets/${id}`, {
      method: "PATCH",
      headers: { "X-CSRF-Token": csrfToken },
      body: JSON.stringify(input),
    }),
  createWebsite: (input: WebsiteInput, csrfToken: string) =>
    request<Asset>("/assets/websites", {
      method: "POST",
      headers: { "X-CSRF-Token": csrfToken },
      body: JSON.stringify(input),
    }),
  updateWebsite: (id: string, input: WebsiteInput, csrfToken: string) =>
    request<Asset>(`/assets/${id}/website`, {
      method: "PATCH",
      headers: { "X-CSRF-Token": csrfToken },
      body: JSON.stringify(input),
    }),
  websiteDiagnostics: (id: string) =>
    request<WebsiteDiagnostics>(`/assets/${id}/website/diagnostics`),
  createWidget: (input: WidgetInput, csrfToken: string) =>
    request<Asset>("/widgets", {
      method: "POST",
      headers: { "X-CSRF-Token": csrfToken },
      body: JSON.stringify(input),
    }),
  updateWidget: (id: string, input: WidgetInput, csrfToken: string) =>
    request<Asset>(`/widgets/${id}`, {
      method: "PATCH",
      headers: { "X-CSRF-Token": csrfToken },
      body: JSON.stringify(input),
    }),
  duplicateWidget: (id: string, csrfToken: string) =>
    request<Asset>(`/widgets/${id}/duplicate`, {
      method: "POST",
      headers: { "X-CSRF-Token": csrfToken },
    }),
  listDataSources: (params?: URLSearchParams) =>
    request<DataSourceListResult>(
      `/data-sources?${(
        params ?? new URLSearchParams({ page: "1", pageSize: "100" })
      ).toString()}`,
    ),
  getDataSource: (id: string) =>
    request<DataSourceDetail>(`/data-sources/${id}`),
  createDataSource: (input: DataSourceInput, csrfToken: string) =>
    request<DataSourceDetail>("/data-sources", {
      method: "POST",
      headers: { "X-CSRF-Token": csrfToken },
      body: JSON.stringify(input),
    }),
  updateDataSource: (id: string, input: DataSourceInput, csrfToken: string) =>
    request<DataSourceDetail>(`/data-sources/${id}`, {
      method: "PATCH",
      headers: { "X-CSRF-Token": csrfToken },
      body: JSON.stringify(input),
    }),
  duplicateDataSource: (id: string, csrfToken: string) =>
    request<DataSourceDetail>(`/data-sources/${id}/duplicate`, {
      method: "POST",
      headers: { "X-CSRF-Token": csrfToken },
    }),
  deleteDataSource: (id: string, csrfToken: string) =>
    request<void>(`/data-sources/${id}`, {
      method: "DELETE",
      headers: { "X-CSRF-Token": csrfToken },
    }),
  dataSourceDiagnostics: (id: string) =>
    request<SourceRefreshDiagnostics>(`/data-sources/${id}/diagnostics`),
  previewDataSource: (
    provider: DataSourceProvider,
    configuration:
      | CalendarConfig
      | StructuredSourceConfig
      | ManualSourceConfig
      | WeatherSourceConfig
      | TransitSourceConfig
      | CAPAlertsSourceConfig
      | AirQualitySourceConfig,
    csrfToken: string,
    previewDate?: string,
  ) =>
    request<
      | StructuredPreview
      | CalendarPreview
      | TypedRecordData
      | TypedDatasetPayload
    >(`/data-sources/${provider}/preview`, {
      method: "POST",
      headers: { "X-CSRF-Token": csrfToken },
      body: JSON.stringify({ configuration, previewDate }),
    }),
  // Preview a saved Data Source by id using its full stored configuration
  // (including uploaded CSV content the detail response strips).
  previewSavedDataSource: (id: string, previewDate?: string) => {
    const query = previewDate
      ? `?previewDate=${encodeURIComponent(previewDate)}`
      : "";
    return request<StructuredPreview | CalendarPreview | TypedRecordData>(
      `/data-sources/${id}/preview${query}`,
    );
  },
  retryAsset: (id: string, csrfToken: string) =>
    request<Asset>(`/assets/${id}/retry`, {
      method: "POST",
      headers: { "X-CSRF-Token": csrfToken },
    }),
  deleteAsset: (id: string, csrfToken: string) =>
    request<void>(`/assets/${id}`, {
      method: "DELETE",
      headers: { "X-CSRF-Token": csrfToken },
    }),
  createUpload: (
    input: { filename: string; mimeType: string; sizeBytes: number },
    csrfToken: string,
  ) =>
    request<UploadSession>("/uploads", {
      method: "POST",
      headers: { "X-CSRF-Token": csrfToken },
      body: JSON.stringify(input),
    }),
  inspectUpload: async (id: string) => {
    const response = await fetch(`/api/v1/uploads/${id}`, {
      method: "HEAD",
      credentials: "same-origin",
    });
    if (!response.ok) return apiFailure(response);
    return {
      offset: Number(response.headers.get("Upload-Offset") ?? 0),
      sizeBytes: Number(response.headers.get("Upload-Length") ?? 0),
      status: response.headers.get("Upload-Status") ?? "pending",
      expiresAt: response.headers.get("Upload-Expires") ?? "",
    };
  },
  uploadChunk: async (
    id: string,
    offset: number,
    chunk: Blob,
    csrfToken: string,
    signal?: AbortSignal,
  ) => {
    const response = await fetch(`/api/v1/uploads/${id}`, {
      method: "PATCH",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/offset+octet-stream",
        "Upload-Offset": String(offset),
        "X-CSRF-Token": csrfToken,
      },
      body: chunk,
      signal,
    });
    if (!response.ok) return apiFailure(response);
    return Number(response.headers.get("Upload-Offset") ?? offset + chunk.size);
  },
  completeUpload: (id: string, csrfToken: string) =>
    request<Asset>(`/uploads/${id}/complete`, {
      method: "POST",
      headers: { "X-CSRF-Token": csrfToken },
    }),
  cancelUpload: (id: string, csrfToken: string) =>
    request<void>(`/uploads/${id}`, {
      method: "DELETE",
      headers: { "X-CSRF-Token": csrfToken },
    }),
  playlists: async (search = "") => {
    const result = await request<PlaylistList | null>(
      `/playlists?page=1&pageSize=100&search=${encodeURIComponent(search)}`,
    );
    return normalizePlaylistList(result);
  },
  playlist: (id: string) => requestPlaylist(`/playlists/${id}`),
  createPlaylist: (
    input: { name: string; description: string },
    csrfToken: string,
  ) =>
    requestPlaylist("/playlists", {
      method: "POST",
      headers: { "X-CSRF-Token": csrfToken },
      body: JSON.stringify(input),
    }),
  updatePlaylist: (
    id: string,
    input: { name: string; description: string },
    csrfToken: string,
  ) =>
    requestPlaylist(`/playlists/${id}`, {
      method: "PATCH",
      headers: { "X-CSRF-Token": csrfToken },
      body: JSON.stringify(input),
    }),
  duplicatePlaylist: (id: string, csrfToken: string) =>
    requestPlaylist(`/playlists/${id}/duplicate`, {
      method: "POST",
      headers: { "X-CSRF-Token": csrfToken },
    }),
  deletePlaylist: (id: string, csrfToken: string) =>
    request<void>(`/playlists/${id}`, {
      method: "DELETE",
      headers: { "X-CSRF-Token": csrfToken },
    }),
  addPlaylistItem: (id: string, input: PlaylistItemInput, csrfToken: string) =>
    requestPlaylist(`/playlists/${id}/items`, {
      method: "POST",
      headers: { "X-CSRF-Token": csrfToken },
      body: JSON.stringify(input),
    }),
  updatePlaylistItem: (
    id: string,
    itemId: string,
    input: PlaylistItemInput,
    csrfToken: string,
  ) =>
    requestPlaylist(`/playlists/${id}/items/${itemId}`, {
      method: "PATCH",
      headers: { "X-CSRF-Token": csrfToken },
      body: JSON.stringify(input),
    }),
  deletePlaylistItem: (id: string, itemId: string, csrfToken: string) =>
    requestPlaylist(`/playlists/${id}/items/${itemId}`, {
      method: "DELETE",
      headers: { "X-CSRF-Token": csrfToken },
    }),
  reorderPlaylist: (id: string, itemIds: string[], csrfToken: string) =>
    requestPlaylist(`/playlists/${id}/items/order`, {
      method: "PUT",
      headers: { "X-CSRF-Token": csrfToken },
      body: JSON.stringify({ itemIds }),
    }),
  playlistAssignment: async (screenId: string) =>
    normalizePlaylistAssignment(
      await request<PlaylistAssignment | null>(
        `/screens/${screenId}/playlist-assignment`,
      ),
    ),
  assignPlaylist: async (
    screenId: string,
    playlistId: string,
    csrfToken: string,
  ) =>
    normalizePlaylistAssignment(
      await request<PlaylistAssignment | null>(
        `/screens/${screenId}/playlist-assignment`,
        {
          method: "PUT",
          headers: { "X-CSRF-Token": csrfToken },
          body: JSON.stringify({ playlistId }),
        },
      ),
    ),
  assignLayout: async (screenId: string, layoutId: string, csrfToken: string) =>
    normalizePlaylistAssignment(
      await request<PlaylistAssignment | null>(
        `/screens/${screenId}/playlist-assignment`,
        {
          method: "PUT",
          headers: { "X-CSRF-Token": csrfToken },
          body: JSON.stringify({ layoutId }),
        },
      ),
    ),
  unassignPlaylist: async (screenId: string, csrfToken: string) =>
    normalizePlaylistAssignment(
      await request<PlaylistAssignment | null>(
        `/screens/${screenId}/playlist-assignment`,
        {
          method: "DELETE",
          headers: { "X-CSRF-Token": csrfToken },
        },
      ),
    ),
  screenGroups: async (search = "") => {
    const result = await request<ScreenGroupList>(
      `/screen-groups?page=1&pageSize=100&search=${encodeURIComponent(search)}`,
    );
    return {
      ...result,
      items: (Array.isArray(result.items) ? result.items : []).map(
        normalizeScreenGroup,
      ),
    };
  },
  screenGroup: async (id: string) =>
    normalizeScreenGroup(await request<ScreenGroup>(`/screen-groups/${id}`)),
  createScreenGroup: (
    input: { name: string; description: string },
    csrfToken: string,
  ) =>
    request<ScreenGroup>("/screen-groups", {
      method: "POST",
      headers: { "X-CSRF-Token": csrfToken },
      body: JSON.stringify(input),
    }),
  updateScreenGroup: (
    id: string,
    input: { name: string; description: string },
    csrfToken: string,
  ) =>
    request<ScreenGroup>(`/screen-groups/${id}`, {
      method: "PATCH",
      headers: { "X-CSRF-Token": csrfToken },
      body: JSON.stringify(input),
    }),
  deleteScreenGroup: (id: string, csrfToken: string) =>
    request<void>(`/screen-groups/${id}`, {
      method: "DELETE",
      headers: { "X-CSRF-Token": csrfToken },
    }),
  addScreenToGroup: (id: string, screenId: string, csrfToken: string) =>
    request<ScreenGroup>(`/screen-groups/${id}/screens`, {
      method: "POST",
      headers: { "X-CSRF-Token": csrfToken },
      body: JSON.stringify({ screenId }),
    }),
  removeScreenFromGroup: (id: string, screenId: string, csrfToken: string) =>
    request<void>(`/screen-groups/${id}/screens/${screenId}`, {
      method: "DELETE",
      headers: { "X-CSRF-Token": csrfToken },
    }),
  assignSyncGroupPlaylist: (
    id: string,
    playlistId: string,
    csrfToken: string,
  ) =>
    request<ScreenGroup>(`/screen-groups/${id}/playlist-assignment`, {
      method: "PUT",
      headers: { "X-CSRF-Token": csrfToken },
      body: JSON.stringify({ playlistId }),
    }),
  assignSyncGroupLayout: (id: string, layoutId: string, csrfToken: string) =>
    request<ScreenGroup>(`/screen-groups/${id}/playlist-assignment`, {
      method: "PUT",
      headers: { "X-CSRF-Token": csrfToken },
      body: JSON.stringify({ layoutId }),
    }),
  unassignSyncGroupPlaylist: (id: string, csrfToken: string) =>
    request<ScreenGroup>(`/screen-groups/${id}/playlist-assignment`, {
      method: "DELETE",
      headers: { "X-CSRF-Token": csrfToken },
    }),
  schedules: (search = "") =>
    request<ScheduleList>(
      `/schedules?page=1&pageSize=100&search=${encodeURIComponent(search)}`,
    ),
  schedule: (id: string) => request<Schedule>(`/schedules/${id}`),
  createSchedule: (input: ScheduleInput, csrfToken: string) =>
    request<Schedule>("/schedules", {
      method: "POST",
      headers: { "X-CSRF-Token": csrfToken },
      body: JSON.stringify(input),
    }),
  updateSchedule: (id: string, input: ScheduleInput, csrfToken: string) =>
    request<Schedule>(`/schedules/${id}`, {
      method: "PATCH",
      headers: { "X-CSRF-Token": csrfToken },
      body: JSON.stringify(input),
    }),
  deleteSchedule: (id: string, csrfToken: string) =>
    request<void>(`/schedules/${id}`, {
      method: "DELETE",
      headers: { "X-CSRF-Token": csrfToken },
    }),
  setScheduleEnabled: (id: string, enabled: boolean, csrfToken: string) =>
    request<Schedule>(`/schedules/${id}/${enabled ? "enable" : "disable"}`, {
      method: "POST",
      headers: { "X-CSRF-Token": csrfToken },
    }),
  previewSchedule: (
    screenId: string,
    timestamp: string,
    proposedSchedule?: ScheduleInput,
  ) =>
    request<SchedulePreview>("/schedules/preview", {
      method: "POST",
      body: JSON.stringify({ screenId, timestamp, proposedSchedule }),
    }),
};
