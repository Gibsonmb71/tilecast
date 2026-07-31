import type {
  UpdateDeployment,
  UpdateDeploymentScreen,
  UpdateDeploymentScreenState,
} from "../api/types";

export type ScreenUpdateTone =
  "success" | "info" | "warning" | "danger" | "neutral";

// Three buckets, because that is the only question an operator asks of a
// deployment: is anything waiting on me, is anything still moving, and is the
// rest finished. Every screen state maps into exactly one of them.
export type ScreenUpdateBucket = "attention" | "progress" | "done";

// The four visible stages of one screen's update. A screen that failed or was
// cancelled has no stage: it stopped somewhere, and saying which step it stopped
// on would read as progress it is not making.
export const screenUpdateStages = [
  "Queued",
  "Downloading",
  "Installing",
  "Updated",
] as const;

export type ScreenUpdateMeaning = {
  label: string;
  // Plain language for what is happening, or what a person has to do about it.
  // Empty when the label already says everything and a second line would only
  // make healthy rows taller.
  detail: string;
  tone: ScreenUpdateTone;
  bucket: ScreenUpdateBucket;
  stage: number;
  // True when the deployment cannot move without a person: approving an
  // installer, granting a permission, retrying, or replacing hardware.
  actionable: boolean;
};

const meanings: Record<UpdateDeploymentScreenState, ScreenUpdateMeaning> = {
  held: {
    label: "Held for canary",
    detail: "Starts once every canary screen reports a successful update.",
    tone: "neutral",
    bucket: "progress",
    stage: 0,
    actionable: false,
  },
  pending: {
    label: "Queued",
    detail: "The player has been told to fetch this release.",
    tone: "info",
    bucket: "progress",
    stage: 0,
    actionable: false,
  },
  offline: {
    label: "Waiting to reconnect",
    detail: "The screen is unreachable and will start after it comes back.",
    tone: "warning",
    bucket: "progress",
    stage: 0,
    actionable: false,
  },
  downloading: {
    label: "Downloading",
    detail: "",
    tone: "info",
    bucket: "progress",
    stage: 1,
    actionable: false,
  },
  downloaded: {
    label: "Downloaded",
    detail: "Waiting to verify the downloaded file.",
    tone: "info",
    bucket: "progress",
    stage: 1,
    actionable: false,
  },
  verifying: {
    label: "Verifying",
    detail: "Checking the downloaded file against its expected hash.",
    tone: "info",
    bucket: "progress",
    stage: 1,
    actionable: false,
  },
  ready: {
    label: "Ready to install",
    detail: "Installation begins at the next moment this mode allows.",
    tone: "info",
    bucket: "progress",
    stage: 2,
    actionable: false,
  },
  waiting_for_permission: {
    label: "Needs install permission",
    detail:
      "Allow this installation source on the TV so the player may install updates.",
    tone: "warning",
    bucket: "attention",
    stage: 2,
    actionable: true,
  },
  waiting_for_user: {
    label: "Needs approval on the TV",
    detail:
      "Someone has to approve the installer on the TV itself. This is not a failure.",
    tone: "warning",
    bucket: "attention",
    stage: 2,
    actionable: true,
  },
  installing: {
    label: "Installing",
    detail: "The player is installing the release now.",
    tone: "info",
    bucket: "progress",
    stage: 2,
    actionable: false,
  },
  reconnecting: {
    label: "Restarting",
    detail: "The player restarted into the new version and is reconnecting.",
    tone: "info",
    bucket: "progress",
    stage: 2,
    actionable: false,
  },
  succeeded: {
    label: "Updated",
    detail: "",
    tone: "success",
    bucket: "done",
    stage: 3,
    actionable: false,
  },
  already_current: {
    label: "Already current",
    detail: "This screen was on the deployed version before the rollout began.",
    tone: "success",
    bucket: "done",
    stage: 3,
    actionable: false,
  },
  failed: {
    label: "Failed",
    detail: "The update stopped. Retry once the screen is reachable.",
    tone: "danger",
    bucket: "attention",
    stage: -1,
    actionable: true,
  },
  cancelled: {
    label: "Cancelled",
    detail: "Stopped before it finished.",
    tone: "neutral",
    bucket: "done",
    stage: -1,
    actionable: false,
  },
  incompatible: {
    label: "Incompatible",
    detail: "This release cannot run on this screen's Android version.",
    tone: "danger",
    bucket: "attention",
    stage: -1,
    actionable: true,
  },
};

const unknownState: ScreenUpdateMeaning = {
  label: "Unknown",
  detail: "This player reported a state Studio does not recognize.",
  tone: "neutral",
  bucket: "progress",
  stage: 0,
  actionable: false,
};

export function screenUpdateMeaning(state: string): ScreenUpdateMeaning {
  return meanings[state as UpdateDeploymentScreenState] ?? unknownState;
}

