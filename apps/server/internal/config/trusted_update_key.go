package config

// DefaultUpdateManifestPublicKey is Tilecast's public Ed25519 update-signing key.
// It is public trust material, not a secret. Deployments may override it with
// TILECAST_UPDATE_MANIFEST_PUBLIC_KEY for custom Player builds.
const DefaultUpdateManifestPublicKey = "pqsc4g9DNHwgHYeiqhbmjV9IFzkNPBy/WUbBRij4zdk="
