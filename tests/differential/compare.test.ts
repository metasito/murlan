import { test } from "node:test";
import assert from "node:assert/strict";
import { compareTraces, parseTrace, type Accepted } from "./compare.ts";
import { TABLES } from "./trace.ts";

type Match = { orders?: string[][]; error?: string; turns?: number[] };

const round = (finishingOrder: string[]) => ({ finishingOrder, moves: 20, target: 21, cumulativeAfter: {} });
const lines = (table: string, seed: number, m: Match) => [
  JSON.stringify(
    m.error
      ? { level: "match", table, seed, error: m.error }
      : { level: "match", table, seed, rounds: (m.orders ?? [["player_0", "player_1"]]).map(round), winners: ["player_0"], isDraw: false }
  ),
  ...(m.turns ?? []).map((currentTurnIndex, seq) =>
    JSON.stringify({ level: "transition", table, seed, round: 0, seq, kind: seq ? "play" : "deal", seat: null, cardIds: [], handCounts: [14, 14], currentTurnIndex })
  ),
];
/** One seed at every table `trace.ts` plays; `over` replaces or (with null) drops a table's match. */
const trace = (over: Record<string, Match | null> = {}, turns?: number[]) =>
  parseTrace(
    Object.keys(TABLES)
      .flatMap((t) => (over[t] === null ? [] : lines(t, 1, { turns, ...over[t] })))
      .join("\n")
  );
const accepted = (entries: Accepted["entries"], level: Accepted["level"] = "round"): Accepted => ({ baseline: "abc", level, entries });
const swapped = { orders: [["player_1", "player_0"]] };

test("a differing match listed with where it first differs passes, at round level when either side lacks transitions", () => {
  const report = compareTraces(trace(), trace({ "2": swapped }), accepted([{ table: "2", seed: 1, round: 0, where: "round 0", cause: "planted" }]));
  assert.equal(report.level, "round");
  assert.equal(report.matches, Object.keys(TABLES).length);
  assert.deepEqual(report.diffs, [{ key: "2:1", round: 0, where: "round 0" }]);
  assert.deepEqual(report.failures, []);
});

test("an unlisted diff fails, naming the match and where it first differs", () => {
  const report = compareTraces(trace(), trace({ "2": swapped }), accepted([]));
  assert.deepEqual(report.failures, ["unlisted diff 2:1 at round 0"]);
});

test("an entry that no longer differs fails as stale", () => {
  const report = compareTraces(trace(), trace(), accepted([{ table: "3", seed: 1, round: 0, where: "round 0", cause: "planted" }]));
  assert.deepEqual(report.diffs, []);
  assert.deepEqual(report.failures, ["stale entry 3:1: it no longer differs"]);
});

test("an entry whose match now first differs somewhere else fails as moved", () => {
  const head = trace({ "2": { orders: [["player_0", "player_1"], ["player_1", "player_0"]] } });
  const base = trace({ "2": { orders: [["player_0", "player_1"], ["player_0", "player_1"]] } });
  const report = compareTraces(base, head, accepted([{ table: "2", seed: 1, round: 0, where: "round 0", cause: "planted" }]));
  assert.deepEqual(report.failures, ["moved entry 2:1: first differs at round 1, accepted at round 0"]);
});

test("an empty trace fails for comparing zero matches at every table", () => {
  const report = compareTraces([], parseTrace("\n"), accepted([]));
  assert.equal(report.matches, 0);
  assert.deepEqual(
    report.failures,
    Object.keys(TABLES).map((t) => `table ${t}: compared zero matches`)
  );
});

test("one table missing fails for that table alone", () => {
  const report = compareTraces(trace({ "3": null }), trace({ "3": null }), accepted([]));
  assert.deepEqual(report.failures, ["table 3: compared zero matches"]);
});

test("a table whose matches played no round fails for comparing zero rounds", () => {
  const empty = trace({ "4": { orders: [] } });
  assert.deepEqual(compareTraces(empty, empty, accepted([])).failures, ["table 4: compared zero rounds"]);
});

test("a match that errored identically on both sides fails instead of comparing equal", () => {
  const broken = trace({ "2": { error: "MatchStallError: stuck" } });
  const report = compareTraces(broken, broken, accepted([]));
  assert.deepEqual(report.diffs, []);
  assert.deepEqual(report.failures, ["table 2: compared zero rounds", "match 2:1 errored on baseline: MatchStallError: stuck", "match 2:1 errored on head: MatchStallError: stuck"]);
});

test("accepted.json written against another baseline fails", () => {
  const report = compareTraces(trace(), trace(), accepted([]), { baseline: "def" });
  assert.deepEqual(report.failures, ["accepted.json describes baseline abc, not def"]);
});

test("both sides offering transitions compare there, catching a diff the rounds hide", () => {
  const report = compareTraces(trace({ "2": { turns: [0] } }, [0]), trace({ "2": { turns: [1] } }, [0]), accepted([], "transition"));
  assert.equal(report.level, "transition");
  assert.deepEqual(report.diffs, [{ key: "2:1", round: 0, where: "round 0, transition 0 (deal vs deal)" }]);
  assert.deepEqual(report.failures, ["unlisted diff 2:1 at round 0, transition 0 (deal vs deal)"]);
});

test("a comparison shallower than accepted.json's level fails", () => {
  const report = compareTraces(trace(), trace({}, [0]), accepted([], "transition"));
  assert.equal(report.level, "round");
  assert.deepEqual(report.failures, ["compared at round level, accepted.json requires transition"]);
});

test("--head-level transition fails a table where head wrote no transitions", () => {
  const head = trace({ "4-teams": { turns: [] } }, [0]);
  const report = compareTraces(trace({}, [0]), head, undefined, { headLevel: "transition" });
  assert.deepEqual(report.failures, ["table 4-teams: head wrote no transitions"]);
});

test("--match compares that one match only, with the floors of its table alone", () => {
  const report = compareTraces(trace({ "3": null }), trace({ "2": swapped, "3": null }), undefined, { only: "4:1" });
  assert.equal(report.matches, 1);
  assert.deepEqual(report.diffs, []);
  assert.deepEqual(report.failures, []);
});
