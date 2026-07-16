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
  assetType: "image" | "video" | "widget";
  widgetProvider?: WidgetProvider;
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
  layoutUsage: { id: string; name: string; published: boolean }[];
};

export type PlaylistList = {
  items: Playlist[];
  total: number;
  page: number;
  pageSize: number;
};

export type LayoutOrientation = "landscape" | "portrait" | "custom";
export type LayoutPlacementType =
  "widget" | "asset" | "playlistZone" | "primitive";
export type LayoutBinding = {
  dataSourceId: string;
  field: string;
  prefix?: string;
  suffix?: string;
  fallbackText?: string;
  hideWhenEmpty?: boolean;
  format?:
    "text" | "date-short" | "date-long" | "number" | "integer" | "currency";
};
export type LayoutPrimitive = {
  kind: "text" | "rectangle" | "circle" | "line" | "group";
  text?: string;
  fontFamily?: "Inter" | "Roboto" | "Source Sans 3" | "Noto Sans";
  fontSize?: number;
  fontWeight?: 400 | 500 | 600 | 700 | 800;
  textAlign?: "left" | "center" | "right";
  verticalAlign?: "top" | "center" | "bottom";
  color?: string;
  backgroundColor?: string;
  lineHeight?: number;
  letterSpacing?: number;
  padding?: number;
  borderWidth?: number;
  borderColor?: string;
  cornerRadius?: number;
  maximumLines?: number;
  overflow?: "clip" | "ellipsis";
  autoFit?: boolean;
  minimumFontSize?: number;
  fillColor?: string;
  strokeColor?: string;
  strokeWidth?: number;
  binding?: LayoutBinding;
};
export type LayoutPlayback = {
  fit?: "contain" | "cover" | "stretch";
  muted?: boolean;
  loop?: boolean;
  fallback?: "hide" | "background" | "previous";
  cornerRadius?: number;
};
export type LayoutPlacement = {
  id: string;
  type: LayoutPlacementType;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  layer: number;
  opacity: number;
  visible: boolean;
  locked: boolean;
  groupId?: string;
  widgetId?: string;
  assetId?: string;
  playlistId?: string;
  overrides?: Record<string, unknown>;
  primitive?: LayoutPrimitive;
  playback?: LayoutPlayback;
};
export type LayoutDocument = {
  schemaVersion: 2;
  canvas: {
    width: number;
    height: number;
    orientation: LayoutOrientation;
    backgroundColor: string;
    backgroundAssetId?: string;
    safeAreaPercent: number;
  };
  placements: LayoutPlacement[];
};
export type LayoutDependency = {
  type: "widget" | "asset" | "playlist" | "data_source";
  id: string;
};
export type Layout = {
  id: string;
  name: string;
  description: string;
  orientation: LayoutOrientation;
  canvasWidth: number;
  canvasHeight: number;
  draft: LayoutDocument;
  draftRevision: number;
  publishedRevisionId?: string;
  publishedRevision?: number;
  publishedAt?: string;
  createdAt: string;
  updatedAt: string;
  dependencies: LayoutDependency[];
  usage: {
    screens: { id: string; name: string }[];
    schedules: { id: string; name: string }[];
  };
};
export type LayoutSummary = Omit<
  Layout,
  "draft" | "dependencies" | "usage" | "publishedRevisionId"
>;
export type LayoutList = {
  items: LayoutSummary[];
  total: number;
  page: number;
  pageSize: number;
};
export type LayoutRevision = {
  id: string;
  layoutId: string;
  revision: number;
  document: LayoutDocument;
  documentSha256: string;
  publishedBy?: string;
  publishedAt: string;
};
export type LayoutRevisionList = {
  items: LayoutRevision[];
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
  layoutId?: string;
  layoutName?: string;
  layoutRevision?: number;
  presentationType?: "playlist" | "layout";
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
    presentationType: "playlist" | "layout";
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
  layoutId?: string;
  layoutName?: string;
  presentationType?: "playlist" | "layout";
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
  playlistId?: string;
  playlistName: string;
  layoutId?: string;
  layoutName?: string;
  presentationType: "playlist" | "layout";
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
  | "id"
  | "playlistName"
  | "layoutName"
  | "presentationType"
  | "specificity"
  | "createdAt"
  | "updatedAt"
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
  type: "image" | "video" | "widget";
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
  widget?: Widget;
  playlistUsage?: number;
  layoutUsage?: { id: string; name: string; published: boolean }[];
  folderId?: string;
  tags?: ContentTag[];
  collectionIds?: string[];
};
export type ContentFolder = {
  id: string;
  parentId?: string;
  name: string;
  description: string;
  assetCount: number;
  createdAt: string;
  updatedAt: string;
};
export type ContentCollection = {
  id: string;
  name: string;
  description: string;
  assetCount: number;
  createdAt: string;
  updatedAt: string;
};
export type ContentTag = {
  id: string;
  name: string;
  color: string;
  assetCount?: number;
};
export type BulkOrganizeInput = {
  assetIds: string[];
  setFolder?: boolean;
  folderId?: string;
  addTagIds?: string[];
  removeTagIds?: string[];
  addCollectionIds?: string[];
  removeCollectionIds?: string[];
};
export type WidgetProvider =
  | "website"
  | "youtube"
  | "clock"
  | "date"
  | "qrcode"
  | "ticker"
  | "menu"
  | "list"
  | "table"
  | "agenda";
