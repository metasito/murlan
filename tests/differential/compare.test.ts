import { test } from "node:test";
import assert from "node:assert/strict";
import { compareTraces, parseTrace, type Accepted } from "./compare.ts";

const round = (finishingOrder: string[]) => ({ finishingOrder, moves: 20, target: 21, cumulativeAfter: {} });
const match = (table: string, seed: number, orders: string[][]) =>
  JSON.stringify({ level: "match", table, seed, rounds: orders.map(round), winners: ["player_0"], isDraw: false });
const transition = (table: string, seed: number, seq: number, currentTurnIndex: number) =>
  JSON.stringify({ level: "transition", table, seed, round: 0, seq, kind: seq ? "play" : "deal", seat: null, cardIds: [], handCounts: [14, 14], currentTurnIndex });

const baseline = parseTrace([match("2", 1, [["player_0", "player_1"]]), match("3", 2, [["player_2", "player_1", "player_0"]])].join("\n"));
const headDiffering = parseTrace([match("2", 1, [["player_1", "player_0"]]), match("3", 2, [["player_2", "player_1", "player_0"]])].join("\n"));
const accepted = (entries: Accepted["entries"]): Accepted => ({ baseline: "abc", entries });

test("a differing match listed in accepted.json passes, at round level when either side lacks transitions", () => {
  const report = compareTraces(baseline, headDiffering, accepted([{ table: "2", seed: 1, cause: "planted" }]));
  assert.equal(report.level, "round");
  assert.equal(report.matches, 2);
  assert.equal(report.rounds, 2);
  assert.deepEqual(report.diffs, [{ key: "2:1", where: "round 0" }]);
  assert.deepEqual(report.failures, []);
});

test("an unlisted diff fails, naming the match and where it first differs", () => {
  const report = compareTraces(baseline, headDiffering, accepted([]));
  assert.deepEqual(report.failures, ["unlisted diff 2:1 at round 0"]);
});

test("an entry that no longer differs fails as stale", () => {
  const report = compareTraces(baseline, baseline, accepted([{ table: "3", seed: 2, cause: "planted" }]));
  assert.deepEqual(report.diffs, []);
  assert.deepEqual(report.failures, ["stale entry 3:2: it no longer differs"]);
});

test("an empty trace fails for comparing zero matches, not for its diffs", () => {
  const report = compareTraces([], parseTrace("\n"), accepted([]));
  assert.equal(report.matches, 0);
  assert.deepEqual(report.failures, ["compared zero matches"]);
});

test("matches that played no round fail for comparing zero rounds", () => {
  const empty = parseTrace(match("2", 1, []));
  assert.deepEqual(compareTraces(empty, empty, accepted([])).failures, ["compared zero rounds"]);
});

test("accepted.json written against another baseline fails", () => {
  const report = compareTraces(baseline, baseline, accepted([]), { baseline: "def" });
  assert.deepEqual(report.failures, ["accepted.json describes baseline abc, not def"]);
});

test("both sides offering transitions compare there, catching a diff the rounds hide", () => {
  const a = parseTrace([match("2", 1, [["player_0", "player_1"]]), transition("2", 1, 0, 0)].join("\n"));
  const b = parseTrace([match("2", 1, [["player_0", "player_1"]]), transition("2", 1, 0, 1)].join("\n"));
  const report = compareTraces(a, b);
  assert.equal(report.level, "transition");
  assert.deepEqual(report.diffs, [{ key: "2:1", where: "round 0, transition 0 (deal vs deal)" }]);
});

test("--match compares that one match only", () => {
  const report = compareTraces(baseline, headDiffering, undefined, { only: "3:2" });
  assert.equal(report.matches, 1);
  assert.deepEqual(report.diffs, []);
});
