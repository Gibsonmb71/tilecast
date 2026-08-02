package httpapi

import (
	"embed"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"
	"time"
)

// Provisioning assets are served by the server rather than fetched from GitHub.
// A signage box is commonly on a network that reaches the Tilecast server and
// nothing else, and an operator who has approved this server should not have to
// approve a second origin to install a player against it.
//
//go:embed install/install-tilecast-player.sh install/install-airplay-support.sh install/tilecast-player.service
var installAssets embed.FS

const installServerURLToken = "__TILECAST_SERVER_URL__"

var installHostPattern = regexp.MustCompile(`^(?:[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?|\[[0-9A-Fa-f:.]+\])(?::[0-9]{1,5})?$`)

// serverBaseURL is the address the installed player should call home to. The
// configured public URL wins, because that is the name an operator published
// and the one a certificate matches; the request's own host is the fallback so
// a server that never set TILECAST_PUBLIC_URL still serves a usable script.
func (s *server) serverBaseURL(r *http.Request) string {
	candidate := strings.TrimRight(strings.TrimSpace(s.publicURL), "/")
	if candidate == "" {
		scheme := "http"
		if r.TLS != nil {
			scheme = "https"
		}
		if forwarded := strings.TrimSpace(strings.Split(r.Header.Get("X-Forwarded-Proto"), ",")[0]); forwarded == "http" || forwarded == "https" {
			scheme = forwarded
		}
		if !installHostPattern.MatchString(r.Host) {
			return ""
		}
		candidate = scheme + "://" + r.Host
	}
	if !validInstallBaseURL(candidate) {
		return ""
	}
	return candidate
}

func validInstallBaseURL(value string) bool {
	if value == "" || strings.ContainsAny(value, "\x00\x01\x02\x03\x04\x05\x06\x07\x08\x09\x0a\x0b\x0c\x0d\x0e\x0f\x10\x11\x12\x13\x14\x15\x16\x17\x18\x19\x1a\x1b\x1c\x1d\x1e\x1f\x7f\"'`$\\;|&<>") {
		return false
	}
	parsed, err := url.Parse(value)
	return err == nil && (parsed.Scheme == "http" || parsed.Scheme == "https") && parsed.Host != "" && parsed.User == nil && parsed.RawQuery == "" && parsed.Fragment == ""
}

func (s *server) requireInstallBaseURL(w http.ResponseWriter, r *http.Request) (string, bool) {
	base := s.serverBaseURL(r)
	if base != "" {
		return base, true
	}
	writeError(w, http.StatusInternalServerError, "install_server_url_invalid", "Tilecast could not construct a safe server URL for the installer.")
	return "", false
}

func (s *server) installScript(w http.ResponseWriter, r *http.Request) {
	raw, err := installAssets.ReadFile("install/install-tilecast-player.sh")
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	// The base URL is substituted into a double-quoted shell assignment. It is
	// validated as a URL and rejected if it contains shell metacharacters or
	// control bytes; silently stripping a quote would turn an invalid Host or
	// forwarded header into a different script.
	base, ok := s.requireInstallBaseURL(w, r)
	if !ok {
		return
	}
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
	_, _ = w.Write(raw)
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
	base, ok := s.requireInstallBaseURL(w, r)
	if !ok {
		return
	}
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
		"artifactUrl": base + "/api/v1/install/linux/artifact",
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
