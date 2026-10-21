// Every fixed real-time wait left in the server-side suites, counted exactly. A test waits on
// server time by installing a clock and advancing it, on an event or an ack by awaiting it, and on
// an absence with `nothingArrives`; real time is left only where real time is the subject.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fixedSleeps } from "../helpers/sleepScan.ts";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const SCANNED = ["tests/integration", "tests/server", "tests/helpers"];

/** Exact, not a ceiling: a wait removed goes red until its entry is lowered, so the list only shrinks. */
const INVENTORY: Record<string, { n: number; why: string }> = {
  "tests/helpers/client.ts": {
    n: 2,
    why: "nothingArrives' window, since absence has no event to await; and eventually's poll cadence, for state that pushes nothing",
  },
  "tests/integration/disposeTombstone.test.ts": {
    n: 1,
    why: "the window after dispose in which the room must stay unclaimable while its row's delete is held",
  },
  "tests/integration/events.test.ts": {
    n: 1,
    why: "a second tutorial.started row is an absence, and the event write is fire-and-forget with nothing to await",
  },
  "tests/integration/ownerLoss.test.ts": {
    n: 2,
    why: "the owner process is killed a beat after its deal persisted; and a disconnect handler slower than the teardown is the scenario",
  },
  "tests/integration/postgresRestart.test.ts": {
    n: 1,
    why: "both instances are watched staying up after they resubscribe: a crash that follows has no event to await",
  },
  "tests/integration/reconnect.test.ts": {
    n: 2,
    why: "reconnectOnALoop's cadence is the stimulus: two drop-and-return cycles inside one AFK window",
  },
  "tests/integration/roomLifecycleRaces.test.ts": {
    n: 1,
    why: "the database is held closed while two writes race, and that window is the race",
  },
  "tests/integration/socketHandshakeLimit.test.ts": {
    n: 4,
    why: "the server's offline notice waits on a real 400ms timer no installed clock reaches, which quiet() and after() outwait; quiet() polls engine and pool counts that push nothing; and the connect's second friends read is fire-and-forget",
  },
  "tests/integration/socketOrigin.test.ts": {
    n: 1,
    why: "after() outwaits the server's offline notice, a real 400ms timer no installed clock reaches",
  },
  "tests/integration/takeoverSerialised.test.ts": {
    n: 1,
    why: "the restore's stand-in database read: the window a second racer has to land inside",
  },
  "tests/server/adminConcurrency.test.ts": {
    n: 1,
    why: "staggered task durations are the stimulus that interleaves completions against the limit",
  },
  "tests/server/closeDatabaseBusy.test.ts": {
    n: 1,
    why: "the pool is held busy, and `ended` is watched not settling for that long",
  },
  "tests/server/closeTableShutdown.test.ts": {
    n: 1,
    why: "a slow status write is the stimulus the shutdown has to outwait",
  },
  "tests/server/publishOrder.test.ts": {
    n: 1,
    why: "a row write still in flight is the stimulus the last leaver's delete has to queue behind",
  },
  "tests/server/sessionEviction.test.ts": {
    n: 1,
    why: "socket.io stamps handshake.issued from the real clock, and the two sockets need distinct stamps",
  },
  "tests/server/stallHygiene.test.ts": {
    n: 1,
    why: "the deadline a deal has to beat: a stall is the absence of the event",
  },
};

const CODE = /\.(?:[cm]?[jt]s|tsx)$/;

function sources(): [string, string][] {
  return SCANNED.flatMap((dir) =>
    readdirSync(path.join(repoRoot, dir), { recursive: true, encoding: "utf8" })
      .filter((f) => CODE.test(f))
      .map((f): [string, string] => {
        const rel = path.posix.join(dir, f.split(path.sep).join("/"));
        return [rel, readFileSync(path.join(repoRoot, rel), "utf8")];
      })
  );
}

const files = sources();
const counts = new Map<string, number[]>();
for (const s of fixedSleeps(files)) counts.set(s.file, [...(counts.get(s.file) ?? []), s.line]);

test("the suites are scanned at all", () => {
  for (const dir of SCANNED) {
    assert.ok(files.filter(([f]) => f.startsWith(`${dir}/`)).length > 10, `fewer than ten files under ${dir}: the walk no longer sees it`);
  }
  assert.ok(counts.size > 0, "no fixed wait found anywhere, which the inventory says is false");
});

test("every fixed real-time wait left is inventoried, at its exact count", () => {
  const found = Object.fromEntries([...counts].map(([file, lines]) => [file, lines.length]));
  const pinned = Object.fromEntries(Object.entries(INVENTORY).map(([file, { n }]) => [file, n]));
  assert.deepEqual(
    found,
    pinned,
    "Install a clock for server time, await the event or ack, or use nothingArrives for an absence. " +
      "A wait that is about real time itself is listed here with its reason; a removed one lowers its entry. " +
      `Found: ${JSON.stringify([...counts].map(([file, lines]) => `${file}: ${lines.join(", ")}`))}`
  );
});

test("each inventoried wait says why it is real time", () => {
  for (const [file, { why }] of Object.entries(INVENTORY)) {
    assert.ok(why.split(/\s+/).length >= 6, `${file}: say why this wait is about real time`);
  }
});
