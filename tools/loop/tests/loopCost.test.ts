// tools/loop/tests/loopCost.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { killedLine, ledgerSummary, mismatchedModel, priceOf, readTicket, report, shaTable, sinceWindow, wanted } from "../loop-cost.mjs";

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

  test("several arguments are the union of what each names", () => {
    assert.deepEqual(wanted(files, ["70", "1050"]), ["70.jsonl", "1050.jsonl"]);
    assert.deepEqual(wanted(files, ["70", "1050+"]), ["70.jsonl", "1050.jsonl"]);
  });
});

describe("priceOf", () => {
  // #1097's opus session, as its result's `modelUsage` reports it: $2.6356.
  test("prices a one-hour cache write at twice base, which is every write the loop makes", () => {
    const u = { input_tokens: 72, output_tokens: 19229, cache_read_input_tokens: 2489832, cache_creation_input_tokens: 90963, cache_creation: { ephemeral_1h_input_tokens: 90963 } };
    assert.equal(priceOf("claude-opus-5", u).toFixed(4), "2.6356");
    assert.ok(priceOf("opus", { cache_creation_input_tokens: 1e6 }) < priceOf("opus", { cache_creation_input_tokens: 1e6, cache_creation: { ephemeral_1h_input_tokens: 1e6 } }));
  });
});

describe("sinceWindow", () => {
  test("takes rows by when they started, never by ticket number", () => {
    const rows = [
      { n: 1090, started: "2026-09-17T20:57:00.000Z" },
      { n: 70, started: "2026-09-21T10:44:00.000Z" },
      { n: 1090, started: "2026-09-21T14:02:00.000Z" },
    ];
    const out = sinceWindow(rows, "2026-09-21T10:18:00.000Z");
    assert.deepEqual(out.tickets, ["70", "1090"]);
    assert.equal(out.rows.length, 2);
  });
});