export type DataSourceProvider = "calendar" | "rss" | "atom" | "json" | "csv";
export type Widget = {
  provider: WidgetProvider;
  configVersion: number;
  configuration:
    | WebsiteConfig
    | YouTubeConfig
    | ClockWidgetConfig
    | DateWidgetConfig
    | QRCodeWidgetConfig
    | TickerWidgetConfig
    | DisplayWidgetConfig;
};
export type WidgetInput = {
  provider: WidgetProvider;
  name: string;
  description: string;
  configuration:
    | WebsiteConfigInput
    | YouTubeConfig
    | ClockWidgetConfig
    | DateWidgetConfig
    | QRCodeWidgetConfig
    | TickerWidgetConfig
    | DisplayWidgetConfig;
};
export type DataSourceField = {
  key: string;
  label: string;
  type: string;
};
export type DataSource = {
  id: string;
  provider: DataSourceProvider;
  name: string;
  description: string;
  configVersion: number;
  configuration: CalendarConfig | StructuredSourceConfig;
  status: string;
  cachedRecordCount: number;
  createdAt: string;
  updatedAt: string;
  creator?: { id: string; name: string };
};
export type DataSourceDetail = {
  id: string;
  provider: DataSourceProvider;
  name: string;
  description: string;
  configVersion: number;
  configuration: CalendarConfig | StructuredSourceConfig;
  creator?: { id: string; name: string };
  createdAt: string;
  updatedAt: string;
  status: string;
  diagnostics: SourceRefreshDiagnostics;
  fields: DataSourceField[];
  dateSelection?: DateSelection;
  cachedRecordCount: number;
  widgetUsage: { id: string; name: string; provider: WidgetProvider }[];
  bindingUsage: { layoutId: string; layoutName: string; field: string }[];
};
export type DataSourceInput = {
  provider: DataSourceProvider;
  name: string;
  description: string;
  configuration: CalendarConfig | StructuredSourceConfig;
};
export type DataSourceListResult = {
  items: DataSource[];
  total: number;
  page: number;
  pageSize: number;
};
export type StructuredSourceConfig = {
  url?: string;
  uploadedContent?: string;
  uploaded?: boolean;
  presentation: "list" | "agenda" | "cards" | "ticker";
  maxItems: number;
  fields: {
    title: boolean;
    subtitle: boolean;
    date: boolean;
    author: boolean;
    description: boolean;
    image: boolean;
    link: boolean;
  };
  filterKeyword?: string;
  sort: "newest" | "oldest" | "title" | "source";
  mapping?: {
    rootList: string;
    title: string;
    subtitle: string;
    date: string;
    imageUrl: string;
    link: string;
    valueFields?: Record<string, string>;
  };
  delimiter?: "" | "," | ";" | "\t" | "|";
  filters?: { field: string; operator: "equals" | "contains"; value: string }[];
  refreshIntervalSeconds: number;
  stalenessLimitHours: number;
  emptyState: string;
  dateSelection: DateSelection;
};
export type DateSelection = {
  enabled: boolean;
  dateFormat:
    "auto" | "iso_date" | "us_date" | "us_short" | "day_month_name" | "rfc3339";
  timezone: string;
  mode:
    "today" | "tomorrow" | "next_available" | "current_week" | "custom_range";
  customStartDate?: string;
  customEndDate?: string;
  excludePast: boolean;
  noMatchBehavior:
    "fallback_text" | "next_available" | "empty" | "hide" | "last_known_good";
  fallbackText?: string;
};
export type ClockWidgetConfig = {
  timezone: string;
  format: "12" | "24";
  showSeconds: boolean;
  foregroundColor: string;
  backgroundColor: string;
  textScale?: number;
  contentPadding?: number;
};
export type DateWidgetConfig = {
  timezone: string;
  format: "full" | "long" | "medium" | "short";
  foregroundColor: string;
  backgroundColor: string;
  textScale?: number;
  contentPadding?: number;
};
export type QRCodeWidgetConfig = {
  value: string;
  label?: string;
  errorCorrection: "low" | "medium" | "quartile" | "high";
  foregroundColor: string;
  backgroundColor: string;
  textScale?: number;
  contentPadding?: number;
};
export type TickerWidgetConfig = {
  dataSourceId: string;
  field: string;
  separator: string;
  direction: "left" | "right";
  speed: "slow" | "normal" | "fast";
  foregroundColor: string;
  backgroundColor: string;
  textScale?: number;
  contentPadding?: number;
};
export type DisplayWidgetConfig = {
  dataSourceId: string;
  fields: string[];
  maximumItems: number;
  foregroundColor: string;
  backgroundColor: string;
  textScale?: number;
  contentPadding?: number;
};
export type StructuredRecord = {
  id: string;
  title: string;
  subtitle?: string;
  date?: string;
  author?: string;
  description?: string;
  imageUrl?: string;
  link?: string;
  values?: Record<string, string>;
};
export type StructuredPreview = {
  configuration: {
    presentation: StructuredSourceConfig["presentation"];
    fields: StructuredSourceConfig["fields"];
    emptyState: string;
    dateSelection: DateSelection;
    data: {
      records: StructuredRecord[];
      cachedAt: string;
      staleAt: string;
      usingCachedData: boolean;
    };
  };
  diagnostics: SourceRefreshDiagnostics;
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
  availableItemCount: number;
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
