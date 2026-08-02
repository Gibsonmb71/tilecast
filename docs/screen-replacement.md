# Screen Replacement

Screen Replacement changes the physical player behind a logical Tilecast screen. It is intentionally separate from **credential repair**:

- Credential repair recognizes the same player installation UUID and rotates a credential for that existing player.
- Screen Replacement pairs a new player installation to an existing screen ID and retires the previous hardware only after the new player enrolls.

The replacement flow is available from Studio’s pairing approval screen:

1. Open a pending player pairing.
2. Choose **Replace hardware for an existing screen**.
3. Select the existing logical screen.
4. Confirm the replacement and finish enrollment on the new player.

The replacement preserves the logical screen’s name, location, Display Group membership and Span geometry, content assignments, schedules, policies, scopes, snapshots, and Activity history. It updates only physical player metadata and the active device credential. If approval or enrollment fails, the transaction rolls back and the previous credential remains usable.

Each successful physical pairing is recorded in `screen_player_history`. Studio shows the current record and retired hardware on the screen Overview. The record includes the player installation ID, platform, manufacturer/model, player and platform versions, display metadata, pairing time, retirement time, and retirement reason. Existing installations receive a current hardware record through migration `00086_screen_replacement.sql`.

Replacement hardware must complete the normal authenticated enrollment path. It must not send a device credential until the permanent installation identity has been checked, and it must rerun player heartbeat capability detection rather than inheriting the previous player’s claims.
