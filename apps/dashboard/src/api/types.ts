export type User = {
  id: string;
  name: string;
  username: string;
  role: "owner" | "administrator" | "editor" | "viewer";
  active: boolean;
  createdAt: string;
  lastLoginAt?: string;
};

export type AuthStatus = {
  setupRequired: boolean;
  authenticated: boolean;
  user?: User;
  csrfToken?: string;
};

export type SetupInput = {
  organizationName: string;
  ownerName: string;
  username: string;
  password: string;
};

export type LoginInput = { username: string; password: string };

export type ScreenStatus =
  "online" | "recent" | "stale" | "offline" | "disabled" | "revoked";

export type Screen = {
  id: string;
  name: string;
  description: string;
  location: string;
  platform: string;
  deviceManufacturer: string;
  deviceModel: string;
  androidVersion: string;
  playerVersion: string;
  playerVersionCode?: number;
  androidSdk?: number;
  installerSource?: string;
  installPermissionStatus?: string;
  currentUpdateDeploymentId?: string;
  updateState?: string;
  updateDownloadedBytes?: number;
  updateExpectedBytes?: number;
  updateError?: string;
  screenWidth: number;
  screenHeight: number;
  density: number;
  locale: string;
  timezone: string;
  availableStorageBytes?: number;
  uptimeSeconds?: number;
  enabled: boolean;
  pairedAt: string;
  lastContactAt?: string;
  lastKnownIp?: string;
  status: ScreenStatus;
  hasActiveCredential: boolean;
};

export type PlaylistItem = {
  id: string;
  assetId: string;
  position: number;
  durationMs?: number;
  fitMode: "contain" | "cover" | "stretch";
  transition: "none" | "fade";
  audioEnabled: boolean;
  volume: number;
  videoStartOffsetMs?: number;
  videoEndOffsetMs?: number;
  deliveryPolicy: "download" | "stream" | "automatic";
  assetName: string;
  assetType: "image" | "video" | "source" | "website";
  sourceProvider?: SourceProvider;
  assetStatus: AssetStatus;
  assetDurationSeconds?: number;
  thumbnailUrl: string;
  variantId?: string;
};

export type Playlist = {
  id: string;
  name: string;
  description: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  items: PlaylistItem[];
  itemCount: number;
  warnings: string[];
};

export type PlaylistList = {
  items: Playlist[];
  total: number;
  page: number;
  pageSize: number;
};
export type PlaylistItemInput = {
  assetId: string;
  durationMs?: number;
  fitMode: PlaylistItem["fitMode"];
  transition: PlaylistItem["transition"];
  audioEnabled: boolean;
  volume: number;
  videoStartOffsetMs?: number;
  videoEndOffsetMs?: number;
  deliveryPolicy: PlaylistItem["deliveryPolicy"];
};
export type PlaylistAssignment = {
  screenId: string;
  playlistId?: string;
  playlistName?: string;
  playlistRevision?: number;
  manifestVersion: number;
  playerActiveManifestVersion?: number;
  playerPendingManifestVersion?: number;
  synchronizationStatus:
    "not_reported" | "current" | "preparing" | "out_of_date";
  downloadQueueCount?: number;
  downloadedBytes?: number;
  requiredBytes?: number;
  cacheUsedBytes?: number;
  cacheLimitBytes?: number;
  currentItemId?: string;
  currentAssetId?: string;
  playbackState?: string;
  lastSynchronizationError?: string;
  lastPlaybackError?: string;
  currentScheduleId?: string;
  currentPlaylistId?: string;
  selectionSource?: "emergency" | "schedule" | "direct_fallback" | "none";
  nextTransitionAt?: string;
  deviceClockOffsetSeconds?: number;
  scheduleEvaluationError?: string;
  scheduleManifestVersion?: number;
  groups: { id: string; name: string }[];
  relevantSchedules: {
    id: string;
    name: string;
    playlistName: string;
    priority: number;
    enabled: boolean;
  }[];
  clockSkewWarningSeconds: number;
  currentWebsiteAssetId?: string;
  websiteState?: string;
  websiteLoadStartedAt?: string;
  websiteLoadCompletedAt?: string;
  websiteFailureCategory?: string;
  websiteBlockedNavigationCount?: number;
  websiteCurrentHost?: string;
  websiteFallbackShown?: boolean;
  websiteRendererRecoveryCount?: number;
  activeEmergencyId?: string;
  emergencyState?: string;
  emergencyPreparationProgress?: number;
  playbackDisabled: boolean;
  lastCommandId?: string;
  lastCommandState?: string;
  lastCommandResult?: string;
  lastCommandCompletedAt?: string;
  activeConfigRevision?: number;
  configurationError?: string;
};

