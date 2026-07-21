# Roles and Permissions

Tilecast uses four local roles.

| Action                                      | Owner | Administrator | Editor | Viewer |
| ------------------------------------------- | :---: | :-----------: | :----: | :----: |
| View Studio and operational status          |  Yes  |      Yes      |  Yes   |  Yes   |
| Upload and edit content                     |  Yes  |      Yes      |  Yes   |   No   |
| Create and edit playlists                   |  Yes  |      Yes      |  Yes   |   No   |
| Approve, repair, disable, or revoke screens |  Yes  |      Yes      |   No   |   No   |
| Manage screen groups                        |  Yes  |      Yes      |   No   |   No   |
| Create and edit schedules                   |  Yes  |      Yes      |   No   |   No   |
| Activate emergencies and send commands      |  Yes  |      Yes      |   No   |   No   |
| Edit organization and player settings       |  Yes  |      Yes      |   No   |   No   |
| Manage users                                |  Yes  |      Yes      |   No   |   No   |
| Import or export organization configuration |  Yes  |      No       |   No   |   No   |
| Sync or upload Player releases              |  Yes  |      No       |   No   |   No   |
| Deploy a verified Player release            |  Yes  |      Yes      |   No   |   No   |
| Change personal preferences                 |  Yes  |      Yes      |  Yes   |  Yes   |

## Owner

Owner is the highest-trust role. Keep the number of Owner accounts small.

Owner-only work includes portable configuration import/export and introducing new signed Player releases into the installation.

## Administrator

Administrators run the installation day to day. They can manage screens, schedules, emergencies, policies, users, and deployments of already verified Player releases.

## Editor

Editors manage content and playlists but cannot change device credentials, schedules, player policy, emergency state, or other administrative controls.

## Viewer

Viewers have read-only operational access.

## Operational practice

Use individual accounts. Do not share the Owner password.

Before granting Administrator access, remember that an Administrator can:

- approve a new physical player
- revoke an existing player credential
- replace playback across many screens
- trigger an emergency takeover
- send persistent device commands
- deploy a verified APK release

Review account access when staff roles change.
