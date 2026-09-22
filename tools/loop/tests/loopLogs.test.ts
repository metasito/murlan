// tools/loop/tests/loopLogs.test.ts
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  ARTEFACTS,
  errorOf,
  killedStarts,
  ledger,
  parkReasonOf,
  STDERR_CAP,
  prunable,
  prune,
  readLedger,
  sessionRow,
  ticketTally,
  typicalMs,
  usageSplit,
  windowCost,
} from "../loop-logs.mjs";

const RESULT = {
  kind: "result",
  isError: false,
  subtype: "success",
  terminalReason: null,
  cost: 1.82,
  turns: 41,
  durationMs: 1_420_000,
  models: { "claude-opus-5": { costUSD: 1.6 }, "claude-sonnet-5": { costUSD: 0.22 } },
  subagents: { spawned: 3, failed: 0 },
  cache: { created: 26069, read: 15320 },
};

const session = (over: object = {}) => ({
  number: 953,
  size: "size:S",
  outcome: "landed",
  pr: 1204,
  phases: { A: 12, B: 92, C: 407, D: 212, E: 1375, F: 45 },
  result: RESULT,
  merged: true,
  reviewRounds: 2,
  startedAt: "2026-09-10T22:14:03Z",
  ms: 2_143_000,
  version: "2.1.251",
  ...over,
});

describe("artefact names", () => {
  // The pruner used to hold a fifth copy of the other four writers' conventions, matched by
  // extension. Nothing held the two spellings together, which is the only thing this checks.
  test("every builder's own output matches its own name pattern", () => {
    for (const [kind, a] of Object.entries(ARTEFACTS)) {
      const name = path.basename(a.path(7));
      assert.ok(a.name.test(name), `${kind}: ${a.name} does not match ${name}`);
    }
  });

  test("no artefact's pattern matches another's file", () => {
    for (const [kind, a] of Object.entries(ARTEFACTS)) {
      for (const [other, b] of Object.entries(ARTEFACTS)) {
        if (kind === other) continue;
        assert.ok(!b.name.test(path.basename(a.path(7))), `${other} claims ${kind}'s file`);
      }
    }
  });

  test("the record is never prunable, whatever its age", () => {
    assert.equal(prunable("tickets.jsonl"), false);
    assert.equal(prunable("run-2026-09-13-04-12.md"), false);
  });

  test("a stream log, a CI tail and a park note are", () => {
    assert.equal(prunable("999.jsonl"), true);
    assert.equal(prunable("ci-999.log"), true);
    assert.equal(prunable("ci-red-999.md"), true);
    assert.equal(prunable("park-999.md"), true);
  });

  test("so is something nobody named", () => {
    assert.equal(prunable("dod-999.md"), true);
    assert.equal(prunable("ios-1158"), true);
  });
});

describe("prune", () => {
  const day = 24 * 60 * 60_000;
  let dir: string;
  before(() => {
    dir = mkdtempSync(path.join(tmpdir(), "loop-logs-prune-"));
  });
  after(() => rmSync(dir, { recursive: true, force: true }));

  test("sweeps past fourteen days, keeps the record at any age, and ages a directory by its newest file", () => {
    const now = Date.now();
    const age = (rel: string, days: number) => {
      const t = new Date(now - days * day);
      utimesSync(path.join(dir, rel), t, t);
    };
    const at = (rel: string, days: number) => {
      mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      writeFileSync(path.join(dir, rel), "x");
      age(rel, days);
    };
    at("999.jsonl", 15);
    at("998.jsonl", 13);
    at("dod-999.md", 15);
    at("tickets.jsonl", 400);
    at("run-2026-01-01-00-00.md", 400);
    at("old-device/a/b.log", 20);
    at("live-device/a/old.log", 20);
    at("live-device/new.log", 1);
    for (const d of ["old-device/a", "old-device", "live-device/a", "live-device"]) age(d, 20);
    assert.deepEqual(prune(now, undefined, dir).sort(), ["999.jsonl", "dod-999.md", "old-device"]);
    assert.deepEqual(readdirSync(dir).sort(), ["998.jsonl", "live-device", "run-2026-01-01-00-00.md", "tickets.jsonl"]);
  });

  test("no directory is nothing to sweep, not a throw", () => {
    assert.deepEqual(prune(0, undefined, path.join(dir, "absent")), []);
  });
});