export type PlayerCommand = {
  id: string;
  type: string;
  payload: Record<string, number>;
  state: string;
  createdAt: string;
  expiresAt: string;
  deliveredAt?: string;
  acknowledgedAt?: string;
  completedAt?: string;
  resultCode?: string;
  resultMessage?: string;
};

export type ReliabilityStatus = {
  configuredMode?: string;
  effectiveMode?: string;
  foregroundState?: string;
  lastForegroundExitAt?: string;
  lastForegroundPackage?: string;
  bootRecoveryResult?: string;
  lastSuccessfulColdBootAt?: string;
  immersiveModeActive?: boolean;
  keepScreenOn?: boolean;
  managedKioskCapability?: string;
  deviceOwnerState?: string;
  lockTaskState?: string;
  accessibilityServiceState?: string;
  accessibilityReturnState?: string;
  accessibilityReturnAttempts?: number;
  activeHoursState?: string;
  sleepCapability?: string;
  lastSleepRequestResult?: string;
  lastWakeResult?: string;
  recoveryLevel?: number;
  recoveryCount?: number;
  safeMode?: boolean;
  lastWatchdogFailure?: string;
  lastWatchdogRecoveryAt?: string;
  maintenanceSessionExpiresAt?: string;
  commissioningState?: string;
  commissioningStep?: string;
  commissioningCompletedAt?: string;
  cachedFallbackAvailable?: boolean;
  lastHealthyPlaybackAt?: string;
  lastPlaylistTransitionAt?: string;
  lastSuccessfulSyncAt?: string;
  lastServerConnectionAt?: string;
  bootAttemptCount?: number;
  bootLastAttemptAt?: string;
  bootLaunchVerified?: boolean;
  updateReadiness?: string;
  selfTestResult?: string;
  selfTestCompletedAt?: string;
  powerAssist: PowerAssistResults;
};
export type PowerAssistResults = {
  deviceSleep: string;
  tvStandby: string;
  deviceWake: string;
  tvWake: string;
  inputSelection: string;
  tilecastStartup: string;
  lastTestedAt?: string;
};

export type EmergencyTakeover = {
  id: string;
  name: string;
  description: string;
  playlistId: string;
  playlistName: string;
  status: string;
  activatedAt?: string;
  expiresAt: string;
  cancelledAt?: string;
  cancellationReason?: string;
  affectedCount: number;
  activeCount: number;
  preparingCount: number;
  failedCount: number;
};

export type SettingDefinition = {
  key: string;
  category: string;
  type: string;
  title: string;
  description?: string;
  default: unknown;
  min?: number;
  max?: number;
  allowed?: string[];
  scope: "organization" | "policy" | "preference";
  sensitive: boolean;
  restartRequired: boolean;
  immediate: boolean;
  futureOnly: boolean;
};
export type SettingsDocument = {
  schemaVersion: number;
  revision: number;
  values: Record<string, unknown>;
  definitions: SettingDefinition[];
  updatedAt: string;
};
export type PolicyDocument = {
  schemaVersion: number;
  revision: number;
  priority?: number;
  values: Record<string, unknown>;
  updatedAt?: string;
};
export type EffectivePolicy = {
  values: Record<string, { value: unknown; source: string; sourceId?: string }>;
  organizationRevision: number;
  groupRevisions: Record<string, number>;
  screenRevision: number;
  configRevision: number;
  hash: string;
};
export type SystemStatus = {
  tilecastVersion: string;
  buildCommit: string;
  buildDate: string;
  uptimeSeconds: number;
  goVersion: string;
  database: {
    status: string;
    migrationVersion: string;
    postgresVersion: string;
  };
  media: Record<string, unknown>;
  activeProcessingJobs: number;
  pendingCommands: number;
  connectedScreens: number;
  serverTimezone: string;
  deployment: Record<string, unknown>;
};
export type ScreenGroup = {
  id: string;
  name: string;
  description: string;
  playlistId?: string;
  playlistName?: string;
  playbackEpoch: string;
  membershipCount: number;
  screens: { id: string; name: string; location: string }[];
  createdAt: string;
  updatedAt: string;
};
export type ScreenGroupList = {
  items: ScreenGroup[];
  total: number;
  page: number;
  pageSize: number;
};
export type ScheduleTarget = {
  type: "screen" | "group";
  id: string;
  name?: string;
};
export type Schedule = {
  id: string;
  name: string;
  description: string;
  playlistId: string;
  playlistName: string;
  type: "one_time" | "weekly";
  timezone: string;
  priority: number;
  specificity: number;
  enabled: boolean;
  startDate?: string;
  endDate?: string;
  oneTimeStart?: string;
  oneTimeEnd?: string;
  dailyStart?: string;
  dailyEnd?: string;
  daysOfWeek: number[];
  targets: ScheduleTarget[];
  createdAt: string;
  updatedAt: string;
};
export type ScheduleInput = Omit<
  Schedule,
  "id" | "playlistName" | "specificity" | "createdAt" | "updatedAt"
