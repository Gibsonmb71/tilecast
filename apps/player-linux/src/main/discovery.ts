/**
 * LAN server discovery (mDNS / DNS-SD).
 *
 * The server advertises `_tilecast._tcp.local` with TXT records including
 * `base-url` and `installation-id`. On first run — when no server address has
 * been configured — the player browses for that service so a screen on the
 * same network can be pointed at its server with zero typing: the setup UI
 * offers the discovered servers as one-tap choices. Discovery is best-effort
 * and never blocks manual entry.
 */

import Bonjour from "bonjour-service";
import { logger } from "../core/log";
import { normalizeServerUrl } from "../core/server-url";

const log = logger("discovery");

/** Structural view of the fields we read from a resolved mDNS service. */
interface MdnsService {
  name?: string;
  host?: string;
  port?: number;
  txt?: Record<string, string>;
}

type BonjourInstance = InstanceType<typeof Bonjour>;
type BonjourBrowser = ReturnType<BonjourInstance["find"]>;

export interface DiscoveredServer {
  name: string;
  serverUrl: string;
  installationId?: string;
}

export class LanDiscovery {
  private bonjour: BonjourInstance | null = null;
  private browser: BonjourBrowser | null = null;
  private readonly seen = new Map<string, DiscoveredServer>();

  constructor(private readonly onFound: (server: DiscoveredServer) => void) {}

  start(): void {
    try {
      this.bonjour = new Bonjour();
      this.browser = this.bonjour.find({ type: "tilecast", protocol: "tcp" });
      this.browser.on("up", (service: MdnsService) => this.handle(service));
    } catch (err) {
      // No multicast route, container without net_admin, etc. — manual entry
      // still works.
      log.warn("mDNS discovery unavailable", { error: String(err) });
    }
  }

  stop(): void {
    try {
      this.browser?.stop?.();
      this.bonjour?.destroy();
    } catch {
      // ignore
    }
    this.bonjour = null;
    this.browser = null;
  }

  list(): DiscoveredServer[] {
    return [...this.seen.values()];
  }

  private handle(service: MdnsService): void {
    const txt = (service.txt ?? {}) as Record<string, string>;
    const raw =
      txt["base-url"] ??
      (service.host && service.port
        ? `http://${service.host}:${service.port}`
        : "");
    if (!raw) {
      return;
    }
    const normalized = normalizeServerUrl(raw);
    if (!normalized.ok || !normalized.url) {
      return;
    }
    const server: DiscoveredServer = {
      name: service.name || normalized.url,
      serverUrl: normalized.url,
      installationId: txt["installation-id"],
    };
    if (this.seen.has(server.serverUrl)) {
      return;
    }
    this.seen.set(server.serverUrl, server);
    log.info("discovered tilecast server", { serverUrl: server.serverUrl });
    this.onFound(server);
  }
}
