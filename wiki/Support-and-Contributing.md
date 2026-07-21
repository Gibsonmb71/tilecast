# Support and Contributing

Use [GitHub Issues](https://github.com/Gibsonmb71/tilecast/issues) for reproducible bugs and focused feature requests.

## Before opening a bug

Check:

- [[Troubleshooting]]
- [[Known Limitations]]
- existing open and closed issues
- the current repository documentation
- whether the problem reproduces on the latest relevant release

## Include

For server problems:

- Tilecast version, tag, or commit
- deployment method
- Docker and host OS versions
- reverse proxy or tunnel type
- exact failing action
- relevant sanitized server logs
- `/healthz` and `/readyz` result

For Player problems:

- Player version
- device manufacturer and exact model
- Fire OS or Android version
- screen resolution
- network path to the server
- requested and effective reliability mode
- commissioning and readiness state
- whether the problem survives an app restart
- whether cached playback still works

For playback problems:

- content type
- playlist item settings
- delivery policy
- schedule or direct-assignment context
- player synchronization state
- the exact visible failure

## Never post

Do not include:

- passwords
- full player credentials
- pairing poll secrets
- enrollment tokens
- session cookies
- CSRF tokens
- Cloudflare Tunnel tokens
- GitHub tokens
- APK signing keys
- update-manifest private keys
- private database URLs
- private screenshots containing credentials

Redact sensitive hostnames and addresses when they are not necessary to reproduce the issue.

## Contributing code

Read [CONTRIBUTING.md](https://github.com/Gibsonmb71/tilecast/blob/main/CONTRIBUTING.md) and [AGENTS.md](https://github.com/Gibsonmb71/tilecast/blob/main/AGENTS.md) before changing the repository.

From the repository root, the normal verification path is:

```sh
npm install
make check
make build
```

Changes to pairing, credentials, manifests, configuration, scheduling, commands, reliability, or updates need tests that preserve the documented security and compatibility rules.

## Documentation changes

The Wiki is task-oriented operator documentation. The repository's `/docs` directory is the versioned technical reference.

When behavior changes:

- update the code and technical contract together
- update the relevant Wiki workflow
- avoid documenting planned behavior as available
- state device and firmware limitations plainly
