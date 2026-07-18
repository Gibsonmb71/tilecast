---
name: Player or screen issue
about: Report playback, pairing, synchronization, or Android Player problems
title: "[Player] "
labels: ""
assignees: ""
---

<!--
Do not include pairing secrets, device tokens, authentication headers,
passwords, private server URLs, or other sensitive information.
-->

## Problem

Describe the Player or screen behavior that is not working correctly.

## Issue category

Select all that apply:

- [ ] Screen will not pair
- [ ] Screen appears offline
- [ ] Content does not update
- [ ] Incorrect content plays
- [ ] Playback is blank or frozen
- [ ] Media fails to load
- [ ] Layout renders incorrectly
- [ ] Dynamic text or Data Source binding fails
- [ ] Playlist or schedule is incorrect
- [ ] Sync group is out of sync
- [ ] Commands remain pending
- [ ] Player update fails
- [ ] Offline playback fails
- [ ] Reconnection or recovery fails
- [ ] Display power control fails
- [ ] Other

## Player environment

- Tilecast server version, release, or commit:
- Player version:
- Player release channel:
- Device manufacturer and model:
- Android or Fire OS version:
- TV or display model:
- Connection: Wi-Fi / Ethernet
- Server is: Local network / Remote
- Player installation method:
- Number of affected screens:
- Is the screen in a sync group? Yes / No
- Is the screen using inherited policies? Yes / No / Unknown

## Content being played

Select all that apply:

- [ ] Image
- [ ] Video
- [ ] Web content
- [ ] Layout
- [ ] Widget
- [ ] Playlist
- [ ] Schedule
- [ ] Data Source content
- [ ] Emergency takeover
- [ ] Other

Content, playlist, layout, or schedule name:

## Steps to reproduce

1.
2.
3.

## Actual behavior

Describe what appears on the physical screen.

## Expected behavior

Describe what should appear or happen.

## Studio comparison

Does the content work correctly in Studio preview?

- [ ] Yes
- [ ] No
- [ ] Partially
- [ ] Not applicable

Describe any difference between Studio preview and physical playback:

## Recovery behavior

Select any actions that temporarily fix the problem:

- [ ] Restarting the Player
- [ ] Force-stopping and reopening the Player
- [ ] Rebooting the device
- [ ] Re-publishing the content
- [ ] Re-pairing the screen
- [ ] Clearing Player data
- [ ] Reconnecting the network
- [ ] Waiting for the next sync
- [ ] Nothing tested
- [ ] Nothing fixes it

## Logs and diagnostics

Include relevant Android logs, server logs, command status, manifest information, or network errors.

Remove tokens, credentials, and private URLs.

```text
Paste logs here
```

## Screenshots or recordings

Attach:

- A screenshot of the physical screen
- The corresponding Studio preview
- Relevant screen status or command history

## Additional context

Include recent Player updates, network changes, policy changes, or related issues.

## Acceptance criteria

- [ ] The issue is reproducible on a supported Player configuration.
- [ ] Physical playback matches the published content and configuration.
- [ ] The Player recovers safely from temporary network or server failures.
- [ ] Existing offline playback behavior remains intact.
- [ ] Relevant Android and server tests are added or updated.
