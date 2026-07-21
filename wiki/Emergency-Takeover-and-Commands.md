# Emergency Takeover and Commands

Tilecast separates urgent fullscreen takeover from ordinary scheduling. It also provides a fixed set of persistent player commands.

Owners and Administrators can activate or cancel emergencies and send commands.

## Emergency takeover

An emergency is a temporary fullscreen playlist override.

It requires:

- a name
- a ready, non-empty playlist
- at least one screen or group target
- an expiration time

The default maximum duration is 24 hours. The server administrator can lower or raise the deployment limit with `TILECAST_MAX_EMERGENCY_DURATION_HOURS`.

## Activate an emergency

From **Screens**:

1. Open **Emergency takeover**.
2. Enter a clear name.
3. Select the playlist.
4. Choose an expiration.
5. Select screens, groups, or both.
6. Confirm the target count and offline count.
7. Authenticate again if the organization requires it.
8. Confirm activation.

A newly activated emergency replaces an older emergency only on overlapping screens. Unaffected screens continue the older takeover.

## Preparation and activation

Downloaded emergency assets are prepared and verified before atomic activation. Existing playback remains visible if preparation fails.

Studio reports affected screens as preparing, active, or failed.

## Offline behavior

A player that already received an emergency continues it offline until the expiration instant. At expiration, it evaluates the current normal schedule and fallback.

An offline player that never received the emergency cannot display it.

A badly incorrect device clock can affect offline expiration.

## Cancel an emergency

Canceling restores the currently winning schedule or direct fallback. It does not restore whatever happened to be on screen when the emergency started.

## Persistent commands

Commands are stored by the server, expire, and survive temporary disconnection. A WebSocket notification only tells the player to fetch available commands.

Supported commands:

| Command              | Effect                                                 |
| -------------------- | ------------------------------------------------------ |
| `sync_now`           | Reconcile content manifest and player configuration    |
| `reload_playback`    | Recreate the current playback session                  |
| `identify_screen`    | Show a temporary on-screen identifier                  |
| `clear_media_cache`  | Remove unprotected cached media                        |
| `clear_website_data` | Clear Website Source browser data                      |
| `disable_playback`   | Stop ordinary playback while keeping management online |
| `enable_playback`    | Resume ordinary playback                               |

Tilecast does not accept arbitrary shell commands, executable names, URLs, or command payloads.

## Command safety

- Commands are acknowledged before execution.
- Results are reported back to Studio.
- Idempotency prevents duplicate execution after reconnect or restart.
- Completed commands are retained for a bounded period.
- Cache clearing preserves files protected by the active or pending manifest.
- Maintenance and update flows pause actions that would interfere with installation.
