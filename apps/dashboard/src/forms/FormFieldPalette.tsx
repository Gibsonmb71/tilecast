import type { FormFieldControl } from "../api/types";
import { CONTROLS } from "./formSchema";

// FormFieldPalette lists the supported controls as accessible Add buttons. It intentionally uses
// no drag-and-drop dependency in this pass.
export function FormFieldPalette({
  onAdd,
  disabled,
}: {
  onAdd: (control: FormFieldControl) => void;
  disabled?: boolean;
}) {
  return (
    <div className="form-builder__palette">
      <h3 className="form-builder__palette-title">Add a field</h3>
      <div className="form-builder__palette-grid">
        {CONTROLS.map((meta) => (
          <button
            key={meta.control}
            type="button"
            className="form-builder__palette-item"
            disabled={disabled}
            onClick={() => onAdd(meta.control)}
            title={meta.description}
          >
            <strong>{meta.label}</strong>
            <span>{meta.description}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
