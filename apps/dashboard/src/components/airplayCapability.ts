import type { ReliabilityStatus } from "../api/types";

// Fallback for a player too old to send its own limitation string, and for the
// group case where several displays fail for different reasons.
export function missingAirplayComponents(blocked: ReliabilityStatus[]) {
  const missing = [
    [
      "UxPlay",
      blocked.some((item) => item.airplayUxPlayInstalled === false),
    ] as const,
    [
      "GStreamer",
      blocked.some((item) => item.airplayGstreamerInstalled === false),
    ] as const,
    [
      "an H.264 decoder",
      blocked.some((item) => item.airplayH264DecoderAvailable === false),
    ] as const,
    [
      "Avahi/Bonjour",
      blocked.some((item) => item.airplayAvahiAvailable === false),
    ] as const,
  ]
    .filter(([, absent]) => absent)
    .map(([name]) => name);
  if (missing.length === 0)
    return "Run the server's /install-airplay.sh installer as root to provision UxPlay, GStreamer, an H.264 decoder, and Avahi.";
  const list =
    missing.length === 1
      ? missing[0]
      : `${missing.slice(0, -1).join(", ")} and ${missing[missing.length - 1]}`;
  return `Missing ${list}. Run the server's /install-airplay.sh installer as root.`;
}

export function airplayCapabilityBlockDetail(blocked: ReliabilityStatus[]) {
  const limitations = blocked
    .map((item) => item.airplayLimitation?.trim())
    .filter((value): value is string => Boolean(value));
  if (
    limitations.length === blocked.length &&
    limitations.every((value) => value === limitations[0])
  ) {
    return limitations[0];
  }
  return missingAirplayComponents(blocked);
}
