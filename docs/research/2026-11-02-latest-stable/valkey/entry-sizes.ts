// Plays tables whose seats alternate between two real server processes, then reads every entry the
// cluster streams hold: the inbox streams (`inbox:<instance>`) and the adapter's room stream.
// A one-instance soak writes neither (delivery is local-first), so this is what measures them.
// Run from the repo root:
//   DATABASE_URL=postgres://postgres@localhost:55432/<db> REDIS_URL=redis://127.0.0.1:<port> \
//     [DUMP=<file>] node docs/research/2026-11-02-latest-stable/valkey/entry-sizes.ts <tables> <minutes> <seed>
// DUMP writes each inbox entry's `m` value, one per line, for fill.ts to replay.
import { appendFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { createClient, RESP_TYPES } from "redis";
import { boot, freePorts, stopInstance, at, type Instance } from "../../../../tests/helpers/instance.ts";
import { connectAs } from "../../../../tests/helpers/client.ts";
import { Seat, seatSocket, settle } from "../../../../tests/soak/soak.ts";
import type { TestServer } from "../../../../tests/helpers/testServer.ts";
import type { WireRoomState } from "../../../../shared/protocol.ts";

const [tables = 8, minutes = 1, seed = 4242] = process.argv.slice(2).map(Number);
const databaseUrl = process.env.DATABASE_URL!;
const redisUrl = process.env.REDIS_URL!;
if (!databaseUrl || !redisUrl) throw new Error("DATABASE_URL and REDIS_URL are required");

function makeRng(s: number): () => number {
  let state = s >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x100000000;
  };
}

const env = {
  REDIS_URL: redisUrl,
  MURLAN_PG_POOL_MAX: "10",
  MURLAN_SOCKET_ADAPTER_POOL_MAX: "4",
  MURLAN_AUTH_RATE_LIMIT: "100000",
  MURLAN_TICKET_RATE_LIMIT: "100000",
};

async function openSplitTable(ports: number[], seats: Seat[], tag: string): Promise<void> {
  for (let i = 0; i < 4; i++) {
    const server = { url: at(ports[i % ports.length]) } as TestServer;
    const c = await connectAs(server, `es_${tag}_${i}`);
    seats.push(new Seat(c.socket, c.user.username, c.user.id, c.cookie));
  }
  const room = await new Promise<WireRoomState>((resolve) => {
    seatSocket(seats[0]).once("room:state", resolve);
    seatSocket(seats[0]).emit("room:create", { gameMode: "free_for_all", maxPlayers: 4 });
  });
  for (const seat of seats.slice(1)) {
    await new Promise<void>((resolve) => {
      seatSocket(seat).once("room:state", () => resolve());
      seatSocket(seat).emit("room:join", { code: room.code });
    });
  }
  seatSocket(seats[0]).emit("room:start");
}

async function play(seats: Seat[], rng: () => number, until: number): Promise<number> {
  let moves = 0;
  while (Date.now() < until) {
    if (seats.every((s) => s.state?.roundOver)) {
      for (const seat of seats) seatSocket(seat).emit("game:rematch_vote");
      await sleep(700);
      continue;
    }
    let acted = false;
    for (const seat of seats) {
      const answered = new Promise<boolean>((resolve) => seatSocket(seat).once("game:state", () => resolve(true)));
      if (!seat.act(rng)) continue;
      acted = true;
      moves += 1;
      await Promise.race([answered, sleep(5_000, false, { ref: false })]);
    }
    if (!acted) await sleep(5);
  }
  return moves;
}

type Sizes = { entries: number; bytes: number[]; memory: number; kinds: Map<string, number[]> };

async function readStreams(): Promise<Map<string, Sizes>> {
  const redis = createClient({ url: redisUrl, RESP: 2 }).withTypeMapping({ [RESP_TYPES.BLOB_STRING]: Buffer });
  await redis.connect();
  const out = new Map<string, Sizes>();
  try {
    for await (const keys of redis.scanIterator({ TYPE: "stream", COUNT: 500 })) {
      for (const raw of keys) {
        const key = String(raw);
        const kind = key.includes(":inbox:") ? "inbox" : key.includes("socket.io") ? "adapter" : key;
        const sizes = out.get(kind) ?? { entries: 0, bytes: [], memory: 0, kinds: new Map() };
        out.set(kind, sizes);
        sizes.memory += Number(await redis.sendCommand(["MEMORY", "USAGE", key, "SAMPLES", "0"]));
        let start = "-";
        for (;;) {
          const page = (await redis.sendCommand(["XRANGE", key, start, "+", "COUNT", "1000"])) as [Buffer, Buffer[]][];
          if (page.length === 0) break;
          for (const [id, fields] of page) {
            const size = fields.reduce((sum, f) => sum + f.length, 0);
            sizes.entries += 1;
            sizes.bytes.push(size);
            if (kind === "inbox") {
              const at = fields.findIndex((f, i) => i % 2 === 0 && String(f) === "m");
              if (process.env.DUMP) appendFileSync(process.env.DUMP, `${String(fields[at + 1])}\n`);
              let name = "?";
              try {
                const message = JSON.parse(String(fields[at + 1]));
                name = message.kind === "deliver" ? `deliver:${(message.items ?? []).map((x: { t: string }) => x.t).join("+") || "?"}` : message.kind;
              } catch {}
              const list = sizes.kinds.get(name) ?? [];
              list.push(size);
              sizes.kinds.set(name, list);
            }
            start = `(${String(id)}`;
          }
        }
      }
    }
  } finally {
    redis.destroy();
  }
  return out;
}

const stat = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(s.length * p))] ?? 0;
  const mean = s.reduce((a, b) => a + b, 0) / (s.length || 1);
  return `n=${s.length} mean=${mean.toFixed(1)} p50=${q(0.5)} p90=${q(0.9)} p99=${q(0.99)} max=${s.at(-1) ?? 0}`;
};

const ports = await freePorts(2);
const instances: Instance[] = [];
try {
  for (const port of ports) instances.push(await boot(port, databaseUrl, env));
  const rng = makeRng(seed);
  const all: Seat[][] = [];
  const tag = Date.now().toString(36);
  for (let t = 0; t < tables; t++) {
    const seats: Seat[] = [];
    all.push(seats);
    await openSplitTable(ports, seats, `${tag}${t}`);
  }
  await Promise.all(all.map((s) => settle(s)));
  const started = performance.now();
  const until = Date.now() + minutes * 60_000;
  const moves = (await Promise.all(all.map((s) => play(s, rng, until)))).reduce((a, b) => a + b, 0);
  const seconds = (performance.now() - started) / 1000;
  await sleep(1_000);
  console.log(`entry-sizes: ${tables} tables split over 2 instances, ${moves} moves in ${seconds.toFixed(1)}s`);
  for (const [kind, sizes] of await readStreams()) {
    console.log(
      `${kind}: ${sizes.entries} entries, field+value bytes ${stat(sizes.bytes)}; ` +
        `MEMORY USAGE ${sizes.memory} B = ${(sizes.memory / (sizes.entries || 1)).toFixed(1)} B/entry`,
    );
    for (const [name, list] of [...sizes.kinds].sort((a, b) => b[1].length - a[1].length)) {
      console.log(`  ${name}: ${stat(list)}`);
    }
  }
  for (const seats of all) for (const seat of seats) seatSocket(seat).close();
} finally {
  await Promise.all(instances.map((i) => stopInstance(i.child)));
}
