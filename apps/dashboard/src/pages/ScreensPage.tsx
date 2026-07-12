import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CircleAlert,
  Link2,
  Monitor,
  Plus,
  RefreshCw,
  ShieldOff,
  Wifi,
  WifiOff,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate, useParams } from "react-router";
import { z } from "zod";
import { api } from "../api/client";
import type { PairingRequest, Screen, ScreenStatus, User } from "../api/types";
import { useAuth } from "../auth/AuthProvider";
import { FormField } from "../components/FormField";

export const canManageScreens = (user?: User) =>
  user?.role === "owner" || user?.role === "administrator";
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
      <header className="page-heading">
        <div>
          <h2>Screens</h2>
          <p>Pair and monitor Android TV, Google TV, and Fire TV players.</p>
        </div>
        {manageable && (
          <Link className="button button--primary" to="/screens/pair">
            <Plus size={16} /> Pair screen
          </Link>
        )}
      </header>
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
        onDone={() => void navigate("/screens")}
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
  onDone: () => void;
}) {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const form = useForm<ApprovalForm>({
    resolver: zodResolver(approvalSchema),
    defaultValues: {
      name: `${request.metadata.manufacturer} ${request.metadata.model}`,
      location: "",
      description: "",
    },
  });
  const approve = useMutation({
    mutationFn: (values: ApprovalForm) =>
      api.approvePairing(request.id, values, auth.status?.csrfToken ?? ""),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["screens"] });
      onDone();
    },
  });
  const reject = useMutation({
    mutationFn: () =>
      api.rejectPairing(
        request.id,
        "Rejected by administrator",
        auth.status?.csrfToken ?? "",
      ),
    onSuccess: onDone,
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
            disabled={reject.isPending}
          >
            Reject
          </button>
          <button
            type="submit"
            className="button button--primary"
            disabled={approve.isPending}
          >
            {approve.isPending ? "Approving…" : "Approve and pair"}
          </button>
        </div>
      </form>
    </section>
  );
}

export function ScreenDetailPage() {
  const { id = "" } = useParams();
  const auth = useAuth();
  const queryClient = useQueryClient();
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const query = useQuery({
    queryKey: ["screens", id],
    queryFn: () => api.screen(id),
    refetchInterval: 10_000,
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
  if (query.isLoading)
    return <div className="table-loading">Loading screen…</div>;
  if (!query.data)
    return (
      <div className="notice notice--error">Screen could not be loaded.</div>
    );
  const screen = query.data;
  return (
    <div className="screen-detail">
      <header className="page-heading">
        <div>
          <Link className="back-link" to="/screens">
            ← Screens
          </Link>
          <h2>{screen.name}</h2>
          <p>{screen.location || "No location set"}</p>
        </div>
        <StatusLabel status={screen.status} />
      </header>
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
              <dd>{screen.playerVersion}</dd>
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
                Permanently invalidates the device credential. The player must
                pair again.
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
      {confirmRevoke && (
        <div className="modal-backdrop" role="presentation">
          <section
            className="confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="revoke-title"
          >
            <h3 id="revoke-title">Revoke pairing for {screen.name}?</h3>
            <p>
              The player will disconnect immediately and cannot reconnect
              without a new pairing approval.
            </p>
            <div className="form-actions">
              <button
                className="button button--quiet"
                onClick={() => setConfirmRevoke(false)}
              >
                Cancel
              </button>
              <button
                className="button button--danger"
                onClick={() => revoke.mutate()}
              >
                Revoke pairing
              </button>
            </div>
          </section>
        </div>
      )}
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
