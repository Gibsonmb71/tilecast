import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { Asset } from "../api/types";
import { useAuth } from "../auth/AuthProvider";
import "./BrandingAssets.css";

const chunkSize = 5 * 1024 * 1024;

type LoginBackground = {
  assetId?: string;
  imageUrl: string;
};

export function BrandingAssets({
  values,
  editable,
  onChange,
}: {
  values: Record<string, unknown>;
  editable: boolean;
  onChange: (key: string, value: unknown) => void;
}) {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const background = useQuery({
    queryKey: ["login-background"],
    queryFn: getLoginBackground,
  });
  const saveBackground = useMutation({
    mutationFn: (assetId: string) =>
      setLoginBackground(assetId, auth.status?.csrfToken ?? ""),
    onSuccess: (result) =>
      queryClient.setQueryData(["login-background"], result),
  });
  const removeBackground = useMutation({
    mutationFn: () => clearLoginBackground(auth.status?.csrfToken ?? ""),
    onSuccess: () =>
      queryClient.setQueryData(["login-background"], {
        imageUrl: "/api/v1/auth/background",
      } satisfies LoginBackground),
  });

  return (
    <section className="settings-subsection">
      <header>
        <h3>Organization images</h3>
        <p>
          Upload images from this device. Tilecast stores the selected asset
          internally.
        </p>
      </header>
      <div className="branding-asset-grid">
        <BrandingAssetUpload
          title="Logo"
          description="A wide organization logo for Tilecast Studio and supported player screens."
          value={stringValue(values["branding.logo_asset_id"])}
          editable={editable}
          onSelect={(assetId) => onChange("branding.logo_asset_id", assetId)}
          onRemove={() => onChange("branding.logo_asset_id", "")}
        />
        <BrandingAssetUpload
          title="Square icon"
          description="A square mark for compact branding and icon-sized placements."
          value={stringValue(values["branding.icon_asset_id"])}
          editable={editable}
          onSelect={(assetId) => onChange("branding.icon_asset_id", assetId)}
          onRemove={() => onChange("branding.icon_asset_id", "")}
        />
        <BrandingAssetUpload
          title="Login background"
          description="The full-screen image behind the Tilecast Studio sign-in panel."
          value={background.data?.assetId ?? ""}
          editable={editable && !background.isLoading}
          fallbackImageUrl={background.data?.imageUrl ?? "/api/v1/auth/background"}
          previewMode="cover"
          pending={saveBackground.isPending || removeBackground.isPending}
          actionError={
            saveBackground.error?.message ?? removeBackground.error?.message
          }
          onSelect={(assetId) => saveBackground.mutateAsync(assetId)}
          onRemove={() => removeBackground.mutateAsync()}
        />
      </div>
    </section>
  );
}