// The server's own error text wins over the generic sentence: it is the only
// thing that says why this particular screen stopped.
export function screenUpdateDetail(screen: UpdateDeploymentScreen) {
  const meaning = screenUpdateMeaning(screen.state);
  if (screen.state === "failed" && screen.safeError) return screen.safeError;
  return meaning.detail;
}

// Only a download reports real progress. Everything else is a step, not a
// percentage, and inventing one would be a fake progress bar.
export function screenDownloadPercent(
  screen: UpdateDeploymentScreen,
  artifactSizeBytes: number,
) {
  if (screen.state !== "downloading" || artifactSizeBytes <= 0) return null;
  const percent = Math.round(
    (screen.downloadedBytes / artifactSizeBytes) * 100,
  );
  return Math.min(100, Math.max(0, percent));
}

export type DeploymentSegment = {
  key: "succeeded" | "attention" | "failed" | "remaining";
  label: string;
  count: number;
  tone: ScreenUpdateTone;
};

// One meter per deployment, built from the counts the list already returns so it
// needs no extra request. Remaining is whatever the other three do not claim.
export function deploymentSegments(
  item: Pick<
    UpdateDeployment,
    "targetCount" | "succeededCount" | "failedCount" | "waitingForUserCount"
  >,
): DeploymentSegment[] {
  const succeeded = Math.max(0, item.succeededCount);
  const failed = Math.max(0, item.failedCount);
  const waiting = Math.max(0, item.waitingForUserCount);
  const remaining = Math.max(
    0,
    item.targetCount - succeeded - failed - waiting,
  );
  return [
    { key: "succeeded", label: "Updated", count: succeeded, tone: "success" },
    {
      key: "attention",
      label: "Waiting on someone",
      count: waiting,
      tone: "warning",
    },
    { key: "failed", label: "Failed", count: failed, tone: "danger" },
    {
      key: "remaining",
      label: "In progress",
      count: remaining,
      tone: "neutral",
    },
  ];
}

export function deploymentPercent(
  item: Pick<UpdateDeployment, "targetCount" | "succeededCount">,
) {
  if (item.targetCount <= 0) return 0;
  return Math.round((item.succeededCount / item.targetCount) * 100);
}

// The same four numbers the deployment list returns, recomputed from the screen
// rows so the drawer's meter matches the rows underneath it even when a scoped
// operator only sees part of the deployment.
export function screenStateCounts(screens: UpdateDeploymentScreen[]) {
  const counted = (states: UpdateDeploymentScreenState[]) =>
    screens.filter((screen) => states.includes(screen.state)).length;
  return {
    targetCount: screens.length,
    succeededCount: counted(["succeeded", "already_current"]),
    failedCount: counted(["failed", "incompatible"]),
    waitingForUserCount: counted([
      "waiting_for_user",
      "waiting_for_permission",
    ]),
  };
}

export type ScreenFilter = "all" | ScreenUpdateBucket;

export function bucketCounts(screens: UpdateDeploymentScreen[]) {
  const counts: Record<ScreenUpdateBucket, number> = {
    attention: 0,
    progress: 0,
    done: 0,
  };
  for (const screen of screens)
    counts[screenUpdateMeaning(screen.state).bucket] += 1;
  return counts;
}

// Attention first, then whatever is still moving: the rows a person can act on
// should never be below a hundred finished screens.
const bucketOrder: Record<ScreenUpdateBucket, number> = {
  attention: 0,
  progress: 1,
  done: 2,
};

export function sortedDeploymentScreens(screens: UpdateDeploymentScreen[]) {
  return [...screens].sort((left, right) => {
    const order =
      bucketOrder[screenUpdateMeaning(left.state).bucket] -
      bucketOrder[screenUpdateMeaning(right.state).bucket];
    return order || left.screenName.localeCompare(right.screenName);
  });
}

export function filterDeploymentScreens(
  screens: UpdateDeploymentScreen[],
  filter: ScreenFilter,
) {
  const sorted = sortedDeploymentScreens(screens);
  if (filter === "all") return sorted;
  return sorted.filter(
    (screen) => screenUpdateMeaning(screen.state).bucket === filter,
  );
}

// A single sentence for the whole deployment, so the history row says what to do
// rather than leaving four counts to be compared.
export function deploymentHeadline(item: UpdateDeployment) {
  if (item.status === "cancelled") return "Cancelled.";
  if (item.failedCount)
    return `${item.failedCount} ${item.failedCount === 1 ? "screen needs" : "screens need"} a retry.`;
  if (item.waitingForUserCount)
    return `${item.waitingForUserCount} ${item.waitingForUserCount === 1 ? "screen is" : "screens are"} waiting on someone at the TV.`;
  if (item.status === "paused")
    return item.pauseReason ?? "Paused after a canary failure.";
  if (item.succeededCount >= item.targetCount && item.targetCount > 0)
    return "Every screen is on this release.";
  return "Rolling out. Nothing needs attention.";
}
