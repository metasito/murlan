// tools/loop/tests/loopCost.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readTicket, report, wanted } from "../loop-cost.mjs";

const at = (min: number) => new Date(Date.UTC(2026, 8, 14, 10, min)).toISOString();
const say = (text: string, min: number, model = "claude-opus-5", parent: string | null = null) =>
  JSON.stringify({
    type: "assistant", timestamp: at(min), parent_tool_use_id: parent,
    message: { model, content: [{ type: "text", text }], usage: { cache_read_input_tokens: 1e6 } },
  });
const result = (usd: number, session = "s1") =>
  JSON.stringify({ type: "result", session_id: session, total_cost_usd: usd });
const spawn = (description: string) =>
  JSON.stringify({ type: "system", subtype: "task_started", task_type: "local_agent", description });

describe("readTicket", () => {
  test("attributes turns to the phase marker preceding them", () => {
    const t = readTicket([say("PHASE A", 0), say("claiming", 1), say("PHASE C", 2), say("building", 8)]);
    assert.equal(t.phases.A.turns, 2);
    assert.equal(t.phases.C.turns, 2);
  });

  test("a phase's minutes run from its marker to the next", () => {
    const t = readTicket([say("PHASE A", 0), say("PHASE C", 5), say("done", 20)]);
    assert.equal(t.phases.A.minutes, 5);
    assert.equal(t.phases.C.minutes, 15);
  });

  test("a subagent turn never moves the phase, because it emits no marker", () => {
    const t = readTicket([say("PHASE D", 0), say("PHASE A", 1, "claude-sonnet-5", "toolu_1"), say("x", 2)]);
    assert.equal(t.phases.D.turns, 3);
    assert.equal(t.phases.A, undefined);
  });

  test("total_cost_usd is cumulative per session, so it is maxed and not summed", () => {
    assert.equal(
      readTicket([result(5, "s1"), result(11, "s1"), result(4, "s2")]).usd,
      15,
      "11 for s1 plus 4 for s2 — summing s1's two records would say 20",
    );
  });

  test("counts a review round per pair of review subagents", () => {
    assert.equal(readTicket([spawn("Spec review round 2"), spawn("Standards review round 2"), spawn("Recon issue 5")]).rounds, 1);
  });

  test("prices each turn at its own model's rate", () => {
    const opus = readTicket([say("PHASE D", 0)]).phases.D.usd;
    const sonnet = readTicket([say("PHASE D", 0, "claude-sonnet-5")]).phases.D.usd;
    assert.equal(Math.round((sonnet / opus) * 10) / 10, 0.4);
  });

  /** The logs carry four spellings of two models; an exact-match table charged sonnet at opus. */
  test("every spelling of a family prices as that family", () => {
    const rate = (model: string) => readTicket([say("PHASE D", 0, model)]).phases.D.usd;
    assert.equal(rate("sonnet"), rate("claude-sonnet-5"));
    assert.equal(rate("claude-opus-5[1m]"), rate("opus"));
    assert.notEqual(rate("sonnet"), rate("opus"));
  });

  test("an id belonging to no family is named rather than quietly charged as opus", () => {
    assert.deepEqual(readTicket([say("PHASE D", 0, "<synthetic>")]).unpriced, ["<synthetic>"]);
    assert.deepEqual(readTicket([say("PHASE D", 0, "claude-haiku-4-5-20251001")]).unpriced, []);
  });

  test("a log with no phase markers is read, not dropped", () => {
    const t = readTicket([say("no marker here", 0), result(3)]);
    assert.equal(t.usd, 3);
    assert.equal(t.phases.pre.turns, 1);
    assert.equal(t.marked, false);
  });

  test("an unparsable line is skipped rather than taking the report down", () => {
    assert.equal(readTicket(["{not json", say("PHASE A", 0)]).phases.A.turns, 1);
  });

  /** Taking `at = null` from an unstamped record loses the interval either side of it. */
  test("a record with no timestamp does not reset the phase clock", () => {
    const unstamped = JSON.stringify({ type: "assistant", message: { model: "claude-opus-5", content: [], usage: {} } });
    const t = readTicket([say("PHASE C", 0), unstamped, say("done", 10)]);
    assert.equal(t.phases.C.minutes, 10);
  });
});

/**
 * Task 6 asks whether a change moved the median. Averaged over every ticket on disk it cannot: the
 * five runs after a change are outvoted by the twenty before it.
 */
describe("wanted", () => {
  const files = ["70.jsonl", "955.jsonl", "1049.jsonl", "1050.jsonl", "tickets.jsonl", "run-a.md", "ci-1049.log"];

  test("with no argument, every ticket stream and nothing else", () => {
    assert.deepEqual(wanted(files), ["70.jsonl", "955.jsonl", "1049.jsonl", "1050.jsonl"]);
  });

  test("a bare number is that one ticket", () => {
    assert.deepEqual(wanted(files, "1049"), ["1049.jsonl"]);
  });

  test("a trailing + is that ticket and every later one", () => {
    assert.deepEqual(wanted(files, "1049+"), ["1049.jsonl", "1050.jsonl"]);
  });

  test("the ledger is never a ticket, whatever the argument", () => {
    assert.deepEqual(wanted(["tickets.jsonl"], "1+"), []);
  });
});

describe("report", () => {
  const marked = () => readTicket([say("PHASE D", 0), say("reviewing", 5), result(20)], "1");
  const unmarked = () => readTicket([say("no marker here", 0), result(3)], "2");

  test("a ticket with no phase marker is dropped, and the drop is counted", () => {
    const out = report([marked(), unmarked()]);
    assert.match(out, /1 tickets, \$20\.00 reported, 1 skipped for emitting no phase marker/);
    assert.doesNotMatch(out, /^pre /m);
  });

  test("its spend never reaches the phase table", () => {
    assert.equal(report([marked(), unmarked()]), report([marked()]).replace(/reported/, "reported, 1 skipped for emitting no phase marker"));
  });

  test("nothing marked says so rather than printing an empty table", () => {
    assert.match(report([unmarked()]), /no priced tickets in .*1 skipped/);
  });
});
