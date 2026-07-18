---
name: Installation or deployment issue
about: Get help with Docker, configuration, upgrades, proxies, or startup failures
title: "[Deployment] "
labels: ""
assignees: ""
---

<!--
Do not paste complete .env files or unredacted configuration.

Remove passwords, cookies, tokens, OAuth secrets, PostgreSQL credentials,
Tunnel credentials, private keys, and public IP addresses when appropriate.
-->

## Problem

Describe the installation, startup, upgrade, or deployment problem.

## Installation method

- [ ] Docker Compose
- [ ] Prebuilt container image
- [ ] Built from source
- [ ] Development environment
- [ ] Upgrade from an earlier Tilecast version
- [ ] Other

## Environment

- Tilecast version, release, or commit:
- Host operating system and version:
- CPU architecture:
- Docker version:
- Docker Compose version:
- Database and version:
- Reverse proxy:
- Tunnel or remote-access service:
- Browser and version:

## Deployment topology

Briefly describe how requests reach Tilecast.

Example:

```text
Browser → Cloudflare Tunnel → Caddy → Tilecast Server → PostgreSQL
```

## Steps to reproduce

1.
2.
3.

## Command that failed

```shell
Paste the command here
```

## Actual behavior

Describe the error or failure.

## Expected behavior

Describe what should happen instead.

## Logs

Include the smallest relevant section of logs.

```text
Paste redacted logs here
```

## Redacted configuration

Include only settings relevant to the problem.

```yaml
# Paste redacted configuration here
```

## Health information

- Does the server container start? Yes / No
- Is PostgreSQL reachable? Yes / No / Unknown
- Does the health endpoint respond? Yes / No / Unknown
- Can Studio load? Yes / No
- Can a Player connect? Yes / No / Not tested

## Upgrade information

Complete this section when the problem began during an upgrade.

- Previous version:
- New version:
- Were database migrations run?
- Was the deployment rolled back?
- Does a clean installation show the same issue?

## Troubleshooting attempted

Describe commands, configuration changes, restarts, or workarounds already attempted.

## Additional context

Include related issues, documentation followed, or unusual deployment requirements.

## Acceptance criteria

- [ ] A supported installation can start with documented configuration.
- [ ] Upgrade and migration behavior is safe and repeatable.
- [ ] Errors identify the invalid or missing configuration clearly.
- [ ] Deployment documentation is updated when necessary.
