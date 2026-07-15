# Calendar Sources

Calendar Sources turn one to eight public iCalendar feeds into reusable Tilecast Content. Studio supports Today, Upcoming, This week, and Agenda views; bounded event counts; field visibility; keyword and calendar filters; IANA timezones; empty text; live preview; and typed refresh diagnostics. Calendar Sources can be added to normal playlists and schedules.

The server fetches and parses ICS. It expands RFC 5545 recurrence rules into a bounded 90-day occurrence window using the configured timezone, including all-day events and DST transitions. Titles, locations, and description excerpts are converted to plain bounded text. Raw ICS is not retained or returned by the API.

Refresh state is durable in PostgreSQL. A successful refresh atomically replaces the prepared cache and advances affected manifests. A failed refresh retains the last-known-good cache until `stalenessLimitHours`; diagnostics identify network, HTTP, content, or parse state without leaking response bodies. Players receive only prepared events needed by their relevant playlists and keep them through verified cached-manifest startup.

Calendar URLs cannot contain credentials or fragments. Public endpoints require HTTPS and standard ports. Private, loopback, link-local, multicast, and shared-address destinations, including internal nonstandard ports, are blocked at validation, redirect, and dial time unless `TILECAST_SOURCE_ALLOW_PRIVATE_NETWORKS=true`. The dedicated client has no environment proxy, enforces configured timeouts, caps redirects and bytes, and accepts only calendar-compatible content types whose body identifies itself as VCALENDAR. Calendar credentials are not supported.
