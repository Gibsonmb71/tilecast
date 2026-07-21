# Pair a Screen

Pairing gives one Tilecast Player an individual device credential and creates a screen record in Studio.

Only Owners and Administrators can approve or reject pairing requests.

## Before pairing

Confirm that:

- Tilecast Player can reach the server URL.
- The TV and browser show the same organization.
- The device details shown in Studio match the physical device.
- The TV remains on the pairing screen.

Pairing sessions expire after ten minutes and are single-use.

## Pair a new player

On the TV:

1. Open Tilecast Player.
2. Select the server or enter its URL.
3. Leave the six-character code visible.

In Studio:

1. Open **Screens**.
2. Select **Pair screen**.
3. Enter the code.
4. Select **Find player**.
5. Review manufacturer, model, platform, Android version, Player version, resolution, locale, timezone, and approximate network address.
6. Enter a screen name.
7. Add a location and description when useful.
8. Select **Approve and pair**.

The player polls with a private secret that is different from the visible code. The code is only for matching the request in Studio.

## After approval

The server issues a one-time enrollment token. The player consumes it and receives its permanent device credential exactly once.

The player then starts local commissioning. Finish the setup shown on the TV before treating the screen as unattended. See [[Reliability and Kiosk]].

## Reject an unknown request

Open the pending request and select **Reject**.

Do not approve a request based only on its code. Confirm the device metadata and physical TV.

## Repair an existing pairing

Tilecast Player keeps a stable installation ID. If an upgraded or reset player retains that ID but loses access to its protected credential, the next request is marked as previously paired.

Studio shows **Repair and replace credential**.

Repairing:

- preserves the existing screen record
- preserves direct assignments, group memberships, and policy
- replaces the old credential only after the new player completes enrollment
- revokes the previous credential after successful replacement

Do not delete the screen merely because the player needs credential repair.

## Server identity mismatch

A paired player stores the Tilecast installation identity. If the same URL begins serving a different installation, the player refuses to send its credential.

This can happen after:

- restoring the wrong database
- rebuilding the server without restoring PostgreSQL
- reusing a hostname for a separate Tilecast installation
- pointing DNS at the wrong server

Verify the server before resetting the player. Resetting and pairing to the wrong installation can create a new screen instead of recovering the existing one.

## Pairing problems

### Code expired

Return to the TV and create a fresh request.

### Request does not appear in Studio

- Confirm the player reached the correct server.
- Check reverse-proxy and tunnel rules.
- Confirm no access gateway is blocking player API traffic.
- Check the server logs.

### Approval succeeds but the TV does not finish

Leave the app open and check connectivity. If the enrollment window expires, create another request. A previous credential is not revoked until a replacement enrollment succeeds.
