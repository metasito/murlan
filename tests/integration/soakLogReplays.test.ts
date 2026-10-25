// tests/integration/soakLogReplays.test.ts — a soak run, pinned.
//
// #567 described the pipeline: the soak finds it, the suite pins it. The seed
// could not carry that. The server deals from `crypto`, so re-running a seed
// deals a different hand and every card id the failure printed belongs to a
// game that no longer exists. What survives is the log the soak now prints.
//
// The log below is not written by hand. It is the output of
//   npm run soak -- --seats 4 --minutes 0.2 --seed 4242 --chaos 0
// on 2026-10-25, copied from the JSON the runner prints. That is the whole
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
      ["4_diamonds", "4_hearts", "5_clubs", "5_hearts", "7_diamonds", "7_hearts", "8_diamonds", "8_spades", "9_clubs", "9_hearts", "9_spades", "J_clubs", "Q_clubs", "Q_hearts"],
      ["3_clubs", "4_clubs", "5_spades", "8_clubs", "9_diamonds", "10_hearts", "10_spades", "J_spades", "K_diamonds", "K_hearts", "A_spades", "2_clubs", "2_spades", "joker_bw"],
      ["3_diamonds", "3_spades", "4_spades", "5_diamonds", "6_clubs", "6_diamonds", "6_hearts", "6_spades", "10_diamonds", "K_spades", "A_diamonds", "2_diamonds", "joker_colored"],
      ["3_hearts", "7_clubs", "7_spades", "8_hearts", "10_clubs", "J_diamonds", "J_hearts", "Q_diamonds", "Q_spades", "K_clubs", "A_clubs", "A_hearts", "2_hearts"],
    ],
  },
  { at: 1, kind: "move", seat: 2, move: { kind: "play", cardIds: ["3_diamonds", "3_spades"] } },
  { at: 2, kind: "move", seat: 1, move: { kind: "play", cardIds: ["2_clubs", "2_spades"] } },
  { at: 3, kind: "move", seat: 0, move: { kind: "pass" } },
  { at: 4, kind: "move", seat: 3, move: { kind: "pass" } },
  { at: 5, kind: "move", seat: 2, move: { kind: "play", cardIds: ["6_clubs", "6_diamonds", "6_hearts", "6_spades"] } },
  { at: 6, kind: "move", seat: 1, move: { kind: "pass" } },
  { at: 7, kind: "move", seat: 0, move: { kind: "pass" } },
  { at: 8, kind: "move", seat: 3, move: { kind: "pass" } },
  { at: 9, kind: "move", seat: 2, move: { kind: "play", cardIds: ["joker_colored"] } },
  { at: 10, kind: "move", seat: 1, move: { kind: "pass" } },
  { at: 11, kind: "move", seat: 0, move: { kind: "pass" } },
  { at: 12, kind: "move", seat: 3, move: { kind: "pass" } },
  { at: 13, kind: "move", seat: 2, move: { kind: "play", cardIds: ["K_spades"] } },
  { at: 14, kind: "move", seat: 1, move: { kind: "play", cardIds: ["A_spades"] } },
  { at: 15, kind: "move", seat: 0, move: { kind: "pass" } },
  { at: 16, kind: "move", seat: 3, move: { kind: "play", cardIds: ["2_hearts"] } },
  { at: 17, kind: "move", seat: 2, move: { kind: "pass" } },
  { at: 18, kind: "move", seat: 1, move: { kind: "play", cardIds: ["joker_bw"] } },
  { at: 19, kind: "move", seat: 0, move: { kind: "pass" } },
  { at: 20, kind: "move", seat: 3, move: { kind: "pass" } },
  { at: 21, kind: "move", seat: 2, move: { kind: "pass" } },
  { at: 22, kind: "move", seat: 1, move: { kind: "play", cardIds: ["8_clubs"] } },
  { at: 23, kind: "move", seat: 0, move: { kind: "play", cardIds: ["J_clubs"] } },
  { at: 24, kind: "move", seat: 3, move: { kind: "play", cardIds: ["Q_diamonds"] } },
];

/** Cards each seat had left when the run above stopped. */
const FINAL_COUNTS = [13, 9, 5, 11];

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

  // A fault the run saw land moved the table, and every entry after it was written against
  // that table. Here a landed entry stands for seat 3's pass from move 4 as a second pass,
  // so seat 2's four sixes at 5 only follow if the replay applies it. A server that checks the turn
  // token no longer writes such an entry; the replay must still follow one.
  test("a fault that landed is replayed as the move it carried", async () => {
    const throughThree = CAPTURED.filter((entry) => entry.at <= 3);
    const latePass: SoakLogEntry = {
      at: 3,
      kind: "restart-duplicate",
      move: { kind: "move", seat: 3, move: { kind: "pass" } },
      intentId: "i1",
      landed: true,
    };
    const log: SoakLogEntry[] = [
      ...throughThree,
      { at: 3, kind: "restart" },
      latePass,
      { at: 5, kind: "move", seat: 2, move: { kind: "play", cardIds: ["6_clubs", "6_diamonds", "6_hearts", "6_spades"] } },
    ];
    const moves = throughThree.filter((e) => e.kind === "move").length;

    const result = await replaySoakLog(log, server);

    assert.deepEqual(result.skipped, [], "the replay did not reach the table the run had");
    assert.equal(result.applied, moves + 2);
    assert.deepEqual(result.finalCounts, [14, 12, 7, 13]);

    const turnedAway = await replaySoakLog(
      log.map((entry) => (entry === latePass ? { ...latePass, landed: false } : entry)),
      server
    );
    assert.equal(turnedAway.abandonedAt, 5, "a fault the server refused was applied anyway");
  });

  // The floor. Every assertion above is also satisfied by a replay that seats
  // four clients and lets the game play itself, so without a log the driver
  // refuses to follow, this file would pass while replaying nothing.
  test("a log the table cannot follow is reported, not played around", async () => {
    const tampered = CAPTURED.map((entry) =>
      entry.at === 7
        ? { at: 7, kind: "move" as const, seat: 0, move: { kind: "play" as const, cardIds: ["3_spades"] } }
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