describe("sessionRow", () => {
  const r = sessionRow(session());

  test("carries the ticket, its size and its outcome", () => {
    assert.equal(r.n, 953);
    assert.equal(r.size, "size:S");
    assert.equal(r.outcome, "landed");
    assert.equal(r.pr, 1204);
  });

  test("stamps the schema, so two readings of a field are never averaged together", () => {
    // The literal, not the module's own constant: a test that reads the value it is pinning moves
    // with it and pins nothing. Bump it here deliberately when a field changes what it holds.
    assert.equal(r.schema, 6);
  });

  test("carries the loop's sha, a structured handoff and the error, and no solo_bash_turns", () => {
    const handoff = { phase: "D", why: null, said: "built" };
    const error = { status: 529, reason: "api_error", stderr: null };
    const v6 = sessionRow(session({ loopSha: "abc", handoff, error }));
    assert.deepEqual([v6.loop_sha, v6.handoff, v6.error], ["abc", handoff, error]);
    assert.equal("solo_bash_turns" in v6, false);
    assert.deepEqual([r.loop_sha, r.handoff, r.error], [null, null, null]);
  });

  test("carries the head and the run that wrote it", () => {
    const withHead = sessionRow(session({ head: "aaa1111", runId: "2026-09-17-07-14" }));
    assert.equal(withHead.head, "aaa1111");
    assert.equal(withHead.run_id, "2026-09-17-07-14");
  });

  test("a row with neither is still valid, not a throw", () => {
    assert.equal(r.head, null);
  });

  // Six tickets ran two sessions and the ledger kept only the second, so a fifth of the money
  // spent never reached the file kept to measure it.
  test("carries its own duration, so a ticket's cost is the sum of its rows", () => {
    assert.equal(r.ms, 2_143_000);
    assert.equal(r.cost, 1.82);
  });

  // A park written by a turn cap, one by a review deadlock and one by a genuine blocker were the
  // same four characters in the file, so "why do tickets park" could not be asked of it.
  test("a park carries the sentence, not just the outcome", () => {
    const parked = sessionRow(session({ outcome: "parked", parkReason: "the reviewer held it twice" }));
    assert.match(String(parked.park_reason), /held it twice/);
  });

  test("a landing carries no park reason", () => {
    assert.equal(r.park_reason, null);
  });

  // Named for what the supervisor knows. `ci: {pass:false}` was written for every non-merged
  // outcome and read back as "CI failed" on five tickets that merged.
  test("says whether the merge happened, not what CI is imagined to have said", () => {
    assert.equal(r.merged, true);
    assert.equal("ci" in r, false, "the old field claimed a verdict the loop never held");
  });

  test("keeps phase durations in seconds, so a night is comparable", () => {
    assert.deepEqual(r.phases, { A: 12, B: 92, C: 407, D: 212, E: 1375, F: 45 });
  });

  test("counts the review rounds phase D's cap is supposed to bound", () => {
    assert.equal(r.review_rounds, 2);
  });

  test("a count nobody could take is null, never zero", () => {
    assert.equal(sessionRow(session({ reviewRounds: null })).review_rounds, null);
  });

  test("collapses modelUsage to cost per model", () => {
    assert.deepEqual(r.models, { "claude-opus-5": 1.6, "claude-sonnet-5": 0.22 });
  });

  test("records the cache, because whether a prefix was reused is the whole question", () => {
    assert.deepEqual(r.cache, { created: 26069, read: 15320 });
  });

  test("a result with no modelUsage still produces a row", () => {
    const bare = sessionRow(
      session({ outcome: "parked", pr: null, result: { ...RESULT, models: {}, subagents: null }, merged: false }),
    );
    assert.deepEqual(bare.models, {});
    assert.equal(bare.outcome, "parked");
    assert.equal(bare.pr, null);
    assert.equal(bare.merged, false);
  });

  test("a run that produced no result event at all still produces a row", () => {
    const killed = sessionRow(session({ result: null }));
    assert.equal(killed.cost, 0);
    assert.equal(killed.turns, 0);
    assert.deepEqual(killed.cache, { created: 0, read: 0 });
  });

  // One row per line, so a value carrying a newline has to survive as an escape rather than
  // splitting the row in two. `JSON.stringify` handles that; what it cannot handle is a value it
  // drops silently, which is what the round trip checks.
  test("the row survives the round trip it is written and read through", () => {
    const withNewlines = sessionRow(session({ parkReason: "line one\nline two" }));
    const line = JSON.stringify(withNewlines);
    assert.equal(line.split("\n").length, 1, "a row spanning two lines is two rows to the reader");
    assert.deepEqual(JSON.parse(line), withNewlines);
  });
});

