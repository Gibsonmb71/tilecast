# Structured Sources

Tilecast provides native RSS, Atom, JSON, and CSV Sources. Each Source is a reusable Content item that can be placed in playlists. The server keeps one bounded last-known-good payload and projects only the prepared records required by a screen into manifest v8.

## Providers

- RSS and Atom parse standard feed entries. Title, date, author, description excerpt, HTTPS link, and safely discovered HTTPS enclosure images are normalized into typed records. Feed HTML is stripped and never rendered.
- JSON selects a root array and scalar fields with RFC 6901 JSON Pointer. JavaScript, JMESPath functions, templates, expressions, and server-side scripts are not supported.
- CSV accepts a public URL or an uploaded UTF-8 file. The parser detects comma, semicolon, tab, or pipe delimiters unless one is selected, requires a header row, validates every row width, and maps columns by exact header name.

All providers support bounded item counts, keyword filtering, source/title/date sorting, list/agenda/card/ticker presentation, refresh and staleness limits, an empty state, preview, typed diagnostics, and last-known-good playback. CSV and mapped data also support up to eight equality or contains filters and twelve optional value fields.

## Security

Dynamic Sources use the same dedicated fetch policy as Calendar Sources. Public URLs require HTTPS and standard ports. Private, loopback, link-local, multicast, and non-global destinations are blocked during validation, redirects, DNS resolution, and connection unless `TILECAST_SOURCE_ALLOW_PRIVATE_NETWORKS=true` is explicitly set. The client does not use environment proxies and enforces total/request-header timeouts, redirect limits, response-size limits, and provider-specific content types.

Displayed strings are stripped of markup, control characters, and excessive length. URLs in records must be credential-free HTTPS URLs. Uploaded CSV bytes remain in the server configuration for refresh and backup but are removed from Studio API responses and Player manifests. Manifest data contains no fetch URL, uploaded bytes, mapping paths, filters, or executable content.

The Player validates manifest v8 before activation, keeps its previous verified manifest, and renders structured records with native Compose primitives. WebView remains limited to Website and YouTube Sources. Cached prepared records remain available during server or upstream outages until their configured staleness deadline.
