# Optional Cloudflare Tunnel

Tilecast does not require Cloudflare. A Tunnel is useful when players must reach a server outside the local network without opening an inbound firewall port.

1. Create a remotely managed tunnel in Cloudflare Zero Trust.
2. Add a public hostname whose service is `http://server:8080`. That hostname is configured in the Cloudflare dashboard; `server` is the Compose service name.
3. Copy the tunnel token into `deploy/docker/.env` as `CLOUDFLARE_TUNNEL_TOKEN`.
4. Set `TILECAST_PUBLIC_URL` to the HTTPS hostname and `TILECAST_COOKIE_SECURE=true`.
5. Start the optional profile:

   ```sh
   docker compose --env-file deploy/docker/.env -f deploy/docker/compose.yml --profile tunnel up -d
   ```

The container uses an outbound-only, token-managed tunnel. Keep the token out of version control. Tilecast remains responsible for its own local authentication; Cloudflare Access in front of the dashboard is optional and must not block future player API traffic without a compatible service-token design.
