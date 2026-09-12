// tests/loopRender.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  elapsed,
  header,
  phaseLine,
  activeLine,
  toolDetail,
  queueLine,
  bell,
  SPIN,
  closing,
  reportRow,
  runTotal,
  PHASES,
  clockAt,
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

  test("the mark is the caller's, so a phase taken up does not read as a phase finished", () => {
    assert.match(phaseLine({ letter: "C", detail: "resumed", ms: 0, mark: "↻" }), /↻ \[3\/6\]/);
    assert.equal(
      phaseLine({ letter: "C", detail: "x", ms: 0, mark: "↻" }).length,
      phaseLine({ letter: "C", detail: "x", ms: 0 }).length
    );
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

describe("activeLine", () => {
  test("names the phase, its number and how long it has been open", () => {
    const line = activeLine({ letter: "C", ms: 252_000 });
    assert.match(line, /\[3\/6\] C/);
    assert.match(line, /build/);
    assert.match(line, /4:12\s*$/);
  });

  test("the spinner advances with the frame", () => {
    assert.notEqual(
      activeLine({ letter: "C", ms: 0, frame: 0 }).trim()[0],
      activeLine({ letter: "C", ms: 0, frame: 1 }).trim()[0]
    );
  });

  test("the frame wraps rather than running off the end of the spinner", () => {
    assert.equal(activeLine({ letter: "C", ms: 0, frame: SPIN.length }).trim()[0], SPIN[0]);
    assert.equal(activeLine({ letter: "C", ms: 0, frame: SPIN.length * 3 + 2 }).trim()[0], SPIN[2]);
  });

  // Every line this module emits is the same width, and the timer is what is redrawn in place: a
  // line that changes width leaves the tail of the longer one on screen after the shorter one.
  test("the width does not move as the detail grows", () => {
    assert.equal(
      activeLine({ letter: "C", ms: 0, detail: "git status" }).length,
      activeLine({ letter: "C", ms: 0, detail: "x".repeat(200) }).length
    );
  });

  test("it lines up with the finished line that replaces it", () => {
    assert.equal(activeLine({ letter: "C", ms: 0 }).length, phaseLine({ letter: "C", ms: 0 }).length);
  });

  test("an unknown letter does not render a negative index", () => {
    assert.doesNotMatch(activeLine({ letter: "Z", ms: 0 }), /\[0\/6\]/);
    assert.doesNotMatch(phaseLine({ letter: "Z", ms: 0 }), /\[0\/6\]/);
  });
});

describe("toolDetail", () => {
  test("a shell call shows the command", () => {
    assert.equal(
      toolDetail({ name: "Bash", command: "git push -u origin agent/42-x" }),
      "git push -u origin agent/42-x"
    );
  });

  test("a non-shell tool shows its name", () => {
    assert.equal(toolDetail({ name: "Read", command: "" }), "Read");
  });

  test("only the first line of a multi-line command", () => {
    assert.equal(
      toolDetail({ name: "Bash", command: "gh issue comment 42 \\\n  --body-file b.md" }),
      "gh issue comment 42 \\"
    );
  });

  test("a long command is truncated, not wrapped", () => {
    const d = toolDetail({ name: "Bash", command: `git ${"x".repeat(200)}` });
    assert.ok(d.length <= 44, `${d.length} chars`);
    assert.match(d, /…$/);
  });

  // A review subagent's calls are the only sign of life during phase D, which is the longest phase
  // and the one that looked like a hang.
  test("a subagent's call is shown, and marked as one", () => {
    assert.match(toolDetail({ name: "Bash", command: "git diff", parent: "toolu_1" }), /^· /);
  });

  test("a marked call is truncated to the same width as an unmarked one", () => {
    const d = toolDetail({ name: "Bash", command: "y".repeat(200), parent: "toolu_1" });
    assert.ok(d.length <= 44, `${d.length} chars`);
  });

  test("a command that is only whitespace falls back to the tool's name", () => {
    assert.equal(toolDetail({ name: "Bash", command: "   \n  " }), "Bash");
  });
});

describe("queueLine", () => {
  const q = (implement: number, triage = 0, wayfinder = 0) => ({ implement, triage, wayfinder });

  test("a bucket that moved shows both numbers", () => {
    assert.match(queueLine(q(11), q(10)), /11→10 implement/);
  });

  test("a bucket that did not move shows one", () => {
    const line = queueLine(q(11, 3), q(10, 3));
    assert.match(line, /3 triage/);
    assert.doesNotMatch(line, /3→3/);
  });

  // The frontier grew because the ticket filed follow-ups. That is the number worth seeing, and the
  // arrow is the only thing that shows it.
  test("a bucket that grew reads as growth", () => {
    assert.match(queueLine(q(10), q(12)), /10→12 implement/);
  });

  test("an empty queue says so rather than printing three zeroes", () => {
    assert.match(queueLine(q(1), q(0, 0, 0)), /empty/);
  });
});

describe("bell", () => {
  test("it rings at a terminal", () => {
    const wrote: string[] = [];
    bell({ isTTY: true, write: (s: string) => wrote.push(s) } as never);
    assert.deepEqual(wrote, [""]);
  });

  // Piped to a file or a CI log a bell is a stray byte, and the loop's output is read that way more
  // often than it is watched.
  test("it is silent anywhere else", () => {
    const wrote: string[] = [];
    bell({ isTTY: false, write: (s: string) => wrote.push(s) } as never);
    assert.deepEqual(wrote, []);
  });

  test("a stream that cannot be written to does not take the run down with it", () => {
    assert.doesNotThrow(() =>
      bell({
        isTTY: true,
        write: () => {
          throw new Error("EPIPE");
        },
      } as never)
    );
  });

  test("no stream at all is silent, not a crash", () => {
    assert.doesNotThrow(() => bell(null as never));
  });
});

// A wait is only actionable as a time and a distance.
describe("clockAt", () => {
  const now = Date.UTC(2026, 8, 11, 9, 14);

  test("reads as a time and a distance, never as an epoch", () => {
    const s = clockAt(1789134000, now);
    assert.doesNotMatch(s, /1789134000/);
    assert.match(s, /in 4h/);
  });

  test("minutes under the hour", () => {
    assert.match(clockAt(Math.floor(now / 1000) + 25 * 60, now), /in 25m/);
  });

  test("milliseconds are accepted too, since the shape is not guaranteed", () => {
    assert.equal(clockAt(1789134000000, now), clockAt(1789134000, now));
  });

  test("a past or missing reset says so rather than counting backwards", () => {
    assert.doesNotMatch(clockAt(Math.floor(now / 1000) - 600, now), /in -/);
    assert.equal(clockAt(null), "an unknown time");
  });
});
