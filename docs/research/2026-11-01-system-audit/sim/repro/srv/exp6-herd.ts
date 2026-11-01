// Claim 6: the reconnect herd after a restart, computed with the installed code itself —
// socket.io-client's Backoff with lib/socket.ts's options, and lib/reconnectDelay.ts for the app's
// own loop — not a restated formula. Pure computation; no server.
import { createRequire } from "node:module";
import path from "node:path";
import { reconnectDelayMs } from "../../../../../../lib/reconnectDelay.ts";
import { out } from "./lib.ts";

const require = createRequire(import.meta.url);
const { Backoff } = require(path.join(path.dirname(require.resolve("socket.io-client")), "contrib/backo2.js")) as {
  Backoff: new (o: { min: number; max: number; jitter: number }) => { duration(): number; attempts: number };
};
// lib/socket.ts: reconnectionDelay 1000, reconnectionDelayMax 5000, randomizationFactor unset (0.5).
const OPTS = { min: 1000, max: 5000, jitter: 0.5 };
const { log, save } = out("exp6.txt");
const N = 1000;
const TICKETS_PER_MIN = 60; // ticketLimiter: 60 a minute, per IP, per instance (MemoryStore)

function buckets(times: number[], width = 250, until = 3000) {
  const rows: string[] = [];
  for (let b = 0; b < until; b += width) {
    const n = times.filter((t) => t >= b && t < b + width).length;
    rows.push(`  ${String(b).padStart(4)}-${String(b + width).padStart(4)} ms: ${String(n).padStart(4)} ${"#".repeat(Math.round(n / 10))}`);
  }
  return rows;
}

log("# exp6: reconnect herd, 1,000 clients, socket.io-client Backoff {min 1000, max 5000, jitter 0.5}");

// Scenario A: a rolling deploy. Another instance is already up, so every first attempt opens and
// mints a ticket (lib/socket.ts `auth` runs once the transport opens, before CONNECT).
const first = Array.from({ length: N }, () => new Backoff(OPTS).duration());
first.sort((a, b) => a - b);
log("\n## A: replacement already up; first reconnect attempt per client (each mints one ticket)");
log(`range ${first[0]}-${first.at(-1)} ms, all ${N} inside ${((first.at(-1)! - first[0]!) / 1000).toFixed(2)} s`);
for (const r of buckets(first)) log(r);
const comb = new Map<number, number>();
for (const t of first) comb.set(Math.floor(t / 50) * 50, (comb.get(Math.floor(t / 50) * 50) ?? 0) + 1);
log("50 ms strips that hold any attempt:", [...comb.keys()].sort((a, b) => a - b).map((k) => `${k}:${comb.get(k)}`).join(" "));
log("(one Math.random() picks both the sign and the size of the deviation: rand in [k/10,(k+1)/10) gives");
log(" deviation 50k..50k+50 ms, minus for even k, plus for odd k -> ten 50 ms teeth, 50 ms gaps, 550-1500 ms)");

// Scenario B: a single instance restarts and is unreachable for DOWN ms. Failed attempts back off.
for (const DOWN of [2000, 5000]) {
  const attempts: number[] = [];
  const tickets: number[] = [];
  for (let i = 0; i < N; i++) {
    const b = new Backoff(OPTS);
    let t = 0;
    for (;;) {
      t += b.duration();
      attempts.push(t);
      if (t >= DOWN) {
        tickets.push(t);
        break;
      }
    }
  }
  log(`\n## B: one instance, down for ${DOWN} ms; every attempt, failed ones included`);
  for (const r of buckets(attempts, 250, Math.max(3000, DOWN + 1500))) log(r);
  tickets.sort((a, b) => a - b);
  log(`tickets minted once it is back: all ${N} between ${tickets[0]} and ${tickets.at(-1)} ms (${((tickets.at(-1)! - tickets[0]!) / 1000).toFixed(2)} s)`);
}

// Tickets per IP against the limiter, for clients sharing one address.
log("\n## tickets per IP in the first minute vs the 60/minute ticketLimiter (scenario A, one attempt each)");
for (const perIp of [10, 60, 100, 300, 1000]) {
  const over = Math.max(0, perIp - TICKETS_PER_MIN);
  log(`  ${String(perIp).padStart(4)} clients behind one IP: ${perIp} ticket requests within ~1 s -> ${over} answered 429`);
}

// What a 429 does: web (cookie on the upgrade) still authenticates; native (ticket only) is refused
// "Not authenticated", socket.active goes false, and SocketContext's own loop retries with
// reconnectDelayMs (full jitter, base 2 s, cap 30 s) — each retry another ticket request.
log("\n## native clients behind one IP after a 429: SocketContext loop, every retry mints again");
for (const perIp of [100, 300]) {
  let windowStart = -1;
  let used = 0;
  let refused = 0;
  const done: number[] = [];
  type C = { next: number; attempt: number };
  const clients: C[] = Array.from({ length: perIp }, () => ({ next: new Backoff(OPTS).duration(), attempt: 0 }));
  const queue = [...clients];
  while (queue.length) {
    queue.sort((a, b) => a.next - b.next);
    const c = queue.shift()!;
    if (windowStart < 0 || c.next - windowStart >= 60_000) {
      windowStart = c.next;
      used = 0;
    }
    if (used < TICKETS_PER_MIN) {
      used += 1;
      done.push(c.next);
      continue;
    }
    refused += 1;
    c.next += reconnectDelayMs(c.attempt++);
    queue.push(c);
  }
  done.sort((a, b) => a - b);
  log(`  ${perIp} natives: ${refused} ticket requests answered 429; connected by 10 s: ${done.filter((t) => t < 10_000).length}, by 61 s: ${done.filter((t) => t < 61_000).length}, last at ${(done.at(-1)! / 1000).toFixed(1)} s`);
}
log("web clients: a 429 makes fetchSocketTicket return null, auth sends no ticket, and the cookie on the");
log("upgrade authenticates anyway (server/socket/socket.ts:142-144) - the limiter costs web nothing but the request.");
save();
