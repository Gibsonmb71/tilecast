import { useEffect, useMemo, useRef, useState } from "react";
import { useBlocker } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import type {
  FormDataSource,
  FormRecordDetail,
  FormSchema,
} from "../api/types";
import { api, ApiError } from "../api/client";
import { Button, Notice } from "../components/ui";
import {
  FormRenderer,
  type FormValues,
  type ImageFieldState,
} from "./FormRenderer";
import {
  applyDefaults,
  coerceScalar,
  formValuesToPayload,
  recordValuesToForm,
  validateSubmission,
} from "./formValues";
import { isEditableState, initialState, stateLabel } from "./formStatus";

// SubmissionEditor is the submitter-facing editable form for one submission. It handles a brand-new
// submission (no record yet) and editing an existing draft or changes-requested record, including
// image upload/preview/replacement/removal, client-side validation, schema defaults, save draft,
// submit/resubmit via the server-provided transition, optimistic-concurrency versions, and
// unsaved-navigation protection. When editing, it uses the record's immutable revision schema.
export function SubmissionEditor({
  form,
  initialDetail,
  csrf,
  onCompleted,
}: {
  form: FormDataSource;
  initialDetail?: FormRecordDetail;
  csrf: string;
  onCompleted: (recordId: string) => void;
}) {
  const queryClient = useQueryClient();

  // Editing uses the record's immutable revision; a new submission uses the current published one.
  const schema: FormSchema = useMemo(() => {
    if (initialDetail?.revision) return initialDetail.revision.schema;
    return form.publishedRevision?.schema ?? { fields: [] };
  }, [initialDetail, form.publishedRevision]);

  const [recordId, setRecordId] = useState<string | null>(
    initialDetail?.id ?? null,
  );
  const [version, setVersion] = useState<number>(initialDetail?.version ?? 0);
  const [state, setState] = useState<string>(
    initialDetail?.state ?? initialState(form.workflow)?.key ?? "draft",
  );
  const [values, setValues] = useState<FormValues>(() =>
    initialDetail
      ? recordValuesToForm(schema, initialDetail.values)
      : applyDefaults(schema),
  );
  const [baseline, setBaseline] = useState(() => JSON.stringify(values));
  const [images, setImages] = useState<Record<string, ImageFieldState>>(() =>
    imagesFromDetail(form.id, initialDetail),
  );
  const pendingFiles = useRef<Record<string, File>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState<"" | "draft" | "submit">("");
  const [comments, setComments] = useState(initialDetail?.comments ?? []);

  const hasPending = Object.keys(pendingFiles.current).length > 0;
  const dirty = JSON.stringify(values) !== baseline || hasPending;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty &&
      (currentLocation.pathname !== nextLocation.pathname ||
        currentLocation.search !== nextLocation.search),
  );

  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (dirtyRef.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  const submitTransition = useMemo(
    () =>
      form.workflow.transitions.find(
        (transition) =>
          transition.from === state &&
          transition.requiredCapability === "submit",
      ),
    [form.workflow, state],
  );

  const editable = recordId === null || isEditableState(form.workflow, state);
  const latestReviewerNote = useMemo(
    () => findLatestReviewerNote(comments),
    [comments],
  );

  // --- image handling ---
  function absorbDetail(detail: FormRecordDetail) {
    setRecordId(detail.id);
    setVersion(detail.version);
    setState(detail.state);
    setImages(imagesFromDetail(form.id, detail));
    setComments(detail.comments);
    // Keep the user's in-progress text edits; only refresh image asset ids from the server.
    setValues((current) => {
      const next = { ...current };
      for (const field of schema.fields) {
        if (field.control === "image") {
          next[field.key] = coerceScalar(detail.values[field.key]);
        }
      }
      return next;
    });
  }

  async function handleImageSelect(fieldKey: string, file: File) {
    const objectUrl = URL.createObjectURL(file);
    pendingFiles.current[fieldKey] = file;
    setImages((current) => ({
      ...current,
      [fieldKey]: {
        pendingUrl: objectUrl,
        pendingName: file.name,
        uploading: recordId !== null,
      },
    }));
    if (recordId === null) return; // deferred until the draft is created
    try {
      const detail = await api.uploadFormRecordAttachment(
        form.id,
        recordId,
        file,
        fieldKey,
        csrf,
      );
      delete pendingFiles.current[fieldKey];
      absorbDetail(detail);
      invalidate();
    } catch (error) {
      setImages((current) => ({
        ...current,
        [fieldKey]: {
          ...current[fieldKey],
          uploading: false,
          error: messageOf(error),
        },
      }));
    }
  }

  async function handleImageRemove(fieldKey: string) {
    const committed = images[fieldKey]?.attachmentId;
    if (committed && recordId) {
      try {
        const detail = await api.removeFormRecordAttachment(
          form.id,
          recordId,
          committed,
          csrf,
        );
        absorbDetail(detail);
        invalidate();
      } catch (error) {
        setImages((current) => ({
          ...current,
          [fieldKey]: { ...current[fieldKey], error: messageOf(error) },
        }));
      }
      return;
    }
    delete pendingFiles.current[fieldKey];
    setImages((current) => {
      const next = { ...current };
      delete next[fieldKey];
      return next;
    });
    setValues((current) => ({ ...current, [fieldKey]: "" }));
  }

  function invalidate() {
    if (recordId) {
      void queryClient.invalidateQueries({
        queryKey: ["form-record", form.id, recordId],
      });
    }
    void queryClient.invalidateQueries({ queryKey: ["form-records", form.id] });
    void queryClient.invalidateQueries({ queryKey: ["forms"] });
  }

  // Persist current values and any pending image files, creating the draft first if needed.
  // Returns the record id and its latest version, or throws.
  async function persist(): Promise<{ recordId: string; version: number }> {
    const payload = formValuesToPayload(schema, values);
    let currentRecordId = recordId;
    let currentVersion = version;
    if (currentRecordId === null) {
      const created = await api.createFormRecord(
        form.id,
        { values: payload },
        csrf,
      );
      currentRecordId = created.id;
      currentVersion = created.version;
      setRecordId(created.id);
      setVersion(created.version);
      setState(created.state);
      // Upload any images selected before the draft existed.
      for (const [fieldKey, file] of Object.entries(pendingFiles.current)) {
        const detail = await api.uploadFormRecordAttachment(
          form.id,
          currentRecordId,
          file,
          fieldKey,
          csrf,
        );
        delete pendingFiles.current[fieldKey];
        currentVersion = detail.version;
        absorbDetail(detail);
      }
    } else {
      const updated = await api.updateFormRecord(
        form.id,
        currentRecordId,
        { values: payload, version: currentVersion },
        csrf,
      );
      currentVersion = updated.version;
      setVersion(updated.version);
      setState(updated.state);
    }
    setBaseline(JSON.stringify(values));
    invalidate();
    return { recordId: currentRecordId, version: currentVersion };
  }

  async function saveDraft() {
    setFormError("");
    const validation = validateSubmission(schema, values, false);
    setErrors(validation);
    if (Object.keys(validation).length > 0) return;
    setBusy("draft");
    try {
      await persist();
    } catch (error) {
      setFormError(conflictAwareMessage(error));
    } finally {
      setBusy("");
    }
  }

  async function submit() {
    setFormError("");
    const validation = validateSubmission(schema, values, true);
    setErrors(validation);
    if (Object.keys(validation).length > 0) return;
    if (!submitTransition) {
      setFormError("This form cannot be submitted from its current state.");
      return;
    }
    setBusy("submit");
    try {
      const persisted = await persist();
      const record = await api.transitionFormRecord(
        form.id,
        persisted.recordId,
        { toState: submitTransition.to, version: persisted.version },
        csrf,
      );
      setVersion(record.version);
      setState(record.state);
      setBaseline(JSON.stringify(values));
      invalidate();
      onCompleted(persisted.recordId);
    } catch (error) {
      // The draft (and any uploads) are saved server-side; keep the editor so the user can retry.
      setFormError(conflictAwareMessage(error));
    } finally {
      setBusy("");
    }
  }

  const submitLabel = submitTransition?.label ?? "Submit";

  return (
    <div className="submission-editor">
      {blocker.state === "blocked" && (
        <Notice
          variant="warning"
          title="Leave without saving?"
          action={
            <div className="form-builder__confirm-actions">
              <Button variant="quiet" onClick={() => blocker.reset?.()}>
                Stay on page
              </Button>
              <Button variant="primary" onClick={() => blocker.proceed?.()}>
                Leave without saving
              </Button>
            </div>
          }
        >
          You have unsaved changes to this submission. Leaving now will discard
          them.
        </Notice>
      )}

      {latestReviewerNote && editable && state === "changes_requested" && (
        <Notice variant="warning" title="Changes requested">
          <strong>{latestReviewerNote.authorName}:</strong>{" "}
          {latestReviewerNote.body}
        </Notice>
      )}

      {formError && (
        <Notice variant="danger" title="Could not save">
          {formError}
        </Notice>
      )}

      <FormRenderer
        schema={schema}
        values={values}
        readOnly={!editable}
        onChange={
          editable
            ? (key, value) =>
                setValues((current) => ({ ...current, [key]: value }))
            : undefined
        }
        errors={errors}
        imageHandlers={{
          state: (fieldKey) => images[fieldKey],
          onSelect: (fieldKey, file) => void handleImageSelect(fieldKey, file),
          onRemove: (fieldKey) => void handleImageRemove(fieldKey),
        }}
      />

      {comments.length > 0 && (
        <section className="submission-editor__comments" aria-label="Comments">
          <h3>Comments</h3>
          <ul>
            {comments.map((comment) => (
              <li key={comment.id}>
                <strong>{comment.authorName}</strong>
                <p>{comment.body}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {editable ? (
        <div className="submission-editor__actions">
          <Button
            variant="secondary"
            loading={busy === "draft"}
            disabled={busy !== ""}
            onClick={() => void saveDraft()}
          >
            Save draft
          </Button>
          <Button
            variant="primary"
            loading={busy === "submit"}
            disabled={busy !== "" || !submitTransition}
            onClick={() => void submit()}
          >
            {submitLabel}
          </Button>
        </div>
      ) : (
        <Notice
          variant="info"
          title={`This submission is ${stateLabel(form.workflow, state)}`}
        >
          It can no longer be edited. A reviewer will follow up if changes are
          needed.
        </Notice>
      )}
    </div>
  );
}

function imagesFromDetail(
  formId: string,
  detail: FormRecordDetail | undefined,
): Record<string, ImageFieldState> {
  const result: Record<string, ImageFieldState> = {};
  if (!detail) return result;
  for (const attachment of detail.attachments) {
    result[attachment.fieldKey] = {
      attachmentId: attachment.id,
      contentUrl: api.formAttachmentContentUrl(
        formId,
        detail.id,
        attachment.id,
      ),
    };
  }
  return result;
}

function findLatestReviewerNote(
  comments: FormRecordDetail["comments"],
): FormRecordDetail["comments"][number] | undefined {
  if (comments.length === 0) return undefined;
  return comments[comments.length - 1];
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}

function conflictAwareMessage(error: unknown): string {
  if (error instanceof ApiError && error.status === 409) {
    return "This submission changed elsewhere. Reload to see the latest version, then try again.";
  }
  return messageOf(error);
}