describe("usageSplit", () => {
  const line = (over: object) =>
    JSON.stringify({
      type: "assistant",
      request_id: "req_1",
      parent_tool_use_id: null,
      message: { model: "claude-opus-5", usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 20 } },
      ...over,
    });

  test("splits on parent_tool_use_id, which is the only thing that tells a subagent apart", () => {
    const out = usageSplit(
      [line({}), line({ request_id: "req_2", parent_tool_use_id: "toolu_1" })].join("\n"),
    );
    assert.equal(out.main.input, 10);
    assert.equal(out.subagents.input, 10);
    assert.equal(out.subagents.cacheRead, 100);
  });

  // The stream repeats one request's usage across its events. Counted as they arrive, a session's
  // tokens read several times over.
  test("dedupes on request_id, because the stream repeats one request's usage", () => {
    const out = usageSplit([line({}), line({}), line({})].join("\n"));
    assert.equal(out.main.input, 10);
    assert.equal(out.main.output, 5);
  });

  test("a truncated or non-JSON line is skipped rather than thrown on", () => {
    const out = usageSplit(["{not json", "", line({}), '{"type":"assistant"}'].join("\n"));
    assert.equal(out.main.input, 10);
  });

  test("an empty log is zeros, not a throw", () => {
    const out = usageSplit("");
    assert.deepEqual(out.main, { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 });
    assert.deepEqual(out.models, {});
  });
});