>;
export type ScheduleList = {
  items: Schedule[];
  total: number;
  page: number;
  pageSize: number;
  defaultTimezone: string;
};
export type SchedulePreview = {
  screenId: string;
  at: string;
  winningSchedule?: Schedule;
  winningPlaylistId?: string;
  directFallbackPlaylistId?: string;
  applicableSchedules: Schedule[];
  nextTransition?: string;
  conflicts: string[];
};

export type PlayerRelease = {
  id: string;
  tag: string;
  source: "github" | "upload";
  channel: "stable" | "beta";
  versionCode: number;
  versionName: string;
  minimumSdk: number;
  releaseNotes: string;
  publishedAt: string;
  apkSizeBytes: number;
  apkSha256: string;
  signingCertificateSha256: string;
  manifestSignature: string;
  cacheStatus: "missing" | "downloading" | "cached" | "failed";
  verificationStatus: "verified_manifest" | "verified" | "failed";
  verificationError?: string;
};
export type PlayerReleaseImport = Pick<
  PlayerRelease,
  | "id"
  | "source"
  | "versionCode"
  | "versionName"
  | "channel"
  | "apkSizeBytes"
  | "releaseNotes"
  | "cacheStatus"
  | "verificationStatus"
> & { duplicate: boolean };
export type PlayerReleaseList = {
  repository: string;
  lastCheckedAt?: string;
  providerError?: string;
  manifestKeyConfigured: boolean;
  githubAuth: GitHubAuthStatus;
  items: PlayerRelease[];
};
export type GitHubAuthStatus = {
  available: boolean;
  connected: boolean;
  source: "anonymous" | "device" | "environment";
  login?: string;
  canDisconnect: boolean;
};
export type GitHubDeviceStart = {
  flowId: string;
  userCode: string;
  verificationUri: string;
  expiresAt: string;
  pollIntervalSeconds: number;
};
export type GitHubDevicePoll = {
  status: "pending" | "connected" | "denied" | "expired";
  login?: string;
  retryAfterSeconds?: number;
};
export type UpdateDeployment = {
  id: string;
  name: string;
  mode: string;
  status: string;
  createdAt: string;
  versionCode: number;
  versionName: string;
  targetCount: number;
  succeededCount: number;
  failedCount: number;
  waitingForUserCount: number;
  rolloutMode?: string;
  rolloutPhase?: string;
  canarySize?: number;
  pauseReason?: string;
  lastFailure?: string;
};

export type PairingRequest = {
  id: string;
  status: string;
  createdAt: string;
  expiresAt: string;
  previouslyPaired: boolean;
  existingScreenId?: string;
  existingScreenName?: string;
  hasActiveCredential: boolean;
  credentialReplacementAuthorized: boolean;
  metadata: {
    playerInstallationId: string;
    platform: string;
    manufacturer: string;
    model: string;
    androidVersion: string;
    playerVersion: string;
    screenWidth: number;
    screenHeight: number;
    density: number;
    locale: string;
    timezone: string;
    approximateAddress?: string;
  };
};

export type AssetStatus =
  | "uploading"
  | "uploaded"
  | "queued"
  | "inspecting"
  | "processing"
  | "ready"
  | "failed"
  | "deleting"
  | "deleted";

export type AssetVariant = {
  id: string;
  kind: "original" | "playback" | "thumbnail" | "poster";
  mimeType: string;
  fileSize: number;
  sha256: string;
  width?: number;
  height?: number;
  durationSeconds?: number;
  frameRate?: number;
  videoCodec?: string;
  audioCodec?: string;
  playerCompatible: boolean;
  createdAt: string;
};

