// GuidedJobPage turns "show a lunch menu on the cafeteria TV" into one pass.
//
// It is deliberately thin. Every record it produces is created through the ordinary editors and
// the ordinary APIs, so nothing here is a parallel creation path that could drift from the real
// one — the Widget is built in the real Widget editor (which since the Data Source picker landed
// can connect its own data inline), and the playlist and assignment use the same calls the
// Playlists and Screens pages use. Nothing it writes carries a marker saying a wizard made it.
//
// Progress lives in the URL, so a refresh or a trip through the Widget editor does not lose it.
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, Check, Monitor, Plus } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { api, ApiError } from "../api/client";
import type { Playlist } from "../api/types";
import { useAuth } from "../auth/AuthProvider";
import { Button, Notice, PageHeader, Select } from "../components/ui";
import { guidedJob } from "../navigation/guidedJobs";
import { withParam } from "../navigation/returnPaths";
import { canManageContent } from "./ContentPage";

// The author may choose to decide the screen later; that is recorded explicitly rather than left
// indistinguishable from "not asked yet".
const decideLater = "later";

type Published = { playlist: Playlist; assignmentError?: string };

export function GuidedJobPage() {
  const { job: jobId } = useParams();
  const auth = useAuth();
  const navigate = useNavigate();
  const [search, setSearch] = useSearchParams();
  const csrf = auth.status?.csrfToken ?? "";
  const job = guidedJob(jobId);
  const screenChoice = search.get("screen");
  const widgetId = search.get("widget");
  const [published, setPublished] = useState<Published>();

  const screens = useQuery({ queryKey: ["screens"], queryFn: api.screens });
  const widget = useQuery({
    queryKey: ["assets", widgetId],
    queryFn: () => api.asset(widgetId!),
    enabled: Boolean(widgetId),
  });

  const targetScreen = screens.data?.items?.find(
    (screen) => screen.id === screenChoice,
  );
  const needsSelectedScreen =
    Boolean(screenChoice) && screenChoice !== decideLater;
  const assignmentTarget =
    screenChoice === decideLater ? undefined : targetScreen;
  const screenSelectionError = !needsSelectedScreen
    ? undefined
    : screens.isError
      ? "Screens could not be loaded. Refresh the page or check the Tilecast server connection."
      : !screens.isLoading && !targetScreen
        ? "The selected screen could not be found. It may have been removed."
        : undefined;

  const publish = useMutation({
    mutationFn: async (): Promise<Published> => {
      if (widget.isError)
        throw new Error(
          "The Widget could not be loaded. Refresh the page or check the Tilecast server connection.",
        );
      const built = widget.data;
      if (!built) throw new Error("The Widget is not ready yet.");
      if (screenChoice !== decideLater) {
        if (screens.isLoading)
          throw new Error("The selected screen is still loading.");
        if (screenSelectionError) throw new Error(screenSelectionError);
        if (!assignmentTarget)
          throw new Error(
            "The selected screen could not be found. It may have been removed.",
          );
      }
      const playlist = await api.createPlaylist(
        { name: built.name, description: job?.outcome ?? "" },
        csrf,
      );
      await api.addPlaylistItem(
        playlist.id,
        {
          assetId: built.id,
          durationMs: job?.durationMs ?? 30_000,
          fitMode: "contain",
          transition: "none",
          audioEnabled: false,
          volume: 0,
          deliveryPolicy: "stream",
        },
        csrf,
      );
      // A missing selected screen was rejected before creating the playlist, so only the explicit
      // "decide later" choice can reach this no-assignment result.
      if (!assignmentTarget) return { playlist };
      // Assignment can be refused on its own — most often because the screen's Player is too old
      // for the content. The playlist still exists, so that is reported as a partial result rather
      // than discarding what was built.
      try {
        await api.assignPlaylist(assignmentTarget.id, playlist.id, csrf);
        return { playlist };
      } catch (error) {
        return {
          playlist,
          assignmentError:
            error instanceof ApiError || error instanceof Error
              ? error.message
              : "The playlist could not be assigned to this screen.",
        };
      }
    },
    onSuccess: setPublished,
  });

  if (!job)
    return (
      <section className="empty-state">
        <h2>That guided job is not available.</h2>
        <Link className="text-link" to="/">
          Back to Overview
        </Link>
      </section>
    );

  if (!canManageContent(auth.status?.user))
    return (
      <section className="empty-state">
        <h2>You do not have permission to create content</h2>
        <p>Ask an Owner, Administrator, or Editor to set this up.</p>
        <Link className="text-link" to="/">
          Back to Overview
        </Link>
      </section>
    );

  const chooseScreen = (value: string) => {
    setSearch(
      (current) => {
        const next = new URLSearchParams(current);
        next.set("screen", value);
        return next;
      },
      { replace: true },
    );
  };
  const clearScreen = () => {
    setSearch(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete("screen");
        return next;
      },
      { replace: true },
    );
  };

  const step: "where" | "build" | "publish" = !screenChoice
    ? "where"
    : !widgetId
      ? "build"
      : "publish";

  return (
    <section className="guided-job">
      <Link className="guided-job__back" to="/">
        <ArrowLeft size={16} aria-hidden="true" /> Overview
      </Link>
      <PageHeader title={job.title} description={job.outcome} />

      <ol className="guided-job__steps">
        <GuidedStep
          index={1}
          title="Choose where it plays"
          state={step === "where" ? "current" : "done"}
          summary={
            screenChoice === decideLater
              ? "Decide later"
              : targetScreen
                ? targetScreen.name
                : undefined
          }
          onReopen={step === "where" ? undefined : clearScreen}
        >
          <WhereStep
            loading={screens.isLoading}
            error={screens.isError}
            screens={screens.data?.items ?? []}
            onChoose={chooseScreen}
          />
        </GuidedStep>

        <GuidedStep
          index={2}
          title={`Build the ${job.buildLabel}`}
          state={
            step === "build" ? "current" : step === "publish" ? "done" : "todo"
          }
          summary={widget.data?.name}
        >
          {step === "build" && (
            <div className="guided-job__action">
              {job.dataProviders.length > 0 && job.dataHint && (
                <p className="guided-job__hint">{job.dataHint}</p>
              )}
              <p>
                The editor opens next. If this needs data you have not connected
                yet, you can connect it there without leaving the page.
              </p>
              <Button
                variant="primary"
                onClick={() =>
                  void navigate(
                    `/widgets/new/${job.widgetProvider}?flowReturn=${encodeURIComponent(
                      withParam(`/start/${job.id}`, "screen", screenChoice!),
                    )}`,
                  )
                }
              >
                <Plus size={16} aria-hidden="true" /> Open the Widget editor
              </Button>
            </div>
          )}
        </GuidedStep>

        <GuidedStep
          index={3}
          title="Put it on air"
          state={step === "publish" ? "current" : "todo"}
          summary={published ? "Done" : undefined}
        >
          {step === "publish" && (
            <PublishStep
              screenName={targetScreen?.name}
              screenLoading={needsSelectedScreen && screens.isLoading}
              screenError={screenSelectionError}
              widgetId={widgetId ?? undefined}
              widgetName={widget.data?.name}
              widgetLoading={widget.isLoading}
              widgetError={widget.isError ? widget.error : undefined}
              published={published}
              pending={publish.isPending}
              error={publish.error}
              onPublish={() => publish.mutate()}
            />
          )}
        </GuidedStep>
      </ol>
    </section>
  );
}