describe("ledger", () => {
  const report = (title: string) => ({ number: 953, title, outcome: "landed", ms: 60_000, cost: 1.82 });
  const spy = () => {
    const appended: [string, string][] = [];
    const written: [string, string][] = [];
    const seen = new Set<string>();
    return {
      appended,
      written,
      io: {
        append: (f: string, t: string) => {
          appended.push([path.basename(f), t]);
          seen.add(f);
        },
        mkdir: () => {},
        exists: (f: string) => seen.has(f),
        write: (f: string, t: string) => {
          written.push([path.basename(f), t]);
          seen.add(f);
        },
      },
    };
  };

  test("one session is one row, and its money lands in the totals", () => {
    const { io, appended } = spy();
    const book = ledger(io);
    book.record(session(), { runId: "2026-09-13-04-12", report: report("x") });
    assert.equal(appended.filter(([f]) => f === "tickets.jsonl").length, 1);
    assert.equal(book.totals.cost, 1.82);
    assert.equal(book.totals.landed, 1);
    assert.equal(book.totals.tickets, 1);
  });

  // Two sessions on one ticket used to overwrite each other's reading, and a `counted` flag
  // existed to zero the second one's money rather than let the file hold both.
  test("two sessions on one ticket are two rows, and their costs add", () => {
    const { io } = spy();
    const book = ledger(io);
    book.record(session({ outcome: "retry" }), { runId: "r", report: report("a"), counts: false });
    book.record(session(), { runId: "r", report: report("b") });
    assert.equal(book.rows.length, 2);
    assert.equal(book.totals.cost, 3.64);
    assert.equal(book.totals.tickets, 1, "a fix round is a session, not a ticket");
    assert.deepEqual(book.tickets.map((r) => r.title), ["b"], "the exit summary is one row per ticket");
  });

  // A usage refusal spent real money and reached the totals through a second writer, which is why
  // the ledger needed a flag to stop counting itself twice.
  test("a session that closed no ticket still records what it spent", () => {
    const { io } = spy();
    const book = ledger(io);
    book.record(session({ outcome: "refused" }), { runId: "r", report: report("x"), counts: false });
    assert.equal(book.totals.cost, 1.82);
    assert.equal(book.totals.tickets, 0);
    assert.equal(book.totals.parked, 0);
  });

  test("the report gets its heading once and a row per session after that", () => {
    const { io, appended, written } = spy();
    const book = ledger(io);
    book.record(session(), { runId: "2026-09-13-04-12", report: report("first") });
    book.record(session(), { runId: "2026-09-13-04-12", report: report("second") });
    assert.equal(written.length, 1);
    assert.match(written[0][1], /# queue-loop 2026-09-13 04:12/);
    const rows = appended.filter(([f]) => f.startsWith("run-")).map(([, t]) => t);
    assert.equal(rows.length, 2);
    assert.match(rows[0], /#953 first/);
    assert.match(rows[1], /#953 second/);
    assert.ok(rows.every((r) => !r.includes("\u001B")), "the report file is plain text");
  });

  test("a park counts against the run rather than for it", () => {
    const { io } = spy();
    const book = ledger(io);
    book.record(session({ outcome: "parked", merged: false }), { runId: "r", report: report("x") });
    assert.equal(book.totals.parked, 1);
    assert.equal(book.totals.landed, 0);
  });

  test("the row carries the run that wrote it, without the caller repeating it in session", () => {
    const { io } = spy();
    const book = ledger(io);
    const entry = book.record(session(), { runId: "2026-09-13-04-12", report: report("x") });
    assert.equal(entry.run_id, "2026-09-13-04-12");
  });
});

describe("typicalMs", () => {
  test("a median per step, the merge step from the settle rows", () => {
    const typical = typicalMs([
      { outcome: "handoff", phases: { B: 100, C: 500 }, ms: 1 },
      { outcome: "handoff", phases: { C: 300 }, ms: 1 },
      { outcome: "handoff", phases: { C: 900 }, ms: 1 },
      { outcome: "landed", phases: {}, ms: 480_000 },
      { outcome: "landed", phases: {}, ms: 3_104_948, turns: 132, cost: 16.76 },
      { outcome: "landed", phases: { F: 20 }, ms: 9 },
    ]);
    assert.deepEqual(typical, { B: 100_000, C: 500_000, G: 480_000, F: 20_000 });
  });
});

describe("the run report's recap", () => {
  test("sits under the title, above the rows", () => {
    const files = new Map<string, string>();
    const book = ledger({
      append: (f: string, t: string) => files.set(f, (files.get(f) ?? "") + t),
      mkdir: () => {},
      exists: (f: string) => files.has(f),
      write: (f: string, t: string) => files.set(f, t),
      read: (f: string) => files.get(f) ?? "",
    });
    book.record(session(), { runId: "r", report: { number: 1, title: "x", outcome: "landed", pr: 2, ms: 1, cost: 1 } });
    book.close("r", "1 ticket", "run   21:40 → 08:44");
    const text = [...files.entries()].find(([f]) => f.includes("run-r"))![1].split("\n");
    assert.match(text[0], /^# queue-loop/);
    assert.equal(text[2], "run   21:40 → 08:44");
    assert.match(text.at(-2)!, /1 ticket/);
  });

  test("a run that recorded nothing keeps the file the total alone wrote", () => {
    const files = new Map<string, string>();
    const book = ledger({
      append: (f: string, t: string) => files.set(f, (files.get(f) ?? "") + t),
      mkdir: () => {},
      exists: (f: string) => files.has(f),
      write: (f: string, t: string) => files.set(f, t),
      read: (f: string) => files.get(f) ?? "",
    });
    book.close("r", "0 tickets", "run   21:40 → 21:41");
    assert.deepEqual([...files.values()], ["\n0 tickets\n"]);
  });
});

describe("ticketTally", () => {
  const row = (over: object) => ({ n: 1, cost: 0, ...over });

  test("reads a structured handoff first, and the prose only on a row that has none", () => {
    const t = ticketTally(1, [row({ outcome: "handoff", park_reason: "phase D next", handoff: { phase: "C", why: "red", said: null } })]);
    assert.deepEqual([t.lastHandoff, t.handoffWhy], ["C", "red"]);
  });

  test("a start row is a spawn, not a session", () => {
    const t = ticketTally(1, [row({ outcome: "handoff", park_reason: "phase D next" }), row({ outcome: "started", phase: "D" })]);
    assert.deepEqual([t.sessions, t.handoffsThisRound, t.lastHandoff], [1, 1, "D"]);
  });

  describe("on the recorded 2026-09-21/22 ledger", () => {
    const rows = readFileSync(path.join(import.meta.dirname, "fixtures", "ledger-2026-09-21.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    const each = (of: object[]) => rows.map((r, i) => ticketTally(r.n, of.slice(0, i + 1)));

    test("every prefix tallies as it did before schema 6", () => {
      const s = { sessions: 0, handoffs: 0, retries: 0, spend: 0, last: "" };
      for (const t of each(rows)) {
        s.sessions += t.sessions;
        s.handoffs += t.handoffsThisRound;
        s.retries += t.retries;
        s.spend += t.spend;
        s.last += t.lastHandoff ?? "-";
      }
      assert.deepEqual(
        { ...s, spend: Number(s.spend.toFixed(2)) },
        {
          sessions: 188,
          handoffs: 119,
          retries: 23,
          spend: 704.32,
          last: "DDD-DDDDD-DDDD-DD-DDD-DDD--DDD-DD-DDDD-DD-DD-CDDD-DDD-DD-DD-DD-DD-DD-DDD-D-DD-DDD-DD--DD-DDDD-DD-DD-DDD-DD-DD-DD-",
        },
      );
    });

    test("the same rows written as schema 6 tally the same as their prose", () => {
      const v6 = rows.map((r) => {
        const m = /^phase ([A-F]) next(?: — (.+))?$/.exec(r.park_reason ?? "");
        return r.outcome === "handoff" && m ? { ...r, park_reason: null, handoff: { phase: m[1], why: m[2] ?? null, said: null } } : r;
      });
      assert.deepEqual(each(v6), each(rows));
    });

    test("rows of every schema before 6 still tally", () => {
      assert.deepEqual([...new Set(rows.map((r) => r.schema))], [5]);
      const older = [{ n: 1, outcome: "handoff", park_reason: "phase C next" }, { schema: 2, n: 1, outcome: "retry" }, { schema: 4, n: 1, outcome: "handoff", park_reason: "phase D next — x", solo_bash_turns: 3 }];
      assert.deepEqual([ticketTally(1, older).lastHandoff, ticketTally(1, older).handoffWhy], ["D", "x"]);
    });
  });

  test("handoffs since the last terminal row, restarting the streak on a retry", () => {
    const t = ticketTally(1, [
      row({ outcome: "handoff", park_reason: "phase D next" }),
      row({ outcome: "handoff", park_reason: "phase D next" }),
      row({ outcome: "retry", head: "a" }),
      row({ outcome: "handoff", park_reason: "phase D next" }),
    ]);
    assert.equal(t.sessions, 4);
    assert.equal(t.handoffsThisRound, 1);
    assert.equal(t.lastHandoff, "D");
    assert.equal(t.lastRedHead, "a");
    assert.equal(t.retries, 1);
  });

  test("time, turns and spend add up every session since the last terminal row", () => {
    const t = ticketTally(1, [
      row({ outcome: "landed", ms: 9, turns: 9, cost: 9 }),
      row({ outcome: "handoff", ms: 100, turns: 10, cost: 1 }),
      row({ outcome: "retry", ms: 50, turns: 0, cost: 0 }),
      row({ outcome: "pushed", ms: 20, turns: 3, cost: 0.5 }),
    ]);
    assert.deepEqual([t.ms, t.turns, t.spend], [170, 13, 1.5]);
  });

  test("the last handoff's reason is what follows its phase, and a retry clears it", () => {
    const why = (rows: object[]) => ticketTally(1, rows).handoffWhy;
    const rerouted = row({ outcome: "handoff", park_reason: "phase C next — no local pass" });
    assert.equal(why([rerouted]), "no local pass");
    assert.equal(why([rerouted, row({ outcome: "handoff", park_reason: "phase D next" })]), null);
    assert.equal(why([rerouted, row({ outcome: "retry" })]), null);
  });

  test("a retry clears the phase the last handoff named", () => {
    const t = ticketTally(1, [row({ outcome: "handoff", park_reason: "phase E next" }), row({ outcome: "retry" })]);
    assert.equal(t.lastHandoff, null);
  });

  test("a landed row starts the next tally from zero", () => {
    const t = ticketTally(1, [
      row({ outcome: "retry", head: "x" }),
      row({ outcome: "landed" }),
      row({ outcome: "handoff", park_reason: "phase E next" }),
    ]);
    assert.equal(t.sessions, 1);
    assert.equal(t.lastHandoff, "E");
    assert.equal(t.lastRedHead, null);
    assert.equal(t.retries, 0);
  });

  test("a parked row starts the next tally from zero too", () => {
    const t = ticketTally(1, [row({ outcome: "retry" }), row({ outcome: "parked" }), row({ outcome: "retry" })]);
    assert.equal(t.sessions, 1);
    assert.equal(t.retries, 1);
  });

  test("spend sums every row, including retry and refused rows", () => {
    const t = ticketTally(1, [
      row({ outcome: "retry", cost: 1 }),
      row({ outcome: "refused", cost: 0.5 }),
      row({ outcome: "handoff", cost: 0.2, park_reason: "phase D next" }),
    ]);
    assert.equal(t.spend, 1.7);
  });

  test("a schema-4 row with no head gives lastRedHead null rather than throwing", () => {
    assert.doesNotThrow(() => ticketTally(1, [row({ outcome: "retry" })]));
    assert.equal(ticketTally(1, [row({ outcome: "retry" })]).lastRedHead, null);
  });

  test("a ticket with no rows at all is an empty tally, not a throw", () => {
    assert.deepEqual(ticketTally(1, []), {
      sessions: 0,
      spend: 0,
      ms: 0,
      turns: 0,
      handoffsThisRound: 0,
      lastHandoff: null,
      handoffWhy: null,
      lastRedHead: null,
      retries: 0,
      diagnosed: [],
      brief: null,
    });
  });

  test("a head is diagnosed until the window closes, whatever rounds pass on it", () => {
    const rows = [row({ outcome: "diagnosed", head: "a" }), row({ outcome: "retry", head: "a" }), row({ outcome: "diagnosed", head: "b" })];
    assert.deepEqual(ticketTally(1, rows).diagnosed, ["a", "b"]);
    assert.deepEqual(ticketTally(1, [...rows, row({ outcome: "parked" })]).diagnosed, []);
  });

  test("a resume's cause is the brief until a session has run on it", () => {
    const resume = row({ outcome: "diagnosed", park_reason: "resume C — tsc is red" });
    const brief = (...later: object[]) => ticketTally(1, [resume, ...later]).brief;
    assert.equal(brief(), "tsc is red");
    assert.equal(brief(row({ outcome: "retry" }), row({ outcome: "handoff", park_reason: "phase C next — diagnosis: tsc is red" })), "tsc is red");
    assert.equal(brief(row({ outcome: "pushed" })), null);
    assert.equal(brief(row({ outcome: "handoff", park_reason: "phase D next" })), null);
    assert.equal(ticketTally(1, [row({ outcome: "diagnosed", park_reason: "rerun — 403" })]).brief, null);
  });

  test("a pushed row and its settle row are one session", () => {
    const t = ticketTally(1, [row({ outcome: "pushed", cost: 2 }), row({ outcome: "retry" })]);
    assert.equal(t.sessions, 1);
    assert.equal(t.spend, 2);
  });

  test("another ticket's rows in the same file are not counted", () => {
    const t = ticketTally(1, [row({ n: 2, outcome: "retry", cost: 5 })]);
    assert.equal(t.sessions, 0);
    assert.equal(t.spend, 0);
  });
});

describe("windowCost", () => {
  const pushed = { n: 1, outcome: "pushed", cost: 4 };

  test("a settle row shows the cost of the pushed row its window opened with", () => {
    assert.equal(windowCost({ n: 1, outcome: "landed", own: 0.5 }, [pushed]), 4.5);
    assert.equal(windowCost({ n: 1, outcome: "retry", own: 0 }, [pushed, { n: 2, outcome: "landed", cost: 9 }]), 4);
  });

  test("a row with no pushed row before it shows its own cost", () => {
    assert.equal(windowCost({ n: 1, outcome: "landed", own: 2 }, [pushed, { n: 1, outcome: "retry", cost: 0 }]), 2);
    assert.equal(windowCost({ n: 1, outcome: "pushed", own: 3 }, [pushed]), 3);
    assert.equal(windowCost({ n: 1, outcome: "parked", own: 1 }, []), 1);
  });
});

describe("parkReasonOf", () => {
  test("a landed, retry or pushed row carries no park reason", () => {
    for (const outcome of ["landed", "retry", "pushed"]) assert.equal(parkReasonOf(outcome, "CI next"), null);
    assert.equal(parkReasonOf("parked", "held twice"), "held twice");
    assert.equal(parkReasonOf("parked", undefined), null);
  });
});

describe("readLedger", () => {
  let dir: string;
  before(() => {
    dir = mkdtempSync(path.join(tmpdir(), "read-ledger-"));
  });
  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("a missing file is no rows, not a throw", () => {
    assert.deepEqual(readLedger(path.join(dir, "nope.jsonl")), []);
  });

  test("skips a line it cannot parse", () => {
    const file = path.join(dir, "tickets.jsonl");
    writeFileSync(file, '{"n":1}\nnot json\n\n{"n":2}\n', "utf8");
    assert.deepEqual(readLedger(file), [{ n: 1 }, { n: 2 }]);
  });

  test("an empty file is no rows", () => {
    const file = path.join(dir, "empty.jsonl");
    writeFileSync(file, "", "utf8");
    assert.deepEqual(readLedger(file), []);
  });
});

describe("a session's error", () => {
  test("a clean exit has none", () => {
    assert.equal(errorOf({ result: { isError: false }, stderr: "  " }), null);
  });

  test("carries the API status and terminal reason, and keeps only the stderr tail past the cap", () => {
    const e = errorOf({ result: { isError: true, apiStatus: 529, terminalReason: "api_error" }, stderr: `${"x".repeat(STDERR_CAP)}END` })!;
    assert.deepEqual([e.status, e.reason, e.stderr!.length], [529, "api_error", STDERR_CAP]);
    assert.ok(e.stderr!.endsWith("END"));
  });

  test("goes into a park's reason, and into no other row's", () => {
    const e = { status: null, reason: "error_during_execution", stderr: "spawn EPERM" };
    assert.equal(parkReasonOf("parked", "exited 1", e), "exited 1 — error_during_execution · spawn EPERM");
    assert.equal(parkReasonOf("diagnosed", "resume C — x", e), "resume C — x");
  });
});

describe("start rows", () => {
  const book = () => {
    const lines: string[] = [];
    const titles: string[] = [];
    const b = ledger({ append: (f: string, t: string) => f.endsWith("tickets.jsonl") && lines.push(t), mkdir: () => {}, exists: () => false, write: (_f: string, t: string) => titles.push(t), loopSha: "abcdef1234" });
    return { b, titles, rows: () => lines.map((l) => JSON.parse(l)) };
  };

  test("a spawn with no row after it reads as killed at the next boot, with its elapsed time", () => {
    const { b, rows } = book();
    b.start(1094, "D", "r1");
    const earlier = rows().map((r) => ({ ...r, started: "2026-09-21T08:05:45.000Z" }));
    const [killed] = killedStarts(earlier, (s: any) => Date.parse(s.started) + 60_000);
    assert.deepEqual([killed.n, killed.phase, killed.ms, killed.trailing, killed.loop_sha], [1094, "D", 60_000, true, "abcdef1234"]);
  });

  test("a normal exit is exactly one end row, and nothing killed", () => {
    const { b, titles, rows } = book();
    b.start(1094, "D", "r1");
    b.record(session({ number: 1094 }), { runId: "r1", report: { number: 1094, title: "t", outcome: "landed", ms: 1, cost: 0 } });
    assert.deepEqual(rows().map((r) => r.outcome), ["started", "landed"]);
    assert.equal(rows()[1].loop_sha, "abcdef1234");
    assert.match(titles[0], /· loop abcdef1/);
    assert.deepEqual(killedStarts(rows()), []);
  });

  test("a restarted run's row for the ticket does not answer the start it never ran", () => {
    const at = (m: number) => new Date(Date.UTC(2026, 8, 21, 8, m)).toISOString();
    const rows = [
      { outcome: "started", n: 7, run_id: "r1", started: at(0) },
      { outcome: "retry", n: 7, run_id: "r2", started: at(30) },
      { outcome: "started", n: 7, run_id: "r2", started: at(31) },
      { outcome: "handoff", n: 7, run_id: "r2", started: at(31) },
    ];
    assert.deepEqual(killedStarts(rows).map((k) => [k.n, k.ms, k.trailing]), [[7, 31 * 60_000, false]]);
    const spoke = (s: any, until: number) => Math.min(Date.parse(s.started) + 5 * 60_000, until);
    assert.equal(killedStarts(rows, spoke)[0].ms, 5 * 60_000, "the restart bounds the session, it does not time it");
  });

  test("readLedger leaves them out unless asked", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "starts-"));
    const file = path.join(dir, "tickets.jsonl");
    writeFileSync(file, '{"n":1,"outcome":"started"}\n{"n":1,"outcome":"landed"}\n', "utf8");
    assert.deepEqual(readLedger(file).map((r) => r.outcome), ["landed"]);
    assert.equal(readLedger(file, { starts: true }).length, 2);
    rmSync(dir, { recursive: true, force: true });
  });
});
