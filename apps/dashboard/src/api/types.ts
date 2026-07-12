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

export type PairingRequest = {
  id: string;
  status: string;
  createdAt: string;
  expiresAt: string;
  metadata: {
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
  type: "image" | "video";
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
