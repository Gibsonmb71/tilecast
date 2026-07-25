// DataSourcePicker is the single control for choosing the data behind a Widget or a Layout text
// binding. It exists because authoring previously required knowing that a Data Source is a
// separate record that must be created first, on a different page, before a data-driven Widget
// could be configured at all.
//
// Three rules it enforces everywhere it is used:
//   1. Data can be connected from here. Selecting "Connect new data" opens the ordinary Data
//      Source editor in its existing modal mode and selects the result, so authoring never
//      leaves the Widget or Layout in progress.
//   2. Never render a disabled control where an empty state belongs. With no compatible source
//      the picker explains that and offers the same Connect action.
//   3. Show the data, not just its name. The selected source reports status, cached record
//      count, and sample values.
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronRight, Database, Plus, X } from "lucide-react";
import { useId, useState } from "react";
import { api } from "../api/client";
import type {
  DataSource,
  DataSourceDefinition,
  DataSourceProvider,
} from "../api/types";
import { Button, StatusDot } from "../components/ui";
import { DataSourceEditor } from "./DataSourceEditors";
import { previewRecordMaps } from "./previewRecords";
import { providerLabel, sourceIcon } from "./dataSourceProviderMeta";

// Studio shows at most this many sample values so a wide source cannot overflow the control.
const sampleFieldLimit = 4;

function statusTone(status: unknown) {
  if (status === "ready") return "success" as const;
  if (status === "error") return "danger" as const;
  return "info" as const;
}

function statusLabel(status: unknown, recordCount: unknown) {
  if (status === "error") return "Last refresh failed";
  if (typeof status !== "string" || status.length === 0)
    return "Status unavailable";
  if (status !== "ready") return status.replaceAll("_", " ");
  if (typeof recordCount !== "number") return "Ready";
  return `Ready · ${recordCount} record${recordCount === 1 ? "" : "s"}`;
}

// ConnectDataNotice is the empty state shown wherever a control needs data that does not exist
// yet. It replaces disabling the control: the reason is stated and the fix is one click away.
export function ConnectDataNotice({
  message,
  definitions,
  createProviders,
  csrf,
  disabled = false,
  onCreated,
}: {
  message?: string;
  definitions?: DataSourceDefinition[];
  createProviders?: DataSourceProvider[];
  csrf?: string;
  disabled?: boolean;
  onCreated: (id: string) => void;
}) {
  const [creating, setCreating] = useState<DataSourceProvider | "choose">();
  const canCreate = !disabled && Boolean(csrf);
  return (
    <div className="data-source-picker__empty">
      <span className="data-source-picker__empty-icon" aria-hidden="true">
        <Database size={20} />
      </span>
      <div>
        <strong>No compatible data connected yet</strong>
        <p>
          {message ??
            (canCreate
              ? "Connect a calendar, spreadsheet, feed, or table to fill this Widget."
              : "Ask an editor to connect a compatible Data Source.")}
        </p>
      </div>
      {canCreate && (
        <Button
          type="button"
          variant="secondary"
          compact
          onClick={() => setCreating("choose")}
        >
          <Plus size={15} aria-hidden="true" /> Connect new data
        </Button>
      )}
      {creating && (
        <ConnectDataFlow
          provider={creating === "choose" ? undefined : creating}
          definitions={definitions ?? []}
          createProviders={createProviders}
          csrf={csrf ?? ""}
          onChooseProvider={setCreating}
          onClose={() => setCreating(undefined)}
          onCreated={(id) => {
            setCreating(undefined);
            onCreated(id);
          }}
        />
      )}
    </div>
  );
}

