// tests/integration/soakLogReplays.test.ts — a soak run, pinned.
//
// #567 described the pipeline: the soak finds it, the suite pins it. The seed
// could not carry that. The server deals from `crypto`, so re-running a seed
// deals a different hand and every card id the failure printed belongs to a
// game that no longer exists. What survives is the log the soak now prints.
//
// The log below is not written by hand. It is the output of
//   npm run soak -- --seats 4 --minutes 0.2 --seed 4242 --chaos 0
// on 2026-10-21, copied from the JSON the runner prints. That is the whole
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
    round: 0,
    hands: [
      ["3_clubs", "5_clubs", "6_diamonds", "6_spades", "7_spades", "9_spades", "10_spades", "J_hearts", "Q_diamonds", "Q_hearts", "2_diamonds", "2_hearts", "2_spades", "joker_bw"],
      ["6_clubs", "6_hearts", "7_clubs", "8_hearts", "9_clubs", "9_diamonds", "J_diamonds", "J_spades", "Q_spades", "K_diamonds", "K_hearts", "A_diamonds", "A_spades", "2_clubs"],
      ["4_clubs", "5_diamonds", "5_hearts", "7_diamonds", "8_spades", "10_diamonds", "10_hearts", "J_clubs", "K_clubs", "K_spades", "A_clubs", "A_hearts", "joker_colored"],
      ["3_diamonds", "3_hearts", "3_spades", "4_diamonds", "4_hearts", "4_spades", "5_spades", "7_hearts", "8_clubs", "8_diamonds", "9_hearts", "10_clubs", "Q_clubs"],
    ],
  },
  { at: 1, kind: "move", seat: 3, move: { kind: "play", cardIds: ["3_spades"] } },
  { at: 2, kind: "move", seat: 2, move: { kind: "play", cardIds: ["A_clubs"] } },
  { at: 3, kind: "move", seat: 1, move: { kind: "play", cardIds: ["2_clubs"] } },
  { at: 4, kind: "move", seat: 0, move: { kind: "play", cardIds: ["joker_bw"] } },
  { at: 5, kind: "move", seat: 3, move: { kind: "pass" } },
  { at: 6, kind: "move", seat: 2, move: { kind: "play", cardIds: ["joker_colored"] } },
  { at: 7, kind: "move", seat: 1, move: { kind: "pass" } },
  { at: 8, kind: "move", seat: 0, move: { kind: "pass" } },
  { at: 9, kind: "move", seat: 3, move: { kind: "pass" } },
  { at: 10, kind: "move", seat: 2, move: { kind: "play", cardIds: ["10_diamonds"] } },
  { at: 11, kind: "move", seat: 1, move: { kind: "play", cardIds: ["K_diamonds"] } },
  { at: 12, kind: "move", seat: 0, move: { kind: "play", cardIds: ["2_diamonds"] } },
  { at: 13, kind: "move", seat: 3, move: { kind: "pass" } },
  { at: 14, kind: "move", seat: 2, move: { kind: "pass" } },
  { at: 15, kind: "move", seat: 1, move: { kind: "pass" } },
  { at: 16, kind: "move", seat: 0, move: { kind: "play", cardIds: ["2_hearts"] } },
  { at: 17, kind: "move", seat: 3, move: { kind: "pass" } },
  { at: 18, kind: "move", seat: 2, move: { kind: "pass" } },
  { at: 19, kind: "move", seat: 1, move: { kind: "pass" } },
  { at: 20, kind: "move", seat: 0, move: { kind: "play", cardIds: ["10_spades"] } },
  { at: 21, kind: "move", seat: 3, move: { kind: "play", cardIds: ["Q_clubs"] } },
  { at: 22, kind: "move", seat: 2, move: { kind: "play", cardIds: ["A_hearts"] } },
  { at: 23, kind: "move", seat: 1, move: { kind: "pass" } },
  { at: 24, kind: "move", seat: 0, move: { kind: "play", cardIds: ["2_spades"] } },
];

/** Cards each seat had left when the run above stopped. */
const FINAL_COUNTS = [9, 12, 9, 11];

/** Derived, not counted: `drop` and `rejoin` entries are replayed without applying a move. */
const MOVES = CAPTURED.filter((e) => e.kind === "move").length;

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
      entry.at === 7
        ? { at: 7, kind: "move" as const, seat: 3, move: { kind: "play" as const, cardIds: ["3_spades"] } }
        : entry
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
