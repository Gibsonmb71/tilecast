# LAN discovery

Tilecast advertises `_tilecast._tcp.local` when `TILECAST_MDNS_ENABLED=true`. TXT records include the identity path, base URL, API version, and installation ID. Android Player uses the standard `NsdManager` DNS-SD APIs.

Multicast discovery is only a convenience. Guest Wi-Fi, VLAN boundaries, multicast filtering, AP isolation, Docker bridge networking, and some enterprise wireless systems can block it. In those cases, enter the local server URL manually. Discovery never downgrades HTTPS and does not discover Cloudflare Tunnel hostnames.
