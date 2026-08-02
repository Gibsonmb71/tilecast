# AirPlay Present

AirPlay Present temporarily makes a supported Linux Tilecast screen—or an
entire Tilecast screen group—an AirPlay destination. It is an external
presentation capability, not a playlist item and not a ManifestPlugin. When
the session ends, the Linux player evaluates the current manifest, schedule,
takeover, active-hours, and disabled state before returning to signage.

The supported UxPlay baseline is 1.73.6. Tilecast uses UxPlay's RTP forwarding
mode for groups so the gateway forwards decrypted, compressed H.264 packets;
the gateway never renders, captures, decodes, or re-encodes the mirrored
stream. See the [UxPlay project](https://github.com/FDH2/UxPlay) for the
upstream receiver and option reference.

## Hardware profile

The feature targets the old Debian/Linux Electron signage machines: Celeron
class CPU, 4 GB RAM, Intel integrated graphics, and a 1080p HDMI display.

- H.264 only, capped at 1920×1080 and 30 fps.
- Decoder preference is `vah264dec`, `vaapih264dec`, then `avdec_h264`.
- A hardware decoder allows the `1080p30` profile. Software-only players are
  reported as limited and use `720p30` for group sessions.
- H.265, AV1, VP9, 4K, 60 fps, Electron screen capture, and software
  redistribution encoding are not part of this feature.

## Dependencies and provisioning

AirPlay support is provisioned by default by the player installer
(`curl -fsSL https://your-server/install.sh | sudo bash`). To add it to a
machine that already runs the player, the server publishes the same script on
its own:

```sh
curl -fsSL https://your-server/install-airplay.sh | sudo bash
```

Either path installs or validates:

- UxPlay 1.73.6
- GStreamer tools and base/good/bad/libav/VA-API plugins, including
  `fpsdisplaysink` for packet-derived receiver health/FPS reporting
- VA-API userspace and `vainfo`
- Avahi daemon and `avahi-browse`
- UxPlay build dependencies when the distro package is not exactly 1.73.6

The script never clones a repository or contacts GitHub or another source-code
host. Tilecast Server embeds the upstream UxPlay v1.73.6 source archive (tag
commit `21eef8df25d91e12635c36d8176ad192725baca2`) and serves it at
`/api/v1/install/airplay/uxplay`. The installer obtains the published checksum
from `/api/v1/install/airplay/uxplay.sha256`, requires it to match Tilecast's
pinned SHA-256
`3a1a754bc7ed4b0f72b6237aa4d769238b9c20a71b651bc3fe9ac679e2a67f18`,
verifies the downloaded archive again, and only then extracts and builds it.
The signage player therefore needs network access only to Tilecast Server and
the configured Debian/APT mirrors. As with the Linux Player AppImage, this
provisioning path currently supports x86_64 machines.

The script does not create a permanent AirPlay advertisement, a kiosk-user
sudo rule, or a second player service. Normal UxPlay/GStreamer processes are
spawned by Electron as the existing unprivileged kiosk user.

## Network contract

The fixed firewall contract is:

| Purpose                       | Ports               |
| ----------------------------- | ------------------- |
| UxPlay AirPlay control/media  | TCP+UDP 37000–37002 |
| Tilecast compressed video RTP | UDP 42000           |
| Reserved future audio RTP     | UDP 42002           |
| Bonjour/mDNS                  | UDP 5353            |

Tilecast only asks UxPlay to listen/advertise while a session is enabled. The
group video range is `239.255.42.x` when multicast is selected. Unicast
`multiudpsink` is the default for 1–4 screens. Auto selection may use multicast
for larger groups only when every participating player reports support; a
multicast failure falls back to unicast.

AirPlay discovery requires Bonjour/mDNS between the sender and gateway. If
Wi-Fi clients and signage players are on separate VLANs, the network may need
an mDNS/Bonjour gateway or reflector. Tilecast does not attempt to route
district VLANs.

## Single-screen flow

1. Studio requests a temporary session and the server verifies the current
   screen is online, Linux, and AirPlay-capable.
2. The server creates a transient session, chooses a profile, generates a new
   four-digit PIN and a new locally administered UxPlay identity, and queues a
   persistent `prepare_airplay_session` command.
3. The player suspends normal signage and renders a Tilecast ready page with
   the clean receiver name, PIN, instructions, and deadline.
4. UxPlay advertises the configured screen name without appending the Linux
   hostname. It renders the single-screen session directly with H.264 decode.
5. Sender disconnect returns to the ready page while AirPlay remains enabled.
   Stop, expiration, emergency takeover, or a fatal gateway failure stops
   UxPlay and evaluates the current signage state.

## Group flow

1. The server snapshots current group membership, verifies every display, and
   chooses the preferred gateway or the deterministic capability-ranked
   gateway.
2. The common profile is the weakest member: all hardware-capable members use
   `1080p30`; any software-only member selects `720p30`.
3. Every display prepares a GStreamer receiver before the gateway advertises.
   The gateway's own display also receives its forwarded RTP stream, so all
   displays use the same transport path.
4. UxPlay runs with `-vs 0 -vrtp ...` on the gateway. RTP/H.264 remains
   compressed through fan-out. Each display runs the equivalent of
   `udpsrc → rtpjitterbuffer → rtph264depay → h264parse → H.264 decoder →
fullscreen sink`; when available, the sink is VA-API `vaapisink
fullscreen=true`, with `autovideosink` as the compatibility fallback.
5. Group audio defaults to the gateway/primary display only. No frame-perfect
   synchronization is claimed; the small jitter buffer aims for a few frames
   of alignment.

Group activation is all-or-nothing during preparation. A failed member causes
the session to fail and all prepared processes are stopped. A follower that
fails after activation receives bounded receiver restarts and is reported as
degraded; a gateway failure ends the room session.

## Priority, expiry, and recovery

The runtime priority is:

1. emergency takeover
2. AirPlay Present
3. normal Tilecast scheduling
4. outside-hours sleep

An emergency takeover affecting one member ends the complete group session.
Normal manifest and schedule changes continue to sync while AirPlay is active;
the player never restores a stale content snapshot.

Every session has an absolute `expiresAt`, enforced both by the server and by
the Linux process manager. The player persists only the active session
configuration in an owner-only `airplay-session.json`. An unexpired session is
reconstructed after player restart; an expired one is deleted and signage is
evaluated.

The server clears PIN/device identity fields and the prepare-command payload
when a session ends. PINs are not included in audit metadata. The player
generates a fresh PIN and fresh locally administered identity for every new
session, so an Apple device trusted in one session does not inherit trust into
the next one.

## Capability and privacy behavior

The Linux probe reports UxPlay version, GStreamer/H.264 decoder, VA-API
hardware availability, maximum profile, group/audio readiness, Avahi/mDNS
status, and multicast test status. These fields are included in heartbeat and
screen reliability status. A support test is available through the persistent
`test_airplay_support` command.

The probe also reports a one-sentence `airplayLimitation` naming the dependency
that failed and what to run, in provisioning order: UxPlay missing, UxPlay older
than the baseline (with the version it found), GStreamer missing, no supported
H.264 decoder, Avahi missing, then the VA-API/hardware-decode quality notes.
Studio shows it verbatim in Present · AirPlay, so an operator sees which of the
five dependencies to fix rather than a generic "not AirPlay-ready". It is
cleared as soon as a capability report arrives without one.

AirPlay frames are never sent through Tilecast live-preview or snapshot
capture. While an external presentation is active, Studio shows external
presentation state instead of uploading mirrored-device frames.

## Manual test procedure for 2012-era Celeron boxes

Perform on a representative wired and wireless machine before rollout:

1. Run the provisioning script and capture `uxplay -v`, `vainfo`, and
   the three decoder probes.
2. Present from an iPhone, iPad, and Mac. Test the four-digit PIN, incorrect
   PIN, receiver picker name, 1080p30, audio, portrait rotation, reconnect,
   sender disconnect, manual stop, and expiration while mirroring.
3. Repeat with a two-screen and three-screen group. Confirm the gateway's own
   display is consuming RTP, followers have video but no echoing audio, and
   Studio reports readiness/connection counts.
4. Unplug the gateway and a follower separately. Confirm gateway failure ends
   the room session while follower failure is bounded/degraded.
5. Restart one player during waiting and one during mirroring. Confirm an
   unexpired session recovers and an expired session resumes current signage.
6. Activate an emergency takeover during mirroring and verify all group
   members leave AirPlay immediately.
7. Measure CPU, RSS, VA-API activity, dropped frames, incoming FPS, RTP
   bitrate, and temperature for at least 30 minutes at 720p30 and 1080p30.
   Record whether the machine remains responsive and whether the selected
   profile needs to be limited to 720p30.
