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
  PlayerCommand,
  EmergencyTakeover,
  SettingsDocument,
  PolicyDocument,
  EffectivePolicy,
  SystemStatus,
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
  screens: () => request<{ items: Screen[]; total: number }>("/screens"),
  pendingPairings: () =>
    request<{ items: PairingRequest[]; total: number }>(
      "/screens/pairing/pending",
    ),
  screen: (id: string) => request<Screen>(`/screens/${id}`),
  resolvePairing: (code: string) =>
    request<PairingRequest>("/screens/pairing/resolve", {
      method: "POST",
      body: JSON.stringify({ code }),
    }),
  approvePairing: (
    id: string,
    input: { name: string; location: string; description: string },
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
  asset: (id: string) => request<Asset>(`/assets/${id}`),
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
  playlists: (search = "") =>
    request<PlaylistList>(
      `/playlists?page=1&pageSize=100&search=${encodeURIComponent(search)}`,
    ),
  playlist: (id: string) => request<Playlist>(`/playlists/${id}`),
  createPlaylist: (
    input: { name: string; description: string },
    csrfToken: string,
  ) =>
    request<Playlist>("/playlists", {
      method: "POST",
      headers: { "X-CSRF-Token": csrfToken },
      body: JSON.stringify(input),
    }),
  updatePlaylist: (
    id: string,
    input: { name: string; description: string },
    csrfToken: string,
  ) =>
    request<Playlist>(`/playlists/${id}`, {
      method: "PATCH",
      headers: { "X-CSRF-Token": csrfToken },
      body: JSON.stringify(input),
    }),
  duplicatePlaylist: (id: string, csrfToken: string) =>
    request<Playlist>(`/playlists/${id}/duplicate`, {
      method: "POST",
      headers: { "X-CSRF-Token": csrfToken },
    }),
  deletePlaylist: (id: string, csrfToken: string) =>
    request<void>(`/playlists/${id}`, {
      method: "DELETE",
      headers: { "X-CSRF-Token": csrfToken },
    }),
  addPlaylistItem: (id: string, input: PlaylistItemInput, csrfToken: string) =>
    request<Playlist>(`/playlists/${id}/items`, {
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
    request<Playlist>(`/playlists/${id}/items/${itemId}`, {
      method: "PATCH",
      headers: { "X-CSRF-Token": csrfToken },
      body: JSON.stringify(input),
    }),
  deletePlaylistItem: (id: string, itemId: string, csrfToken: string) =>
    request<Playlist>(`/playlists/${id}/items/${itemId}`, {
      method: "DELETE",
      headers: { "X-CSRF-Token": csrfToken },
    }),
  reorderPlaylist: (id: string, itemIds: string[], csrfToken: string) =>
    request<Playlist>(`/playlists/${id}/items/order`, {
      method: "PUT",
      headers: { "X-CSRF-Token": csrfToken },
      body: JSON.stringify({ itemIds }),
    }),
  playlistAssignment: (screenId: string) =>
    request<PlaylistAssignment>(`/screens/${screenId}/playlist-assignment`),
  assignPlaylist: (screenId: string, playlistId: string, csrfToken: string) =>
    request<PlaylistAssignment>(`/screens/${screenId}/playlist-assignment`, {
      method: "PUT",
      headers: { "X-CSRF-Token": csrfToken },
      body: JSON.stringify({ playlistId }),
    }),
  unassignPlaylist: (screenId: string, csrfToken: string) =>
    request<PlaylistAssignment>(`/screens/${screenId}/playlist-assignment`, {
      method: "DELETE",
      headers: { "X-CSRF-Token": csrfToken },
    }),
  screenGroups: (search = "") =>
    request<ScreenGroupList>(
      `/screen-groups?page=1&pageSize=100&search=${encodeURIComponent(search)}`,
    ),
  screenGroup: (id: string) => request<ScreenGroup>(`/screen-groups/${id}`),
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
