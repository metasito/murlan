// tests/loopRecord.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { row } from "../scripts/loop-record.mjs";

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

describe("row", () => {
  const r = row({
    number: 953,
    size: "size:S",
    outcome: "landed",
    pr: 1204,
    phases: { A: 12, B: 92, C: 407, D: 212, E: 1375, F: 45 },
    result: RESULT,
    ci: { runs: 1, red: 0 },
    reviewRounds: 2,
    startedAt: "2026-09-10T22:14:03Z",
    version: "2.1.251",
  });

  test("carries the ticket, its size and its outcome", () => {
    assert.equal(r.n, 953);
    assert.equal(r.size, "size:S");
    assert.equal(r.outcome, "landed");
    assert.equal(r.pr, 1204);
  });

  test("keeps phase durations in seconds, so a night is comparable", () => {
    assert.deepEqual(r.phases, { A: 12, B: 92, C: 407, D: 212, E: 1375, F: 45 });
  });

  test("collapses modelUsage to cost per model", () => {
    assert.deepEqual(r.models, { "claude-opus-5": 1.6, "claude-sonnet-5": 0.22 });
  });

  test("records the cache, because whether a prefix was reused is the whole question", () => {
    assert.deepEqual(r.cache, { created: 26069, read: 15320 });
  });

  test("a result with no modelUsage still produces a row", () => {
    const bare = row({
      number: 1,
      size: null,
      outcome: "parked",
      pr: null,
      phases: { A: 5 },
      result: { ...RESULT, models: {}, subagents: null },
      ci: null,
      reviewRounds: 0,
      startedAt: "2026-09-10T22:14:03Z",
      version: null,
    });
    assert.deepEqual(bare.models, {});
    assert.equal(bare.outcome, "parked");
    assert.equal(bare.pr, null);
  });

  test("a run that produced no result event at all still produces a row", () => {
    const killed = row({
      number: 953,
      size: "size:M",
      outcome: "parked",
      pr: null,
      phases: { A: 12, C: 900 },
      result: null,
      ci: null,
      reviewRounds: 0,
      startedAt: "2026-09-10T22:14:03Z",
      version: null,
    });
    assert.equal(killed.cost, 0);
    assert.equal(killed.turns, 0);
    assert.deepEqual(killed.cache, { created: 0, read: 0 });
  });

  test("the row is JSON-serialisable, since it is written one per line", () => {
    assert.doesNotThrow(() => JSON.stringify(r));
    assert.ok(!JSON.stringify(r).includes("\n"));
  });
});
