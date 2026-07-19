import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import type { BackupJob, ScreenStatus, User } from "../api/types";

// Notifications are derived on the fly from the live domain data the Studio already
// polls; there is no stored notification model. Priority orders how urgently a person
// should look: critical means something failed and needs action now, warning means it
// needs attention, info is routine or FYI.
export type NotificationPriority = "critical" | "warning" | "info";

export type NotificationItem = {
  id: string;
  priority: NotificationPriority;
  title: string;
  detail: string;
  to: string;
};

export type NotificationFeed = {
  items: NotificationItem[];
  count: number;
  topPriority: NotificationPriority | null;
};

const priorityRank: Record<NotificationPriority, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

const screenStatusLabels: Record<ScreenStatus, string> = {
  online: "Online",
  recent: "Recently online",
  stale: "Stale",
  offline: "Offline",
  disabled: "Disabled",
  revoked: "Pairing revoked",
};

const screenStatusPriority: Record<ScreenStatus, NotificationPriority> = {
  online: "info", // never surfaced; online screens are not an alert
  recent: "info",
  stale: "warning",
  offline: "warning",
  disabled: "info",
  revoked: "warning",
};

const DAY_MS = 24 * 60 * 60 * 1000;

function plural(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

export function useNotifications(user?: User): NotificationFeed {
  const canManageSystem =
    user?.role === "owner" || user?.role === "administrator";
  const canOperate = user?.role !== "viewer";

  const screens = useQuery({
    queryKey: ["screens"],
    queryFn: api.screens,
    refetchInterval: 10_000,
  });
  const deployments = useQuery({
    queryKey: ["update-deployments"],
    queryFn: api.updateDeployments,
    refetchInterval: 15_000,
  });
  const pairings = useQuery({
    queryKey: ["pending-pairings"],
    queryFn: api.pendingPairings,
    refetchInterval: 30_000,
    enabled: canManageSystem,
  });
  const backups = useQuery({
    queryKey: ["backups"],
    queryFn: api.backups,
    refetchInterval: 60_000,
    enabled: canManageSystem,
  });
  const emergencies = useQuery({
    queryKey: ["emergencies"],
    queryFn: api.emergencies,
    refetchInterval: 30_000,
    enabled: canOperate,
  });
  const failedAssets = useQuery({
    queryKey: ["assets", "failed"],
    queryFn: () =>
      api.assets(
        new URLSearchParams({ status: "failed", page: "1", pageSize: "50" }),
      ),
    refetchInterval: 60_000,
  });

  const items = useMemo<NotificationItem[]>(() => {
    const collected: NotificationItem[] = [];
    const now = Date.now();

    for (const screen of screens.data?.items ?? []) {
      if (screen.status === "online") continue;
      collected.push({
        id: `screen:${screen.id}`,
        priority: screenStatusPriority[screen.status],
        title: screen.name,
        detail: screenStatusLabels[screen.status],
        to: `/screens/${screen.id}`,
      });
    }

    for (const deployment of deployments.data?.items ?? []) {
      if (deployment.failedCount > 0) {
        collected.push({
          id: `deployment-failed:${deployment.id}`,
          priority: "critical",
          title: deployment.name,
          detail: plural(deployment.failedCount, "failed player update"),
          to: "/settings/player/updates",
        });
      }
      if (deployment.waitingForUserCount > 0) {
        collected.push({
          id: `deployment-waiting:${deployment.id}`,
          priority: "warning",
          title: deployment.name,
          detail: `${plural(deployment.waitingForUserCount, "player")} waiting for action`,
          to: "/settings/player/updates",
        });
      }
    }

    // Only surface backup failures from the last day so resolved history does not
    // linger in the bell (there is no acknowledge/dismiss state to clear).
    const backupJobs = [
      backups.data?.currentJob,
      ...(backups.data?.recentJobs ?? []),
    ].filter((job): job is BackupJob => Boolean(job));
    for (const job of backupJobs) {
      if (job.status !== "failed") continue;
      const finishedAt = job.completedAt ?? job.createdAt;
      if (finishedAt && now - new Date(finishedAt).getTime() > DAY_MS) continue;
      collected.push({
        id: `backup:${job.id}`,
        priority: job.kind === "restore" ? "critical" : "warning",
        title:
          job.kind === "restore"
            ? "Restore failed"
            : job.kind === "verify"
              ? "Backup verification failed"
              : "Backup failed",
        detail: job.errorMessage || "Open backup and restore to review.",
        to: "/settings/operations/backups",
      });
    }

    for (const takeover of emergencies.data?.items ?? []) {
      const active =
        !takeover.cancelledAt && new Date(takeover.expiresAt).getTime() > now;
      if (!active) continue;
      if (takeover.failedCount > 0) {
        collected.push({
          id: `emergency-failed:${takeover.id}`,
          priority: "critical",
          title: takeover.name,
          detail: `${plural(takeover.failedCount, "screen")} failed to switch to emergency content`,
          to: "/settings/operations/emergency",
        });
      } else {
        collected.push({
          id: `emergency:${takeover.id}`,
          priority: "warning",
          title: takeover.name,
          detail: `Emergency active on ${plural(takeover.affectedCount, "screen")}`,
          to: "/settings/operations/emergency",
        });
      }
    }

    const failedAssetCount =
      failedAssets.data?.total ?? failedAssets.data?.items.length ?? 0;
    if (failedAssetCount > 0) {
      collected.push({
        id: "assets-failed",
        priority: "warning",
        title: "Media processing failed",
        detail: `${plural(failedAssetCount, "asset")} could not be processed`,
        to: "/assets",
      });
    }

    const pending = pairings.data?.items ?? [];
    if (pending.length > 0) {
      collected.push({
        id: "pending-pairings",
        priority: "info",
        title: "Screens awaiting approval",
        detail: `${plural(pending.length, "pairing request")} pending`,
        to: "/screens/pair",
      });
    }

    // Array.prototype.sort is stable, so items keep their insertion order within
    // a priority band while the bands themselves sort critical -> warning -> info.
    return collected.sort(
      (left, right) =>
        priorityRank[left.priority] - priorityRank[right.priority],
    );
  }, [
    screens.data,
    deployments.data,
    backups.data,
    emergencies.data,
    failedAssets.data,
    pairings.data,
  ]);

  return {
    items,
    count: items.length,
    topPriority: items[0]?.priority ?? null,
  };
}
