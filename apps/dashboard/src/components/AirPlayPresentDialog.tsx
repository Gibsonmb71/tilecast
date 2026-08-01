import { useMutation, useQuery } from "@tanstack/react-query";
import { Airplay, Radio, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import type { AirplaySession, ReliabilityStatus } from "../api/types";
import { Button, Dialog, Field, Select } from "./ui";
import "./AirPlayPresentDialog.css";

function countdown(expiresAt: string, now: number) {
  const remaining = Math.max(0, Date.parse(expiresAt) - now);
  const totalMinutes = Math.floor(remaining / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const seconds = Math.floor((remaining % 60_000) / 1_000);
  return hours > 0
    ? `${hours}h ${String(minutes).padStart(2, "0")}m`
    : `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

function sessionStatus(session: AirplaySession) {
  if (session.status === "active" || session.connectedCount > 0)
    return `Presenting · ${session.connectedCount}/${session.screenCount} displays receiving`;
  if (session.status === "failed" || session.failedCount > 0)
    return "AirPlay could not prepare every display";
  if (session.status === "ended" || session.status === "expired")
    return session.status === "expired" ? "AirPlay expired" : "AirPlay stopped";
  return `Preparing · ${session.readyCount}/${session.screenCount} displays ready`;
}

export function AirPlayPresentDialog({
  open,
  targetType,
  targetId,
  destinationName,
  displayCount,
  csrfToken,
  capability,
  capabilities,
  audioDisplayName,
  onClose,
}: {
  open: boolean;
  targetType: "screen" | "group";
  targetId: string;
  destinationName: string;
  displayCount: number;
  csrfToken: string;
  capability?: ReliabilityStatus;
  capabilities?: ReliabilityStatus[];
  audioDisplayName?: string;
  onClose: () => void;
}) {
  const [durationMinutes, setDurationMinutes] = useState<0 | 15 | 30 | 60>(30);
  const [transport, setTransport] = useState<"auto" | "unicast" | "multicast">(
    "auto",
  );
  const [audioMode, setAudioMode] = useState<"gateway_only" | "none">(
    "gateway_only",
  );
  const [session, setSession] = useState<AirplaySession | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!open) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [open]);

  const create = useMutation({
    mutationFn: () =>
      api.createAirplaySession(
        { targetType, targetId, durationMinutes, transport, audioMode },
        csrfToken,
      ),
    onSuccess: setSession,
  });
  const current = useQuery({
    queryKey: ["airplay-session", session?.id],
    queryFn: () => api.airplaySession(session!.id),
    enabled: Boolean(open && session?.id),
    refetchInterval: (query) => {
      const value = query.state.data as AirplaySession | undefined;
      return value && ["ended", "expired", "failed"].includes(value.status)
        ? false
        : 2_000;
    },
  });
  const stop = useMutation({
    mutationFn: () => api.stopAirplaySession(session!.id, csrfToken),
    onSuccess: setSession,
  });
  useEffect(() => {
    if (!open) setSession(null);
  }, [open, targetId]);
  const live = current.data ?? session;
  const allCapabilities = capabilities ?? (capability ? [capability] : []);
  const capabilitiesComplete =
    displayCount > 0 && allCapabilities.length === displayCount;
  const groupReady =
    targetType !== "group" && displayCount === 1
      ? true
      : allCapabilities.every((item) => item.airplayGroupSupported === true);
  const capabilityText = useMemo(() => {
    if (displayCount === 0) return "Add at least one display to this target.";
    if (!capabilitiesComplete) {
      const remaining = Math.max(1, displayCount - allCapabilities.length);
      return `Waiting for ${remaining} display${remaining === 1 ? "" : "s"} to report AirPlay capabilities.`;
    }
    const unsupported = allCapabilities.filter((item) =>
      targetType === "group"
        ? item.airplayGroupSupported === false
        : item.airplaySupported === false,
    ).length;
    if (unsupported > 0)
      return `${unsupported} display${unsupported === 1 ? " is" : "s are"} not AirPlay-ready. Provision UxPlay, GStreamer, and an H.264 decoder first.`;
    if (targetType === "group" && groupReady === false) {
      return "One or more displays has not verified the GStreamer RTP receiver path.";
    }
    if (
      targetType !== "group" &&
      allCapabilities.some((item) => item.airplaySupported !== true)
    )
      return "Waiting for a complete AirPlay capability report.";
    const hardware1080 = allCapabilities.every(
      (item) =>
        item.airplayHardwareDecode && item.airplayMaxProfile === "1080p30",
    );
    const h264Ready = allCapabilities.every(
      (item) =>
        item.airplayMaxProfile === "1080p30" ||
        item.airplayMaxProfile === "720p30",
    );
    if (hardware1080)
      return `All ${allCapabilities.length} displays hardware-ready · common profile 1080p30 H.264`;
    if (h264Ready)
      return `Common profile 720p30 H.264 · at least one display is software-only`;
    return "Capability profile is still being reported.";
  }, [
    allCapabilities,
    capabilitiesComplete,
    displayCount,
    groupReady,
    targetType,
  ]);
  const anyUnsupported = allCapabilities.some((item) =>
    targetType === "group"
      ? item.airplayGroupSupported === false
      : item.airplaySupported === false,
  );
  const profileReady = allCapabilities.every(
    (item) =>
      item.airplayMaxProfile === "1080p30" ||
      item.airplayMaxProfile === "720p30",
  );
  const canEnable =
    capabilitiesComplete &&
    !anyUnsupported &&
    (targetType === "group"
      ? allCapabilities.every((item) => item.airplayGroupSupported === true)
      : allCapabilities.every((item) => item.airplaySupported === true)) &&
    profileReady &&
    groupReady;

  return (
    <Dialog
      open={open}
      title={`Present with AirPlay · ${destinationName}`}
      onClose={onClose}
      className="airplay-present-dialog"
    >
      {!live ? (
        <>
          <div className="airplay-present-dialog__intro">
            <Airplay size={28} aria-hidden="true" />
            <div>
              <strong>{destinationName}</strong>
              <span>
                {displayCount} display{displayCount === 1 ? "" : "s"} ·
                temporary external presentation
              </span>
            </div>
          </div>
          <div className="airplay-present-dialog__readiness">
            <ShieldCheck size={17} aria-hidden="true" />
            <span>{capabilityText}</span>
          </div>
          {capability?.externalPresentationState &&
            capability.externalPresentationState !== "none" && (
              <div className="notice notice--warning">
                An AirPlay presentation is already reported on this screen. Stop
                it before starting another.
              </div>
            )}
          <div className="airplay-present-dialog__fields">
            <Field label="Duration">
              <Select
                value={durationMinutes}
                onChange={(event) =>
                  setDurationMinutes(
                    Number(event.target.value) as 0 | 15 | 30 | 60,
                  )
                }
              >
                <option value={15}>15 minutes</option>
                <option value={30}>30 minutes</option>
                <option value={60}>1 hour</option>
                <option value={0}>
                  Until stopped (24-hour safety deadline)
                </option>
              </Select>
            </Field>
            <Field
              label="Video transport"
              description="Auto uses unicast for 1–4 displays and multicast only when validated."
            >
              <Select
                value={transport}
                onChange={(event) =>
                  setTransport(event.target.value as typeof transport)
                }
              >
                <option value="auto">Auto</option>
                <option value="unicast">Unicast fan-out</option>
                <option value="multicast">
                  Multicast (falls back to unicast)
                </option>
              </Select>
            </Field>
            <Field
              label="Audio display"
              description={
                audioDisplayName
                  ? `Primary audio: ${audioDisplayName}`
                  : "Primary audio uses the selected or automatically chosen gateway."
              }
            >
              <Select
                value={audioMode}
                onChange={(event) =>
                  setAudioMode(event.target.value as typeof audioMode)
                }
              >
                <option value="gateway_only">
                  Gateway / primary display only
                </option>
                <option value="none">No AirPlay audio</option>
              </Select>
            </Field>
          </div>
          {create.error && (
            <div className="notice notice--error">{create.error.message}</div>
          )}
          <footer className="dialog-actions">
            <Button onClick={onClose}>Cancel</Button>
            <Button
              variant="primary"
              loading={create.isPending}
              disabled={!canEnable}
              onClick={() => create.mutate()}
            >
              Enable AirPlay
            </Button>
          </footer>
        </>
      ) : (
        <>
          <div
            className={`airplay-present-dialog__status airplay-present-dialog__status--${live.status}`}
          >
            <Radio size={18} aria-hidden="true" />
            <strong>{sessionStatus(live)}</strong>
          </div>
          <div className="airplay-present-dialog__pin-card">
            <span>AirPlay receiver</span>
            <strong>{live.receiverName}</strong>
            <small>PIN</small>
            <code>{live.pin ?? "----"}</code>
            <p>
              On iPhone, iPad, or Mac, open Screen Mirroring / AirPlay and
              choose this receiver.
            </p>
          </div>
          <dl className="airplay-present-dialog__summary">
            <div>
              <dt>Profile</dt>
              <dd>{live.videoProfile} H.264</dd>
            </div>
            <div>
              <dt>Transport</dt>
              <dd>{live.transport}</dd>
            </div>
            <div>
              <dt>Audio</dt>
              <dd>
                {live.audioMode === "none"
                  ? "None"
                  : `${audioDisplayName ?? "Gateway / primary display"} only`}
              </dd>
            </div>
            <div>
              <dt>Expires in</dt>
              <dd>{countdown(live.expiresAt, now)}</dd>
            </div>
          </dl>
          <div className="airplay-present-dialog__states">
            {live.screens.map((screen) => (
              <span
                key={screen.screenId}
                className={`airplay-screen-state airplay-screen-state--${screen.state}`}
              >
                {screen.screenName}: {screen.state.replaceAll("_", " ")}
              </span>
            ))}
          </div>
          {stop.error && (
            <div className="notice notice--error">{stop.error.message}</div>
          )}
          <footer className="dialog-actions">
            <Button onClick={onClose}>Close</Button>
            <Button
              variant="danger"
              loading={stop.isPending}
              disabled={["ended", "expired", "failed"].includes(live.status)}
              onClick={() => stop.mutate()}
            >
              Stop AirPlay
            </Button>
          </footer>
        </>
      )}
    </Dialog>
  );
}
