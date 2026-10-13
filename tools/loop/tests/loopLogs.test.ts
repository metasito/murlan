// tools/loop/tests/loopLogs.test.ts
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  ARTEFACTS,
  errorOf,
  handoffIn,
  holdRound,
  killedStarts,
  ledger,
  outcomeRow,
  parkReasonOf,
  processRow,
  STDERR_CAP,
  prunable,
  RETAIN_MS,
  prune,
  readLedger,
  sessionRow,
  ticketTally,
  ticketWindow,
  pendingReparks,
  typicalMs,
  usageSplit,
  windowCost,
  withSpawnPhase,
} from "../loop-logs.mjs";
import { readEvent } from "../loop-stream.mjs";

const fixture = (name: string) => readFileSync(path.join(import.meta.dirname, "fixtures", name), "utf8");
const golden = {
  rows: fixture("ledger-golden.jsonl").trim().split("\n").map((l) => JSON.parse(l)),
  main: JSON.parse(fixture("ledger-golden.main.json")),
};

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

  test("an entry that vanishes or is locked mid-walk is skipped, and the rest still sweep", () => {
    const fs = {
      existsSync: () => true,
      readdirSync: () => ["gone", "old.log"],
      lstatSync: (p: string) => {
        if (p.endsWith("gone")) throw new Error("ENOENT");
        return { isDirectory: () => false, mtimeMs: 0 };
      },
      rmSync: () => {},
    };
    assert.deepEqual(prune(RETAIN_MS + 1, fs as never, "d"), ["old.log"]);
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
    assert.equal(r.schema, 8);
  });

  test("carries the time the session's machine was asleep, null when none was measured", () => {
    assert.equal(sessionRow(session({ asleepMs: 7_200_000 })).asleep_ms, 7_200_000);
    assert.equal(r.asleep_ms, null);
  });

  test("carries the CI reruns the session ran itself", () => {
    assert.equal(sessionRow(session({ reruns: 1 })).reruns, 1);
    assert.equal(r.reruns, null);
  });

  test("carries the run and tests a rerun turned green, null when none did", () => {
    const flake = { runId: 7, tests: ["tests/e2e/x.spec.ts › y"] };
    assert.deepEqual(sessionRow(session({ flake })).flake, flake);
    assert.equal(r.flake, null);
  });

  test("carries the park steps the tracker never received", () => {
    assert.deepEqual(sessionRow(session({ parkFailed: ["label"] })).park_failed, ["label"]);
    assert.equal(r.park_failed, null);
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
    assert.equal(sessionRow(session({ totalHolds: null })).review_holds_total, null);
  });

  test("carries every HOLD on the issue beside the count the cap reads", () => {
    const r = sessionRow(session({ reviewRounds: 1, totalHolds: 5 }));
    assert.equal(r.review_holds_total, 5);
    assert.equal("review_rounds_total" in r, false);
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

  test("a ticket closed as done counts as landed, not parked", () => {
    const { io } = spy();
    const book = ledger(io);
    book.record(session({ outcome: "closed", merged: false }), { runId: "2026-09-13-04-12", report: { ...report("x"), outcome: "closed" } });
    assert.equal(book.totals.landed, 1);
    assert.equal(book.totals.parked, 0);
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

describe("pendingReparks", () => {
  const parked = (n: number, park_failed: string[] | null) => ({ n, outcome: "parked", park_failed });
  test("owes the tracker's steps of a ticket's last park, and nothing once a reparked row clears them", () => {
    assert.deepEqual(pendingReparks([parked(1, ["label", "worktree"]), parked(2, null)]), [{ n: 1, steps: ["label"] }]);
    const partly = { n: 1, outcome: "reparked", park_failed: ["comment"] };
    assert.deepEqual(pendingReparks([parked(1, ["label", "comment"]), partly]), [{ n: 1, steps: ["comment"] }]);
    assert.deepEqual(pendingReparks([parked(1, ["label"]), { n: 1, outcome: "reparked", park_failed: null }]), []);
    assert.deepEqual(pendingReparks([parked(1, ["label"]), { n: 1, outcome: "handoff" }]), [], "a ticket the owner sent back has moved on");
  });

  test("a reparked row closes a window as the park did, so it is not a session of the next", () => {
    const t = ticketTally(1, [{ n: 1, outcome: "parked", cost: 2 }, { n: 1, outcome: "reparked", cost: 0 }]);
    assert.equal(t.sessions, 0);
  });
});

describe("ticketTally", () => {
  const row = (over: object) => ({ n: 1, cost: 0, ...over });

  test("reads a structured handoff first, and the prose only on a row that has none", () => {
    const t = ticketTally(1, [row({ outcome: "handoff", park_reason: "phase D next", handoff: { phase: "C", why: "red", said: null } })]);
    assert.deepEqual([t.lastHandoff, t.handoffWhy], ["C", "red"]);
  });

  test("a declared handoff's own why reaches the next process when the supervisor gave none", () => {
    assert.deepEqual(handoffIn({ handoff: { phase: "D", why: null, said: "round 1 HOLD: model the Modal root" } }), { phase: "D", why: "round 1 HOLD: model the Modal root" });
    assert.deepEqual(handoffIn({ handoff: { phase: "C", why: "the D handoff had no local pass", said: "x" } }), { phase: "C", why: "the D handoff had no local pass" });
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

  test("so does a closed row", () => {
    const t = ticketTally(1, [row({ outcome: "retry" }), row({ outcome: "closed" }), row({ outcome: "retry" })]);
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
      armedFlake: null,
    });
  });

  // Written when poll arms on a rerun's green, so a restart before the merge still knows the flake.
  test("an armed row carries its flake and head to the tally, is no session, and a landing clears it", () => {
    const flake = { runId: 7, tests: ["t"], step: "Test" };
    const armed = row({ outcome: "armed", head: "h1", flake });
    const t = ticketTally(1, [row({ outcome: "pushed" }), armed]);
    assert.deepEqual(t.armedFlake, { ...flake, head: "h1" });
    assert.equal(t.sessions, 0);
    assert.equal(ticketTally(1, [armed, row({ outcome: "landed" })]).armedFlake, null);
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

describe("schema 9 rows", () => {
  const result = readEvent({ type: "result", session_id: "s1", is_error: false, subtype: "success", total_cost_usd: 1.5, num_turns: 20 });
  const run = { result, phases: { D: 50, E: 10 } };
  const proc = (over: object = {}) =>
    processRow({
      n: 7,
      runId: "r1",
      loopSha: "abc",
      started: "2026-10-12T10:00:00.000Z",
      ms: 60_000,
      at: "D",
      size: "size:S",
      model: "claude-opus-5-5",
      sessionId: "s1",
      maxTurns: 320,
      run,
      outcome: "handoff",
      handoff: { phase: "C", why: null, said: "HOLD on abc" },
      ...over,
    });

  test("a process row carries the supervisor's result event's figures, its spawn phase and its own model", () => {
    const r = proc({ fix: true });
    assert.deepEqual(
      [r.schema, r.kind, r.n, r.at, r.fix, r.model, r.session_id, r.cost, r.turns, r.max_turns, r.subtype, r.outcome, r.handoff?.phase],
      [9, "process", 7, "D", true, "claude-opus-5-5", "s1", 1.5, 20, 320, "success", "handoff", "C"],
    );
    assert.deepEqual(r.phases, { D: 50, E: 10 });
    assert.deepEqual([r.run_id, r.loop_sha, r.started, r.ms], ["r1", "abc", "2026-10-12T10:00:00.000Z", 60_000]);
  });

  test("a process not known to be a fix round writes no flag, so the window's order decides", () => {
    const written = (row: object) => JSON.parse(JSON.stringify(row));
    const flagless = written(proc({ at: "D", outcome: "pushed", handoff: null }));
    assert.equal("fix" in flagless, false);
    const rows = [
      written(proc({ at: "C", outcome: "pushed", handoff: null })),
      outcomeRow({ n: 7, outcome: "retry", head: "a" }),
      written(proc({ at: "C", fix: true, handoff: { phase: "D", why: null, said: null } })),
      flagless,
    ];
    assert.equal(ticketWindow(7, rows).fixSpend, 3);
  });

  test("a process that died before its result event is a row of no spend, not a throw", () => {
    const r = proc({ run: null, outcome: "parked", why: "the session exited 1 in phase C" });
    assert.deepEqual([r.cost, r.turns, r.session_id, r.subtype, r.why], [0, 0, "s1", null, "the session exited 1 in phase C"]);
    assert.deepEqual(r.phases, {});
  });

  test("an outcome row is the supervisor's: no spend, no turns, and the time it waited", () => {
    const r = outcomeRow({ n: 7, runId: "r1", loopSha: "abc", outcome: "landed", why: "merged", pr: 9, head: "h", ms: 480_000, at: new Date("2026-10-12T11:00:00Z") });
    assert.deepEqual(
      [r.schema, r.kind, r.n, r.outcome, r.why, r.pr, r.head, r.ms, r.started, "cost" in r, "turns" in r],
      [9, "outcome", 7, "landed", "merged", 9, "h", 480_000, "2026-10-12T11:00:00.000Z", false, false],
    );
  });
});

describe("ticketWindow", () => {
  const proc = (over: object) => ({ schema: 9, kind: "process", n: 1, at: "C", fix: false, cost: 0, turns: 10, ms: 0, ...over });
  const out = (over: object) => ({ schema: 9, kind: "outcome", n: 1, ...over });

  test("is the rows since the last landed, closed, parked or reparked row", () => {
    for (const closer of ["landed", "closed", "parked", "reparked"]) {
      const t = ticketWindow(1, [proc({ cost: 9 }), out({ outcome: closer }), proc({ cost: 2, ms: 5, turns: 3 }), { n: 1, outcome: "started" }]);
      assert.deepEqual([t.spend, t.ms, t.turns, t.processes], [2, 5, 3, 1], closer);
    }
  });

  test("a HOLD round is a D-spawned process handing back to C or D, and its spend is fix spend", () => {
    const t = ticketWindow(1, [
      proc({ at: "C", cost: 5, outcome: "handoff", handoff: { phase: "D" } }),
      proc({ at: "D", cost: 2, outcome: "handoff", handoff: { phase: "C" } }),
      proc({ at: "C", cost: 3, outcome: "handoff", handoff: { phase: "D" } }),
      proc({ at: "D", cost: 4, outcome: "handoff", handoff: { phase: "D" } }),
      proc({ at: "D", cost: 1, outcome: "handoff", handoff: { phase: "E" } }),
    ]);
    assert.deepEqual([t.holds, t.fixSpend, t.spend], [2, 6, 15]);
  });

  test("a CI fix round is fix spend: by its own flag, and before schema 9 by following a retry", () => {
    assert.equal(ticketWindow(1, [proc({ cost: 4 }), proc({ fix: true, cost: 3 })]).fixSpend, 3);
    const v8 = [{ n: 1, outcome: "pushed", cost: 4, turns: 20 }, { n: 1, outcome: "retry", cost: 0, turns: 0 }, { n: 1, outcome: "pushed", cost: 1.5, turns: 9 }];
    assert.equal(ticketWindow(1, v8).fixSpend, 1.5);
  });

  test("a retry restarts the handoff streak, clears the handed phase and names the red head", () => {
    const t = ticketWindow(1, [
      proc({ outcome: "handoff", handoff: { phase: "D", why: null, said: null } }),
      out({ outcome: "retry", head: "a" }),
      proc({ outcome: "handoff", handoff: { phase: "D", why: null, said: "round 1 HOLD" } }),
    ]);
    assert.deepEqual([t.handoffs, t.retries, t.lastRedHead], [1, 1, "a"]);
    assert.deepEqual(t.lastHandoff, { phase: "D", why: "round 1 HOLD" });
    assert.equal(ticketWindow(1, [proc({ outcome: "handoff", handoff: { phase: "E" } }), out({ outcome: "retry" })]).lastHandoff, null);
  });

  test("the supervisor's reason outranks what the session said", () => {
    const t = ticketWindow(1, [proc({ outcome: "handoff", handoff: { phase: "C", why: "no local pass", said: "x" } })]);
    assert.deepEqual(t.lastHandoff, { phase: "C", why: "no local pass" });
  });

  test("a head rerun, or diagnosed before reruns, has had its one second look", () => {
    const t = ticketWindow(1, [{ n: 1, outcome: "diagnosed", head: "a", turns: 4 }, out({ outcome: "rerun", head: "b" })]);
    assert.deepEqual(t.reruns, ["a", "b"]);
  });

  test("before schema 9 a process is a row that ran turns, and a settle row is none", () => {
    const t = ticketWindow(1, [{ n: 1, outcome: "pushed", cost: 3, turns: 20, ms: 100 }, { n: 1, outcome: "retry", cost: 0, turns: 0, ms: 50 }]);
    assert.deepEqual([t.processes, t.spend, t.ms], [1, 3, 150]);
  });

  test("another ticket's rows and no rows at all are an empty window, not a throw", () => {
    assert.deepEqual(ticketWindow(1, [proc({ n: 2, cost: 5 })]), {
      spend: 0,
      ms: 0,
      turns: 0,
      processes: 0,
      handoffs: 0,
      lastHandoff: null,
      retries: 0,
      lastRedHead: null,
      reruns: [],
      holds: 0,
      fixSpend: 0,
      ciRounds: 0,
    });
  });

  test("carries the tracker's CI-RED count beside the ledger's retries", () => {
    assert.equal(ticketWindow(1, [out({ outcome: "retry" })], 2).ciRounds, 2);
  });

  test("before schema 6 a handoff is read from its prose", () => {
    const v5 = { schema: 5, n: 1, outcome: "handoff", cost: 2, turns: 30, phases: { D: 600 }, park_reason: "phase C next — HOLD on abc" };
    assert.deepEqual(ticketWindow(1, [v5]).lastHandoff, { phase: "C", why: "HOLD on abc" });
    assert.equal(holdRound(v5), true);
    assert.equal(holdRound({ ...v5, park_reason: "phase E next" }), false);
  });

  test("on every prefix of a ledger of schema 3 to 8, matches what main's ticketTally recorded", () => {
    const rows = golden.rows.filter((r) => r.outcome !== "started" && r.schema !== 9);
    assert.equal(rows.length, golden.main.tallies.length);
    rows.forEach((r, i) => {
      const t = ticketWindow(r.n, rows.slice(0, i + 1));
      assert.deepEqual([r.n, t.spend, t.retries, t.handoffs, t.lastRedHead, t.lastHandoff?.phase ?? null], golden.main.tallies[i], `row ${i + 1}`);
    });
  });
});

describe("withSpawnPhase", () => {
  const start = (phase: string, over: object = {}) => ({ schema: 8, n: 1, outcome: "started", phase, run_id: "r", ...over });
  const row = (over: object) => ({ schema: 8, n: 1, run_id: "r", turns: 20, cost: 1, phases: { B: 60 }, ...over });

  test("gives a process before schema 9 the phase its start row named, and drops the start rows", () => {
    const out = withSpawnPhase([start("A"), row({ outcome: "handoff" })]);
    assert.deepEqual(out.map((r) => [r.outcome, r.at]), [["handoff", "A"]]);
  });

  test("a supervisor row in between does not take the next process's start", () => {
    const out = withSpawnPhase([start("D"), row({ outcome: "retry", turns: 0, phases: {} }), row({ outcome: "pushed" })]);
    assert.deepEqual(out.map((r) => r.at), [undefined, "D"]);
  });

  test("a row with no start row of its run keeps its own phase, and schema 9 keeps its own `at`", () => {
    const out = withSpawnPhase([start("A", { run_id: "other" }), row({ outcome: "pushed" }), { schema: 9, kind: "process", n: 1, at: "C", run_id: "other" }]);
    assert.deepEqual(out.map((r) => r.at), [undefined, "C"]);
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

  test("an armed row between the push and its settle does not close the window", () => {
    assert.equal(windowCost({ n: 1, outcome: "landed", own: 0.5 }, [pushed, { n: 1, outcome: "armed", cost: 0 }]), 4.5);
  });
});

describe("parkReasonOf", () => {
  test("a landed, retry or pushed row carries no park reason", () => {
    for (const outcome of ["landed", "closed", "retry", "pushed"]) assert.equal(parkReasonOf(outcome, "CI next"), null);
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
    assert.equal(parkReasonOf("handoff", "phase D next", e), "phase D next");
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
