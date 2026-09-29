import { Client, Pool, type ClientConfig, type PoolConfig } from "pg";
import { logger } from "../http/logger.ts";

export function createPool(name: string, config: Omit<PoolConfig, "connectionString">): Pool {
  const pool = new Pool({ ...config, connectionString: process.env.DATABASE_URL });
  // Every client error is logged below; this only absorbs pg-pool's re-emit for an idle one.
  pool.on("error", () => {});
  // pg-pool listens on a client only while it is idle: a backend dying under a checked-out one
  // (a transaction between statements, the socket adapter's LISTEN) emits with nobody listening.
  pool.on("connect", (client) => {
    client.on("error", (err) => logger.error({ err, pool: name }, "Postgres client error"));
  });
  return pool;
}

export function createClient(
  config: Omit<ClientConfig, "connectionString">,
  onError: (err: Error) => void
): Client {
  const client = new Client({ ...config, connectionString: process.env.DATABASE_URL });
  client.on("error", onError);
  return client;
}
