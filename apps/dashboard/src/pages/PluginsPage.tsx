import { useQuery } from "@tanstack/react-query";
import { ClipboardList, Plug, Plus } from "lucide-react";
import { Link } from "react-router";
import { api, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthProvider";
import { EmptyState, Notice, PageHeader } from "../components/ui";
import { canManageContent } from "./ContentPage";

export function PluginsPage() {
  return (
    <section className="plugins-page">
      <PageHeader
        title="Plugins"
        description="Built-in tools that extend what your Tilecast installation can do."
      />
      <div className="plugin-grid">
        <Link className="plugin-card" to="/plugins/forms">
          <span className="plugin-card__icon">
            <ClipboardList size={28} aria-hidden="true" />
          </span>
          <span className="plugin-card__body">
            <strong>Forms</strong>
            <span>
              Collect submissions, run approval workflows, and publish approved
              records to Widgets.
            </span>
          </span>
          <span className="plugin-card__status">Built in</span>
        </Link>
      </div>
    </section>
  );
}

export function FormsPluginPage() {
  const auth = useAuth();
  const canManage = canManageContent(auth.status?.user);
  const forms = useQuery({
    queryKey: ["forms"],
    queryFn: api.listForms,
    retry: false,
  });

  return (
    <section className="plugins-page">
      <div className="plugins-page__back">
        <Link className="text-link" to="/plugins">
          <Plug size={15} aria-hidden="true" /> Plugins
        </Link>
      </div>
      <PageHeader
        eyebrow="Plugin"
        title="Forms"
        description="Build forms, manage responses, and make approved records available to signage."
        actions={
          canManage ? (
            <Link className="button button--primary" to="/plugins/forms/new">
              <span>
                <Plus size={16} aria-hidden="true" /> Create form
              </span>
            </Link>
          ) : undefined
        }
      />
      {forms.isError && (
        <Notice variant="danger" title="Could not load forms">
          {forms.error instanceof ApiError
            ? forms.error.message
            : "Forms could not be loaded."}
        </Notice>
      )}
      {forms.isLoading ? (
        <div className="table-loading">Loading forms…</div>
      ) : forms.data?.length === 0 ? (
        <EmptyState
          icon={<ClipboardList size={24} aria-hidden="true" />}
          title="No forms yet"
          message={
            canManage
              ? "Create a form to start collecting submissions."
              : "You do not have access to any forms."
          }
          action={
            canManage ? (
              <Link className="button button--primary" to="/plugins/forms/new">
                <span>Create form</span>
              </Link>
            ) : undefined
          }
        />
      ) : (
        <div className="plugin-form-list">
          {forms.data?.map((form) => (
            <Link
              className="plugin-form-card"
              to={`/plugins/forms/${form.id}`}
              key={form.id}
            >
              <span className="plugin-form-card__icon">
                <ClipboardList size={20} aria-hidden="true" />
              </span>
              <span className="plugin-form-card__body">
                <strong>{form.name}</strong>
                <span>{form.description || "No description"}</span>
              </span>
              <span className="plugin-form-card__revision">
                {form.publishedRevisionNumber
                  ? `Revision ${form.publishedRevisionNumber}`
                  : "Draft"}
              </span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
