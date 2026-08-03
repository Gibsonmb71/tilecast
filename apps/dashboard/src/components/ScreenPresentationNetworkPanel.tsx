import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Wifi, WifiOff } from "lucide-react";
import { api } from "../api/client";
import type { PresentationNetworkReadiness, Screen } from "../api/types";
import { Button, Field, Select } from "./ui";

function statusLabel(status: PresentationNetworkReadiness["status"]) {
  switch (status) {
    case "ready":
      return "Presentation Network ready";
    case "connected":
      return "Connected for AirPlay";
    case "unassigned":
      return "No Presentation Network assigned";
    case "wifi_adapter_unavailable":
      return "Wi-Fi adapter unavailable";
    case "network_manager_unavailable":
      return "NetworkManager unavailable";
    case "helper_missing":
      return "Network helper unavailable";
    case "helper_unhealthy":
      return "Network helper unhealthy";
    case "configuration_pending":
      return "Configuration pending";
    case "reporting_pending":
      return "Waiting for player status";
    case "failed":
      return "Last connection failed";
    case "unsupported":
      return "Presentation Network unsupported";
    default:
      return "Presentation Network not applicable";
  }
}

function statusTone(status: PresentationNetworkReadiness["status"]) {
  if (status === "ready" || status === "connected") return "online";
  if (status === "failed" || status === "unsupported") return "offline";
  if (status === "unassigned") return "unknown";
  return "recent";
}