function GuidedStep({
  index,
  title,
  state,
  summary,
  onReopen,
  children,
}: {
  index: number;
  title: string;
  state: "todo" | "current" | "done";
  summary?: string;
  onReopen?: () => void;
  children?: React.ReactNode;
}) {
  return (
    <li className={`guided-job__step guided-job__step--${state}`}>
      <span className="guided-job__marker" aria-hidden="true">
        {state === "done" ? <Check size={15} /> : index}
      </span>
      <div className="guided-job__body">
        <div className="guided-job__heading">
          <h3>{title}</h3>
          {summary && <span className="guided-job__summary">{summary}</span>}
          {onReopen && (
            <button
              type="button"
              className="button button--quiet button--compact"
              onClick={onReopen}
            >
              Change
            </button>
          )}
        </div>
        {state === "current" && children}
      </div>
    </li>
  );
}

function WhereStep({
  loading,
  error,
  screens,
  onChoose,
}: {
  loading: boolean;
  error: boolean;
  screens: { id: string; name: string }[];
  onChoose: (value: string) => void;
}) {
  const [value, setValue] = useState("");
  if (loading) return <div className="table-loading">Loading screens…</div>;
  if (error)
    return (
      <Notice variant="danger">
        Screens could not be loaded. Refresh the page or check the Tilecast
        server connection.
      </Notice>
    );
  if (screens.length === 0)
    return (
      <div className="guided-job__action">
        <p>
          No screens are paired yet. You can still build the content now and
          assign it once a screen is paired.
        </p>
        <div className="guided-job__buttons">
          <Button variant="primary" onClick={() => onChoose(decideLater)}>
            Build it anyway
          </Button>
          <Link className="button button--secondary" to="/screens/pair">
            <Monitor size={16} aria-hidden="true" /> Pair a screen
          </Link>
        </div>
      </div>
    );
  return (
    <div className="guided-job__action">
      <label className="field">
        <span className="field__label">Screen</span>
        <Select
          value={value}
          onChange={(event) => setValue(event.target.value)}
        >
          <option value="">Select a screen…</option>
          {screens.map((screen) => (
            <option key={screen.id} value={screen.id}>
              {screen.name}
            </option>
          ))}
        </Select>
      </label>
      <div className="guided-job__buttons">
        <Button
          variant="primary"
          disabled={!value}
          onClick={() => onChoose(value)}
        >
          Continue
        </Button>
        <Button variant="quiet" onClick={() => onChoose(decideLater)}>
          Decide later
        </Button>
      </div>
    </div>
  );
}

