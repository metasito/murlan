// A TCP proxy in front of Postgres that can turn any connection half-open: bytes stop flowing
// both ways while both sockets stay open, which is what a partition looks like to node-postgres.
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
  close(): Promise<void>;
}

export async function startProxy(targetPort: number, opts: { finThroughDead?: boolean } = {}): Promise<Proxy> {
  const links: Link[] = [];
  let swallowNew = false;
  let next = 0;
  const server = net.createServer((client) => {
    const upstream = new net.Socket();
    const link: Link = { id: ++next, client, server: upstream, dead: swallowNew };
    links.push(link);
    if (!swallowNew) upstream.connect(targetPort, "127.0.0.1");
    client.on("data", (b) => { if (!link.dead) upstream.write(b); });
    upstream.on("data", (b) => { if (!link.dead) client.write(b); });
    client.on("error", () => {});
    upstream.on("error", () => {});
    // A blackholed flow carries the app's FIN no further than its packets: Postgres keeps the
    // backend. finThroughDead lets the close through anyway (data lost, teardown delivered).
    client.on("close", () => { if (!link.dead || opts.finThroughDead) upstream.destroy(); });
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
    async close() {
      for (const l of links) { l.client.destroy(); l.server.destroy(); }
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}

export const PG_PORT = 55432;
export const REPRO_DB = "murlan_repro_db";
export const directUrl = `postgres://postgres@localhost:${PG_PORT}/${REPRO_DB}`;
export const viaProxy = (port: number) => `postgres://postgres@127.0.0.1:${port}/${REPRO_DB}`;
export const t0 = Date.now();
export const ms = () => `${String(Date.now() - t0).padStart(6)}ms`;
export const log = (...a: unknown[]) => console.log(ms(), ...a);
