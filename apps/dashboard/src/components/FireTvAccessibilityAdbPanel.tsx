import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api } from "../api/client";

const ACCESSIBILITY_COMPONENT =
  "org.tilecast.player/org.tilecast.player.reliability.TilecastAccessibilityService";

export const fireTvAccessibilityCommands = (address?: string) => {
  const target = address
    ? address.includes(":")
      ? `[${address}]:5555`
      : `${address}:5555`
    : "FIRE_TV_IP:5555";
  const enable = `adb shell 'component="${ACCESSIBILITY_COMPONENT}"; current=$(settings get secure enabled_accessibility_services); [ "$current" = "null" ] && current=""; case ":$current:" in *":$component:"*) ;; *) current="\${current:+$current:}$component" ;; esac; settings put secure enabled_accessibility_services "$current"; settings put secure accessibility_enabled 1'`;
  return {
    connect: `adb connect ${target}`,
    enable,
    combined: `adb connect ${target}
${enable}`,
  };
};

export function FireTvAccessibilityAdbPanel({
  screenId,
}: {
  screenId: string;
}) {
  const [showCommand, setShowCommand] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">(
    "idle",
  );
  const screen = useQuery({
    queryKey: ["screens", screenId],
    queryFn: () => api.screen(screenId),
  });

  const isFireTv =
    screen.data?.platform === "fire-tv" ||
    screen.data?.deviceManufacturer.toLowerCase() === "amazon";
  const commands = useMemo(
    () => fireTvAccessibilityCommands(screen.data?.lastKnownIp),
    [screen.data?.lastKnownIp],
  );
  if (!isFireTv) return null;

  const copyCommands = async () => {
    try {
      await navigator.clipboard.writeText(commands.combined);
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 2_000);
    } catch {
      setCopyState("error");
    }
  };

  return (
    <section
      className="detail-card"
      aria-labelledby="fire-tv-accessibility-title"
    >
      <h3 id="fire-tv-accessibility-title">
        Optional Fire TV Accessibility Control
      </h3>
      <p>
        Fire OS does not expose Tilecast in its normal Accessibility menu.
        Commissioning can continue without this feature, or an administrator can
        enable Tilecast’s accessibility service manually through ADB.
      </p>
      <button
        type="button"
        className="button button--quiet"
        onClick={() => {
          setShowCommand((shown) => !shown);
          setCopyState("idle");
        }}
      >
        {showCommand ? "Hide ADB commands" : "Show ADB commands"}
      </button>
      {showCommand && (
        <div>
          <p>
            Enable ADB debugging on the Fire TV first. These commands use the
            player’s last reported address when available.
          </p>
          <pre>
            <code>{commands.combined}</code>
          </pre>
          <button
            type="button"
            className="button button--quiet"
            onClick={() => void copyCommands()}
          >
            {copyState === "copied" ? "Copied" : "Copy commands"}
          </button>
          <span role="status" aria-live="polite">
            {copyState === "error"
              ? " Clipboard access failed. Select and copy the commands manually."
              : copyState === "copied"
                ? " Commands copied."
                : ""}
          </span>
          <p>
            Run both commands, reopen Tilecast Player, and choose Verify again.
            The enable command preserves other accessibility services.
          </p>
        </div>
      )}
    </section>
  );
}
