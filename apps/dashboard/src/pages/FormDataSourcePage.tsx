import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useSearchParams } from "react-router";
import type { DataSourceDetail, FormDataSource } from "../api/types";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthProvider";
import {
  Button,
  Field,
  Input,
  Notice,
  PageHeader,
  Textarea,
} from "../components/ui";
import { FormBuilder } from "../forms/FormBuilder";
import { FormRenderer } from "../forms/FormRenderer";

export function FormDataSourcePage({ dataSource }: { dataSource?: DataSourceDetail }) {
  const { id } = useParams();
  const auth = useAuth();
  const csrf = auth.status?.csrfToken ?? "";
  const [searchParams] = useSearchParams();
  // Only the form builder exists in this pass. Future tabs (responses, workflow, views, outputs,
  // access) will read this; unknown values normalize to the form builder.
  void searchParams.get("tab");

  const form = useQuery({
    queryKey: ["form-data-source", id],
    queryFn: () => api.getForm(id!),
    enabled: Boolean(id),
  });

  if (form.isLoading) {
    return <div className="table-loading">Loading form…</div>;
  }
  if (!form.data || !id) {
    return (
      <Notice variant="danger" title="Form unavailable">
        This Form Data Source could not be loaded.
      </Notice>
    );
  }

  const detail = form.data;
  const canManage = detail.grantedCapabilities.includes("manage");

  return (
    <section className="app-editor-route form-page">
      <PageHeader
        eyebrow="Form Data Source"
        title={dataSource?.name ?? detail.name}
        description={dataSource?.description ?? detail.description}
      />
      {canManage ? (
        <ManageView form={detail} csrf={csrf} />
      ) : (
        <ReadOnlyView form={detail} />
      )}
    </section>
  );
}

function ManageView({ form, csrf }: { form: FormDataSource; csrf: string }) {
  return (
    <div className="form-page__body">
      <MetadataEditor form={form} csrf={csrf} />
      <FormBuilder form={form} csrf={csrf} />
    </div>
  );
}

function MetadataEditor({ form, csrf }: { form: FormDataSource; csrf: string }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(form.name);
  const [description, setDescription] = useState(form.description);
  const [error, setError] = useState("");

  const save = useMutation({
    mutationFn: () =>
      api.updateFormMetadata(form.id, { name: name.trim(), description: description.trim() }, csrf),
    onMutate: () => setError(""),
    onSuccess: (updated) => {
      // Sync local editor state to the saved values so reopening Edit details shows the latest.
      setName(updated.name);
      setDescription(updated.description);
      void queryClient.invalidateQueries({ queryKey: ["form-data-source", form.id] });
      void queryClient.invalidateQueries({ queryKey: ["data-source", form.id] });
      void queryClient.invalidateQueries({ queryKey: ["data-sources"] });
      setEditing(false);
    },
    onError: (err) =>
      setError(err instanceof Error ? err.message : "Could not update details."),
  });

  if (!editing) {
    return (
      <div className="form-page__details">
        <div>
          <h2 className="form-page__details-name">{form.name}</h2>
          {form.description && (
            <p className="form-page__details-description">{form.description}</p>
          )}
        </div>
        <Button variant="secondary" compact onClick={() => setEditing(true)}>
          Edit details
        </Button>
      </div>
    );
  }

  return (
    <div className="form-page__details form-page__details--editing">
      {error && (
        <Notice variant="danger" title="Details not saved">
          {error}
        </Notice>
      )}
      <Field label="Data Source name" required>
        <Input value={name} onChange={(event) => setName(event.target.value)} />
      </Field>
      <Field label="Description">
        <Textarea
          rows={2}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </Field>
      <div className="form-page__details-actions">
        <Button
          variant="quiet"
          onClick={() => {
            setName(form.name);
            setDescription(form.description);
            setEditing(false);
          }}
        >
          Cancel
        </Button>
        <Button
          variant="primary"
          loading={save.isPending}
          disabled={name.trim() === ""}
          onClick={() => save.mutate()}
        >
          Save details
        </Button>
      </div>
    </div>
  );
}

function ReadOnlyView({ form }: { form: FormDataSource }) {
  const revision = form.publishedRevision;
  return (
    <div className="form-page__body form-page__body--readonly">
      <Notice variant="neutral" title="Read-only">
        You can view this form but do not have permission to edit it.
      </Notice>
      {revision && (
        <p className="form-page__revision">
          Published revision {revision.revisionNumber} ·{" "}
          {new Date(revision.publishedAt).toLocaleString()}
        </p>
      )}
      <FormRenderer schema={form.draftSchema} readOnly />
    </div>
  );
}
