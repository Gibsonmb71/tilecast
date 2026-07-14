# Troubleshooting pairing

## Reliability and power

- **Zero-Touch Readiness says Needs setup or Partially ready:** inspect every safeguard on the screen’s Reliability tab. Accessibility and install permission require local Android approval. Boot launch is confirmed only after a real boot and healthy foreground return. Cached fallback requires fully prepared downloadable content. Use **Run setup again** in the local maintenance menu without deleting pairing.
- **A canary update paused:** review the safe rollout reason. Tilecast pauses for explicit failure, safe mode, or a missed reconnect; it does not continue to held screens automatically after a bad canary.

- **Managed Kiosk remains Standard:** the policy is requested but Android has not confirmed device-owner permission and active lock task. Provision locally on compatible firmware.
- **Tilecast does not launch after boot:** consumer firmware may block foreground launch. Open Tilecast once, remove vendor battery restrictions, and record `foreground_launch_blocked` in Studio; cached content remains available when launched.
- **TV did not turn off or wake:** Power Assist asks Android to sleep/wake. Enable the device and TV HDMI-CEC options, test sleep and wake separately, and store the observed physical result. Tilecast does not send raw CEC.
- **Accessibility keeps returning from Settings:** Settings and installers are excluded by default. End the loop with the maintenance sequence and verify the locally configured package allowlist.
- **Recovery screen is shown:** the bounded watchdog entered safe mode. Inspect the diagnostic code and storage, then issue Retry recovery or Exit safe mode. Tilecast does not automatically delete cache, manifests, or pairing.

- **No server appears:** use manual entry, confirm the TV and server share a network, and check multicast or client-isolation rules.
- **Public HTTP is rejected:** use HTTPS. HTTP is permitted only for private IPv4, link-local, localhost, and `.local` addresses after a visible warning.
- **Code expired:** request a new code on the TV; pairing sessions last ten minutes.
- **Identity changed:** confirm the address points to the intended installation, then reset the saved connection. Tilecast will not send the old credential to a different installation ID.
- **Screen is disabled:** enable it in Screens. Pairing remains intact.
- **Pairing revoked:** choose Pair again on the TV and approve a new request.
- **Pairing recovery required:** the player installation matches an existing screen with an active credential. Review the existing screen name and select **Repair and replace credential**. The old credential remains valid until this player successfully enrolls, and all content relationships stay on the original screen record.
- **Unsupported request field:** update Studio and Player together. Strict JSON errors now name the mismatched field; pairing and enrollment request bodies are never written to logs.
- **Tunnel connection fails:** enter the public HTTPS hostname manually and verify the Tunnel routes to `http://server:8080`.

## Media

- **Readiness reports media infrastructure unavailable:** confirm `/data/media` is writable by the Tilecast runtime user and that the configured FFmpeg and FFprobe paths are executable.
- **Upload offset mismatch:** use `HEAD /api/v1/uploads/{id}` and resume from the returned `Upload-Offset`; do not restart from a client-cached offset.
- **Insufficient storage:** free space or reduce the upload. Tilecast reserves `TILECAST_MEDIA_RESERVED_FREE_BYTES` after accounting for the declared upload size.
- **Processing failed:** inspect server logs using the request/job identifier. Studio receives only a safe error message, never raw FFmpeg output. Use Retry after correcting missing executables or storage permissions.
- **Variant unavailable:** the asset must be ready, the variant must be player-compatible, and the underlying file must still exist. Restore both database and media volume from the same backup point.

## Player synchronization and playback

- **Manifest remains out of date:** confirm the socket is connected, then allow the five-minute reconciliation fallback.
- **Insufficient player storage:** Automatic videos fall back to streaming, but explicit Download items prevent activation when the cache limit or free-space reserve is exceeded. The previous manifest keeps playing.
- **Download restarts:** the ETag, size, or hash changed; Tilecast safely discards the incompatible partial file.
- **Content is online-only:** Stream items require the server. Use Download, or Automatic for images and suitably sized videos.
- **No playable content:** every item failed or was unavailable. Tilecast waits before retrying instead of remaining black or entering a tight loop.

## A schedule changes at the wrong time

Check the schedule's IANA timezone and the player clock warning in screen details. Tilecast Player intentionally uses its device clock while offline; it reports server-time skew but does not silently shift evaluation. Confirm automatic date/time and timezone are enabled on the TV. Around daylight-saving changes, nonexistent local times advance to the first valid time after the gap, while repeated times use the earlier start occurrence and later end occurrence.

If a future one-time event was created after the player lost connectivity, it cannot activate until the player receives a new manifest. Weekly rules already present in the active manifest continue recurring offline when their Download-policy assets remain cached.

## A website is unavailable or blocked

Open the website asset for safe player diagnostics. Confirm the TV can resolve and reach the origin, its clock is correct for TLS, and redirects remain on an explicitly allowed host. Tilecast never bypasses certificate errors. Add a related redirect host only when it is trusted and intentional; wildcards are unsupported.

Website pages are not offline-capable. Configure a ready fallback image for predictable offline presentation, or use the Tilecast placeholder/skip behavior. Do not rely on incidental WebView cache. On persistent site-state problems, an Owner or Administrator can clear website data from screen details; the command requires the player to reconnect before its ten-minute expiry.

For stale player policy, compare the effective configuration revision with the active revision reported by the player, then request configuration reconciliation from Settings → System. Invalid configuration preserves the previous valid revision and reports a safe error.

## A Player update is unavailable or waiting

Confirm the release is published rather than draft and contains the three exact asset names. Check the trusted manifest public key, GitHub rate-limit status, `/data/updates` free space, and that the version code exceeds the installed player. Verification failures are intentionally undeployable.

If GitHub reports an API rate limit, open Settings → Player Updates and connect a GitHub account. If **Connect GitHub** is disabled, configure `TILECAST_GITHUB_CLIENT_ID` with a device-flow-enabled OAuth App client ID and restart Tilecast Server. An environment-managed `TILECAST_GITHUB_TOKEN` also authenticates requests. Tilecast requests no private-repository scope for the fixed public release source.

`Waiting for permission` requires enabling unknown-app installation for Tilecast Player. `Waiting for user` requires approving Android or Fire OS. Emergency playback delays installation. Interrupted downloads resume from `.part`. A certificate mismatch means the installed app and release use different Android keys and cannot update in place.

`Installed certificate mismatch` means the Player currently on the TV was signed with a different Android key than the verified release, commonly because a debug APK was installed during setup. Android cannot replace it in place. Uninstall that Player once, install the production-signed `tilecast-player.apk`, and pair the screen again. Preserve the same production keystore for every later release.
