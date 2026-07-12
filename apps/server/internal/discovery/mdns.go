package discovery

import (
	"fmt"
	"net/url"
	"strconv"
	"strings"

	"github.com/grandcat/zeroconf"
	"github.com/tilecast/tilecast/apps/server/internal/devices"
)

type Server struct{ server *zeroconf.Server }

func Advertise(identity devices.Identity, publicURL string) (*Server, error) {
	parsed, err := url.Parse(publicURL)
	if err != nil || parsed.Hostname() == "" {
		return nil, fmt.Errorf("mDNS requires a valid TILECAST_PUBLIC_URL")
	}
	port := 80
	if parsed.Scheme == "https" {
		port = 443
	}
	if parsed.Port() != "" {
		port, err = strconv.Atoi(parsed.Port())
		if err != nil {
			return nil, fmt.Errorf("parse public URL port: %w", err)
		}
	}
	instance := strings.TrimSpace("Tilecast - " + identity.OrganizationName)
	server, err := zeroconf.Register(instance, "_tilecast._tcp", "local.", port, []string{
		"path=/api/v1/system/identity",
		"base-url=" + strings.TrimRight(publicURL, "/"),
		"installation-id=" + identity.InstallationID,
		"api-version=v1",
	}, nil)
	if err != nil {
		return nil, fmt.Errorf("advertise Tilecast with mDNS: %w", err)
	}
	return &Server{server: server}, nil
}

func (s *Server) Shutdown() {
	if s != nil && s.server != nil {
		s.server.Shutdown()
	}
}
