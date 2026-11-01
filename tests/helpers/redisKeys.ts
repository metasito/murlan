import { createClient } from "redis";
import { keyspace } from "../../server/store/redis.ts";

/** Deletes every key a server on `databaseUrl` wrote, as `dropSchema` does its tables. */
export async function dropKeyspace(databaseUrl: string, redisUrl = process.env.REDIS_URL): Promise<void> {
  if (!redisUrl) return;
  const client = createClient({ url: redisUrl });
  client.on("error", () => {});
  await client.connect();
  try {
    const keys: string[] = [];
    for await (const batch of client.scanIterator({ MATCH: `${keyspace(databaseUrl)}:*`, COUNT: 500 })) keys.push(...batch);
    if (keys.length) await client.del(keys);
  } finally {
    client.destroy();
  }
}
