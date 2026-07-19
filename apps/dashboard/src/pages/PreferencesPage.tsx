import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthProvider";
import { PageHeader } from "../components/ui";
import { SettingsSection } from "../settings/SettingsSection";
import { SettingsActionBar } from "../settings/SettingsActionBar";
import { sectionDetails } from "../settings/settingsNavigation";
import { useNavigationWarning } from "../settings/useNavigationWarning";

export function PreferencesPage() {
  const auth = useAuth();
  const client = useQueryClient();
  const preferences = useQuery({
    queryKey: ["preferences"],
    queryFn: api.preferences,
  });
  const [baseline, setBaseline] = useState<Record<string, unknown>>();
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [revision, setRevision] = useState(0);
  const [saved, setSaved] = useState<string>();
  useEffect(() => {
    if (preferences.data && !baseline) {
      setBaseline(preferences.data.values);
      setDraft(preferences.data.values);
      setRevision(preferences.data.revision);
    }
  }, [preferences.data, baseline]);
  useEffect(() => applyPreferences(draft), [draft]);
  const definitions = preferences.data?.definitions ?? [];
  const dirty =
    Boolean(baseline) &&
    definitions.some(
      (definition) =>
        !same(
          (baseline ?? {})[definition.key] ?? definition.default,
          draft[definition.key] ?? definition.default,
        ),
    );
  useNavigationWarning(
    dirty,
    "/preferences",
    "Leave My preferences with unsaved changes?",
  );
  const save = useMutation({
    mutationFn: (values: Record<string, unknown>) =>
      api.updatePreferences(revision, values, auth.status?.csrfToken ?? ""),
    onSuccess: (data) => {
      setBaseline(data.values);
      setDraft(data.values);
      setRevision(data.revision);
      setSaved("Preferences saved.");
      client.setQueryData(["preferences"], data);
    },
  });
  const reload = () => {
    setBaseline(undefined);
    setSaved(undefined);
    void preferences.refetch();
  };
  if (preferences.isLoading)
    return <div className="table-loading">Loading preferences…</div>;
  const details = sectionDetails.preferences;
  return (
    <section>
      <PageHeader title={details.title} description={details.description} />
      <SettingsSection
        section="preferences"
        definitions={definitions}
        values={draft}
        editable
        onChange={(key, value) => {
          setSaved(undefined);
          setDraft({ ...draft, [key]: value });
        }}
      />
      <SettingsActionBar
        dirty={dirty}
        saving={save.isPending}
        success={saved}
        error={errorMessage(save.error)}
        onCancel={() => {
          setSaved(undefined);
          if (baseline) setDraft(baseline);
        }}
        onSave={() => {
          setSaved(undefined);
          save.mutate(draft);
        }}
        onReload={isConflict(save.error) ? reload : undefined}
      />
    </section>
  );
}

function same(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b);
}
function isConflict(error: Error | null | undefined) {
  return (
    error instanceof ApiError && error.code === "settings_revision_conflict"
  );
}
function errorMessage(error: Error | null | undefined) {
  if (!error) return undefined;
  return isConflict(error)
    ? "These preferences changed elsewhere. Reload the latest preferences before saving."
    : error.message;
}
function applyPreferences(values: Record<string, unknown>) {
  const root = document.documentElement;
  root.dataset.theme =
    typeof values["preference.appearance"] === "string"
      ? String(values["preference.appearance"])
      : "system";
  root.dataset.density =
    typeof values["preference.density"] === "string"
      ? String(values["preference.density"])
      : "comfortable";
  root.dataset.reducedMotion = String(
    Boolean(values["preference.reduced_motion"]),
  );
}
