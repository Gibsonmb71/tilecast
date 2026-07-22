import { FileImage, FileVideo } from "lucide-react";
import { useState } from "react";
import type { Asset } from "../../api/types";

export function AssetPreview({ asset }: { asset: Asset }) {
  const [failedImageUrl, setFailedImageUrl] = useState<string>();
  const imageUrl = asset.thumbnailUrl;

  if (imageUrl && imageUrl !== failedImageUrl) {
    return (
      <img
        src={imageUrl}
        alt=""
        draggable={false}
        onError={() => setFailedImageUrl(imageUrl)}
      />
    );
  }
  if (asset.type === "widget")
    return (
      <span className="asset-preview-unavailable">Preview unavailable</span>
    );
  if (asset.type === "video") return <FileVideo size={28} />;
  return <FileImage size={28} />;
}
