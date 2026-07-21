# Screens and Groups

A screen represents one paired Tilecast Player. A group is a reusable set of screens for schedules, emergency takeovers, update deployments, and policy.

## Screen status

| Status          | Meaning                                                             |
| --------------- | ------------------------------------------------------------------- |
| Online          | An authenticated Player WebSocket is active                         |
| Recently online | No active socket; last contact was within two minutes               |
| Stale           | Last contact was more than two and no more than fifteen minutes ago |
| Offline         | No contact for more than fifteen minutes, or never contacted        |
| Disabled        | Playback was administratively disabled                              |
| Pairing revoked | The screen has no active device credential                          |

Status is computed by the server. The player does not submit an `online` value.

## Screen details

A screen record can include:

- name
- location
- description
- manufacturer and model
- Android and Player versions
- resolution
- locale and timezone
- last contact
- manifest and configuration synchronization state
- reliability capability and commissioning state
- direct playlist assignment
- group memberships
- effective player policy

Owners and Administrators can manage screens. Editors and Viewers can monitor them.

## Direct assignment

The direct playlist assignment is the screen's fallback. It remains in place when schedules are added.

Playback order is:

1. emergency
2. schedule
3. direct assignment
4. no content

## Disable playback

The `disable_playback` command stops ordinary playback but keeps pairing, networking, health reporting, and command delivery active.

An emergency takeover can still appear on a disabled screen. When the emergency expires, the screen returns to disabled until `enable_playback` succeeds.

## Revoke pairing

Revoking invalidates the current device credential and disconnects the active player.

Use revoke when:

- the device was lost or replaced
- a credential may be compromised
- the screen should no longer connect

Do not revoke merely to fix an upgraded player that lost access to its local credential. Use [[pairing repair|Pair a Screen#repair-an-existing-pairing]] when Studio recognizes the installation ID.

## Screen groups

A screen may belong to multiple groups.

Create groups around an operational purpose, not a temporary playlist. Examples:

- Main building
- Cafeterias
- Front offices
- Elementary schools
- Portrait displays
- Fire TV devices

A group can carry player policy and can be targeted by schedules, emergencies, and updates.

## Group policy priority

When several groups set the same player policy key, the highest-priority matching group wins. A direct screen override still wins over every group.

Use the effective-policy view on the screen before assuming which value applies.

## Changing group membership

Group membership changes which screens are affected by group-based configuration and future operations. Review:

- enabled schedules
- active emergencies
- pending update deployments
- group player policies

before moving a production screen between groups.