export function ScreenPresentationNetworkPanel({
  screen,
  canManage,
  csrfToken,
}: {
  screen: Screen;
  canManage: boolean;
  csrfToken: string;
}) {
  const client = useQueryClient();
  const linux = screen.platform.trim().toLowerCase() === "linux";
  const readiness = useQuery({
    queryKey: ["screens", screen.id, "presentation-network"],
    queryFn: () => api.screenPresentationNetwork(screen.id),
    enabled: linux,
    refetchInterval: linux ? 10_000 : false,
  });
  const networks = useQuery({
    queryKey: ["presentation-networks"],
    queryFn: api.presentationNetworks,
    enabled: linux && canManage,
  });
  const [selected, setSelected] = useState("");
  const [notice, setNotice] = useState<string>();

  useEffect(() => {
    setSelected(readiness.data?.presentationNetworkId ?? "");
  }, [readiness.data?.presentationNetworkId]);

  const assignment = useMutation({
    mutationFn: () =>
      selected
        ? api.assignScreenPresentationNetwork(screen.id, selected, csrfToken)
        : api.unassignScreenPresentationNetwork(screen.id, csrfToken),
    onSuccess: async () => {
      setNotice(
        selected
          ? "Presentation Network assignment saved."
          : "Presentation Network unassigned.",
      );
      await client.invalidateQueries({
        queryKey: ["screens", screen.id, "presentation-network"],
      });
      await client.invalidateQueries({ queryKey: ["presentation-networks"] });
      await client.invalidateQueries({ queryKey: ["screens"] });
    },
  });
  const test = useMutation({
    mutationFn: () => {
      const networkId = readiness.data?.presentationNetworkId;
      if (!networkId) throw new Error("Assign a Presentation Network first.");
      return api.testPresentationNetwork(networkId, screen.id, csrfToken);
    },
    onSuccess: (result) => {
      setNotice(
        `Connection test requested. The player will report the result within ${result.timeoutSeconds} seconds.`,
      );
      void client.invalidateQueries({
        queryKey: ["screens", screen.id, "commands"],
      });
    },
  });

  const assignedNetwork = useMemo(
    () =>
      networks.data?.items.find(
        (network) => network.id === readiness.data?.presentationNetworkId,
      ),
    [networks.data, readiness.data?.presentationNetworkId],
  );

  if (!linux) return null;

  const data = readiness.data;
  const disabled = !canManage || assignment.isPending;
  return (
    <section
      className="readiness-panel screen-presentation-network-panel"
      aria-labelledby="presentation-network-readiness-heading"
    >
      <div className="readiness-panel__heading">
        <div>
          <h4 id="presentation-network-readiness-heading">
            Presentation Network
          </h4>
          <p>
            Temporary Wi-Fi is used only by this Linux player when it is the
            AirPlay gateway. Group followers remain on Ethernet.
          </p>
        </div>
        <span
          className={`status-badge status-badge--${statusTone(data?.status ?? "reporting_pending")}`}
        >
          {statusLabel(data?.status ?? "reporting_pending")}
        </span>
      </div>
      {readiness.isLoading ? (
        <div className="table-loading">
          Loading Presentation Network status…
        </div>
      ) : readiness.error ? (
        <div className="notice notice--error" role="alert">
          Could not load Presentation Network status. {readiness.error.message}
        </div>
      ) : (
        <>
          <dl className="detail-list">
            <div>
              <dt>Assigned network</dt>
              <dd>
                {data?.presentationNetworkName ?? "None"}
                {assignedNetwork && !assignedNetwork.credentialSet
                  ? " · credential missing"
                  : ""}
              </dd>
            </div>
            <div>
              <dt>Player status</dt>
              <dd>{data?.detail ?? "Waiting for player status."}</dd>
            </div>
            <div>
              <dt>Wi-Fi adapter</dt>
              <dd>
                {data?.wifiAdapterPresent == null
                  ? "Not reported"
                  : data.wifiAdapterPresent
                    ? "Available"
                    : "Unavailable"}
              </dd>
            </div>
            <div>
              <dt>Ethernet IPv4</dt>
              <dd>
                {data?.wiredIpv4
                  ? `${data.wiredIpv4}${data.wiredInterfaceAvailable === false ? " · interface unavailable" : ""}`
                  : data?.wiredInterfaceAvailable === false
                    ? "Unavailable"
                    : "Not reported"}
              </dd>
            </div>
          </dl>
          {data?.limitation && (
            <p className="field__hint">
              Capability limitation: {data.limitation}
            </p>
          )}
        </>
      )}
      {canManage && (
        <div className="screen-presentation-network-panel__controls">
          <Field
            label="Assigned Presentation Network"
            description="Assignment is durable; the player joins Wi-Fi only for an AirPlay gateway session."
          >
            <Select
              value={selected}
              disabled={networks.isLoading || assignment.isPending}
              onChange={(event) => setSelected(event.target.value)}
            >
              <option value="">No Presentation Network</option>
              {(networks.data?.items ?? []).map((network) => (
                <option key={network.id} value={network.id}>
                  {network.name} · {network.ssid}
                </option>
              ))}
            </Select>
          </Field>
          <div className="screen-presentation-network-panel__actions">
            <Button
              variant="primary"
              disabled={
                disabled || selected === (data?.presentationNetworkId ?? "")
              }
              loading={assignment.isPending}
              onClick={() => {
                setNotice(undefined);
                assignment.mutate();
              }}
            >
              Save assignment
            </Button>
            {data?.presentationNetworkId && (
              <Button
                compact
                disabled={test.isPending || data.status === "connected"}
                loading={test.isPending}
                onClick={() => {
                  setNotice(undefined);
                  test.mutate();
                }}
              >
                Test connection
              </Button>
            )}
          </div>
        </div>
      )}
      {notice && <div className="notice notice--info">{notice}</div>}
      {(assignment.error || test.error) && (
        <div className="notice notice--error" role="alert">
          {(assignment.error ?? test.error)?.message}
        </div>
      )}
      {!canManage && (
        <p className="field__hint">
          An Owner or Administrator can change this assignment.
        </p>
      )}
      {data?.status === "unassigned" && (
        <p className="field__hint">
          <WifiOff size={14} aria-hidden="true" /> AirPlay remains Ethernet-only
          until a network is assigned.
        </p>
      )}
      {(data?.status === "ready" || data?.status === "connected") && (
        <p className="field__hint">
          <Wifi size={14} aria-hidden="true" /> Ethernet remains the default
          Tilecast route.
        </p>
      )}
    </section>
  );
}
