export type ScreenPreviewStatus =
  "loading" | "available" | "unavailable" | "capture_error";

export type ScreenPreview = {
  screenId: string;
  status: ScreenPreviewStatus;
  leaseExpiresAt?: string;
  capturedAt?: string;
  playerVersion?: string;
  width?: number;
  height?: number;
  fileSize?: number;
  captureFailureStatus?: string;
  imageAvailable: boolean;
  updatedAt: string;
};

export type PreviewSession = {
  active: boolean;
  expiresAt?: string;
  captureIntervalSeconds: number;
  captureNow: boolean;
};

type Envelope<T> = { data: T };
type ErrorEnvelope = { error?: { code?: string; message?: string } };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "same-origin",
    cache: "no-store",
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const body = await response.text();
  if (!response.ok) {
    let message = `Tilecast returned HTTP ${response.status}`;
    try {
      message = (JSON.parse(body) as ErrorEnvelope).error?.message ?? message;
    } catch {
      // Keep the bounded generic message for non-JSON failures.
    }
    throw new Error(message);
  }
  return (JSON.parse(body) as Envelope<T>).data;
}

export const previewApi = {
  renew: (screenId: string, csrfToken: string, forceCapture: boolean) =>
    request<PreviewSession>(`/api/v1/screens/${screenId}/preview-session`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": csrfToken,
      },
      body: JSON.stringify({ forceCapture }),
    }),
  metadata: (screenId: string) =>
    request<ScreenPreview>(`/api/v1/screens/${screenId}/preview`),
  imageUrl: (screenId: string, version: string) =>
    `/api/v1/screens/${screenId}/preview/image?v=${encodeURIComponent(version)}`,
};
