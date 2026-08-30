// tests/integration/soakLogReplays.test.ts — a soak run, pinned.
//
// #567 described the pipeline: the soak finds it, the suite pins it. The seed
// could not carry that. The server deals from `crypto`, so re-running a seed
// deals a different hand and every card id the failure printed belongs to a
// game that no longer exists. What survives is the log the soak now prints.
//
// The log below is not written by hand. It is the output of
//   npm run soak -- --seats 4 --minutes 0.2 --seed 4242 --chaos 0
// on 2026-08-31, copied from the JSON the runner prints. That is the whole
// claim of this file: a printed log is enough to rebuild the hand it came from,
// on a fresh server, and get the same table back.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { hasDatabase, skipMessage, startTestServer, type TestServer } from "../helpers/testServer.ts";
import { replaySoakLog } from "../soak/replay.ts";
import type { SoakLogEntry } from "../soak/soak.ts";

const CAPTURED: SoakLogEntry[] = [
  {
    at: 0,
    kind: "deal",
    manche: 0,
    hands: [
      ["3_hearts", "4_clubs", "5_clubs", "7_diamonds", "7_hearts", "8_clubs", "10_clubs", "10_hearts", "J_diamonds", "J_spades", "K_hearts", "K_spades", "A_spades", "joker_bw"],
      ["3_spades", "4_diamonds", "4_spades", "6_clubs", "6_hearts", "7_clubs", "7_spades", "8_diamonds", "8_spades", "10_spades", "J_clubs", "Q_diamonds", "2_diamonds", "joker_colored"],
      ["3_diamonds", "5_diamonds", "5_hearts", "5_spades", "6_spades", "8_hearts", "J_hearts", "Q_clubs", "Q_hearts", "Q_spades", "K_diamonds", "2_hearts", "2_spades"],
      ["3_clubs", "4_hearts", "6_diamonds", "9_clubs", "9_diamonds", "9_hearts", "9_spades", "10_diamonds", "K_clubs", "A_clubs", "A_diamonds", "A_hearts", "2_clubs"],
    ],
  },
  { at: 1, kind: "play", seat: 1, cardIds: ["3_spades"] },
  { at: 2, kind: "play", seat: 0, cardIds: ["A_spades"] },
  { at: 3, kind: "play", seat: 3, cardIds: ["2_clubs"] },
  { at: 4, kind: "pass", seat: 2 },
  { at: 5, kind: "play", seat: 1, cardIds: ["joker_colored"] },
  { at: 6, kind: "pass", seat: 0 },
  { at: 7, kind: "play", seat: 3, cardIds: ["9_clubs", "9_diamonds", "9_hearts", "9_spades"] },
  { at: 8, kind: "pass", seat: 2 },
  { at: 9, kind: "pass", seat: 1 },
  { at: 10, kind: "pass", seat: 0 },
  { at: 11, kind: "play", seat: 3, cardIds: ["6_diamonds"] },
  { at: 12, kind: "play", seat: 2, cardIds: ["2_hearts"] },
  { at: 13, kind: "pass", seat: 1 },
  { at: 14, kind: "play", seat: 0, cardIds: ["joker_bw"] },
  { at: 15, kind: "pass", seat: 3 },
  { at: 16, kind: "pass", seat: 2 },
  { at: 17, kind: "pass", seat: 1 },
  { at: 18, kind: "play", seat: 0, cardIds: ["J_diamonds"] },
  { at: 19, kind: "play", seat: 3, cardIds: ["A_clubs"] },
  { at: 20, kind: "play", seat: 2, cardIds: ["2_spades"] },
  { at: 21, kind: "pass", seat: 1 },
  { at: 22, kind: "pass", seat: 0 },
  { at: 23, kind: "pass", seat: 3 },
  { at: 24, kind: "play", seat: 2, cardIds: ["Q_clubs", "Q_hearts"] },
];

/** Cards each seat had left when the run above stopped. */
const FINAL_COUNTS = [11, 12, 9, 6];

/** Derived, not counted: `drop` and `rejoin` entries are replayed without applying a move. */
const MOVES = CAPTURED.filter(
  (e) => e.kind === "play" || e.kind === "pass" || e.kind === "exchange"
).length;

describe("a printed soak log replays as a fixed case", {
  skip: hasDatabase() ? false : skipMessage(),
}, () => {
  // One server for both replays: `stop()` ends the shared pg pool, so a second
  // `startTestServer` in this process would boot onto a closed one.
  let server: TestServer;
  before(async () => {
    server = await startTestServer();
  });
  after(async () => {
    await server.stop();
  });

  test("every move of a real run applies again, and the table agrees", async () => {
    const result = await replaySoakLog(CAPTURED, server);

    assert.deepEqual(result.skipped, [], "the server refused a move this log says it accepted");
    assert.equal(result.applied, MOVES);
    assert.deepEqual(result.finalCounts, FINAL_COUNTS);
    assert.deepEqual(result.violations, [], JSON.stringify(result.violations));
  });

  // The floor. Every assertion above is also satisfied by a replay that seats
  // four clients and lets the game play itself, so without a log the driver
  // refuses to follow, this file would pass while replaying nothing.
  test("a log the table cannot follow is reported, not played around", async () => {
    const tampered = CAPTURED.map((entry) =>
      entry.at === 7 ? { ...entry, kind: "play" as const, seat: 3, cardIds: ["3_spades"] } : entry
    );
    const result = await replaySoakLog(tampered, server);

    assert.ok(
      result.skipped.length > 0,
      "a card the seat does not hold was reported as applied"
    );
    assert.equal(typeof result.abandonedAt, "number", "it should say it gave up, not just stop");
    assert.notDeepEqual(result.finalCounts, FINAL_COUNTS);
  });
});
