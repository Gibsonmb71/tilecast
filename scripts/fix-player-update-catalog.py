from pathlib import Path

updates_path = Path("apps/server/internal/httpapi/updates.go")
text = updates_path.read_text()
old = '''func (s *server) listPlayerReleases(w http.ResponseWriter, r *http.Request) {
\trows, err := s.db.Query(r.Context(), `SELECT id,COALESCE(github_tag,''),source,channel,version_code,version_name,minimum_sdk,release_notes,published_at,apk_size,apk_sha256,signing_certificate_sha256,manifest_signature,cache_status,verification_status,verification_error FROM player_releases ORDER BY version_code DESC`)
'''
new = '''func (s *server) listPlayerReleases(w http.ResponseWriter, r *http.Request) {
\tvar releaseCount int
\tvar checked *time.Time
\tvar providerError *string
\t_ = s.db.QueryRow(r.Context(), `SELECT count(*) FROM player_releases`).Scan(&releaseCount)
\t_ = s.db.QueryRow(r.Context(), `SELECT last_checked_at,safe_error FROM update_provider_state WHERE provider='github'`).Scan(&checked, &providerError)
\tif releaseCount == 0 || checked == nil || time.Since(*checked) > 15*time.Minute {
\t\tctx, cancel := context.WithTimeout(r.Context(), 25*time.Second)
\t\t_ = s.updates.Check(ctx)
\t\tcancel()
\t\tchecked = nil
\t\tproviderError = nil
\t\t_ = s.db.QueryRow(r.Context(), `SELECT last_checked_at,safe_error FROM update_provider_state WHERE provider='github'`).Scan(&checked, &providerError)
\t}

\trows, err := s.db.Query(r.Context(), `SELECT id,COALESCE(github_tag,''),source,channel,version_code,version_name,minimum_sdk,release_notes,published_at,apk_size,apk_sha256,signing_certificate_sha256,manifest_signature,cache_status,verification_status,verification_error FROM player_releases ORDER BY version_code DESC`)
'''
if old not in text:
    raise SystemExit("listPlayerReleases marker not found")
text = text.replace(old, new, 1)
old_state = '''\tvar checked *time.Time
\tvar providerError *string
\t_ = s.db.QueryRow(r.Context(), `SELECT last_checked_at,safe_error FROM update_provider_state WHERE provider='github'`).Scan(&checked, &providerError)
\twriteJSON(w, 200, map[string]any{"data": map[string]any{"repository": "Gibsonmb71/tilecast", "lastCheckedAt": checked, "providerError": providerError, "manifestKeyConfigured": s.updates.ManifestKeyConfigured(), "items": items}})
'''
new_state = '''\twriteJSON(w, 200, map[string]any{"data": map[string]any{"repository": "Gibsonmb71/tilecast", "lastCheckedAt": checked, "providerError": providerError, "manifestKeyConfigured": s.updates.ManifestKeyConfigured(), "items": items}})
'''
if old_state not in text:
    raise SystemExit("provider state marker not found")
text = text.replace(old_state, new_state, 1)
updates_path.write_text(text)

dashboard_path = Path("apps/dashboard/src/settings/SettingsOperations.tsx")
text = dashboard_path.read_text()
marker = '''        {showUpload && (
          <PlayerReleaseUpload
            csrfToken={auth.status?.csrfToken ?? ""}
            onImported={() => {
              void client.invalidateQueries({ queryKey: ["player-releases"] });
            }}
          />
        )}
        <div className="settings-table-wrap">
'''
replacement = '''        {showUpload && (
          <PlayerReleaseUpload
            csrfToken={auth.status?.csrfToken ?? ""}
            onImported={() => {
              void client.invalidateQueries({ queryKey: ["player-releases"] });
            }}
          />
        )}
        {releases.data && !releases.data.manifestKeyConfigured && (
          <div className="notice notice--error" role="alert">
            <strong>Player update verification is not configured.</strong>
            <p>
              Set <code>TILECAST_UPDATE_MANIFEST_PUBLIC_KEY</code> on the Tilecast
              server to the public Ed25519 key used by the Player release workflow,
              then restart the server.
            </p>
          </div>
        )}
        {(check.error || releases.data?.providerError) && (
          <div className="notice notice--error" role="alert">
            <strong>GitHub releases could not be synchronized.</strong>
            <p>{check.error?.message ?? releases.data?.providerError}</p>
          </div>
        )}
        {!releases.isLoading &&
          !releases.error &&
          releases.data?.manifestKeyConfigured &&
          !releases.data?.providerError &&
          (releases.data?.items.length ?? 0) === 0 && (
            <div className="notice">
              <strong>No Player releases have been imported.</strong>
              <p>
                Tilecast checks GitHub automatically. Use Sync from GitHub to
                retry immediately.
              </p>
            </div>
          )}
        <div className="settings-table-wrap">
'''
if marker not in text:
    raise SystemExit("dashboard release panel marker not found")
text = text.replace(marker, replacement, 1)
dashboard_path.write_text(text)
