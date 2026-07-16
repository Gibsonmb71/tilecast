import { Select } from "../components/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Grid2X2, List, Plus } from "lucide-react";
import { useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import { api, ApiError } from "../api/client";
import type { Asset, WidgetProvider } from "../api/types";
import { useAuth } from "../auth/AuthProvider";
import {
  DashboardListToolbar,
  DashboardSearch,
} from "../components/DashboardListToolbar";
import {
  NativeAppEditor,
  type NativeProvider,
  WidgetProviderGallery,
  YouTubeSourceEditor,
} from "../content/SourceEditors";
import { GenericWidgetEditor } from "../content/GenericDefinitionEditors";
import {
  AssetCollection,
  WebsiteEditor,
  canManageContent,
} from "./ContentPage";

export function WidgetsPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const csrf = auth.status?.csrfToken ?? "";
  const canManage = canManageContent(auth.status?.user);
  const [search, setSearch] = useState("");
  const [provider, setProvider] = useState("");
  const [view, setView] = useState<"grid" | "list">("grid");
  const params = new URLSearchParams({
    page: "1",
    pageSize: "100",
    type: "widget",
  });
  if (search) params.set("search", search);
  if (provider) params.set("provider", provider);
  const widgets = useQuery({
    queryKey: ["assets", "widgets", params.toString()],
    queryFn: () => api.assets(params),
  });
  const definitions = useQuery({
    queryKey: ["content-definitions"],
    queryFn: api.contentDefinitions,
  });
  const filterProviders = definitions.data?.widgets ?? [];
  const duplicate = useMutation({
    mutationFn: (id: string) => api.duplicateWidget(id, csrf),
    onSuccess: (widget) => {
      void queryClient.invalidateQueries({ queryKey: ["assets"] });
      void navigate(`/widgets/${widget.id}`);
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteAsset(id, csrf),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ["assets"] }),
  });

  return (
    <section className="content-page apps-page">
      <header className="page-heading">
        <div>
          <h2>Widgets</h2>
          <p>Reusable visual content for playlists and Layouts.</p>
        </div>
        {canManage && (
          <button
            className="button button--primary"
            onClick={() => void navigate("/widgets/new")}
          >
            <Plus size={16} /> Create Widget
          </button>
        )}
      </header>
      <DashboardListToolbar>
        <DashboardSearch
          value={search}
          onValueChange={setSearch}
          label="Search Widgets"
          placeholder="Search Widgets"
        />
        <Select
          className="dashboard-list-toolbar__filter"
          aria-label="Filter by Widget provider"
          value={provider}
          onChange={(event) => setProvider(event.target.value)}
        >
          <option value="">All Widget types</option>
          {filterProviders.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </Select>
        <span className="view-switch" aria-label="View">
          <button
            aria-label="Grid view"
            aria-pressed={view === "grid"}
            onClick={() => setView("grid")}
          >
            <Grid2X2 size={16} />
          </button>
          <button
            aria-label="List view"
            aria-pressed={view === "list"}
            onClick={() => setView("list")}
          >
            <List size={16} />
          </button>
        </span>
      </DashboardListToolbar>
      {widgets.isError && (
        <div className="notice notice--error">
          {widgets.error instanceof ApiError
            ? widgets.error.message
            : "Widgets could not be loaded."}
        </div>
      )}
      {widgets.isLoading ? (
        <div className="table-loading">Loading Widgets...</div>
      ) : widgets.data?.items.length === 0 ? (
        <div className="content-empty">
          <Plus size={30} />
          <h3>No Widgets yet</h3>
          <p>Create a reusable Widget for signage content.</p>
          {canManage && (
            <button
              className="button button--primary"
              onClick={() => void navigate("/widgets/new")}
            >
              Create Widget
            </button>
          )}
        </div>
      ) : (
        <AssetCollection
          items={widgets.data?.items ?? []}
          view={view}
          onSelect={(widget) => void navigate(`/widgets/${widget.id}`)}
          canManage={canManage}
          onDuplicate={(widget) => duplicate.mutate(widget.id)}
          onDelete={(widget) => {
            if (confirm(`Delete ${widget.name}?`)) remove.mutate(widget.id);
          }}
        />
      )}
    </section>
  );
}

export function WidgetEditorPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { id, provider: providerParam } = useParams();
  const csrf = auth.status?.csrfToken ?? "";
  const widget = useQuery({
    queryKey: ["assets", id],
    queryFn: () => api.asset(id!),
    enabled: Boolean(id),
  });
  const definitions = useQuery({
    queryKey: ["content-definitions"],
    queryFn: api.contentDefinitions,
  });
  const asset = widget.data;
  const provider = (providerParam ?? asset?.widget?.provider) as
    WidgetProvider | undefined;
  const presetId = new URLSearchParams(location.search).get("preset") as
    import("../api/types").WidgetPreset | null;
  const close = () => void navigate("/widgets");
  const saved = (value: Asset) => {
    void navigate(`/widgets/${value.id}`, { replace: true });
  };
  const definition = definitions.data?.widgets.find(
    (candidate) => candidate.id === provider,
  );

  if (!id && !providerParam) {
    return (
      <section className="app-editor-route">
        <WidgetProviderGallery
          page
          onClose={close}
          onChoose={(choice, preset) =>
            void navigate(
              `/widgets/new/${choice}${preset ? `?preset=${preset}` : ""}`,
            )
          }
        />
      </section>
    );
  }
  if (id && widget.isLoading)
    return <div className="table-loading">Loading Widget...</div>;
  if (definitions.isLoading)
    return <div className="table-loading">Loading Widget definition...</div>;
  if ((id && !asset) || !provider || !definition) {
    return (
      <section className="empty-state">
        <h2>Widget unavailable</h2>
        <button className="button" onClick={close}>
          Back to Widgets
        </button>
      </section>
    );
  }
  const common = {
    asset,
    csrf,
    page: true,
    readOnly: !canManageContent(auth.status?.user),
    onClose: close,
    onSaved: saved,
  };
  return (
    <section className="app-editor-route">
      {provider === "website" ? (
        <WebsiteEditor {...common} />
      ) : provider === "youtube" ? (
        <YouTubeSourceEditor {...common} />
      ) : definition && !definition.legacyEditor ? (
        <GenericWidgetEditor {...common} definition={definition} />
      ) : (
        <NativeAppEditor
          {...common}
          provider={provider as NativeProvider}
          presetId={asset?.widget?.presetId ?? presetId ?? undefined}
        />
      )}
    </section>
  );
}