function BrandingAssetUpload({
  title,
  description,
  value,
  editable,
  fallbackImageUrl,
  previewMode = "contain",
  pending = false,
  actionError,
  onSelect,
  onRemove,
}: {
  title: string;
  description: string;
  value: string;
  editable: boolean;
  fallbackImageUrl?: string;
  previewMode?: "contain" | "cover";
  pending?: boolean;
  actionError?: string;
  onSelect: (assetId: string) => void | Promise<void>;
  onRemove: () => void | Promise<void>;
}) {
  const auth = useAuth();
  const input = useRef<HTMLInputElement>(null);
  const [uploadedAsset, setUploadedAsset] = useState<Asset>();
  const [previewUrl, setPreviewUrl] = useState<string>();
  const [progress, setProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string>();
  const existing = useQuery({
    queryKey: ["branding-asset", value],
    queryFn: () => api.asset(value),
    enabled: Boolean(value) && uploadedAsset?.id !== value,
    retry: false,
  });
  const asset = uploadedAsset?.id === value ? uploadedAsset : existing.data;

  useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl],
  );

  const upload = async (file: File) => {
    setError(undefined);
    if (!file.type.startsWith("image/")) {
      setError("Choose a PNG, JPEG, WebP, or SVG image.");
      return;
    }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(URL.createObjectURL(file));
    setUploading(true);
    setProgress(0);
    let sessionId = "";
    try {
      const session = await api.createUpload(
        {
          filename: file.name,
          mimeType: file.type || "application/octet-stream",
          sizeBytes: file.size,
        },
        auth.status?.csrfToken ?? "",
      );
      sessionId = session.id;
      let offset = session.offset;
      while (offset < file.size) {
        const next = Math.min(file.size, offset + chunkSize);
        offset = await api.uploadChunk(
          session.id,
          offset,
          file.slice(offset, next),
          auth.status?.csrfToken ?? "",
        );
        setProgress(Math.round((offset / file.size) * 100));
      }
      const completed = await api.completeUpload(
        session.id,
        auth.status?.csrfToken ?? "",
      );
      setUploadedAsset(completed);
      await onSelect(completed.id);
      setProgress(100);
    } catch (uploadError) {
      if (sessionId)
        void api
          .cancelUpload(sessionId, auth.status?.csrfToken ?? "")
          .catch(() => {});
      setError(
        uploadError instanceof Error ? uploadError.message : "Upload failed.",
      );
    } finally {
      setUploading(false);
    }
  };

  const imageUrl = previewUrl || asset?.thumbnailUrl || fallbackImageUrl;
  const busy = uploading || pending;
  return (
    <article className="branding-asset-card">
      <div
        className={`branding-asset-card__preview branding-asset-card__preview--${previewMode}`}
      >
        {imageUrl ? (
          <img src={imageUrl} alt={`${title} preview`} />
        ) : (
          <span aria-hidden="true">{title}</span>
        )}
      </div>
      <div className="branding-asset-card__body">
        <div>
          <strong>{title}</strong>
          <p>{description}</p>
          {asset && <small>{asset.name || asset.originalFilename}</small>}
          {value && !asset && !existing.isLoading && (
            <small className="field-error">
              The selected image is unavailable. Upload a replacement.
            </small>
          )}
        </div>
        <div className="branding-asset-card__actions">
          <input
            ref={input}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            hidden
            disabled={!editable || busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void upload(file);
              event.target.value = "";
            }}
          />
          <button
            type="button"
            className="button button--primary"
            disabled={!editable || busy}
            onClick={() => input.current?.click()}
          >
            {uploading
              ? `Uploading ${progress}%`
              : value
                ? "Replace image"
                : "Upload image"}
          </button>
          {value && (
            <button
              type="button"
              className="button button--quiet"
              disabled={!editable || busy}
              onClick={() => {
                void Promise.resolve(onRemove()).then(() => {
                  setUploadedAsset(undefined);
                  if (previewUrl) URL.revokeObjectURL(previewUrl);
                  setPreviewUrl(undefined);
                });
              }}
            >
              Remove
            </button>
          )}
        </div>
        {(error || actionError) && (
          <div className="notice notice--error" role="alert">
            {error ?? actionError}
          </div>
        )}
      </div>
    </article>
  );
}

async function getLoginBackground(): Promise<LoginBackground> {
  const response = await fetch("/api/v1/settings/login-background", {
    credentials: "same-origin",
  });
  if (!response.ok) throw await backgroundError(response);
  return ((await response.json()) as { data: LoginBackground }).data;
}

async function setLoginBackground(
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
  if (!response.ok) throw await backgroundError(response);
  return ((await response.json()) as { data: LoginBackground }).data;
}

async function clearLoginBackground(csrfToken: string): Promise<void> {
  const response = await fetch("/api/v1/settings/login-background", {
    method: "DELETE",
    credentials: "same-origin",
    headers: { "X-CSRF-Token": csrfToken },
  });
  if (!response.ok) throw await backgroundError(response);
}

async function backgroundError(response: Response) {
  const body = (await response.json().catch(() => ({}))) as {
    error?: { message?: string };
  };
  return new Error(
    body.error?.message ?? "The login background could not be updated.",
  );
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}