export function DataSourcePicker({
  label = "Data Source",
  description,
  value,
  sources,
  definitions,
  csrf,
  disabled = false,
  required = false,
  allowCreate = true,
  allowEmpty = true,
  emptyMessage,
  createProviders,
  onChange,
}: {
  label?: string;
  description?: string;
  value: string;
  // Sources already narrowed to those compatible with the consuming Widget or binding.
  sources: DataSource[];
  definitions?: DataSourceDefinition[];
  csrf?: string;
  disabled?: boolean;
  required?: boolean;
  allowCreate?: boolean;
  // Layout bindings always reference a source, so they suppress the empty option rather than
  // allowing a selection that would write an invalid binding into the draft.
  allowEmpty?: boolean;
  emptyMessage?: string;
  // Providers offered by the Connect flow. Defaults to every non-Form provider in the catalog,
  // narrowed to what the consumer accepts when it passes a list.
  createProviders?: DataSourceProvider[];
  onChange: (value: string) => void;
}) {
  const [creating, setCreating] = useState<DataSourceProvider | "choose">();
  const [choosing, setChoosing] = useState(false);
  const dialogTitleId = useId();
  const selected = sources.find((source) => source.id === value);
  // A referenced source that is not in the compatible list — deleted, or no longer accepted by
  // this field — must be shown as missing rather than silently resolving to another source.
  const missing = Boolean(value) && !selected;
  const canCreate = allowCreate && !disabled && Boolean(csrf);

  // Sample values come from the saved-source preview, fetched only for the selected source.
  // The list response carries no records, so previewing every row would be an N+1.
  //
  // The key deliberately matches the one the Widget editors use for the same request, so opening a
  // Widget whose preview already fetched this payload reuses it instead of issuing a second call.
  const preview = useQuery({
    queryKey: ["widget-data-source-preview", value],
    queryFn: () => api.previewSavedDataSource(value),
    enabled: Boolean(value),
    retry: false,
  });
  const sampleRecord = previewRecordMaps(preview.data)[0];
  const samples = Object.entries(sampleRecord ?? {})
    .filter(([key, entry]) => key !== "id" && entry !== "")
    .slice(0, sampleFieldLimit);

  return (
    <div className="data-source-picker">
      {/* With no compatible sources the empty state is the whole control — unless something is
          still referenced, in which case the picker must stay so the missing reference is visible
          rather than replaced by a "nothing here yet" message. */}
      {sources.length === 0 && !missing ? (
        <ConnectDataNotice
          message={emptyMessage}
          definitions={definitions}
          createProviders={createProviders}
          csrf={allowCreate ? csrf : undefined}
          disabled={disabled}
          onCreated={onChange}
        />
      ) : (
        <>
          <div className="field">
            <span className="field__label">
              {label}
              {required ? " *" : ""}
            </span>
            <button
              type="button"
              className="data-source-picker__trigger"
              aria-label={`${label}: ${
                selected?.name ??
                (missing ? "Unavailable Data Source" : "Choose data")
              }`}
              aria-haspopup="dialog"
              aria-expanded={choosing}
              disabled={disabled}
              onClick={() => setChoosing(true)}
            >
              <span className="data-source-picker__trigger-icon" aria-hidden>
                {selected ? (
                  sourceIcon(selected.provider, undefined, 20)
                ) : (
                  <Database size={20} />
                )}
              </span>
              <span className="data-source-picker__trigger-copy">
                <strong>
                  {selected?.name ??
                    (missing ? "Unavailable Data Source" : "Choose data")}
                </strong>
                <small>
                  {selected
                    ? providerLabel(selected.provider)
                    : missing
                      ? "Choose a replacement"
                      : `${sources.length} compatible ${
                          sources.length === 1 ? "source" : "sources"
                        }`}
                </small>
              </span>
              <ChevronRight size={18} aria-hidden />
            </button>
            {description && <small>{description}</small>}
          </div>
          {missing && (
            <p className="data-source-picker__missing" role="alert">
              The Data Source this was built with is no longer available. Choose
              another to keep this content working.
            </p>
          )}
          {selected && (
            <div className="data-source-picker__detail">
              <StatusDot
                tone={statusTone(selected.status)}
                label={statusLabel(selected.status, selected.cachedRecordCount)}
              />
              {samples.length > 0 && (
                <dl className="data-source-picker__samples">
                  {samples.map(([key, entry]) => (
                    <div key={key}>
                      <dt>{key}</dt>
                      <dd>{entry}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          )}
          {choosing && (
            <DataSourceSelectionDialog
              titleId={dialogTitleId}
              value={value}
              sources={sources}
              allowEmpty={allowEmpty}
              canCreate={canCreate}
              onSelect={(id) => {
                onChange(id);
                setChoosing(false);
              }}
              onConnect={() => {
                setChoosing(false);
                setCreating("choose");
              }}
              onClose={() => setChoosing(false)}
            />
          )}
        </>
      )}
      {creating && (
        <ConnectDataFlow
          provider={creating === "choose" ? undefined : creating}
          definitions={definitions ?? []}
          createProviders={createProviders}
          csrf={csrf ?? ""}
          onChooseProvider={setCreating}
          onClose={() => setCreating(undefined)}
          onCreated={(id) => {
            setCreating(undefined);
            onChange(id);
          }}
        />
      )}
    </div>
  );
}

function DataSourceSelectionDialog({
  titleId,
  value,
  sources,
  allowEmpty,
  canCreate,
  onSelect,
  onConnect,
  onClose,
}: {
  titleId: string;
  value: string;
  sources: DataSource[];
  allowEmpty: boolean;
  canCreate: boolean;
  onSelect: (id: string) => void;
  onConnect: () => void;
  onClose: () => void;
}) {
  return (
    <div
      className="details-backdrop data-source-select-backdrop"
      role="presentation"
    >
      <section
        className="asset-details source-editor data-source-select-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header>
          <div>
            <h2 id={titleId}>Choose data</h2>
            <p>Select an existing compatible source or connect a new one.</p>
          </div>
          <button className="icon-button" aria-label="Close" onClick={onClose}>
            <X size={18} aria-hidden />
          </button>
        </header>
        <div className="source-editor__body">
          <ul className="data-source-select__choices">
            {allowEmpty && (
              <li>
                <button type="button" onClick={() => onSelect("")}>
                  <span className="data-source-select__icon" aria-hidden>
                    <X size={18} />
                  </span>
                  <span className="data-source-select__copy">
                    <strong>No data</strong>
                    <small>Leave this Widget disconnected.</small>
                  </span>
                  <span aria-hidden />
                  {!value && <Check size={18} aria-label="Selected" />}
                </button>
              </li>
            )}
            {sources.map((source) => (
              <li key={source.id}>
                <button type="button" onClick={() => onSelect(source.id)}>
                  <span className="data-source-select__icon" aria-hidden>
                    {sourceIcon(source.provider, undefined, 20)}
                  </span>
                  <span className="data-source-select__copy">
                    <strong>{source.name}</strong>
                    <small>{providerLabel(source.provider)}</small>
                  </span>
                  <span className="data-source-select__status">
                    <StatusDot
                      tone={statusTone(source.status)}
                      label={statusLabel(
                        source.status,
                        source.cachedRecordCount,
                      )}
                    />
                  </span>
                  {value === source.id && (
                    <Check size={18} aria-label="Selected" />
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
        <footer>
          {canCreate && (
            <Button type="button" variant="primary" onClick={onConnect}>
              <Plus size={15} aria-hidden /> Connect new data
            </Button>
          )}
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </footer>
      </section>
    </div>
  );
}

// ConnectDataFlow is the two-step create path: choose a compatible provider, then run the
// ordinary DataSourceEditor. The editor is rendered without `page`, which is its existing
// focus-managed modal mode, so no new dialog machinery is introduced here.
function ConnectDataFlow({
  provider,
  definitions,
  createProviders,
  csrf,
  onChooseProvider,
  onClose,
  onCreated,
}: {
  provider?: DataSourceProvider;
  definitions: DataSourceDefinition[];
  createProviders?: DataSourceProvider[];
  csrf: string;
  onChooseProvider: (provider: DataSourceProvider) => void;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  // Form Data Sources are authored through the Forms portal, not this editor, so they are
  // never offered here.
  const choices = definitions.filter(
    (definition) =>
      definition.id !== "form" &&
      (!createProviders?.length || createProviders.includes(definition.id)),
  );

  if (provider)
    return (
      <DataSourceEditor
        provider={provider}
        csrf={csrf}
        onClose={onClose}
        onSaved={(created) => onCreated(created.id)}
      />
    );

  return (
    <div
      className="details-backdrop data-source-connect-backdrop"
      role="presentation"
    >
      <section
        className="asset-details source-editor data-source-connect"
        role="dialog"
        aria-modal="true"
        aria-label="Connect new data"
      >
        <header>
          <div>
            <h2>Connect new data</h2>
            <p>Choose where this Widget&rsquo;s data comes from.</p>
          </div>
          <button className="icon-button" aria-label="Close" onClick={onClose}>
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        <div className="source-editor__body">
          {choices.length === 0 ? (
            <p>No Data Source providers are available in this installation.</p>
          ) : (
            <ul className="data-source-connect__choices">
              {choices.map((definition) => (
                <li key={definition.id}>
                  <button
                    type="button"
                    onClick={() => onChooseProvider(definition.id)}
                  >
                    <span aria-hidden="true">
                      {sourceIcon(definition.id, definition, 22)}
                    </span>
                    <span>
                      <strong>{definition.name}</strong>
                      <small>{definition.description}</small>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <footer>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </footer>
      </section>
    </div>
  );
}
