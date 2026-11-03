// One inbox stream at its cap: replays the inbox entries entry-sizes.ts dumped, in order and round
// again, until the stream has had `streamMaxLen()` writes, each trimmed as instanceInbox.ts trims.
// Reports what the store then holds for it.
// Usage: REDIS_URL=redis://127.0.0.1:<port> node docs/research/2026-11-02-latest-stable/valkey/fill.ts <dump>...
import { readFileSync } from "node:fs";
import { createClient } from "redis";

const CAP = 120_000;
const payloads = process.argv
  .slice(2)
  .flatMap((file) => readFileSync(file, "utf8").split("\n"))
  .filter(Boolean);
if (payloads.length === 0) throw new Error("no dumped entries given");

const redis = createClient({ url: process.env.REDIS_URL });
await redis.connect();
const usedMemory = async () => Number(/used_memory:(\d+)/.exec(await redis.info("memory"))![1]);
await redis.del("fill");
const before = await usedMemory();
const trim = { strategy: "MAXLEN", strategyModifier: "~", threshold: CAP } as const;
let bytes = 0;
for (let i = 0; i < CAP; i += 1_000) {
  const batch = redis.multi();
  for (let j = i; j < Math.min(CAP, i + 1_000); j++) {
    const m = payloads[j % payloads.length];
    bytes += Buffer.byteLength(m) + 1;
    batch.xAdd("fill", "*", { m }, { TRIM: trim });
  }
  await batch.execAsPipeline();
}
const length = await redis.xLen("fill");
const usage = Number(await redis.sendCommand(["MEMORY", "USAGE", "fill", "SAMPLES", "0"]));
const after = await usedMemory();
const info = await redis.info("server");
const engine = /valkey_version:(\S+)/.exec(info)?.[1] ? `valkey ${/valkey_version:(\S+)/.exec(info)![1]}` : `redis ${/redis_version:(\S+)/.exec(info)![1]}`;
console.log(
  `${engine}: ${payloads.length} distinct entries replayed; XLEN ${length}; field+value ${(bytes / CAP).toFixed(1)} B/entry; ` +
    `MEMORY USAGE ${usage} B (${(usage / length).toFixed(1)} B/entry, ${(usage / 2 ** 20).toFixed(1)} MiB); ` +
    `used_memory +${after - before} B (${((after - before) / 2 ** 20).toFixed(1)} MiB)`,
);
await redis.del("fill");
redis.destroy();
