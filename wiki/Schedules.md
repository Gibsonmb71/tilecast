# Schedules

Schedules temporarily replace a screen's direct fallback playlist. Tilecast supports weekly recurring schedules and one-time events.

Only Owners and Administrators can create, edit, enable, disable, or delete schedules and groups.

## Create a schedule

Open **Schedules → Create schedule**.

The builder has four parts:

1. **Content**: schedule name and playlist
2. **Timing**: weekly recurring or one-time event
3. **Targets**: individual screens, groups, or both
4. **Advanced options**: enabled state, priority, and internal description

Review the summary and preview before saving.

## Weekly recurring schedule

Set:

- days of week
- start time
- end time
- IANA timezone
- optional start and end dates

An end time at or before the start time is an overnight window. For example, 21:00–06:00 starts on the selected day and ends the following morning.

Tilecast uses calendar and timezone rules rather than fixed 24-hour durations.

## One-time event

Set an exact start and end. The schedule is evaluated in its selected timezone.

## Targets

A schedule can target:

- one or more individual screens
- one or more groups
- both

A screen that is selected directly and also appears through a group is still one target.

## Precedence

Emergency takeover always wins over schedules.

When several schedules match the same screen, Tilecast compares:

1. Higher priority
2. Direct-screen target over group target
3. Later effective start
4. Stable ID as the final deterministic tie-breaker

Update time does not decide the winner.

## Priority

Use priority to express a real operational hierarchy.

Example:

| Priority | Use                          |
| -------: | ---------------------------- |
|        0 | Normal recurring programming |
|       20 | Special event                |
|       50 | Time-sensitive announcement  |

Do not use extreme priority values as a substitute for emergency takeover. Emergencies are a separate operation with expiration, preparation state, and audit behavior.

## Disabled schedules

A disabled schedule remains saved but has no effect. This is useful for seasonal or reusable schedules.

## Direct fallback

When no schedule matches, the direct screen assignment plays. If the screen has no direct assignment, it shows the configured no-content screen.

## Offline evaluation

Player manifests include relevant schedules and the required playlists. A player can continue evaluating received schedules while offline.

Offline scheduling depends on the device clock and timezone data. Studio warns about reported clock skew; Tilecast does not silently rewrite the player's clock.

An offline player cannot receive a schedule that was created after it disconnected.

## Daylight-saving behavior

For a nonexistent local time during a spring-forward gap, the boundary advances to the first valid time.

For a repeated local time during a fall-back overlap:

- a start uses the earlier occurrence
- an end uses the later occurrence

This avoids shortening an intended playback window.

## Unexpected playback

Check, in order:

1. Is an emergency active?
2. Is the schedule enabled?
3. Does its timezone match the intended location?
4. Does the screen match a direct or group target?
5. Is a higher-priority schedule active?
6. At equal priority, is another schedule directly targeting the screen?
7. Is the player clock skewed?
8. Did the player receive the latest manifest?