describe("readTicket, across processes and stream lines", () => {
  const line = (o: object) => JSON.stringify(o);
  const init = (session: string) => line({ type: "system", subtype: "init", session_id: session });
  const msg = (id: string, content: object[], min: number, session = "s1") =>
    line({
      type: "assistant", timestamp: at(min), session_id: session, parent_tool_use_id: null,
      message: { id, model: "claude-opus-5", content, usage: { cache_read_input_tokens: 1e6 } },
    });
  const text = (t: string) => ({ type: "text", text: t });
  const call = (name: string, command = "") => ({ type: "tool_use", name, input: { command } });

  test("a message written as one line per block is one turn, priced once", () => {
    const t = readTicket([msg("m1", [text("PHASE D")], 0), msg("m1", [call("Bash", "ls")], 0), msg("m1", [call("Bash", "pwd")], 0)]);
    assert.equal(t.phases.D.turns, 1);
    assert.equal(t.phases.D.tokens, 1e6);
    assert.deepEqual([t.phases.D.toolTurns, t.phases.D.batched], [1, 1]);
  });

  test("a new process starts before its marker, not in the last one's phase", () => {
    const t = readTicket([msg("m1", [text("PHASE F")], 0), init("s2"), msg("m2", [call("Bash", "loop-status")], 30, "s2"), msg("m3", [text("PHASE D")], 31, "s2")]);
    assert.equal(t.phases.pre.turns, 1);
    assert.equal(t.phases.F.minutes, 0, "the half hour between processes is nobody's");
  });

  test("a build under PHASE B moves to C at its first edit, never at a read after the scout", () => {
    const t = readTicket([
      msg("m1", [text("PHASE B"), call("Agent")], 0),
      msg("m2", [call("Bash", "git status")], 1),
      msg("m3", [call("Write")], 2),
    ]);
    assert.deepEqual([t.phases.B.turns, t.phases.C.turns], [2, 1]);
  });

  test("with no scout, B holds through reads and ends at the first edit", () => {
    const t = readTicket([msg("m1", [text("PHASE B"), call("Bash", "grep -n x a.ts")], 0), msg("m2", [call("Edit")], 1)]);
    assert.deepEqual([t.phases.B.turns, t.phases.C.turns], [1, 1]);
  });

  test("since leaves out a whole earlier process of the same ticket", () => {
    const early = msg("m1", [text("PHASE C")], 0, "old");
    const late = line({ ...JSON.parse(msg("m2", [text("PHASE D")], 0, "new")), timestamp: "2026-09-21T11:00:00.000Z" });
    const t = readTicket([early, line({ type: "result", session_id: "old", total_cost_usd: 9 }), late], "", "2026-09-21T10:18:00.000Z");
    assert.deepEqual([t.phases.C, t.phases.D.turns, t.usd], [undefined, 1, 0]);
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

  test("ORDER carries phase G, for a settle round's own accounting", () => {
    const g = { ticket: "3", usd: 4, minutes: 5, rounds: 0, marked: true, unpriced: [],
      phases: { G: { turns: 1, tokens: 200000, usd: 4, minutes: 5 } } };
    assert.match(report([g]), /^G /m);
  });

  test("says nothing about fix rounds or processes with no ledger rows given", () => {
    assert.doesNotMatch(report([marked()]), /fix rounds|processes\/ticket/);
  });

  test("prints fix-round spend and processes/ticket from the ledger it is given", () => {
    const rows = [
      { n: 1, outcome: "retry", cost: 2, phases: { C: 60 }, models: { opus: 2 } },
      { n: 1, outcome: "landed", cost: 1, phases: { E: 60 }, models: { sonnet: 1 } },
    ];
    const out = report([marked()], rows);
    assert.match(out, /fix rounds: \$1\.00 \(33%\)/);
    assert.match(out, /processes\/ticket: median 2/);
  });
});

describe("mismatchedModel", () => {
  const on = (phases: object, mainModels: object) => ({ phases, usage: { mainModels } });

  test("flags a row whose model family is not the phase's own", () => {
    assert.equal(mismatchedModel(on({ E: 60 }, { "claude-opus-5": 1 })), true);
    assert.equal(mismatchedModel(on({ E: 60 }, { "claude-sonnet-5": 1 })), false);
  });

  // It flagged 62 of 51 tickets, including every one of v4's: a phase-C opus session whose sonnet
  // subagents outspent it read as having run on sonnet. Subagents are not the session's model.
  test("subagents do not decide what the session ran on", () => {
    const row = { phases: { C: 60 }, models: { "claude-sonnet-5": 9, "claude-opus-5": 2 },
      usage: { mainModels: { "claude-opus-5": 40 }, models: { "claude-sonnet-5": 300, "claude-opus-5": 40 } } };
    assert.equal(mismatchedModel(row), false);
  });

  test("judges the main session's own model against the phase it started at", () => {
    assert.equal(mismatchedModel(on({ C: 60, E: 9 }, { "claude-sonnet-5": 3 })), true);
    assert.equal(mismatchedModel(on({ D: 60, E: 9 }, { "claude-opus-5": 3 })), false);
  });

  test("a row naming no phase, or predating the reading, has nothing to compare", () => {
    assert.equal(mismatchedModel(on({}, { opus: 1 })), false);
    assert.equal(mismatchedModel(on({ A: 1 }, {})), false);
    assert.equal(mismatchedModel({ phases: { E: 60 }, models: { "claude-opus-5": 1 } }), false);
  });

  test("a model with no known family is not a mismatch", () => {
    assert.equal(mismatchedModel(on({ E: 60 }, { "<synthetic>": 1 })), false);
  });
});

describe("ledgerSummary", () => {
  const row = (n: number, outcome: string, cost: number, phases: object, models: object) =>
    ({ n, outcome, cost, phases, models, usage: { mainModels: models } });

  test("fix-round spend is what a ticket's rows cost after its first retry row", () => {
    const rows = [
      row(1, "handoff", 1, { A: 60 }, { opus: 1 }),
      row(1, "retry", 2, { C: 60 }, { opus: 2 }),
      row(1, "retry", 1.5, { C: 60 }, { opus: 1.5 }),
      row(1, "landed", 0.5, { E: 60 }, { sonnet: 0.5 }),
    ];
    const out = ledgerSummary(rows);
    assert.equal(out.fixCost, 2);
    assert.equal(out.fixShare, 40);
  });

  test("a ticket that never retried has no fix spend", () => {
    assert.equal(ledgerSummary([row(2, "landed", 3, { C: 60 }, { opus: 3 })]).fixCost, 0);
  });

  test("processes/ticket is the median session count across closed windows", () => {
    const rows = [
      row(1, "handoff", 1, {}, {}),
      row(1, "retry", 1, {}, {}),
      row(1, "retry", 1, {}, {}),
      row(1, "landed", 1, {}, {}),
      row(2, "landed", 1, {}, {}),
    ];
    assert.equal(ledgerSummary(rows).processesMedian, 4);
  });

  test("a pushed row and its settle row are one process", () => {
    const rows = [row(1, "pushed", 3, { C: 60 }, {}), row(1, "landed", 0, {}, {})];
    assert.equal(ledgerSummary(rows).processesMedian, 1);
  });

  test("names every row whose model family does not match its phase", () => {
    assert.deepEqual(
      ledgerSummary([row(9, "landed", 1, { E: 60 }, { "claude-opus-5": 1 })]).mismatches.map((r: { n: number }) => r.n),
      [9],
    );
  });

  // A flag that judges nothing and reports nothing looks exactly like a flag that found nothing.
  test("and counts the rows it could not judge, so silence is not mistaken for a pass", () => {
    const blind = { n: 3, outcome: "landed", cost: 1, phases: { E: 60 }, models: { "claude-opus-5": 1 } };
    const out = ledgerSummary([blind, row(9, "landed", 1, { E: 60 }, { "claude-opus-5": 1 })]);
    assert.equal(out.unjudged, 1);
    assert.deepEqual(out.mismatches.map((r: { n: number }) => r.n), [9]);
  });
});

describe("by loop sha", () => {
  const rows = [
    { n: 1, outcome: "handoff", cost: 2, phases: { C: 60 }, loop_sha: "aaaaaaa111" },
    { n: 1, outcome: "landed", cost: 1, phases: {}, loop_sha: "aaaaaaa111" },
    { n: 2, outcome: "parked", cost: 4, phases: { C: 60 } },
  ];
  const killed = [{ n: 3, phase: "D", started: "t", ms: 90_000, trailing: true, loop_sha: "aaaaaaa111" }];

  test("groups sessions, spend and outcomes per loop commit, rows before schema 6 as unknown", () => {
    const table = shaTable(rows, killed);
    assert.match(table, /^aaaaaaa\s+2\s+3\.00\s+1\s+0\s+1$/m);
    assert.match(table, /^unknown\s+1\s+4\.00\s+0\s+1\s+0$/m);
  });

  test("the totals are the same rows' whether or not they are grouped", () => {
    const summed = [...shaTable(rows).matchAll(/^\S+\s+\d+\s+([\d.]+)/gm)].reduce((a, m) => a + Number(m[1]), 0);
    assert.equal(summed, rows.reduce((a, r) => a + r.cost, 0));
    assert.equal(report([], rows), report([], rows.map(({ loop_sha: _, ...r }) => r)));
  });

  test("a killed session is named with its phase and time, and the last may still be running", () => {
    assert.equal(killedLine([]), null);
    assert.equal(killedLine(killed), "killed: 1 sessions left no row — #3 D 2m (the last may still be running)");
  });
});
