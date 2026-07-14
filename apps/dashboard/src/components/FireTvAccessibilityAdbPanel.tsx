import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api/client";

const ACCESSIBILITY_COMPONENT =
  "org.tilecast.player/org.tilecast.player.reliability.TilecastAccessibilityService";

const ADB_COMMAND = `adb shell 'component="${ACCESSIBILITY_COMPONENT}"; current=$(settings get secure enabled_accessibility_services); [ "$current" = "null" ] && current=""; case ":$current:" in *":$component:"*) ;; *) current="${current:+$current:}$component" ;; esac; settings put secure enabled_accessibility_services "$current"; settings put secure accessibility_enabled 1'`;

export function FireTvAccessibilityAdbPanel({
  screenId,
}: {
  screenId: string;
}) {
  const [showCommand, setShowCommand] = useState(false);
  const screen = useQuery({
    queryKey: ["screens", screenId],
    queryFn: () => api.screen(screenId),
  });

  const isFireTv =
    screen.data?.platform === "fire-tv" ||
    screen.data?.deviceManufacturer.toLowerCase() === "amazon";
  if (!isFireTv) return null;

  return (
    <section className="detail-card" aria-labelledby="fire-tv-accessibility-title">
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
        onClick={() => setShowCommand((shown) => !shown)}
      >
        {showCommand ? "Hide ADB command" : "Show ADB command"}
      </button>
      {showCommand && (
        <div>
          <pre>
            <code>{ADB_COMMAND}</code>
          </pre>
          <button
            type="button"
            className="button button--quiet"
            onClick={() => void navigator.clipboard.writeText(ADB_COMMAND)}
          >
            Copy command
          </button>
          <p>
            First enable ADB debugging on the Fire TV and connect with{" "}
            <code>adb connect FIRE_TV_IP</code>. Run the command, reopen Tilecast
            Player, and choose Verify again. The command preserves other enabled
            accessibility services.
          </p>
        </div>
      )}
    </section>
  );
}
