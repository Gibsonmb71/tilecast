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
};
