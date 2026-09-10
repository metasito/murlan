// tests/loopRender.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  elapsed,
  header,
  phaseLine,
  closing,
  reportRow,
  runTotal,
  PHASES,
} from "../scripts/loop-render.mjs";

describe("elapsed", () => {
  test("m:ss under an hour, zero-padded seconds", () => {
    assert.equal(elapsed(12_000), "0:12");
    assert.equal(elapsed(104_000), "1:44");
    assert.equal(elapsed(0), "0:00");
  });

  test("h:mm:ss over an hour", () => {
    assert.equal(elapsed(3_723_000), "1:02:03");
  });
});

describe("header", () => {
  const h = header({
    number: 953,
    title: "Rate limiter factory",
    size: "size:S",
    url: "https://github.com/metasito/murlan/issues/953",
    queue: { implement: 7, triage: 2, wayfinder: 1 },
  });

  test("names the ticket, its size and its link", () => {
    assert.match(h, /#953/);
    assert.match(h, /Rate limiter factory/);
    assert.match(h, /size:S/);
    assert.match(h, /github\.com\/metasito\/murlan\/issues\/953/);
  });

  test("shows how much work is behind this one", () => {
    assert.match(h, /queue: 7 · 2 · 1/);
  });

  test("a ticket with no size label still renders", () => {
    const none = header({
      number: 1,
      title: "x",
      size: null,
      url: "u",
      queue: { implement: 0, triage: 0, wayfinder: 0 },
    });
    assert.match(none, /#1/);
    assert.ok(!none.includes("null"));
  });

  test("a long title does not push the size label off the line", () => {
    const long = header({
      number: 953,
      title: "A ticket title that is considerably longer than the eighty column budget allows for",
      size: "size:XL",
      url: "u",
      queue: { implement: 1, triage: 0, wayfinder: 0 },
    });
    for (const line of long.split("\n")) assert.ok(line.length <= 78, `line over budget: ${line}`);
    assert.match(long, /size:XL/);
  });
});

describe("phaseLine", () => {
  test("numbers the phase out of six and keeps queue.md's letter", () => {
    const line = phaseLine({ letter: "C", detail: "3 commits · 4 files", ms: 511_000 });
    assert.match(line, /\[3\/6\]/);
    assert.match(line, /\bC\b/);
    assert.match(line, /build/);
    assert.match(line, /3 commits · 4 files/);
    assert.match(line, /8:31/);
  });

  test("every phase in PHASES renders and they are the six queue.md defines", () => {
    assert.deepEqual(
      PHASES.map(([l]: [string, string]) => l),
      ["A", "B", "C", "D", "E", "F"]
    );
    for (const [letter] of PHASES) {
      assert.match(phaseLine({ letter, detail: "", ms: 0 }), new RegExp(`\\b${letter}\\b`));
    }
  });
});

describe("closing", () => {
  test("a landed ticket leads with the tick and carries the figures", () => {
    const c = closing({
      outcome: "landed",
      number: 953,
      files: 4,
      turns: 41,
      ms: 1_420_000,
      cost: 1.82,
      log: ".loop-logs/953.jsonl",
    });
    assert.match(c, /✅/);
    assert.match(c, /#953/);
    assert.match(c, /4 files/);
    assert.match(c, /41 turns/);
    assert.match(c, /\$1\.82/);
  });

  test("a parked ticket says why, and says where the log is", () => {
    const c = closing({
      outcome: "parked",
      number: 953,
      why: "no output for 30m in phase C",
      ms: 1_800_000,
      cost: 0.9,
      log: ".loop-logs/953.jsonl",
    });
    assert.match(c, /⚠️/);
    assert.match(c, /no output for 30m in phase C/);
    assert.match(c, /\.loop-logs\/953\.jsonl/);
  });

  test("a rate limit says when it resets and is not an outcome", () => {
    const c = closing({ outcome: "rate_limited", number: 953, why: "resets 04:10", ms: 0, cost: 0 });
    assert.match(c, /⏸/);
    assert.match(c, /04:10/);
  });
});

describe("reportRow", () => {
  test("one fixed-width line per ticket, for the morning file", () => {
    const row = reportRow({
      number: 953,
      title: "Rate limiter factory",
      outcome: "landed",
      pr: 1204,
      ms: 1_420_000,
      cost: 1.82,
    });
    assert.match(row, /#953/);
    assert.match(row, /landed/);
    assert.match(row, /1204/);
    assert.ok(!row.includes("\n"), "a report row is one line");
  });

  test("a parked row carries the reason instead of a PR", () => {
    const row = reportRow({
      number: 970,
      title: "Reconnect backoff",
      outcome: "parked",
      pr: null,
      ms: 900_000,
      cost: 1.48,
      why: "no review after 4 rounds",
    });
    assert.match(row, /parked/);
    assert.match(row, /no review after 4 rounds/);
    assert.ok(!row.includes("null"));
  });
});

describe("runTotal", () => {
  test("counts the night", () => {
    const t = runTotal({ tickets: 3, landed: 2, parked: 1, ms: 11_520_000, cost: 6.4 });
    assert.match(t, /3 tickets/);
    assert.match(t, /2 landed/);
    assert.match(t, /1 parked/);
    assert.match(t, /\$6\.40/);
    assert.match(t, /3:12:00/);
  });
});
