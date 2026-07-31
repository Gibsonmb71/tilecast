export type LiveStreamSession = {
  id: string;
  screenId: string;
  active: boolean;
  expiresAt: string;
  frameIntervalMillis: number;
  maxWidth: number;
  maxHeight: number;
  maxFrameBytes: number;
};

type Envelope<T> = { data: T };
type ErrorEnvelope = { error?: { message?: string } };

async function request<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "same-origin",
    cache: "no-store",
    ...init,
    headers: {
      Accept: "application/json",
      ...(init.headers ?? {}),
    },
  });
  const body = await response.text();
  if (!response.ok) {
    let message = `Tilecast returned HTTP ${response.status}`;
    try {
      message = (JSON.parse(body) as ErrorEnvelope).error?.message ?? message;
    } catch {
      // Preserve the bounded HTTP fallback for proxy-generated responses.
    }
    throw new Error(message);
  }
  if (!body) return undefined as T;
  return (JSON.parse(body) as Envelope<T>).data;
}

export const liveStreamApi = {
  start: (screenId: string, csrfToken: string) =>
    request<LiveStreamSession>(`/api/v1/screens/${screenId}/live-stream`, {
      method: "POST",
      headers: { "X-CSRF-Token": csrfToken },
    }),
  renew: (screenId: string, sessionId: string, csrfToken: string) =>
    request<LiveStreamSession>(
      `/api/v1/screens/${screenId}/live-stream/${sessionId}/renew`,
      {
        method: "POST",
        headers: { "X-CSRF-Token": csrfToken },
      },
    ),
  end: (
    screenId: string,
    sessionId: string,
    csrfToken: string,
    keepalive = false,
  ) =>
    request<void>(`/api/v1/screens/${screenId}/live-stream/${sessionId}`, {
      method: "DELETE",
      headers: { "X-CSRF-Token": csrfToken },
      keepalive,
    }),
  mjpegUrl: (screenId: string, sessionId: string) =>
    `/api/v1/screens/${screenId}/live-stream/${sessionId}/mjpeg`,
};
