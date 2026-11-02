// A TCP proxy that can turn any connection half-open: bytes stop flowing both ways while both
// sockets stay open, which is what a partition looks like to a client. Copied from the audit's
// docs/research/2026-11-01-system-audit/sim/repro/db/proxy.ts.
import net from "node:net";

export interface Link {
  id: number;
  client: net.Socket;
  server: net.Socket;
  dead: boolean;
}

export interface Proxy {
  port: number;
  links: Link[];
  /** Silences every connection open now; later ones still forward. */
  blackholeExisting(): number;
  /** New connections are accepted but never forwarded (a SYN that gets an ACK and nothing else). */
  blackholeNew(on: boolean): void;
  /** Ends every connection and refuses new ones until `refuse(false)`, as a stopped server does. */
  refuse(on: boolean): void;
  close(): Promise<void>;
}

export interface ProxyOptions {
  /** Every chunk the client sends upstream, as it is forwarded. */
  onClientBytes?: (chunk: Buffer) => void;
}

export async function startProxy(target: { host: string; port: number }, opts: ProxyOptions = {}): Promise<Proxy> {
  const links: Link[] = [];
  let swallowNew = false;
  let refusing = false;
  let next = 0;
  const server = net.createServer((client) => {
    if (refusing) {
      client.destroy();
      return;
    }
    const upstream = new net.Socket();
    const link: Link = { id: ++next, client, server: upstream, dead: swallowNew };
    links.push(link);
    if (!swallowNew) upstream.connect(target.port, target.host);
    client.on("data", (b: Buffer) => {
      if (link.dead) return;
      opts.onClientBytes?.(b);
      upstream.write(b);
    });
    upstream.on("data", (b) => { if (!link.dead) client.write(b); });
    client.on("error", () => {});
    upstream.on("error", () => {});
    // A blackholed flow carries the client's FIN no further than its packets.
    client.on("close", () => { if (!link.dead) upstream.destroy(); });
    upstream.on("close", () => { if (!link.dead) client.destroy(); });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as net.AddressInfo).port;
  return {
    port,
    links,
    blackholeExisting() {
      let n = 0;
      for (const l of links) if (!l.dead) { l.dead = true; n++; }
      return n;
    },
    blackholeNew(on) { swallowNew = on; },
    refuse(on) {
      refusing = on;
      if (on) for (const l of links) { l.client.destroy(); l.server.destroy(); }
    },
    async close() {
      for (const l of links) { l.client.destroy(); l.server.destroy(); }
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}

/** `url` with its host and port replaced by the proxy's. */
export function viaProxy(url: string, proxy: Proxy): string {
  const u = new URL(url);
  u.hostname = "127.0.0.1";
  u.port = String(proxy.port);
  return u.toString();
}

/** Where `url` points, for `startProxy`. */
export function targetOf(url: string, defaultPort: number): { host: string; port: number } {
  const u = new URL(url);
  return { host: u.hostname === "localhost" ? "127.0.0.1" : u.hostname, port: Number(u.port || defaultPort) };
}
