// tools/loop/tests/loopLogs.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { ARTEFACTS, ledger, prunable, prune, sessionRow, usageSplit } from "../loop-logs.mjs";

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
    assert.equal(prunable("park-999.md"), true);
  });

  test("something nobody named is left alone rather than deleted on an extension match", () => {
    assert.equal(prunable("notes.jsonl"), false);
    assert.equal(prunable("README.md"), false);
  });
});

describe("prune", () => {
  const week = 7 * 24 * 60 * 60_000;
  const fakeFs = (files: Record<string, number>) => {
    const gone: string[] = [];
    return {
      gone,
      fs: {
        existsSync: () => true,
        readdirSync: () => Object.keys(files),
        statSync: (f: string) => ({ mtimeMs: files[path.basename(f)] }),
        rmSync: (f: string) => gone.push(path.basename(f)),
      },
    };
  };

  test("sweeps only what is both prunable and old", () => {
    const now = 1_000 * week;
    const { fs, gone } = fakeFs({
      "999.jsonl": now - 2 * week,
      "998.jsonl": now - 1_000,
      "ci-999.log": now - 2 * week,
      "tickets.jsonl": now - 50 * week,
      "run-old.md": now - 50 * week,
    });
    const swept = prune(now, fs as never);
    assert.deepEqual(swept.sort(), ["999.jsonl", "ci-999.log"]);
    assert.deepEqual(gone.sort(), ["999.jsonl", "ci-999.log"]);
  });

  test("no directory is nothing to sweep, not a throw", () => {
    assert.deepEqual(prune(0, { existsSync: () => false } as never), []);
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
    assert.equal(r.schema, 3);
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
    book.record(session(), { runId: "2026-09-13-04-12", line: "· #953 landed" });
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
    book.record(session({ outcome: "retry" }), { runId: "r", line: "a", counts: false });
    book.record(session(), { runId: "r", line: "b" });
    assert.equal(book.rows.length, 2);
    assert.equal(book.totals.cost, 3.64);
    assert.equal(book.totals.tickets, 1, "a fix round is a session, not a ticket");
  });

  // A usage refusal spent real money and reached the totals through a second writer, which is why
  // the ledger needed a flag to stop counting itself twice.
  test("a session that closed no ticket still records what it spent", () => {
    const { io } = spy();
    const book = ledger(io);
    book.record(session({ outcome: "refused" }), { runId: "r", line: "x", counts: false });
    assert.equal(book.totals.cost, 1.82);
    assert.equal(book.totals.tickets, 0);
    assert.equal(book.totals.parked, 0);
  });

  test("the report gets its heading once and a row per session after that", () => {
    const { io, appended, written } = spy();
    const book = ledger(io);
    book.record(session(), { runId: "2026-09-13-04-12", line: "first" });
    book.record(session(), { runId: "2026-09-13-04-12", line: "second" });
    assert.equal(written.length, 1);
    assert.match(written[0][1], /# queue-loop 2026-09-13 04:12/);
    assert.deepEqual(
      appended.filter(([f]) => f.startsWith("run-")).map(([, t]) => t.trim()),
      ["first", "second"],
    );
  });

  test("a park counts against the run rather than for it", () => {
    const { io } = spy();
    const book = ledger(io);
    book.record(session({ outcome: "parked", merged: false }), { runId: "r", line: "x" });
    assert.equal(book.totals.parked, 1);
    assert.equal(book.totals.landed, 0);
  });
});
