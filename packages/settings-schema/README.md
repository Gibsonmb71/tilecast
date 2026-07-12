# Tilecast settings schema

`player-config-v1.json` is the player-facing effective configuration contract. Administrative inheritance details never cross this boundary. Stable setting definitions are owned by the closed Go registry in `apps/server/internal/settings/registry.go`; Studio consumes definitions from the authenticated API and Android consumes only the effective contract.
