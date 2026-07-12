# Security policy

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Send a private report to the security contact listed in the repository metadata. Include affected versions, impact, reproduction steps, and any suggested mitigation. The maintainers will acknowledge the report, investigate it, and coordinate disclosure.

## Supported versions

Before the first stable release, security fixes are made on the main development line. A supported release table will be published with versioned releases.

## Deployment responsibilities

Use HTTPS outside a trusted local network, set `TILECAST_COOKIE_SECURE=true` behind HTTPS, protect `.env` and Tunnel credentials, use a unique PostgreSQL password, keep images updated, and do not expose PostgreSQL publicly. Tilecast stores only password hashes and session/device token hashes; administrators remain responsible for host, network, and backup security.
