// tools/loop/tests/loopCost.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { familyOf, killedLine, lastStamp, report, shaTable, sinceWindow, summary, turnHeadroom, wanted } from "../loop-cost.mjs";
import { handoffIn } from "../loop-logs.mjs";

const fixture = (name: string) => readFileSync(path.join(import.meta.dirname, "fixtures", name), "utf8");
const golden = {
  rows: fixture("ledger-golden.jsonl").trim().split("\n").map((l) => JSON.parse(l)),
  main: JSON.parse(fixture("ledger-golden.main.json")),
};

/** The logs carry four spellings of two models; an exact-match table charged sonnet at opus. */
test("every spelling of a family is that family, and an id of none is none", () => {
  assert.deepEqual(["sonnet", "claude-sonnet-5", "claude-opus-5[1m]", "opus", "claude-haiku-4-5-20251001"].map(familyOf), ["sonnet", "sonnet", "opus", "opus", "haiku"]);
  assert.equal(familyOf("claude-mystery-9"), null);
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

test("a closed row counts as landed per loop commit", () => {
  const rows = [{ n: 1, outcome: "closed", cost: 1, turns: 5 }, { n: 1, outcome: "handoff", cost: 1, turns: 5 }];
  assert.match(shaTable(rows), /^unknown\s+2\s+2\.00\s+1\s+0\s+0$/m);
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
