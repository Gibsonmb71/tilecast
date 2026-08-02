package httpapi

import (
	"bytes"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"
)

// Provisioning assets are served by the server rather than fetched from GitHub.
// A signage box is commonly on a network that reaches the Tilecast server and
// nothing else, and an operator who has approved this server should not have to
// approve a second origin to install a player against it.
//
//go:embed install/install-tilecast-player.sh install/install-airplay-support.sh install/tilecast-player.service install/uxplay-1.73.6.tar.gz
var installAssets embed.FS

const (
	installServerURLToken   = "__TILECAST_SERVER_URL__"
	installUxPlayVersion    = "1.73.6"
	installUxPlaySHA256     = "3a1a754bc7ed4b0f72b6237aa4d769238b9c20a71b651bc3fe9ac679e2a67f18"
	installUxPlayArchive    = "install/uxplay-1.73.6.tar.gz"
	installUxPlayArchiveURL = "/api/v1/install/airplay/uxplay"
)

// serverBaseURL is the address the installed player should call home to. The
// configured public URL wins, because that is the name an operator published
// and the one a certificate matches; the request's own host is the fallback so
// a server that never set TILECAST_PUBLIC_URL still serves a usable script.
func (s *server) serverBaseURL(r *http.Request) string {
	if s.publicURL != "" {
		return strings.TrimRight(s.publicURL, "/")
	}
	scheme := "http"
	if forwarded := r.Header.Get("X-Forwarded-Proto"); forwarded != "" {
		scheme = strings.TrimSpace(strings.Split(forwarded, ",")[0])
	} else if r.TLS != nil {
		scheme = "https"
	}
	return scheme + "://" + r.Host
}

func (s *server) installScript(w http.ResponseWriter, r *http.Request) {
	raw, err := installAssets.ReadFile("install/install-tilecast-player.sh")
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	// The base URL is substituted, never interpolated into a shell expression:
	// the token sits inside a single-quoted assignment in the script, and a
	// host containing a quote would break out of it.
	base := strings.ReplaceAll(s.serverBaseURL(r), `"`, "")
	w.Header().Set("Content-Type", "text/x-shellscript; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write([]byte(strings.ReplaceAll(string(raw), installServerURLToken, base)))
}

func (s *server) airplayInstallScript(w http.ResponseWriter, r *http.Request) {
	raw, err := installAssets.ReadFile("install/install-airplay-support.sh")
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	w.Header().Set("Content-Type", "text/x-shellscript; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	base := strings.ReplaceAll(s.serverBaseURL(r), `"`, "")
	_, _ = w.Write([]byte(strings.ReplaceAll(string(raw), installServerURLToken, base)))
}

// installableUxPlayChecksum publishes the digest Tilecast pinned when the
// upstream v1.73.6 source was vendored. The installer also carries this value,
// so a mismatched server build is rejected before any source is extracted.
func (s *server) installableUxPlayChecksum(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("Cache-Control", "public, max-age=3600")
	_, _ = fmt.Fprintln(w, installUxPlaySHA256)
}

func (s *server) installableUxPlayArtifact(w http.ResponseWriter, r *http.Request) {
	archive, err := installAssets.ReadFile(installUxPlayArchive)
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	digest := sha256.Sum256(archive)
	if hex.EncodeToString(digest[:]) != installUxPlaySHA256 {
		s.internalError(w, r, fmt.Errorf("embedded UxPlay %s archive checksum mismatch", installUxPlayVersion))
		return
	}
	w.Header().Set("Content-Type", "application/gzip")
	w.Header().Set("Cache-Control", "public, max-age=3600")
	w.Header().Set("ETag", `"sha256-`+installUxPlaySHA256+`"`)
	w.Header().Set("Accept-Ranges", "bytes")
	w.Header().Set("Content-Disposition", `attachment; filename="uxplay-1.73.6.tar.gz"`)
	http.ServeContent(w, r, "uxplay-1.73.6.tar.gz", time.Time{}, bytes.NewReader(archive))
}

func (s *server) playerServiceUnit(w http.ResponseWriter, r *http.Request) {
	raw, err := installAssets.ReadFile("install/tilecast-player.service")
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write(raw)
}

// installableLinuxRelease reports the build the installer will fetch, so the
// script can verify what it downloaded before it installs it.
func (s *server) installableLinuxRelease(w http.ResponseWriter, r *http.Request) {
	release, err := s.updates.LatestInstallableLinux(r.Context())
	if err != nil {
		writeError(w, 404, "player_release_not_cached", "No cached, verified Linux player release is available. Download one in Settings → Player releases.")
		return
	}
	writeJSON(w, 200, map[string]any{"data": map[string]any{
		"platform":    "linux",
		"versionName": release.VersionName,
		"versionCode": release.VersionCode,
		"sizeBytes":   release.SizeBytes,
		"sha256":      release.SHA256,
		"artifactUrl": s.serverBaseURL(r) + "/api/v1/install/linux/artifact",
	}})
}

func (s *server) installableLinuxArtifact(w http.ResponseWriter, r *http.Request) {
	release, err := s.updates.LatestInstallableLinux(r.Context())
	if err != nil {
		writeError(w, 404, "player_release_not_cached", "No cached, verified Linux player release is available.")
		return
	}
	file, err := os.Open(release.Path)
	if err != nil {
		writeError(w, 404, "player_release_not_cached", "The cached Linux player artifact is unavailable.")
		return
	}
	defer file.Close()
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("ETag", `"sha256-`+release.SHA256+`"`)
	w.Header().Set("Accept-Ranges", "bytes")
	w.Header().Set("Content-Disposition", `attachment; filename="tilecast-player.AppImage"`)
	http.ServeContent(w, r, "tilecast-player.AppImage", time.Time{}, ioSection{file, release.SizeBytes})
}
