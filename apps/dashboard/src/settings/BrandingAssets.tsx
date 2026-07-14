import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import type { Asset } from "../api/types";
import { useAuth } from "../auth/AuthProvider";
import "./BrandingAssets.css";

const chunkSize = 5 * 1024 * 1024;

export function BrandingAssets({
  values,
  editable,
  onChange,
}: {
  values: Record<string, unknown>;
  editable: boolean;
  onChange: (key: string, value: unknown) => void;
}) {
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
          settingKey="branding.logo_asset_id"
          title="Logo"
          description="A wide organization logo for Tilecast Studio and supported player screens."
          value={stringValue(values["branding.logo_asset_id"])}
          editable={editable}
          onChange={onChange}
        />
        <BrandingAssetUpload
          settingKey="branding.icon_asset_id"
          title="Square icon"
          description="A square mark for compact branding and icon-sized placements."
          value={stringValue(values["branding.icon_asset_id"])}
          editable={editable}
          onChange={onChange}
        />
      </div>
    </section>
  );
}

function BrandingAssetUpload({
  settingKey,
  title,
  description,
  value,
  editable,
  onChange,
}: {
  settingKey: string;
  title: string;
  description: string;
  value: string;
  editable: boolean;
  onChange: (key: string, value: unknown) => void;
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
      onChange(settingKey, completed.id);
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

  const imageUrl = previewUrl || asset?.thumbnailUrl;
  return (
    <article className="branding-asset-card">
      <div className="branding-asset-card__preview">
        {imageUrl ? (
          <img src={imageUrl} alt={`${title} preview`} />
        ) : (
          <span aria-hidden="true">{title === "Logo" ? "Logo" : "Icon"}</span>
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
            disabled={!editable || uploading}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void upload(file);
              event.target.value = "";
            }}
          />
          <button
            type="button"
            className="button button--primary"
            disabled={!editable || uploading}
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
              disabled={!editable || uploading}
              onClick={() => {
                setUploadedAsset(undefined);
                if (previewUrl) URL.revokeObjectURL(previewUrl);
                setPreviewUrl(undefined);
                onChange(settingKey, "");
              }}
            >
              Remove
            </button>
          )}
        </div>
        {error && (
          <div className="notice notice--error" role="alert">
            {error}
          </div>
        )}
      </div>
    </article>
  );
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}
