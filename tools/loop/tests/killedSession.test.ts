import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { killedStarts, ledger } from "../loop-logs.mjs";
import { estimateCost, killedLine, report, shaTable } from "../loop-cost.mjs";
import { usageOf } from "../loop-stream.mjs";
import { killedRun } from "../queue-loop.mjs";

const STREAM = readFileSync(path.join(import.meta.dirname, "fixtures", "killed-session.jsonl"), "utf8");
const START = "2026-10-15T17:42:00.000Z";

const book = () => {
  const lines: string[] = [];
  const reports: string[] = [];
  const b = ledger({
    append: (f: string, t: string) => (f.endsWith("tickets.jsonl") ? lines.push(t) : reports.push(t)),
    mkdir: () => {},
    exists: () => false,
    write: (_f: string, t: string) => reports.push(t),
    loopSha: "bbbbbbb222",
  });
  return { b, reports, rows: () => lines.map((l) => JSON.parse(l)) };
};

/** The ledger as the restarted supervisor reads it: a session started by the run that died. */
const died = () => {
  const { b, reports, rows } = book();
  b.start(1601, "C", "night-1");
  const ledgerRows = rows().map((r) => (r.outcome === "started" ? { ...r, started: START, loop_sha: "aaaaaaa111" } : r));
  const [k] = killedStarts(ledgerRows, () => Date.parse(START) + 4 * 60_000);
  return { b, reports, rows, ledgerRows, k };
};

describe("a killed session's row, replayed from its stream", () => {
  test("prices only the session after the stream's last init, each message once", () => {
    const { k } = died();
    const own = new Map(
      STREAM.split("\n")
        .slice(3)
        .map(usageOf)
        .filter(Boolean)
        .map((u) => [u!.id, u!]),
    );
    const run = killedRun(k, STREAM);
    assert.equal(own.size, 2);
    assert.equal(run.estimatedCost, estimateCost(own.values()));
    assert.ok(run.estimatedCost! < 12.5, "the earlier session's billed tokens are not this one's");
    assert.deepEqual([run.model, run.version, run.phases], ["claude-opus-5-5", "2.9.1", { C: 240 }]);
  });

  test("a session that wrote nothing after its start is priced at nothing, not as the session before it", () => {
    const { k } = died();
    assert.equal(killedRun({ ...k, ms: 0 }, STREAM).estimatedCost, null);
  });

  test("the row is `killed`, estimated, timed and attributed to the run and loop that started it", () => {
    const { b, k, rows } = died();
    b.killed(k, killedRun(k, STREAM));
    const row = rows().at(-1);
    assert.deepEqual(
      [row.outcome, row.n, row.cost_estimated, row.ms, row.started, row.run_id, row.loop_sha],
      ["killed", 1601, true, 240_000, START, "night-1", "aaaaaaa111"],
    );
    assert.ok(row.cost > 0);
  });

  test("once written, loop:cost counts it once: as a row, never again as a start with no row", () => {
    const { b, k, rows, ledgerRows } = died();
    assert.equal(killedStarts(ledgerRows).length, 1);
    b.killed(k, killedRun(k, STREAM));
    const after = [...ledgerRows, rows().at(-1)];
    assert.deepEqual(killedStarts(after), [], "the next restart finds nothing left to record");
    assert.equal(killedLine(killedStarts(after)), null);
    const settled = after.filter((r) => r.outcome !== "started");
    assert.match(shaTable(settled, killedStarts(after)), /^aaaaaaa\s+0\s+[\d.]+\s+0\s+0\s+1$/m);
    assert.equal(b.totals.cost, 0,"this run's exit summary does not bill the run that died");
  });

  test("it is written to the ledger, not to the restarted run's report", () => {
    const { b, k, reports } = died();
    b.killed(k, killedRun(k, STREAM));
    assert.deepEqual(reports, []);
  });

  test("the cost report sums it with the ticket's other spend", () => {
    const { b, k, rows } = died();
    b.killed(k, killedRun(k, STREAM));
    const row = rows().at(-1);
    const landed = { n: 1601, outcome: "landed", cost: 1, turns: 3, phases: { E: 60 }, size: "size:M" };
    assert.match(report([landed, row]), new RegExp(`\\$${(1 + row.cost).toFixed(2)}`));
  });
});
