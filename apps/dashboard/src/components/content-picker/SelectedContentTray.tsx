import { X } from "lucide-react";
import type { Asset } from "../../api/types";

export function SelectedContentTray({
  items,
  onRemove,
  onClear,
}: {
  items: Asset[];
  onRemove: (id: string) => void;
  onClear: () => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="selected-content-tray">
      <div>
        <strong>{items.length} selected</strong>
        <button
          type="button"
          className="button button--quiet button--compact"
          onClick={onClear}
        >
          Clear selection
        </button>
      </div>
      <ul>
        {items.map((asset) => (
          <li key={asset.id}>
            <span>{asset.name}</span>
            <button
              type="button"
              className="icon-button icon-button--compact"
              aria-label={`Remove ${asset.name} from selection`}
              onClick={() => onRemove(asset.id)}
            >
              <X size={14} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
