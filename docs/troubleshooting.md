# Troubleshooting pairing

- **No server appears:** use manual entry, confirm the TV and server share a network, and check multicast or client-isolation rules.
- **Public HTTP is rejected:** use HTTPS. HTTP is permitted only for private IPv4, link-local, localhost, and `.local` addresses after a visible warning.
- **Code expired:** request a new code on the TV; pairing sessions last ten minutes.
- **Identity changed:** confirm the address points to the intended installation, then reset the saved connection. Tilecast will not send the old credential to a different installation ID.
- **Screen is disabled:** enable it in Screens. Pairing remains intact.
- **Pairing revoked:** choose Pair again on the TV and approve a new request.
- **Tunnel connection fails:** enter the public HTTPS hostname manually and verify the Tunnel routes to `http://server:8080`.

## Media

- **Readiness reports media infrastructure unavailable:** confirm `/data/media` is writable by the Tilecast runtime user and that the configured FFmpeg and FFprobe paths are executable.
- **Upload offset mismatch:** use `HEAD /api/v1/uploads/{id}` and resume from the returned `Upload-Offset`; do not restart from a client-cached offset.
- **Insufficient storage:** free space or reduce the upload. Tilecast reserves `TILECAST_MEDIA_RESERVED_FREE_BYTES` after accounting for the declared upload size.
- **Processing failed:** inspect server logs using the request/job identifier. Studio receives only a safe error message, never raw FFmpeg output. Use Retry after correcting missing executables or storage permissions.
- **Variant unavailable:** the asset must be ready, the variant must be player-compatible, and the underlying file must still exist. Restore both database and media volume from the same backup point.