export type Asset = {
  id: string;
  name: string;
  description: string;
  type: "image" | "video" | "source";
  originalFilename: string;
  declaredMimeType: string;
  detectedMimeType: string;
  sha256: string;
  originalSize: number;
  width?: number;
  height?: number;
  durationSeconds?: number;
  frameRate?: number;
  videoCodec?: string;
  audioCodec?: string;
  audioChannels?: number;
  metadata: Record<string, unknown>;
  processingStatus: AssetStatus;
  processingProgress?: number;
  errorCode?: string;
  errorMessage?: string;
  creator?: { id: string; name: string };
  createdAt: string;
  updatedAt: string;
  variants: AssetVariant[];
  thumbnailUrl?: string;
  website?: WebsiteConfig;
  source?: Source;
  playlistUsage?: number;
};
export type SourceProvider = "website" | "youtube" | "calendar";
export type Source = {
  provider: SourceProvider;
  configVersion: number;
  configuration: WebsiteConfig | YouTubeConfig | CalendarConfig;
};
export type SourceInput = {
  provider: SourceProvider;
  name: string;
  description: string;
  configuration: WebsiteConfigInput | YouTubeConfig | CalendarConfig;
};
export type WebsiteConfig = {
  url: string;
  displayUrl: string;
  allowedHosts: string[];
  javascriptEnabled: boolean;
  domStorageEnabled: boolean;
  cookiePolicy: "disabled" | "first_party" | "first_and_third_party";
  reloadPolicy: "load_once" | "on_each_activation" | "interval";
  refreshIntervalSeconds?: number;
  loadTimeoutSeconds: number;
  zoomPercent: number;
  scrollX: number;
  scrollY: number;
  customUserAgent: string;
  backgroundColor: string;
  failureBehavior: "last_success" | "placeholder" | "fallback_image" | "skip";
  fallbackImageAssetId?: string;
  createdAt?: string;
  updatedAt?: string;
};
export type WebsiteInput = { name: string; description: string } & Omit<
  WebsiteConfig,
  "displayUrl" | "createdAt" | "updatedAt"
>;
export type WebsiteConfigInput = Omit<
  WebsiteConfig,
  "displayUrl" | "createdAt" | "updatedAt"
>;
export type YouTubeConfig = {
  url: string;
  kind?: "video" | "playlist";
  videoId?: string;
  playlistId?: string;
  startSeconds: number;
  endSeconds?: number;
  loop: boolean;
  muted: boolean;
  volume: number;
  captions: boolean;
  captionLanguage: string;
  controls: boolean;
  failureBehavior: "placeholder" | "fallback_image" | "skip";
  fallbackImageAssetId?: string;
  playlistPlaybackMode: "until_end" | "fixed_duration";
  fixedDurationSeconds?: number;
};
export type CalendarConfig = {
  calendars: { name: string; url: string }[];
  displayMode: "today" | "upcoming" | "this_week" | "agenda";
  maxEvents: number;
  fields: {
    title: boolean;
    startTime: boolean;
    endTime: boolean;
    date: boolean;
    location: boolean;
    descriptionExcerpt: boolean;
  };
  filterKeyword?: string;
  filterCalendars?: string[];
  timezone: string;
  refreshIntervalSeconds: number;
  stalenessLimitHours: number;
  emptyState: string;
};
export type CalendarEvent = {
  id: string;
  calendar: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location?: string;
  descriptionExcerpt?: string;
};
export type SourceRefreshDiagnostics = {
  assetId: string;
  lastSuccessfulRefresh?: string;
  lastAttemptedRefresh?: string;
  httpResultCategory?: string;
  parseStatus: string;
  availableEventCount: number;
  usingCachedData: boolean;
  cacheUpdatedAt?: string;
  cacheExpiresAt?: string;
  errorCode?: string;
};
export type CalendarPreview = {
  configuration: CalendarConfig & {
    data: {
      events: CalendarEvent[];
      cachedAt: string;
      staleAt: string;
      usingCachedData: boolean;
    };
  };
  diagnostics: SourceRefreshDiagnostics;
};
export type WebsiteDiagnostics = {
  assetId: string;
  configuredUrl: string;
  allowedHosts: string[];
  lastSuccessfulLoad?: string;
  lastFailure?: string;
  lastFailureCategory?: string;
  reportingScreens: {
    id: string;
    name: string;
    state: string;
    host?: string;
  }[];
  fallbackImageAssetId?: string;
};

export type AssetList = {
  items: Asset[];
  total: number;
  page: number;
  pageSize: number;
};

export type UploadSession = {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  offset: number;
  status:
    | "pending"
    | "uploading"
    | "finalizing"
    | "finalized"
    | "failed"
    | "expired"
    | "cancelled";
  expiresAt: string;
  assetId?: string;
  uploadEndpoint: string;
  maximumSizeBytes: number;
};