function PublishStep({
  screenName,
  screenLoading,
  screenError,
  widgetId,
  widgetName,
  widgetLoading,
  widgetError,
  published,
  pending,
  error,
  onPublish,
}: {
  screenName?: string;
  screenLoading: boolean;
  screenError?: string;
  widgetId?: string;
  widgetName?: string;
  widgetLoading: boolean;
  widgetError: unknown;
  published?: Published;
  pending: boolean;
  error: unknown;
  onPublish: () => void;
}) {
  if (published)
    return (
      <div className="guided-job__action">
        {published.assignmentError ? (
          <Notice variant="warning">
            <strong>{published.playlist.name}</strong> was created, but it could
            not be assigned to {screenName}: {published.assignmentError} The
            playlist is saved — assign it from the screen once that is resolved.
          </Notice>
        ) : (
          <Notice variant="success">
            {screenName
              ? `${screenName} is now playing ${published.playlist.name}.`
              : `${published.playlist.name} is ready to assign whenever a screen is paired.`}
          </Notice>
        )}
        <p>Everything it made is an ordinary record you can edit any time:</p>
        <div className="guided-job__buttons">
          <Link
            className="button button--secondary"
            to={`/playlists/${published.playlist.id}`}
          >
            Open the playlist
          </Link>
          <Link
            className="button button--secondary"
            to={widgetId ? `/widgets/${widgetId}` : "/widgets"}
          >
            Open the Widget
          </Link>
          <Link className="button button--quiet" to="/">
            Back to Overview
          </Link>
        </div>
      </div>
    );

  return (
    <div className="guided-job__action">
      <p>
        This creates a playlist containing <strong>{widgetName}</strong>
        {screenName ? ` and assigns it to ${screenName}.` : "."}
      </p>
      {screenLoading && (
        <div className="table-loading">Loading the selected screen…</div>
      )}
      {screenError && <Notice variant="danger">{screenError}</Notice>}
      {widgetLoading && (
        <div className="table-loading">Loading the Widget…</div>
      )}
      {Boolean(widgetError) && (
        <Notice variant="danger">
          The Widget could not be loaded. Refresh the page or check the Tilecast
          server connection.
        </Notice>
      )}
      {Boolean(error) && (
        <Notice variant="danger">
          {error instanceof Error
            ? error.message
            : "This could not be published."}
        </Notice>
      )}
      <Button
        variant="primary"
        loading={pending}
        disabled={
          screenLoading ||
          Boolean(screenError) ||
          widgetLoading ||
          Boolean(widgetError) ||
          !widgetName
        }
        onClick={onPublish}
      >
        {screenName ? "Publish to the screen" : "Create the playlist"}
      </Button>
    </div>
  );
}
