import { Radio, Video, WifiOff } from "lucide-react";
import { useEffect, useState } from "react";
import { liveStreamApi, type LiveStreamSession } from "../api/liveStreams";
import { Button, Dialog } from "./ui";
import "./LiveStreamDialog.css";

const LEASE_RENEWAL_MILLIS = 7_000;

export function LiveStreamDialog({
  open,
  screenId,
  screenName,
  csrfToken,
  onClose,
}: {
  open: boolean;
  screenId: string;
  screenName: string;
  csrfToken: string;
  onClose: () => void;
}) {
  const [session, setSession] = useState<LiveStreamSession | null>(null);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let active = true;
    let started: LiveStreamSession | null = null;
    let renewal: number | undefined;

    setSession(null);
    setPlaying(false);
    setError(null);
    void liveStreamApi
      .start(screenId, csrfToken)
      .then((next) => {
        if (!active) {
          void liveStreamApi
            .end(screenId, next.id, csrfToken, true)
            .catch(() => undefined);
          return;
        }
        started = next;
        setSession(next);
        renewal = window.setInterval(() => {
          void liveStreamApi
            .renew(screenId, next.id, csrfToken)
            .then((renewed) => {
              if (active) setSession(renewed);
            })
            .catch((reason) => {
              if (active) {
                setError(
                  reason instanceof Error
                    ? reason.message
                    : "The live stream lease could not be renewed.",
                );
              }
            });
        }, LEASE_RENEWAL_MILLIS);
      })
      .catch((reason) => {
        if (active) {
          setError(
            reason instanceof Error
              ? reason.message
              : "The live stream could not be started.",
          );
        }
      });

    return () => {
      active = false;
      if (renewal !== undefined) window.clearInterval(renewal);
      if (started) {
        void liveStreamApi
          .end(screenId, started.id, csrfToken, true)
          .catch(() => undefined);
      }
    };
  }, [csrfToken, open, screenId]);

  return (
    <Dialog
      open={open}
      title={`Live stream · ${screenName}`}
      onClose={onClose}
      className="live-stream-dialog"
    >
      <div className="live-stream-dialog__viewer">
        {session ? (
          <img
            src={liveStreamApi.mjpegUrl(screenId, session.id)}
            alt={`Live Tilecast output from ${screenName}`}
            onLoad={() => setPlaying(true)}
            onError={() => {
              setPlaying(false);
              setError("The live stream connection ended unexpectedly.");
            }}
          />
        ) : null}
        {!playing && (
          <div className="live-stream-dialog__waiting" aria-live="polite">
            {error ? (
              <>
                <WifiOff size={30} aria-hidden="true" />
                <strong>Stream unavailable</strong>
                <span>{error}</span>
              </>
            ) : (
              <>
                <Video size={30} aria-hidden="true" />
                <strong>Connecting to player…</strong>
                <span>Waiting for the first frame.</span>
              </>
            )}
          </div>
        )}
        {playing && (
          <span className="live-stream-dialog__live">
            <Radio size={13} aria-hidden="true" />
            Live
          </span>
        )}
      </div>
      <div className="live-stream-dialog__details">
        <p>
          Targeting{" "}
          <strong>
            {session
              ? `${Math.round(1_000 / session.frameIntervalMillis)} FPS · ${session.maxWidth}×${session.maxHeight}`
              : "8 FPS · 640×360"}
          </strong>
          . Actual refresh depends on the player and network.
        </p>
        <p>
          This stream is relayed only while this window is open. Frames are
          never saved to snapshots, live preview, Activity, or backups.
        </p>
      </div>
      <footer className="dialog-actions">
        <Button onClick={onClose}>Stop watching</Button>
      </footer>
    </Dialog>
  );
}
