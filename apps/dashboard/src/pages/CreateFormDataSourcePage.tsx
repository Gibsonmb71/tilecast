import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthProvider";
import { canManageContent } from "./ContentPage";
import {
  Button,
  Field,
  Input,
  Notice,
  PageHeader,
  Textarea,
} from "../components/ui";

// CreateFormDataSourcePage collects the Data Source name/description and the initial form
// title/description, then creates the Form (which the server publishes as its first revision) and
// navigates to the new form's builder.
export function CreateFormDataSourcePage() {
  const auth = useAuth();
  const csrf = auth.status?.csrfToken ?? "";
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [formTitle, setFormTitle] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [error, setError] = useState("");

  const create = useMutation({
    mutationFn: () =>
      api.createForm(
        {
          name: name.trim(),
          description: description.trim(),
          draftSchema: {
            title: formTitle.trim(),
            description: formDescription.trim(),
            fields: [
              {
                key: "title",
                label: "Title",
                control: "short_text",
                required: true,
              },
            ],
          },
        },
        csrf,
      ),
    onMutate: () => setError(""),
    onSuccess: (form) => {
      void queryClient.invalidateQueries({ queryKey: ["data-sources"] });
      void navigate(`/data-sources/${form.id}?tab=form`);
    },
    onError: (err) =>
      setError(err instanceof Error ? err.message : "Could not create the form."),
  });

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (name.trim() === "") {
      setError("A name is required.");
      return;
    }
    create.mutate();
  };

  if (!canManageContent(auth.status?.user)) {
    return (
      <section className="app-editor-route">
        <Notice variant="warning" title="Insufficient access">
          You do not have permission to create Data Sources.
        </Notice>
      </section>
    );
  }

  return (
    <section className="app-editor-route form-create">
      <PageHeader
        eyebrow="New Data Source"
        title="Create a Form"
        description="Collect submissions, approve them, and publish records to Widgets."
      />
      <form className="form-create__form" onSubmit={submit}>
        {error && (
          <Notice variant="danger" title="Could not create form">
            {error}
          </Notice>
        )}
        <Field
          label="Data Source name"
          description="Shown in the Data Source library and Widget pickers."
          required
        >
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Staff Announcements"
          />
        </Field>
        <Field label="Data Source description">
          <Textarea
            rows={2}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </Field>
        <Field
          label="Form title"
          description="Shown above the form to submitters."
        >
          <Input
            value={formTitle}
            onChange={(event) => setFormTitle(event.target.value)}
          />
        </Field>
        <Field label="Form description">
          <Textarea
            rows={2}
            value={formDescription}
            onChange={(event) => setFormDescription(event.target.value)}
          />
        </Field>
        <Notice variant="info" title="A starter field is included">
          Your form starts with a required “Title” field and is published
          immediately. You can add fields and publish new revisions from the
          builder.
        </Notice>
        <div className="form-create__actions">
          <Button
            type="button"
            variant="quiet"
            onClick={() => void navigate("/data-sources/new")}
          >
            Back
          </Button>
          <Button
            type="submit"
            variant="primary"
            loading={create.isPending}
            disabled={name.trim() === ""}
          >
            Create form
          </Button>
        </div>
      </form>
    </section>
  );
}
