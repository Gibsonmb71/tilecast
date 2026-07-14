import { ApiError } from "./client";

export type LoginBackground = {
  assetId?: string;
  imageUrl: string;
};

type DataResponse<T> = { data: T };
type ErrorResponse = { error?: { code?: string; message?: string } };

export async function getLoginBackground(): Promise<LoginBackground> {
  const response = await fetch("/api/v1/settings/login-background", {
    credentials: "same-origin",
  });
  if (!response.ok) throw await responseError(response);
  return ((await response.json()) as DataResponse<LoginBackground>).data;
}

export async function setLoginBackground(
  assetId: string,
  csrfToken: string,
): Promise<LoginBackground> {
  const response = await fetch("/api/v1/settings/login-background", {
    method: "PUT",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": csrfToken,
    },
    body: JSON.stringify({ assetId }),
  });
  if (!response.ok) throw await responseError(response);
  return ((await response.json()) as DataResponse<LoginBackground>).data;
}

export async function clearLoginBackground(csrfToken: string): Promise<void> {
  const response = await fetch("/api/v1/settings/login-background", {
    method: "DELETE",
    credentials: "same-origin",
    headers: { "X-CSRF-Token": csrfToken },
  });
  if (!response.ok) throw await responseError(response);
}

async function responseError(response: Response) {
  const body = (await response.json().catch(() => ({}))) as ErrorResponse;
  return new ApiError(
    body.error?.message ?? "The login background could not be updated.",
    response.status,
    body.error?.code ?? "unknown_error",
  );
}
