// tools/loop/tests/loopCost.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { killedLine, lastStamp, ledgerSummary, mismatchedModel, priceOf, readTicket, report, shaTable, sinceWindow, summary, turnHeadroom, wanted } from "../loop-cost.mjs";
import { handoffIn } from "../loop-logs.mjs";

const fixture = (name: string) => readFileSync(path.join(import.meta.dirname, "fixtures", name), "utf8");
const golden = {
  rows: fixture("ledger-golden.jsonl").trim().split("\n").map((l) => JSON.parse(l)),
  main: JSON.parse(fixture("ledger-golden.main.json")),
};

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

  test("counts a round per single reviewer, labelled as queue.md names it", () => {
    assert.equal(readTicket([spawn("Review #1424 round 1"), spawn("Review #1424 round 2"), spawn("Recon issue 5")]).rounds, 2);
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
    assert.deepEqual(readTicket([say("PHASE D", 0, "claude-mystery-9")]).unpriced, ["claude-mystery-9"]);
    assert.deepEqual(readTicket([say("PHASE D", 0, "claude-haiku-4-5-20251001")]).unpriced, []);
  });

  test("a synthetic session-limit notice is no turn and no unpriced model", () => {
    const t = readTicket([say("PHASE D", 0), say("You've hit your session limit", 1, "<synthetic>")]);
    assert.equal(t.phases.D.turns, 1);
    assert.deepEqual(t.unpriced, []);
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

  test("prices a 5.5 release at its own rate, not its family's", () => {
    assert.equal(priceOf("claude-opus-5-5", { cache_read_input_tokens: 1e6 }), 0.2);
    assert.equal(priceOf("claude-opus-5", { cache_read_input_tokens: 1e6 }), 0.5);
    assert.equal(priceOf("claude-sonnet-5-5[1m]", { output_tokens: 1e6 }), 10);
  });

  test("prices a Haiku 5.5 prompt past 100k at five times every rate", () => {
    assert.equal(priceOf("claude-haiku-5-5", { input_tokens: 100_000 }).toFixed(4), "0.0100");
    assert.equal(priceOf("claude-haiku-5-5", { cache_read_input_tokens: 99_000, input_tokens: 2_000 }).toFixed(5), "0.00595");
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

  test("an until closes the window before a later change", () => {
    const rows = [
      { n: 1, started: "2026-09-21T23:59:00.000Z" },
      { n: 2, started: "2026-09-22T09:00:00.000Z" },
      { n: 3, started: "2026-09-23T00:00:00.000Z" },
    ];
    const out = sinceWindow(rows, "2026-09-22T00:00Z", "2026-09-23T00:00Z");
    assert.deepEqual(out.tickets, ["2"]);
  });

  test("a time that does not parse exits 2 with usage, not a RangeError", () => {
    const cli = fileURLToPath(new URL("../loop-cost.mjs", import.meta.url));
    const run = spawnSync(process.execPath, [cli, "--since", "nonsense"], { encoding: "utf8" });
    assert.equal(run.status, 2, run.stderr);
    assert.match(run.stderr, /--since needs a time/);
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
  const edit = (name: string, file: string) => ({ type: "tool_use", name, input: { file_path: file } });

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

  for (const phase of ["D", "E"]) {
    test(`a build under PHASE ${phase} is billed to C from its first edit, and a verdict file is not one`, () => {
      const t = readTicket([
        msg("m1", [text(`PHASE ${phase}`)], 0),
        msg("m2", [edit("Write", "/repo/.worktrees/agent-1/.loop-verdict-1.md")], 1),
        msg("m3", [edit("Edit", "/repo/.worktrees/agent-1/tests/x.ts")], 2),
        msg("m4", [call("Bash", "npx jest tests/x.ts")], 3),
      ]);
      assert.deepEqual([t.phases[phase].turns, t.phases.C?.turns], [2, 2]);
    });
  }

  test("a session marked only by echoing the phase mid-chain is marked, and charges that phase", () => {
    const t = readTicket([
      msg("m1", [call("Bash", "git status")], 0),
      msg("m2", [call("Bash", 'cd /c/x/.worktrees/agent-1 && echo "PHASE C" && git log -1')], 1),
      msg("m3", [call("Bash", 'gh issue comment 5 --body-file v.md && echo "PHASE E" && gh pr view 7')], 2),
    ]);
    assert.equal(t.marked, true);
    assert.deepEqual([t.phases.pre?.turns, t.phases.C?.turns, t.phases.E?.turns], [1, 1, 1]);
  });

  test("an echo a subagent runs moves no phase", () => {
    const sub = line({ ...JSON.parse(msg("m2", [call("Bash", 'echo "PHASE C"')], 1)), parent_tool_use_id: "toolu_1" });
    assert.equal(readTicket([msg("m1", [text("PHASE D")], 0), sub]).phases.C, undefined);
  });

  test("since leaves out a whole earlier process of the same ticket", () => {
    const early = msg("m1", [text("PHASE C")], 0, "old");
    const late = line({ ...JSON.parse(msg("m2", [text("PHASE D")], 0, "new")), timestamp: "2026-09-21T11:00:00.000Z" });
    const t = readTicket([early, line({ type: "result", session_id: "old", total_cost_usd: 9 }), late], "", "2026-09-21T10:18:00.000Z");
    assert.deepEqual([t.phases.C, t.phases.D.turns, t.usd], [undefined, 1, 0]);
    const before = readTicket([early, late], "", null, "2026-09-21T10:18:00.000Z");
    assert.deepEqual([before.phases.C?.turns, before.phases.D], [1, undefined]);
  });
});

const proc = (over: object) => ({
  schema: 9, kind: "process", n: 1, at: "C", fix: false, model: "claude-opus-5-5", size: "size:S",
  cost: 0, turns: 10, ms: 60_000, subtype: "success", phases: {}, outcome: "handoff", handoff: null, ...over,
});
const out = (over: object) => ({ schema: 9, kind: "outcome", n: 1, ...over });

describe("summary", () => {
  test("a HOLD round is a D process that hands to C or D", () => {
    const rows = [
      proc({ n: 1, at: "C", cost: 5 }),
      proc({ n: 1, at: "D", cost: 2, handoff: { phase: "C" } }),
      proc({ n: 1, at: "C", cost: 3 }),
      proc({ n: 1, at: "D", cost: 1 }),
      out({ n: 1, outcome: "landed" }),
    ];
    const s = summary(rows);
    assert.equal(s.holdsPerTicket, 1);
    assert.equal(s.fixSpend, 2);
    assert.equal(s.perTicket.median, 11);
  });

  test("a v8 row counts in spend and processes and is unjudged for the model", () => {
    const s = summary([{ schema: 8, n: 2, cost: 4, turns: 10, phases: { C: 100 } }, out({ n: 2, outcome: "landed" })]);
    assert.equal(s.perTicket.median, 4);
    assert.equal(s.processesMedian, 1);
    assert.equal(s.unjudged, 1);
  });

  // Audit F5: a settle's `landed` and a supervisor's `retry` ran no session, so no model to judge.
  test("a zero-turn supervisor row is never unjudged", () => {
    const s = summary([proc({ n: 3 }), { schema: 8, n: 3, outcome: "retry", cost: 0, turns: 0, phases: {} }, { schema: 8, n: 3, outcome: "landed", cost: 0, turns: 0, phases: {} }]);
    assert.equal(s.unjudged, 0);
    assert.equal(s.processesMedian, 1);
  });

  test("a v8 row is judged by the model most of its own turns ran on, never its subagents'", () => {
    const v8 = (mainModels: object) => ({ schema: 8, n: 4, outcome: "pushed", cost: 1, turns: 9, phases: { E: 60 }, usage: { mainModels, models: { "claude-opus-5": 99 } } });
    assert.equal(summary([v8({ "claude-sonnet-5": 9 })]).mismatched.length, 0);
    assert.deepEqual(summary([v8({ "claude-opus-5": 9 })]).mismatched.map((r: { n: number }) => r.n), [4]);
  });

  test("model mismatch reads the main session's model against its spawn phase", () => {
    assert.equal(summary([proc({ n: 3, at: "E", model: "claude-opus-5-5" }), out({ n: 3, outcome: "landed" })]).mismatched.length, 1);
    assert.equal(summary([proc({ n: 3, at: "E", model: "claude-sonnet-5-5" })]).mismatched.length, 0);
    assert.equal(summary([proc({ n: 3, at: "E", model: null })]).unjudged, 1);
  });

  test("max-turns hits are counted exactly", () => {
    const rows = [
      proc({ subtype: "error_max_turns" }),
      proc({ subtype: "success" }),
      { schema: 8, n: 1, outcome: "parked", cost: 1, turns: 320, phases: { C: 9 }, error: { status: null, reason: "error_max_turns", stderr: null } },
    ];
    assert.equal(summary(rows).maxTurnsHit, 2);
  });

  test("a CI fix round's processes are fix spend, and the share is of all spend", () => {
    const s = summary([proc({ cost: 6 }), out({ outcome: "retry", head: "a" }), proc({ fix: true, cost: 2 }), out({ outcome: "landed" })]);
    assert.deepEqual([s.fixSpend, s.fixShare], [2, 25]);
  });

  test("spend by the phase each process was spawned at, the spawn phase read off v8's first phase", () => {
    const s = summary([proc({ at: "A", cost: 1 }), proc({ at: "D", cost: 3, ms: 120_000 }), { schema: 8, n: 1, outcome: "pushed", cost: 2, turns: 5, ms: 240_000, phases: { D: 9, E: 1 } }]);
    assert.deepEqual(s.byAt.D, { processes: 2, spend: 5, minutes: 4 });
    assert.deepEqual(s.byAt.A, { processes: 1, spend: 1, minutes: 1 });
  });

  test("turn headroom per size, from processes alone", () => {
    const s = summary([proc({ size: "size:S", turns: 200 }), proc({ size: "size:S", turns: 400, outcome: "parked" })], { "size:S": 320 });
    assert.deepEqual(s.headroom, [{ size: "size:S", most: 200, cap: 320, short: true }]);
  });

  test("a ticket is an issue number, however many claims it took", () => {
    const s = summary([proc({ cost: 4 }), out({ outcome: "parked" }), proc({ cost: 2 }), out({ outcome: "landed" }), proc({ n: 2, cost: 1 })]);
    assert.deepEqual([s.tickets, s.perTicket.mean, s.perTicket.median, s.processesMedian], [2, 3.5, 6, 1]);
  });

  test("a review round is a D-spawned process, beside schema 8's own count", () => {
    const s = summary([proc({ at: "D" }), proc({ at: "D" }), proc({ n: 2, at: "C" }), { schema: 8, n: 3, outcome: "pushed", cost: 1, turns: 9, review_rounds: 3 }]);
    assert.equal(s.reviewRoundsMedian, 3);
  });

  test("a process spawned at A that reached review is a HOLD round by what it ran, and spawned at A", () => {
    const rows = [
      { schema: 8, n: 5, outcome: "started", phase: "A", run_id: "r" },
      { schema: 8, n: 5, run_id: "r", outcome: "handoff", cost: 3, turns: 40, phases: { D: 600 }, handoff: { phase: "D" } },
    ];
    const s = summary(rows);
    assert.deepEqual([s.fixSpend, Object.keys(s.byAt)], [3, ["A"]]);
  });

  describe("on a ledger of schema 3 to 8, against what main's gauge recorded of it", () => {
    const rows = golden.rows.filter((r) => r.schema !== 9);
    const s = summary(rows);
    const firstTimed = (r: { phases?: object }) => Object.keys(r.phases ?? {})[0];

    test("HOLD rounds per ticket, processes per ticket, models and turn headroom are main's", () => {
      assert.ok(Math.abs(s.holdsPerTicket - golden.main.holdsMean) < 1e-9);
      assert.equal(s.processesMedian, golden.main.processesMedian);
      assert.deepEqual(s.mismatched.map((r) => `${r.n}@${r.started}`), golden.main.mismatches);
      assert.equal(s.unjudged, golden.main.unjudged);
      assert.deepEqual(s.headroom, golden.main.headroom);
    });

    // Before 09-23 a review that posted LAND handed off to E; main counted that handoff as a HOLD.
    test("fix spend is main's, less the reviews that landed", () => {
      const fixing = new Set();
      let landedReviews = 0;
      for (const r of rows.filter((x) => x.outcome !== "started")) {
        if (["landed", "closed", "parked", "reparked"].includes(r.outcome)) fixing.delete(r.n);
        else if (r.outcome === "retry") fixing.add(r.n);
        else if (r.outcome === "handoff" && firstTimed(r) === "D" && handoffIn(r)?.phase === "E" && !fixing.has(r.n)) landedReviews += r.cost;
      }
      assert.ok(landedReviews > 0);
      assert.ok(Math.abs(s.fixSpend - (golden.main.fixCost - landedReviews)) < 1e-9);
    });
  });

  test("a claim spanning schema 8 and 9 is one ticket, and a fix round with no flag is counted by order", () => {
    const s = summary(golden.rows.filter((r) => r.n === 9001));
    assert.deepEqual([s.tickets, s.spend, s.fixSpend, s.processesMedian, s.unjudged], [1, 9.75, 3, 3, 2]);
  });
});

describe("report", () => {
  const rows = [
    proc({ n: 1, at: "C", cost: 5 }),
    proc({ n: 1, at: "D", cost: 2, handoff: { phase: "C" } }),
    proc({ n: 1, at: "C", cost: 3 }),
    proc({ n: 1, at: "D", cost: 1, outcome: "pushed" }),
    out({ n: 1, outcome: "landed", ms: 600_000 }),
    proc({ n: 2, at: "A", cost: 4 }),
    out({ n: 2, outcome: "parked" }),
  ];

  test("reads the ledger alone: tickets, per ticket, fix rounds, HOLD rounds and processes", () => {
    const text = report(rows);
    assert.match(text, /^loop-cost: 2 tickets, \$15\.00 spent$/m);
    assert.match(text, /^per ticket: \$7\.50 mean, \$11\.00 median, 14 min median, 2 review rounds median$/m);
    assert.match(text, /^fix rounds: \$2\.00 \(13%\)$/m);
    assert.match(text, /^HOLD rounds: 0\.50 per ticket$/m);
    assert.match(text, /^processes\/ticket: median 4$/m);
  });

  test("a by-spawn-phase table takes the phase table's place", () => {
    const text = report(rows);
    assert.match(text, /^spawned at\s+processes\s+\$\s+share\s+med min$/m);
    assert.match(text, /^A\s+1\s+4\.00\s+27%\s+1\.0$/m);
    assert.match(text, /^C\s+2\s+8\.00\s+53%\s+1\.0$/m);
    assert.match(text, /^D\s+2\s+3\.00\s+20%\s+1\.0$/m);
  });

  test("names mismatches, unjudged processes, max-turns hits and a short cap only when there are some", () => {
    assert.doesNotMatch(report(rows), /model mismatch|model unjudged|turn cap|busiest/);
    const odd = [...rows, proc({ n: 3, at: "E", model: "claude-opus-5-5" }), proc({ n: 4, model: null, subtype: "error_max_turns", turns: 400 })];
    const text = report(odd, { "size:S": 320 });
    assert.match(text, /^model mismatch: #3$/m);
    assert.match(text, /^model unjudged: 1 processes name no model$/m);
    assert.match(text, /^turn cap: 1 processes ran out of turns$/m);
    assert.match(text, /turn cap under 2× the busiest process: size:S busiest 400, cap 320/);
  });

  test("an empty ledger says so rather than printing an empty table", () => {
    assert.equal(report([]), "loop-cost: no processes in the ledger");
    assert.equal(report([out({ outcome: "landed" })]), "loop-cost: no processes in the ledger");
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
    const rows = [{ ...row(1, "pushed", 3, { C: 60 }, {}), turns: 20 }, { ...row(1, "landed", 0, {}, {}), turns: 0 }];
    assert.equal(ledgerSummary(rows).processesMedian, 1);
  });

  // Under ADR 0011 a HOLD round is a process that starts at D and hands off: the review and its fix.
  // Fix spend counted only `retry` rows, the last of which was written on 2026-10-10, and read $0.00.
  test("a D-started handoff is fix spend, and a build's handoff is not", () => {
    const rows = [
      row(1, "handoff", 5, { B: 60, C: 600 }, { opus: 5 }),
      row(1, "handoff", 2, { D: 300, C: 300 }, { opus: 2 }),
      row(1, "pushed", 1, { D: 120, E: 30 }, { opus: 1 }),
      row(1, "landed", 0, {}, {}),
    ];
    const out = ledgerSummary(rows);
    assert.equal(out.fixCost, 2);
    assert.equal(out.fixShare, 25);
  });

  const rounds = (n: number, fields: object[], landed = true) => [
    ...fields.map((f) => ({ ...row(n, "handoff", 1, { D: 60 }, {}), ...f })),
    ...(landed ? [{ ...row(n, "landed", 0, {}, {}), ...fields.at(-1) }] : []),
  ];

  test("HOLD rounds per ticket are its HOLD total, or before it its verdicts less its landings", () => {
    const rows = [
      ...rounds(1, [{ review_holds_total: 0 }, { review_holds_total: 1 }, { review_holds_total: 1 }]),
      ...rounds(2, [{ review_rounds: 1, review_holds_total: 2 }]),
      ...rounds(3, [{ review_rounds: 0 }, { review_rounds: 2 }]),
      ...rounds(4, [{}]),
      ...rounds(5, [{ review_holds_total: null, review_rounds: null }], false),
    ];
    const out = ledgerSummary(rows);
    assert.deepEqual(out.holds, { 1: 1, 2: 2, 3: 1, 4: 0, 5: 0 });
    assert.equal(out.holdsMean, 0.8);
  });

  // A CI fix round's `REVIEW <sha> fix` LAND, still settling, is a verdict and no HOLD.
  test("a ticket whose HOLD total is 0 has no HOLDs, whatever its verdicts and landings", () => {
    const rows = [
      ...rounds(6, [{ review_holds_total: 0, review_rounds: 1 }], false),
      { n: 6, outcome: "retry", cost: 0, phases: {}, turns: 0 },
      { ...row(6, "pushed", 1, { C: 60, D: 60 }, {}), review_holds_total: 0, review_rounds: 1 },
    ];
    assert.deepEqual(ledgerSummary(rows).holds, { 6: 0 });
  });

  // 101 of the ledger's rows are a settle's `landed` with no turns, and 14 a supervisor's `retry`.
  test("a zero-turn row is neither a process nor a row whose model went unjudged", () => {
    const rows = [
      { ...row(1, "handoff", 4, { C: 60 }, { "claude-opus-5": 4 }), turns: 50 },
      { n: 1, outcome: "retry", cost: 0, phases: {}, turns: 0 },
      { ...row(1, "handoff", 2, { C: 60 }, { "claude-opus-5": 2 }), turns: 40 },
      { ...row(1, "pushed", 1, { D: 60 }, { "claude-opus-5": 1 }), turns: 20 },
      { n: 1, outcome: "landed", cost: 0, phases: {}, turns: 0 },
    ];
    const out = ledgerSummary(rows);
    assert.equal(out.processesMedian, 3);
    assert.equal(out.unjudged, 0);
    const reparks = [{ n: 2, outcome: "parked", turns: 30 }, { n: 3, outcome: "reparked", turns: 0 }, { n: 4, outcome: "reparked", turns: 0 }];
    assert.equal(ledgerSummary(reparks).processesMedian, 1, "a window no session ran in is no ticket's process count");
  });

  test("a closed row ends its window, and counts as landed per loop commit", () => {
    const rows = [row(1, "closed", 1, {}, {}), row(1, "handoff", 1, {}, {})];
    assert.equal(ledgerSummary(rows).processesMedian, 1);
    assert.match(shaTable(rows), /^unknown\s+2\s+2\.00\s+1\s+0\s+0$/m);
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

describe("turnHeadroom", () => {
  const rows = [
    { size: "size:S", turns: 80, outcome: "handoff" },
    { size: "size:S", turns: 121, outcome: "parked", park_reason: "the session ran out of turns" },
    { size: "size:M", turns: 60, outcome: "pushed" },
    { size: "size:M", turns: 140, outcome: "diagnosed" },
  ];

  test("turn headroom flags a size whose busiest healthy process is over half its cap", () => {
    const got = turnHeadroom(rows, { "size:S": 120, "size:M": 200 });
    assert.deepEqual(got, [
      { size: "size:S", most: 80, cap: 120, short: true },
      { size: "size:M", most: 60, cap: 200, short: false },
    ]);
  });

  test("the report names the short size and stays quiet about the rest", () => {
    const busy = [proc({ size: "size:S", turns: 90, outcome: "handoff", cost: 1 }), proc({ size: "size:M", turns: 60, outcome: "pushed", cost: 1 })];
    const out = report(busy, { "size:S": 160, "size:M": 505 });
    assert.match(out, /turn cap under 2× the busiest process: size:S busiest 90, cap 160/);
    assert.doesNotMatch(out, /size:M busiest/);
  });

  // #1496's build used 153 of size:S's 160 turns; #1438 151 and #1470 137 sat as close.
  test("size:S's cap has twice the turns its busiest measured build used", () => {
    const [s] = turnHeadroom([{ size: "size:S", turns: 153, outcome: "handoff" }]);
    assert.equal(s.short, false, `cap ${s.cap} for a busiest of ${s.most}`);
  });
});

describe("by loop sha", () => {
  const rows = [
    { n: 1, outcome: "handoff", cost: 2, turns: 5, phases: { C: 60 }, loop_sha: "aaaaaaa111" },
    { n: 1, outcome: "landed", cost: 1, turns: 0, phases: {}, loop_sha: "aaaaaaa111" },
    { n: 2, outcome: "parked", cost: 4, turns: 5, phases: { C: 60 } },
  ];
  const killed = [{ n: 3, phase: "D", started: "t", ms: 90_000, trailing: true, loop_sha: "aaaaaaa111" }];

  test("groups sessions, spend and outcomes per loop commit, rows before schema 6 as unknown", () => {
    const table = shaTable(rows, killed);
    assert.match(table, /^aaaaaaa\s+1\s+3\.00\s+1\s+0\s+1$/m, "a settle row ran no session");
    assert.match(table, /^unknown\s+1\s+4\.00\s+0\s+1\s+0$/m);
  });

  test("the totals are the same rows' whether or not they are grouped", () => {
    const summed = [...shaTable(rows).matchAll(/^\S+\s+\d+\s+([\d.]+)/gm)].reduce((a, m) => a + Number(m[1]), 0);
    assert.equal(summed, rows.reduce((a, r) => a + r.cost, 0));
    assert.equal(report(rows), report(rows.map(({ loop_sha: _, ...r }) => r)));
  });

  test("a schema 9 outcome row is the supervisor's, not a session", () => {
    const v9 = [proc({ cost: 2, loop_sha: "bbbbbbb222" }), out({ outcome: "landed", loop_sha: "bbbbbbb222" })];
    assert.match(shaTable(v9), /^bbbbbbb\s+1\s+2\.00\s+1\s+0\s+0$/m);
  });

  test("a killed session is named with its phase and time, and the last may still be running", () => {
    assert.equal(killedLine([]), null);
    assert.equal(killedLine(killed), "killed: 1 sessions left no row — #3 D 2m (the last may still be running)");
  });
});

describe("lastStamp", () => {
  test("is the latest stream timestamp inside the window, skipping lines with none", () => {
    const at = (m: number) => `{"type":"assistant","timestamp":"2026-09-21T08:${String(m).padStart(2, "0")}:00.000Z"}`;
    const text = [at(1), "{}", at(9), at(40)].join("\n");
    assert.equal(lastStamp(text, Date.parse("2026-09-21T08:00Z"), Date.parse("2026-09-21T08:30Z")), Date.parse("2026-09-21T08:09Z"));
    assert.equal(lastStamp("", 0, 1), null);
  });
});
