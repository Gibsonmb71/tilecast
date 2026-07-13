export function SettingsActionBar({
  dirty,
  saving,
  success,
  error,
  onCancel,
  onSave,
  onReload,
}: {
  dirty: boolean;
  saving: boolean;
  success?: string;
  error?: string;
  onCancel: () => void;
  onSave: () => void;
  onReload?: () => void;
}) {
  if (!dirty && !success && !error) return null;
  return (
    <div className="settings-action-bar" aria-live="polite">
      <div>
        {dirty ? (
          <>
            <strong>Unsaved changes</strong>
            <span>Changes are kept while you browse Settings.</span>
            {error && <span className="field-error">{error}</span>}
          </>
        ) : success ? (
          <strong>{success}</strong>
        ) : (
          <strong className="field-error">{error}</strong>
        )}
      </div>
      {error && onReload && (
        <button
          type="button"
          className="button button--quiet"
          onClick={onReload}
        >
          Reload settings
        </button>
      )}
      {dirty && (
        <>
          <button
            type="button"
            className="button button--quiet"
            disabled={saving}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="button button--primary"
            disabled={saving}
            onClick={onSave}
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </>
      )}
    </div>
  );
}
