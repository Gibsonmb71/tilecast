import { Button, Dialog, PageHeader, Select, ViewTabs } from "../components/ui";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CircleAlert,
  Link2,
  Monitor,
  Pencil,
  Plus,
  RefreshCw,
  ShieldOff,
  Wifi,
  WifiOff,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { z } from "zod";
import { api } from "../api/client";
import type {
  PairingRequest,
  ReliabilityStatus,
  Screen,
  ScreenStatus,
  User,
} from "../api/types";
import { useAuth } from "../auth/AuthProvider";
import { FormField } from "../components/FormField";
import { PlayerPolicyEditor } from "../settings/PlayerPolicyEditor";

export const canManageScreens = (user?: User) =>
  user?.role === "owner" || user?.role === "administrator";
const formatBytes = (value: number) => {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let amount = value;
  let unit = 0;
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024;
    unit += 1;
  }
  return `${amount.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
};
export const reliabilityCapabilityWarning = (status?: ReliabilityStatus) => {
  if (
    status?.configuredMode === "managed_kiosk" &&
    status.effectiveMode !== "managed_kiosk"
  )
    return "Managed Kiosk was requested but Android has not confirmed active lock-task capability.";
  if (status?.accessibilityServiceState === "policy_enabled_service_disabled")
    return "Accessibility Control is requested but must be enabled locally.";
  if (status?.sleepCapability === "black_screen_only")
    return "Device sleep is unavailable; the player will use black-screen fallback.";
  return undefined;
};
export const zeroTouchReadiness = (
  status?: ReliabilityStatus,
): "Ready" | "Partially ready" | "Needs setup" | "Unsupported" => {
  if (!status || !status.commissioningState) return "Needs setup";
  if (status.bootRecoveryResult === "unsupported") return "Unsupported";
  if (status.commissioningState !== "complete") return "Needs setup";
  if (
    status.accessibilityServiceState === "enabled" &&
    status.bootLaunchVerified &&
    status.immersiveModeActive &&
    status.keepScreenOn &&
    status.updateReadiness === "ready" &&
    !status.safeMode
  )
    return "Ready";
  return "Partially ready";
};
const codeSchema = z.object({
  code: z.string().trim().min(6, "Enter the six-character code").max(9),
});
const approvalSchema = z.object({
  name: z.string().trim().min(2, "Enter a screen name").max(120),
  location: z.string().max(240),
  description: z.string().max(1000),
});
type CodeForm = z.infer<typeof codeSchema>;
type ApprovalForm = z.infer<typeof approvalSchema>;
export const pairingApprovalPayload = (
  request: PairingRequest,
  values: ApprovalForm,
) => ({
  ...values,
  replaceExistingCredential:
    request.previouslyPaired && request.hasActiveCredential,
});
export const pairingApprovalLabel = (request: PairingRequest) =>
  request.previouslyPaired && request.hasActiveCredential
    ? "Repair and replace credential"
    : "Approve and pair";

const statusContent: Record<
  ScreenStatus,
  { label: string; Icon: typeof Wifi }
> = {
  online: { label: "Online", Icon: Wifi },
  recent: { label: "Recently online", Icon: Wifi },
  stale: { label: "Stale", Icon: CircleAlert },
  offline: { label: "Offline", Icon: WifiOff },
  disabled: { label: "Disabled", Icon: ShieldOff },
  revoked: { label: "Pairing revoked", Icon: ShieldOff },
};

export function ScreensPage() {
  const auth = useAuth();
  const manageable = canManageScreens(auth.status?.user);
  const screens = useQuery({
    queryKey: ["screens"],
    queryFn: api.screens,
    refetchInterval: 10_000,
  });
  const pending = useQuery({
    queryKey: ["screens", "pairing", "pending"],
    queryFn: api.pendingPairings,
    refetchInterval: 10_000,
    enabled: manageable,
  });
  return (
    <div className="screens-page">
      <PageHeader
        title="Screens"
        description="Pair and monitor Android TV, Google TV, and Fire TV players."
        actions={
          manageable ? (
            <>
              <Link className="button button--quiet" to="/groups">
                Sync groups
              </Link>
              <Link className="button button--primary" to="/screens/pair">
                <Plus size={16} aria-hidden="true" /> Pair screen
              </Link>
            </>
          ) : undefined
        }
      />
      <EmergencyPanel
        screens={screens.data?.items ?? []}
        canManage={manageable}
      />
      {screens.isError && (
        <div className="notice notice--error">{screens.error.message}</div>
      )}
      <PendingPairings
        requests={pending.data?.items ?? []}
        canManage={manageable}
      />
      <ScreenListContent
        screens={screens.data?.items ?? []}
        loading={screens.isLoading}
        canManage={manageable}
      />
    </div>
  );
}

function EmergencyPanel({
  screens,
  canManage,
}: {
  screens: Screen[];
  canManage: boolean;
}) {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [playlistId, setPlaylistId] = useState("");
  const [screenIds, setScreenIds] = useState<string[]>([]);
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [minutes, setMinutes] = useState(60);
  const emergencies = useQuery({
    queryKey: ["emergencies"],
    queryFn: api.emergencies,
    refetchInterval: 10_000,
  });
  const playlists = useQuery({
    queryKey: ["playlists", "emergency"],
    queryFn: () => api.playlists(),
    enabled: canManage && open,
  });
  const groups = useQuery({
    queryKey: ["screen-groups", "emergency"],
    queryFn: () => api.screenGroups(),
    enabled: canManage && open,
  });
  const runtimeSettings = useQuery({
    queryKey: ["settings", "emergency-defaults"],
    queryFn: api.settings,
    enabled: canManage && open,
  });
  const activate = useMutation({
    mutationFn: (password: string) =>
      api.activateEmergency(
        {
          name,
          description: "",
          playlistId,
          screenIds,
          groupIds,
          expiresAt: new Date(Date.now() + minutes * 60_000).toISOString(),
          password,
        },
        auth.status?.csrfToken ?? "",
      ),
    onSuccess: async () => {
      setOpen(false);
      setName("");
      setPlaylistId("");
      setScreenIds([]);
      setGroupIds([]);
      await queryClient.invalidateQueries({ queryKey: ["emergencies"] });
    },
  });
  const cancel = useMutation({
    mutationFn: (id: string) =>
      api.cancelEmergency(
        id,
        prompt("Optional cancellation reason") ?? "",
        auth.status?.csrfToken ?? "",
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["emergencies"] }),
  });
  return (
    <section className="detail-card emergency-panel">
      <header>
        <div>
          <h3>Emergency takeover</h3>
          <p>
            Temporarily override schedules and fallback content on selected
            screens.
          </p>
        </div>
        {canManage && (
          <button
            className="button button--danger"
            onClick={() => setOpen(!open)}
          >
            Emergency takeover
          </button>
        )}
      </header>
      {open && (
        <div className="emergency-form">
          <label>
            Name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={180}
            />
          </label>
          <label>
            Playlist
            <Select
              value={playlistId}
              onChange={(e) => setPlaylistId(e.target.value)}
            >
              <option value="">Select playlist</option>
              {playlists.data?.items.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </label>
          <label>
            Expires in
            <Select
              value={minutes}
              onChange={(e) => setMinutes(Number(e.target.value))}
            >
              <option value={15}>15 minutes</option>
              <option value={60}>1 hour</option>
              <option value={240}>4 hours</option>
              <option value={1440}>24 hours</option>
            </Select>
          </label>
          <fieldset>
            <legend>Target screens</legend>
            {screens.map((s) => (
              <label key={s.id}>
                <input
                  type="checkbox"
                  checked={screenIds.includes(s.id)}
                  onChange={(e) =>
                    setScreenIds((ids) =>
                      e.target.checked
                        ? [...ids, s.id]
                        : ids.filter((id) => id !== s.id),
                    )
                  }
                />
                {s.name} · {s.status}
              </label>
            ))}
          </fieldset>
          <fieldset>
            <legend>Target sync groups</legend>
            {groups.data?.items.map((g) => (
              <label key={g.id}>
                <input
                  type="checkbox"
                  checked={groupIds.includes(g.id)}
                  onChange={(e) =>
                    setGroupIds((ids) =>
                      e.target.checked
                        ? [...ids, g.id]
                        : ids.filter((id) => id !== g.id),
                    )
                  }
                />
                {g.name} · {g.membershipCount} screens
              </label>
            ))}
          </fieldset>
          <p>
            {screenIds.length} directly selected screen
            {screenIds.length === 1 ? "" : "s"}; {groupIds.length} sync group
            {groupIds.length === 1 ? "" : "s"};{" "}
            {
              screens.filter(
                (s) => screenIds.includes(s.id) && s.status !== "online",
              ).length
            }{" "}
            selected screens currently offline.
          </p>
          <button
            className="button button--danger"
            disabled={
              !name ||
              !playlistId ||
              (screenIds.length === 0 && groupIds.length === 0) ||
              activate.isPending
            }
            onClick={() => {
              const requiresPassword = Boolean(
                runtimeSettings.data?.values[
                  "emergency.reauthentication_required"
                ],
              );
              const password = requiresPassword
                ? (prompt("Confirm your current password") ?? "")
                : "";
              if (requiresPassword && !password) return;
              if (
                confirm(
                  `Activate the selected playlist for these targets? Existing overlapping emergencies will be replaced.`,
                )
              )
                activate.mutate(password);
            }}
          >
            Activate emergency takeover
          </button>
        </div>
      )}
      {(emergencies.data?.items ?? [])
        .filter((e) => e.status === "active")
        .map((e) => (
          <div className="emergency-row" key={e.id}>
            <span>
              <strong>{e.name}</strong>
              <small>
                {e.playlistName} · expires{" "}
                {new Date(e.expiresAt).toLocaleString()}
              </small>
            </span>
            <span>
              {e.activeCount} active · {e.preparingCount} preparing ·{" "}
              {e.failedCount} failed · {e.affectedCount} total
            </span>
            {canManage && (
              <button
                className="button button--danger-quiet"
                onClick={() => {
                  if (
                    confirm(
                      "Cancel this takeover and restore current scheduled or fallback playback?",
                    )
                  )
                    cancel.mutate(e.id);
                }}
              >
                Cancel
              </button>
            )}
          </div>
        ))}
    </section>
  );
}

export function ScreenListContent({
  screens,
  loading,
  canManage,
}: {
  screens: Screen[];
  loading: boolean;
  canManage: boolean;
}) {
  if (loading) return <div className="table-loading">Loading screens…</div>;
  if (screens.length === 0)
    return (
      <section className="screen-empty">
        <span className="empty-illustration">
          <Monitor size={29} />
        </span>
        <h3>No screens paired</h3>
        <p>
          Install Tilecast Player on a TV device, connect it to this server,
          then enter the pairing code shown on the TV.
        </p>
        {canManage ? (
          <Link className="button button--primary" to="/screens/pair">
            Pair your first screen
          </Link>
        ) : (
          <p className="permission-note">
            An Owner or Administrator can approve new screens.
          </p>
        )}
      </section>
    );
  return (
    <section className="screen-table" aria-label="Paired screens">
      <div className="screen-table__header">
        <span>Screen</span>
        <span>Status</span>
        <span>Device</span>
        <span>Last contact</span>
      </div>
      {screens.map((screen) => (
        <Link
          to={`/screens/${screen.id}`}
          className="screen-row"
          key={screen.id}
        >
          <span className="screen-name">
            <span className="screen-icon">
              <Monitor size={17} />
            </span>
            <span>
              <strong>{screen.name}</strong>
              <small>{screen.location || "No location"}</small>
            </span>
          </span>
          <StatusLabel status={screen.status} />
          <span>
            <strong>
              {screen.deviceManufacturer} {screen.deviceModel}
            </strong>
            <small>{screen.playerVersion}</small>
          </span>
          <span>
            <strong>{formatContact(screen.lastContactAt)}</strong>
            <small>
              {screen.screenWidth} × {screen.screenHeight}
            </small>
          </span>
        </Link>
      ))}
    </section>
  );
}

function PendingPairings({
  requests,
  canManage,
}: {
  requests: PairingRequest[];
  canManage: boolean;
}) {
  if (requests.length === 0) return null;
  return (
    <section className="pending-panel">
      <header>
        <div>
          <h3>Waiting for approval</h3>
          <p>
            {requests.length} player{requests.length === 1 ? "" : "s"} requested
            pairing.
          </p>
        </div>
        <RefreshCw size={16} />
      </header>
      {requests.map((request) => (
        <div className="pending-row" key={request.id}>
          <span>
            <strong>
              {request.metadata.manufacturer} {request.metadata.model}
            </strong>
            <small>
              {request.metadata.platform} · {request.metadata.screenWidth} ×{" "}
              {request.metadata.screenHeight}
            </small>
          </span>
          <span>
            Expires{" "}
            {new Date(request.expiresAt).toLocaleTimeString([], {
              hour: "numeric",
              minute: "2-digit",
            })}
          </span>
          {canManage && (
            <Link
              className="button button--quiet"
              to={`/screens/pair/request/${request.id}`}
            >
              Review
            </Link>
          )}
        </div>
      ))}
    </section>
  );
}

export function PairScreenPage() {
  const { code, requestId } = useParams();
  const auth = useAuth();
  const navigate = useNavigate();
  const [request, setRequest] = useState<PairingRequest>();
  const [error, setError] = useState<string>();
  const form = useForm<CodeForm>({
    resolver: zodResolver(codeSchema),
    defaultValues: { code: code ?? "" },
  });
  const lookup = async (value: CodeForm) => {
    setError(undefined);
    try {
      setRequest(await api.resolvePairing(value.code));
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Pairing code could not be resolved.",
      );
    }
  };
  useEffect(() => {
    if (code && !request) void lookup({ code });
  }, [code]); // eslint-disable-line react-hooks/exhaustive-deps
  const pending = useQuery({
    queryKey: ["screens", "pairing", "pending"],
    queryFn: api.pendingPairings,
    enabled: Boolean(requestId),
  });
  useEffect(() => {
    if (requestId && pending.data)
      setRequest(pending.data.items.find((item) => item.id === requestId));
  }, [requestId, pending.data]);
  if (!canManageScreens(auth.status?.user))
    return (
      <section className="empty-state">
        <span className="empty-state__index">Restricted</span>
        <h2>Screen approval requires administrator access.</h2>
        <p>
          Editors and Viewers can monitor screens but cannot approve or reject
          pairing requests.
        </p>
        <Link className="text-link" to="/screens">
          Return to screens
        </Link>
      </section>
    );
  if (request)
    return (
      <ApprovalPanel
        request={request}
        onDone={(screenId) =>
          void navigate(screenId ? `/screens/${screenId}` : "/screens")
        }
      />
    );
  return (
    <section className="pair-card">
      <header>
        <span className="empty-illustration">
          <Link2 size={24} />
        </span>
        <div>
          <h2>Pair a screen</h2>
          <p>Enter the six-character code displayed by Tilecast Player.</p>
        </div>
      </header>
      {error && (
        <div className="notice notice--error" role="alert">
          {error}
        </div>
      )}
      <form onSubmit={(event) => void form.handleSubmit(lookup)(event)}>
        <FormField
          id="pairingCode"
          label="Pairing code"
          autoComplete="off"
          autoFocus
          className="pair-code-input"
          placeholder="ABC234"
          error={form.formState.errors.code?.message}
          {...form.register("code")}
        />
        <button className="button button--primary" type="submit">
          Find player
        </button>
        <Link className="button button--quiet" to="/screens">
          Cancel
        </Link>
      </form>
      <div className="pair-help">
        <strong>On the TV</strong>
        <p>
          Open Tilecast Player, connect to this server, and leave the pairing
          code visible while you approve it.
        </p>
      </div>
    </section>
  );
}

function ApprovalPanel({
  request,
  onDone,
}: {
  request: PairingRequest;
  onDone: (screenId?: string) => void;
}) {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const form = useForm<ApprovalForm>({
    resolver: zodResolver(approvalSchema),
    defaultValues: {
      name:
        request.existingScreenName ??
        `${request.metadata.manufacturer} ${request.metadata.model}`,
      location: "",
      description: "",
    },
  });
  const approve = useMutation({
    mutationFn: (values: ApprovalForm) => {
      const repair = request.previouslyPaired && request.hasActiveCredential;
      if (
        repair &&
        !window.confirm(
          `Repair pairing for “${request.existingScreenName}” and replace its credential after this player enrolls?`,
        )
      )
        throw new Error("Pairing repair was cancelled.");
      return api.approvePairing(
        request.id,
        pairingApprovalPayload(request, values),
        auth.status?.csrfToken ?? "",
      );
    },
    onSuccess: async (screen) => {
      await queryClient.invalidateQueries({ queryKey: ["screens"] });
      await queryClient.invalidateQueries({
        queryKey: ["screens", "pairing", "pending"],
      });
      onDone(screen.id);
    },
  });
  const reject = useMutation({
    mutationFn: () =>
      api.rejectPairing(
        request.id,
        "Rejected by administrator",
        auth.status?.csrfToken ?? "",
      ),
    onSuccess: () => onDone(),
  });
  const metadata = request.metadata;
  return (
    <section className="approval-card">
      <header>
        <div>
          <p className="step-label">Pairing request</p>
          <h2>Review this player</h2>
          <p>
            Confirm the device details before granting it an individual Tilecast
            credential.
          </p>
        </div>
        <span className="expiry-label">
          Expires{" "}
          {new Date(request.expiresAt).toLocaleTimeString([], {
            hour: "numeric",
            minute: "2-digit",
          })}
        </span>
      </header>
      <dl className="device-facts">
        <div>
          <dt>Device</dt>
          <dd>
            {metadata.manufacturer} {metadata.model}
          </dd>
        </div>
        <div>
          <dt>Platform</dt>
          <dd>{metadata.platform}</dd>
        </div>
        <div>
          <dt>Android</dt>
          <dd>{metadata.androidVersion}</dd>
        </div>
        <div>
          <dt>Player</dt>
          <dd>{metadata.playerVersion}</dd>
        </div>
        <div>
          <dt>Resolution</dt>
          <dd>
            {metadata.screenWidth} × {metadata.screenHeight}
          </dd>
        </div>
        <div>
          <dt>Locale / timezone</dt>
          <dd>
            {metadata.locale} · {metadata.timezone}
          </dd>
        </div>
        {metadata.approximateAddress && (
          <div>
            <dt>Network address</dt>
            <dd>{metadata.approximateAddress}</dd>
          </div>
        )}
      </dl>
      {request.previouslyPaired && (
        <div className="notice notice--warning" role="status">
          <strong>
            This device was previously paired as “{request.existingScreenName}.”
          </strong>
          <p>
            Repairing the pairing will preserve this screen and its content
            assignments. The previous device credential will be revoked only
            after this player completes enrollment.
          </p>
        </div>
      )}
      {(approve.error || reject.error) && (
        <div className="notice notice--error">
          {(approve.error ?? reject.error)?.message}
        </div>
      )}
      <form
        onSubmit={(event) =>
          void form.handleSubmit((values) => approve.mutateAsync(values))(event)
        }
      >
        <FormField
          id="screenName"
          label="Screen name"
          error={form.formState.errors.name?.message}
          {...form.register("name")}
        />
        <FormField
          id="screenLocation"
          label="Location (optional)"
          error={form.formState.errors.location?.message}
          {...form.register("location")}
        />
        <label className="field" htmlFor="screenDescription">
          <span className="field__label">Description (optional)</span>
          <textarea id="screenDescription" {...form.register("description")} />
        </label>
        <div className="form-actions">
          <button
            type="button"
            className="button button--danger-quiet"
            onClick={() => reject.mutate()}
            disabled={reject.isPending || approve.isPending}
          >
            Reject
          </button>
          <button
            type="submit"
            className="button button--primary"
            disabled={approve.isPending || reject.isPending}
          >
            {approve.isPending ? "Approving…" : pairingApprovalLabel(request)}
          </button>
        </div>
      </form>
    </section>
  );
}

export function ScreenDetailPage() {
  const { id = "" } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const auth = useAuth();
  const queryClient = useQueryClient();
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [editingDetails, setEditingDetails] = useState(false);
  const [policyDirty, setPolicyDirty] = useState(false);
  const [selectedPresentation, setSelectedPresentation] = useState("");
  const query = useQuery({
    queryKey: ["screens", id],
    queryFn: () => api.screen(id),
    refetchInterval: 10_000,
  });
  const detailsForm = useForm<ApprovalForm>({
    resolver: zodResolver(approvalSchema),
    defaultValues: { name: "", location: "", description: "" },
  });
  useEffect(() => {
    if (!query.data || editingDetails) return;
    detailsForm.reset({
      name: query.data.name,
      location: query.data.location,
      description: query.data.description,
    });
  }, [detailsForm, editingDetails, query.data]);
  const updateDetails = useMutation({
    mutationFn: (values: ApprovalForm) =>
      api.updateScreen(id, values, auth.status?.csrfToken ?? ""),
    onSuccess: async (updated) => {
      queryClient.setQueryData(["screens", id], updated);
      setEditingDetails(false);
      await queryClient.invalidateQueries({ queryKey: ["screens"] });
    },
  });
  const assignment = useQuery({
    queryKey: ["screens", id, "playlist-assignment"],
    queryFn: () => api.playlistAssignment(id),
    refetchInterval: 10_000,
  });
  const playlists = useQuery({
    queryKey: ["playlists", "assignment-picker"],
    queryFn: () => api.playlists(),
    enabled: canManageScreens(auth.status?.user),
  });
  const layouts = useQuery({
    queryKey: ["layouts", "assignment-picker"],
    queryFn: () => api.layouts(""),
    enabled: canManageScreens(auth.status?.user),
  });
  useEffect(() => {
    setSelectedPresentation(
      assignment.data?.layoutId
        ? `layout:${assignment.data.layoutId}`
        : assignment.data?.playlistId
          ? `playlist:${assignment.data.playlistId}`
          : "",
    );
  }, [assignment.data?.layoutId, assignment.data?.playlistId]);
  const assign = useMutation({
    mutationFn: () => {
      const [type, presentationId] = selectedPresentation.split(":");
      if (type === "layout" && presentationId)
        return api.assignLayout(
          id,
          presentationId,
          auth.status?.csrfToken ?? "",
        );
      if (type === "playlist" && presentationId)
        return api.assignPlaylist(
          id,
          presentationId,
          auth.status?.csrfToken ?? "",
        );
      return api.unassignPlaylist(id, auth.status?.csrfToken ?? "");
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["screens", id, "playlist-assignment"],
      });
    },
  });
  const stateMutation = useMutation({
    mutationFn: (enabled: boolean) =>
      api.setScreenEnabled(id, enabled, auth.status?.csrfToken ?? ""),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["screens"] });
    },
  });
  const revoke = useMutation({
    mutationFn: () =>
      api.revokeScreen(
        id,
        "Revoked in Tilecast Studio",
        auth.status?.csrfToken ?? "",
      ),
    onSuccess: async () => {
      setConfirmRevoke(false);
      await queryClient.invalidateQueries({ queryKey: ["screens"] });
    },
  });
  const commands = useQuery({
    queryKey: ["screens", id, "commands"],
    queryFn: () => api.screenCommands(id),
    refetchInterval: 5_000,
    enabled: true,
  });
  const reliability = useQuery({
    queryKey: ["screens", id, "reliability"],
    queryFn: () => api.screenReliability(id),
    refetchInterval: 10_000,
  });
  const screenPolicy = useQuery({
    queryKey: ["screen", id, "policy"],
    queryFn: () => api.screenPolicy(id),
  });
  const command = useMutation({
    mutationFn: ({
      type,
      payload,
    }: {
      type: string;
      payload: Record<string, number>;
    }) =>
      api.createScreenCommand(id, type, payload, auth.status?.csrfToken ?? ""),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["screens", id, "commands"] }),
  });
  if (query.isLoading)
    return <div className="table-loading">Loading screen…</div>;
  if (!query.data)
    return (
      <div className="notice notice--error">Screen could not be loaded.</div>
    );
  const screen = query.data;
  const requestedTab = searchParams.get("tab") ?? "overview";
  const tab = [
    "overview",
    "content",
    "player-settings",
    "reliability",
    "commands",
  ].includes(requestedTab)
    ? requestedTab
    : "overview";
  const selectTab = (nextTab: string) => {
    if (policyDirty && tab === "player-settings") {
      if (!confirm("Leave Player settings without saving your changes?"))
        return;
      setPolicyDirty(false);
    }
    const next = new URLSearchParams(searchParams);
    if (nextTab === "overview") next.delete("tab");
    else next.set("tab", nextTab);
    setSearchParams(next);
  };
  return (
    <div className="screen-detail">
      <PageHeader
        eyebrow={
          <Link className="back-link" to="/screens">
            ← Screens
          </Link>
        }
        title={screen.name}
        description={screen.location || "No location set"}
        actions={
          <>
            <StatusLabel status={screen.status} />
            {canManageScreens(auth.status?.user) && (
              <button
                type="button"
                className="button button--secondary"
                onClick={() => setEditingDetails((editing) => !editing)}
              >
                <Pencil size={15} aria-hidden="true" />
                {editingDetails ? "Close editor" : "Edit details"}
              </button>
            )}
          </>
        }
      />
      {editingDetails && (
        <section
          className="screen-details-editor"
          aria-labelledby="screen-details-editor-title"
        >
          <header>
            <div>
              <h3 id="screen-details-editor-title">Player details</h3>
            </div>
          </header>
          {updateDetails.error && (
            <div className="notice notice--error" role="alert">
              {updateDetails.error.message}
            </div>
          )}
          <form
            onSubmit={(event) =>
              void detailsForm.handleSubmit((values) =>
                updateDetails.mutateAsync(values),
              )(event)
            }
          >
            <FormField
              id="editScreenName"
              label="Screen name"
              autoFocus
              error={detailsForm.formState.errors.name?.message}
              {...detailsForm.register("name")}
            />
            <FormField
              id="editScreenLocation"
              label="Location (optional)"
              error={detailsForm.formState.errors.location?.message}
              {...detailsForm.register("location")}
            />
            <label
              className="field screen-details-editor__description"
              htmlFor="editScreenDescription"
            >
              <span className="field__label">Description (optional)</span>
              <textarea
                id="editScreenDescription"
                {...detailsForm.register("description")}
              />
              {detailsForm.formState.errors.description?.message && (
                <span className="field__error">
                  {detailsForm.formState.errors.description.message}
                </span>
              )}
            </label>
            <div className="screen-details-editor__actions">
              <button
                type="button"
                className="button button--secondary"
                onClick={() => setEditingDetails(false)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="button button--primary"
                disabled={updateDetails.isPending}
              >
                {updateDetails.isPending ? "Saving…" : "Save details"}
              </button>
            </div>
          </form>
        </section>
      )}
      <ViewTabs
        className="screen-detail-tabs"
        label="Screen details"
        value={tab}
        onValueChange={selectTab}
        items={[
          { value: "overview", label: "Overview" },
          { value: "content", label: "Content" },
          {
            value: "player-settings",
            label: "Player settings",
            marker: policyDirty ? "Unsaved" : undefined,
          },
          { value: "reliability", label: "Reliability" },
          { value: "commands", label: "Commands" },
        ]}
      />

      {tab === "overview" && (
        <section
          className="screen-overview"
          aria-labelledby="screen-overview-title"
        >
          <header>
            <h3 id="screen-overview-title">Screen overview</h3>
            <p>Current player state and the settings that affect it.</p>
          </header>
          <dl className="screen-overview__grid">
            <div>
              <dt>Online status</dt>
              <dd>
                <StatusLabel status={screen.status} />
              </dd>
            </div>
            <div>
              <dt>Current content</dt>
              <dd>
                {assignment.data?.playbackState ??
                  assignment.data?.playlistName ??
                  "No content"}
              </dd>
            </div>
            <div>
              <dt>Synchronization</dt>
              <dd>
                {assignment.data?.synchronizationStatus.replaceAll("_", " ") ??
                  "Not reported"}
              </dd>
            </div>
            <div>
              <dt>Player version</dt>
              <dd>{screen.playerVersion || "Not reported"}</dd>
            </div>
            <div>
              <dt>Reliability mode</dt>
              <dd>
                {reliability.data?.effectiveMode?.replaceAll("_", " ") ??
                  "Not reported"}
              </dd>
            </div>
            <div>
              <dt>Active hours</dt>
              <dd>
                {reliability.data?.activeHoursState?.replaceAll("_", " ") ??
                  "Not reported"}
              </dd>
            </div>
            <div>
              <dt>Player-setting overrides</dt>
              <dd>
                <Link to={`?tab=player-settings`}>
                  {Object.keys(screenPolicy.data?.values ?? {}).length}{" "}
                  configured · Review settings
                </Link>
              </dd>
            </div>
          </dl>
          <div className="screen-overview__links">
            <button type="button" onClick={() => selectTab("content")}>
              View content
            </button>
            <button type="button" onClick={() => selectTab("reliability")}>
              View reliability
            </button>
            <button type="button" onClick={() => selectTab("commands")}>
              View commands
            </button>
          </div>
        </section>
      )}

      {tab === "content" && (
        <section className="detail-card assignment-card">
          <h3>Playback and scheduling</h3>
          {assignment.data?.groups[0] && (
            <div className="notice notice--info">
              This player belongs to the{" "}
              <Link to={`/groups/${assignment.data.groups[0].id}`}>
                {assignment.data.groups[0].name}
              </Link>{" "}
              sync group. Content and schedules apply to every member.
            </div>
          )}
          {canManageScreens(auth.status?.user) ? (
            <div className="assignment-controls">
              <Select
                aria-label="Assigned presentation"
                value={selectedPresentation}
                onChange={(event) =>
                  setSelectedPresentation(event.target.value)
                }
              >
                <option value="">No presentation assigned</option>
                <optgroup label="Playlists">
                  {playlists.data?.items.map((playlist) => (
                    <option key={playlist.id} value={`playlist:${playlist.id}`}>
                      {playlist.name}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Published Layouts">
                  {layouts.data?.items
                    .filter((layout) => layout.publishedRevision)
                    .map((layout) => (
                      <option key={layout.id} value={`layout:${layout.id}`}>
                        {layout.name}
                      </option>
                    ))}
                </optgroup>
              </Select>
              <button
                className="button button--primary"
                disabled={
                  assign.isPending ||
                  selectedPresentation ===
                    (assignment.data?.layoutId
                      ? `layout:${assignment.data.layoutId}`
                      : assignment.data?.playlistId
                        ? `playlist:${assignment.data.playlistId}`
                        : "")
                }
                onClick={() => assign.mutate()}
              >
                {assignment.data?.groups[0]
                  ? "Apply to sync group"
                  : "Apply assignment"}
              </button>
            </div>
          ) : (
            <p>{assignment.data?.playlistName ?? "No playlist assigned"}</p>
          )}
          <dl className="detail-list">
            <div>
              <dt>Direct fallback</dt>
              <dd>
                {assignment.data?.layoutName ??
                  assignment.data?.playlistName ??
                  "No fallback assigned"}
              </dd>
            </div>
            <div>
              <dt>Current selection</dt>
              <dd>
                {assignment.data?.selectionSource === "emergency"
                  ? "Emergency takeover"
                  : assignment.data?.selectionSource === "schedule"
                    ? `Scheduled${assignment.data.currentScheduleId ? ` · ${assignment.data.relevantSchedules.find((s) => s.id === assignment.data?.currentScheduleId)?.name ?? "schedule"}` : ""}`
                    : assignment.data?.selectionSource === "direct_fallback"
                      ? "Direct fallback"
                      : "No content"}
              </dd>
            </div>
            <div>
              <dt>Next scheduled change</dt>
              <dd>
                {assignment.data?.nextTransitionAt
                  ? new Date(assignment.data.nextTransitionAt).toLocaleString()
                  : "None reported"}
              </dd>
            </div>
            <div>
              <dt>Server manifest</dt>
              <dd>Version {assignment.data?.manifestVersion ?? 1}</dd>
            </div>
            <div>
              <dt>Player configuration</dt>
              <dd>
                {assignment.data?.activeConfigRevision != null
                  ? `Revision ${assignment.data.activeConfigRevision}`
                  : "Not reported"}
              </dd>
            </div>
            <div>
              <dt>Player manifest</dt>
              <dd>
                {assignment.data?.playerActiveManifestVersion != null
                  ? `Version ${assignment.data.playerActiveManifestVersion}`
                  : "Not reported"}
              </dd>
            </div>
            <div>
              <dt>Synchronization</dt>
              <dd>
                {assignment.data?.synchronizationStatus.replaceAll("_", " ") ??
                  "Not reported"}
              </dd>
            </div>
            <div>
              <dt>Sync group</dt>
              <dd>
                {assignment.data?.groups.map((g) => g.name).join(", ") ||
                  "Not grouped"}
              </dd>
            </div>
            <div>
              <dt>Relevant schedules</dt>
              <dd>
                {assignment.data?.relevantSchedules
                  .map((s) => `${s.name} (${s.priority})`)
                  .join(", ") || "No schedules"}
              </dd>
            </div>
            <div>
              <dt>Device clock difference</dt>
              <dd>
                {assignment.data?.deviceClockOffsetSeconds != null
                  ? `${Math.abs(assignment.data.deviceClockOffsetSeconds)} seconds`
                  : "Not reported"}
              </dd>
            </div>
            <div>
              <dt>Downloads</dt>
              <dd>
                {assignment.data?.downloadQueueCount != null
                  ? `${assignment.data.downloadQueueCount} queued · ${assignment.data.downloadedBytes ?? 0} of ${assignment.data.requiredBytes ?? 0} bytes`
                  : "Not reported"}
              </dd>
            </div>
            <div>
              <dt>Website playback</dt>
              <dd>
                {assignment.data?.websiteState
                  ? `${assignment.data.websiteState.replaceAll("_", " ")}${assignment.data.websiteCurrentHost ? ` · ${assignment.data.websiteCurrentHost}` : ""}`
                  : "Not active"}
              </dd>
            </div>
            <div>
              <dt>Blocked website navigation</dt>
              <dd>
                {assignment.data?.websiteBlockedNavigationCount ??
                  "Not reported"}
              </dd>
            </div>
            <div>
              <dt>Playback</dt>
              <dd>{assignment.data?.playbackState ?? "Not reported"}</dd>
            </div>
            <div>
              <dt>Emergency</dt>
              <dd>
                {assignment.data?.activeEmergencyId
                  ? `${assignment.data.emergencyState ?? "pending"} · ${assignment.data.emergencyPreparationProgress ?? 0}% prepared`
                  : "No active emergency"}
              </dd>
            </div>
            <div>
              <dt>Cache</dt>
              <dd>
                {assignment.data?.cacheUsedBytes != null
                  ? `${assignment.data.cacheUsedBytes} of ${assignment.data.cacheLimitBytes ?? 0} bytes`
                  : "Not reported"}
              </dd>
            </div>
          </dl>
          {assignment.data?.lastSynchronizationError && (
            <div className="notice notice--error">
              Synchronization: {assignment.data.lastSynchronizationError}
            </div>
          )}
          {assignment.data?.lastPlaybackError && (
            <div className="notice notice--error">
              Playback: {assignment.data.lastPlaybackError}
            </div>
          )}
          {assignment.data?.configurationError && (
            <div className="notice notice--error">
              Configuration: {assignment.data.configurationError}
            </div>
          )}
          {Math.abs(assignment.data?.deviceClockOffsetSeconds ?? 0) >
            (assignment.data?.clockSkewWarningSeconds ?? 300) && (
            <div className="notice notice--warning">
              The player clock differs from server time by more than five
              minutes. Offline schedule changes may occur at the wrong time.
            </div>
          )}
          {assignment.data?.scheduleEvaluationError && (
            <div className="notice notice--error">
              Schedule evaluation: {assignment.data.scheduleEvaluationError}
            </div>
          )}
          {assignment.data?.websiteFailureCategory &&
            ["failed", "timed_out", "blocked", "showing_fallback"].includes(
              assignment.data.websiteState ?? "",
            ) && (
              <div className="notice notice--error">
                Website:{" "}
                {assignment.data.websiteFailureCategory.replaceAll("_", " ")}
              </div>
            )}
        </section>
      )}

      {tab === "reliability" && (
        <section className="operations" aria-labelledby="reliability-heading">
          <h3 id="reliability-heading">Reliability &amp; Power</h3>
          <p>
            Configured features are reported separately from Android-confirmed
            capabilities. Power Assist asks Android to sleep or wake; it does
            not send direct HDMI-CEC commands.
          </p>
          <div className="readiness-panel">
            <div className="readiness-panel__heading">
              <div>
                <h4>Zero-Touch Readiness</h4>
                <p>
                  Commissioning and current device capabilities required for
                  unattended recovery.
                </p>
              </div>
              <span className="status-badge">
                {zeroTouchReadiness(reliability.data)}
              </span>
            </div>
            <dl className="detail-list">
              <div>
                <dt>Commissioning</dt>
                <dd>
                  {reliability.data?.commissioningState?.replaceAll("_", " ") ??
                    "Not started"}
                  {reliability.data?.commissioningStep
                    ? ` · ${reliability.data.commissioningStep.replaceAll("_", " ")}`
                    : ""}
                </dd>
              </div>
              <div>
                <dt>Accessibility return</dt>
                <dd>
                  {reliability.data?.accessibilityServiceState ??
                    "Not reported"}
                </dd>
              </div>
              <div>
                <dt>Launch after boot</dt>
                <dd>
                  {reliability.data?.bootLaunchVerified
                    ? "Verified"
                    : `${reliability.data?.bootAttemptCount ?? 0} attempts · not verified`}
                </dd>
              </div>
              <div>
                <dt>Cached fallback</dt>
                <dd>
                  {reliability.data?.cachedFallbackAvailable
                    ? "Available"
                    : "Not confirmed"}
                </dd>
              </div>
              <div>
                <dt>Install permission</dt>
                <dd>{screen.installPermissionStatus ?? "Not reported"}</dd>
              </div>
              <div>
                <dt>Free storage</dt>
                <dd>
                  {screen.availableStorageBytes == null
                    ? "Not reported"
                    : formatBytes(screen.availableStorageBytes)}
                </dd>
              </div>
              <div>
                <dt>Last healthy playback</dt>
                <dd>
                  {reliability.data?.lastHealthyPlaybackAt
                    ? new Date(
                        reliability.data.lastHealthyPlaybackAt,
                      ).toLocaleString()
                    : "Not reported"}
                </dd>
              </div>
              <div>
                <dt>Update readiness</dt>
                <dd>{reliability.data?.updateReadiness ?? "Not reported"}</dd>
              </div>
            </dl>
          </div>
          <dl className="detail-list">
            <div>
              <dt>Reliability mode</dt>
              <dd>
                {reliability.data?.configuredMode ?? "Not reported"} configured
                · {reliability.data?.effectiveMode ?? "Not reported"} effective
              </dd>
            </div>
            <div>
              <dt>Foreground</dt>
              <dd>{reliability.data?.foregroundState ?? "Not reported"}</dd>
            </div>
            <div>
              <dt>Boot recovery</dt>
              <dd>{reliability.data?.bootRecoveryResult ?? "Not reported"}</dd>
            </div>
            <div>
              <dt>Immersive / keep awake</dt>
              <dd>
                {reliability.data?.immersiveModeActive
                  ? "Immersive"
                  : "Not immersive"}{" "}
                ·{" "}
                {reliability.data?.keepScreenOn
                  ? "Kept awake"
                  : "Wake lock released"}
              </dd>
            </div>
            <div>
              <dt>Managed Kiosk</dt>
              <dd>
                {reliability.data?.managedKioskCapability ?? "Not reported"} ·
                lock task {reliability.data?.lockTaskState ?? "unknown"}
              </dd>
            </div>
            <div>
              <dt>Accessibility Control</dt>
              <dd>
                {reliability.data?.accessibilityServiceState ?? "Not reported"}
              </dd>
            </div>
            <div>
              <dt>Active hours</dt>
              <dd>{reliability.data?.activeHoursState ?? "Not reported"}</dd>
            </div>
            <div>
              <dt>Sleep support</dt>
              <dd>{reliability.data?.sleepCapability ?? "Not reported"}</dd>
            </div>
            <div>
              <dt>Recovery</dt>
              <dd>
                Level {reliability.data?.recoveryLevel ?? 0} ·{" "}
                {reliability.data?.recoveryCount ?? 0} recent · safe mode{" "}
                {reliability.data?.safeMode ? "active" : "inactive"}
              </dd>
            </div>
            <div>
              <dt>Maintenance session</dt>
              <dd>
                {reliability.data?.maintenanceSessionExpiresAt
                  ? `Until ${new Date(reliability.data.maintenanceSessionExpiresAt).toLocaleString()}`
                  : "Inactive"}
              </dd>
            </div>
          </dl>
          {reliabilityCapabilityWarning(reliability.data) && (
            <div className="notice notice--warning">
              {reliabilityCapabilityWarning(reliability.data)}
            </div>
          )}
          {canManageScreens(auth.status?.user) && (
            <>
              <section
                className="reliability-controls"
                aria-labelledby="reliability-controls-title"
              >
                <header className="reliability-section-heading">
                  <div>
                    <h4 id="reliability-controls-title">Player controls</h4>
                    <p>
                      Run a focused recovery action without leaving this screen.
                    </p>
                  </div>
                  {command.isPending && (
                    <span className="status-badge">Sending…</span>
                  )}
                </header>
                <div className="reliability-control-groups">
                  <div className="reliability-control-group">
                    <div>
                      <h5>Power Assist</h5>
                      <p>Test Android sleep and wake behavior.</p>
                    </div>
                    <div className="reliability-button-grid">
                      <button
                        className="button button--secondary"
                        disabled={command.isPending}
                        onClick={() =>
                          command.mutate({
                            type: "power_assist_sleep",
                            payload: {},
                          })
                        }
                      >
                        Test sleep
                      </button>
                      <button
                        className="button button--secondary"
                        disabled={command.isPending}
                        onClick={() =>
                          command.mutate({
                            type: "power_assist_wake",
                            payload: {},
                          })
                        }
                      >
                        Test wake
                      </button>
                    </div>
                  </div>
                  <div className="reliability-control-group">
                    <div>
                      <h5>Recovery</h5>
                      <p>
                        Retry recovery or leave safe mode after resolving a
                        fault.
                      </p>
                    </div>
                    <div className="reliability-button-grid">
                      <button
                        className="button button--secondary"
                        disabled={command.isPending}
                        onClick={() =>
                          command.mutate({
                            type: "retry_player_recovery",
                            payload: {},
                          })
                        }
                      >
                        Retry recovery
                      </button>
                      <button
                        className="button button--secondary"
                        disabled={
                          command.isPending || !reliability.data?.safeMode
                        }
                        onClick={() =>
                          command.mutate({
                            type: "exit_safe_mode",
                            payload: {},
                          })
                        }
                      >
                        Exit safe mode
                      </button>
                    </div>
                  </div>
                  <div className="reliability-control-group reliability-control-group--wide">
                    <div>
                      <h5>Playback and player</h5>
                      <p>
                        Use the least disruptive action that matches the
                        problem.
                      </p>
                    </div>
                    <div className="reliability-button-grid reliability-button-grid--wide">
                      {(
                        [
                          ["retry_current_item", "Retry item"],
                          ["skip_current_item", "Skip item"],
                          ["recreate_renderer", "Recreate renderer"],
                          ["recreate_playback_session", "Recreate session"],
                          ["restart_activity", "Restart activity"],
                          ["restart_player_process", "Restart player"],
                          ["resynchronize_player", "Resynchronize"],
                          ["run_player_self_test", "Run self-test"],
                        ] as const
                      ).map(([type, label]) => (
                        <button
                          key={type}
                          className="button button--secondary"
                          disabled={command.isPending}
                          onClick={() => command.mutate({ type, payload: {} })}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </section>
            </>
          )}
        </section>
      )}

      {tab === "commands" && canManageScreens(auth.status?.user) && (
        <section className="operations">
          <h3>Operations</h3>
          <p>
            Commands remain pending during brief disconnections and expire
            automatically.
          </p>
          <div className="heading-actions">
            <button
              className="button button--quiet"
              onClick={() => command.mutate({ type: "sync_now", payload: {} })}
            >
              Sync now
            </button>
            <button
              className="button button--quiet"
              onClick={() =>
                command.mutate({ type: "reload_playback", payload: {} })
              }
            >
              Reload playback
            </button>
            <button
              className="button button--quiet"
              onClick={() =>
                command.mutate({
                  type: "identify_screen",
                  payload: { durationSeconds: 30 },
                })
              }
            >
              Identify screen
            </button>
            <button
              className="button button--danger-quiet"
              onClick={() => {
                if (
                  confirm(
                    "Clear media not protected by active or pending playback?",
                  )
                )
                  command.mutate({ type: "clear_media_cache", payload: {} });
              }}
            >
              Clear media cache
            </button>
            <button
              className="button button--danger-quiet"
              onClick={() => {
                if (
                  confirm(
                    "Clear cookies, cache, DOM storage, and WebView state?",
                  )
                )
                  command.mutate({ type: "clear_website_data", payload: {} });
              }}
            >
              Clear website data
            </button>
            <button
              className="button button--danger-quiet"
              onClick={() => {
                const disabling = !assignment.data?.playbackDisabled;
                if (
                  !disabling ||
                  confirm(
                    "Disable ordinary playback while keeping this player paired and connected?",
                  )
                )
                  command.mutate({
                    type: disabling ? "disable_playback" : "enable_playback",
                    payload: {},
                  });
              }}
            >
              {assignment.data?.playbackDisabled
                ? "Enable playback"
                : "Disable playback"}
            </button>
          </div>
          {command.isSuccess && (
            <p>Command queued; this does not mean it has completed.</p>
          )}
          <div className="command-history">
            {commands.data?.items.map((c) => (
              <div key={c.id}>
                <strong>{c.type.replaceAll("_", " ")}</strong>
                <span>
                  {c.state} · {new Date(c.createdAt).toLocaleString()}
                </span>
                <small>
                  {c.resultCode?.replaceAll("_", " ") ?? "No result yet"}
                </small>
              </div>
            ))}
          </div>
        </section>
      )}
      {tab === "commands" &&
        !canManageScreens(auth.status?.user) &&
        (commands.data?.items.length ?? 0) > 0 && (
          <section className="operations">
            <h3>Recent operations</h3>
            <div className="command-history">
              {commands.data?.items.map((c) => (
                <div key={c.id}>
                  <strong>{c.type.replaceAll("_", " ")}</strong>
                  <span>
                    {c.state} · {new Date(c.createdAt).toLocaleString()}
                  </span>
                  <small>
                    {c.resultCode?.replaceAll("_", " ") ?? "No result yet"}
                  </small>
                </div>
              ))}
            </div>
          </section>
        )}
      {tab === "player-settings" && (
        <PlayerPolicyEditor
          target="screen"
          id={id}
          onDirtyChange={setPolicyDirty}
        />
      )}
      {tab === "commands" && (
        <>
          <section className="detail-grid">
            <div className="detail-card">
              <h3>Device</h3>
              <dl className="detail-list">
                <div>
                  <dt>Hardware</dt>
                  <dd>
                    {screen.deviceManufacturer} {screen.deviceModel}
                  </dd>
                </div>
                <div>
                  <dt>Platform</dt>
                  <dd>
                    {screen.platform} · Android {screen.androidVersion}
                  </dd>
                </div>
                <div>
                  <dt>Player version</dt>
                  <dd>
                    {screen.playerVersion}
                    {screen.playerVersionCode
                      ? ` (code ${screen.playerVersionCode})`
                      : ""}
                  </dd>
                </div>
                <div>
                  <dt>Android SDK</dt>
                  <dd>{screen.androidSdk ?? "Not reported"}</dd>
                </div>
                <div>
                  <dt>Installer source</dt>
                  <dd>{screen.installerSource ?? "Not reported"}</dd>
                </div>
                <div>
                  <dt>Install permission</dt>
                  <dd>
                    {screen.installPermissionStatus?.replaceAll("_", " ") ??
                      "Unknown"}
                  </dd>
                </div>
                <div>
                  <dt>Player update</dt>
                  <dd>
                    {screen.updateState?.replaceAll("_", " ") ??
                      "No active deployment"}
                    {screen.updateExpectedBytes
                      ? ` · ${Math.round(((screen.updateDownloadedBytes ?? 0) / screen.updateExpectedBytes) * 100)}%`
                      : ""}
                    {screen.updateError ? ` · ${screen.updateError}` : ""}
                  </dd>
                </div>
                <div>
                  <dt>Resolution</dt>
                  <dd>
                    {screen.screenWidth} × {screen.screenHeight}
                  </dd>
                </div>
                <div>
                  <dt>Locale</dt>
                  <dd>{screen.locale}</dd>
                </div>
                <div>
                  <dt>Timezone</dt>
                  <dd>{screen.timezone}</dd>
                </div>
              </dl>
            </div>
            <div className="detail-card">
              <h3>Connection</h3>
              <dl className="detail-list">
                <div>
                  <dt>Last contact</dt>
                  <dd>{formatContact(screen.lastContactAt)}</dd>
                </div>
                <div>
                  <dt>Network address</dt>
                  <dd>{screen.lastKnownIp || "Not reported"}</dd>
                </div>
                <div>
                  <dt>Credential</dt>
                  <dd>{screen.hasActiveCredential ? "Active" : "Revoked"}</dd>
                </div>
              </dl>
            </div>
          </section>
          {canManageScreens(auth.status?.user) && (
            <section className="danger-zone">
              <h3>Player access</h3>
              <div>
                <span>
                  <strong>
                    {screen.enabled ? "Disable screen" : "Enable screen"}
                  </strong>
                  <small>
                    {screen.enabled
                      ? "Temporarily blocks operation while retaining the pairing."
                      : "Allow the paired player to reconnect."}
                  </small>
                </span>
                <button
                  className="button button--quiet"
                  onClick={() => stateMutation.mutate(!screen.enabled)}
                >
                  {screen.enabled ? "Disable" : "Enable"}
                </button>
              </div>
              <div>
                <span>
                  <strong>Revoke pairing</strong>
                  <small>
                    Permanently invalidates the device credential. The player
                    must pair again.
                  </small>
                </span>
                <button
                  className="button button--danger"
                  onClick={() => setConfirmRevoke(true)}
                  disabled={!screen.hasActiveCredential}
                >
                  Revoke pairing
                </button>
              </div>
            </section>
          )}
        </>
      )}
      <Dialog
        open={confirmRevoke}
        title={`Revoke pairing for ${screen.name}?`}
        onClose={() => setConfirmRevoke(false)}
      >
        <p>
          The player will disconnect immediately and cannot reconnect without a
          new pairing approval.
        </p>
        <div className="form-actions">
          <Button variant="quiet" onClick={() => setConfirmRevoke(false)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            loading={revoke.isPending}
            onClick={() => revoke.mutate()}
          >
            Revoke pairing
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

export function StatusLabel({ status }: { status: ScreenStatus }) {
  const { label, Icon } = statusContent[status];
  return (
    <span className={`screen-status screen-status--${status}`}>
      <Icon size={14} />
      {label}
    </span>
  );
}
function formatContact(value?: string) {
  if (!value) return "Never";
  const seconds = Math.max(
    0,
    Math.round((Date.now() - new Date(value).getTime()) / 1000),
  );
  if (seconds < 60) return "Just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hr ago`;
  return new Date(value).toLocaleDateString();
}
