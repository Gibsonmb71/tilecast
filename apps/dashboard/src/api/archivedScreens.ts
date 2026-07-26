import { normalizeScreen } from "./client";
import type { Screen } from "./types";

export type ArchivedScreen = Screen & {
  archivedAt?: string;
  archivedReason?: string;
};

type ArchivedScreenResponse = {
  data?: {
    items?: ArchivedScreen[];
    total?: number;
  };
  error?: {
    message?: string;
  };
};

export async function archivedScreens(): Promise<{
  items: ArchivedScreen[];
  total: number;
}> {
  const response = await fetch("/api/v1/screens/archive", {
    credentials: "same-origin",
  });
  const body = (await response
    .json()
    .catch(() => ({}))) as ArchivedScreenResponse;
  if (!response.ok) {
    throw new Error(
      body.error?.message ?? "Archived screens could not be loaded.",
    );
  }
  const result = body.data;
  return {
    items: (Array.isArray(result?.items) ? result.items : []).map(
      (screen) => normalizeScreen(screen) as ArchivedScreen,
    ),
    total: result?.total ?? 0,
  };
}
