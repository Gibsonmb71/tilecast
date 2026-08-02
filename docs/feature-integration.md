# Cross-feature behavior

The feature stack composes around the existing manifest, command, and schedule
authorities:

1. Emergency Takeover
2. External presentation, including AirPlay
3. Quick Present
4. Scheduled or assigned content
5. Outside-hours state

Quick Present is a durable `presentation_overrides` record. Its expiry or a
manual stop bumps the affected manifest, and the next manifest evaluation
recomputes the current schedule, assignment, active-hours state, takeover, and
content availability. It does not restore an old playback snapshot. A new
Quick Present request conflicts with an active AirPlay presentation rather
than interrupting it silently.

For a Span Display Group, the same override targets the logical group. Images
and layouts use the group canvas and each Player's viewport; videos use the
server-generated, synchronized panel variants. A takeover remains higher
priority and uses the same Span preparation/readiness path.

Screen Replacement keeps the logical `screen_id`, so group membership, Span
panel geometry, assignments, schedules, policies, scopes, snapshots, and
history remain attached. Enrollment retires the old credential only after the
new credential is issued. The replacement Player must report its own Display
Control capabilities; the old hardware snapshot is cleared.

Display Group Display Control actions use the persistent Player command queue.
Studio previews independent capability coverage and queues commands only for
eligible members. Command delivery and confirmed physical display state are
reported separately, and a display powered off by policy does not make its
Player appear offline. AirPlay implementation and protocol behavior are not
changed by this integration.
