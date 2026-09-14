// tools/loop/tests/loopRender.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  act,
  activity,
  bar,
  bell,
  capabilities,
  clockAt,
  closing,
  cols,
  elapsed,
  header,
  keybar,
  phaseRow,
  progress,
  queueLine,
  reportRow,
  runTotal,
  stream,
  tasksDetail,
  theme,
  thought,
  wrap,
  KEYS,
  LAND,
  MIN_WIDTH,
  PHASES,
  PLAIN,
  RECENT,
  SPIN,
  WIDTH,
} from "../loop-render.mjs";
import { ticker } from "../queue-loop.mjs";

/** What a terminal reports. `getColorDepth` is the only signal the renderer reads for colour. */
const term = (over: object = {}) =>
  ({ isTTY: true, getColorDepth: () => 8, columns: WIDTH + 1, ...over }) as never;

const t256 = theme(capabilities(term()));
const t16 = theme(capabilities(term({ getColorDepth: () => 4 })));
const tPlain = PLAIN();

/** Every escape the renderer can emit: SGR, and an OSC 8 hyperlink's two halves. */
const strip = (s: string) =>
  s
    .replace(new RegExp(`${String.fromCharCode(27)}\\]8;;[^${String.fromCharCode(7)}]*${String.fromCharCode(7)}`, "g"), "")
    .replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[A-Za-z]`, "g"), "");

const rows = (block: string) => block.split("\n");

describe("capabilities", () => {
  test("a pipe reports no colour, no links, and the full width", () => {
    const caps = capabilities({ isTTY: false } as never, {});
    assert.equal(caps.colour, false);
    assert.equal(caps.links, false);
    assert.equal(caps.width, WIDTH);
  });

  test("16-colour and 256-colour terminals are told apart", () => {
    assert.equal(capabilities(term({ getColorDepth: () => 4 }), {}).c256, false);
    assert.equal(capabilities(term({ getColorDepth: () => 8 }), {}).c256, true);
    assert.equal(capabilities(term({ getColorDepth: () => 24 }), {}).c256, true);
  });

  // conhost prints the escape rather than consuming it, and the loop is read there as often as in
  // Windows Terminal. There is no query for this — the terminal has to be recognised.
  test("links are offered only where they are known to land", () => {
    assert.equal(capabilities(term(), {}).links, false);
    assert.equal(capabilities(term(), { WT_SESSION: "x" }).links, true);
    assert.equal(capabilities(term({ getColorDepth: () => 1 }), { WT_SESSION: "x" }).links, false);
  });

  test("a narrow window narrows the board; a wide one does not widen it", () => {
    assert.equal(capabilities(term({ columns: 47 }), {}).width, 46);
    assert.equal(capabilities(term({ columns: 400 }), {}).width, WIDTH);
  });

  // A board wider than the window wraps, and a wrapped row puts the next carriage return on the
  // wrong line — which is the whole of the redraw going wrong. So the floor that stops the layout
  // computing a negative span must not itself be a width the terminal does not have.
  test("the board is never wider than the window, at any window", () => {
    for (const columns of [1, 2, 20, 24, 39, 40, 41, 47, 80, 400]) {
      const caps = capabilities(term({ columns }), {});
      assert.ok(caps.width < columns || columns < 2, `${columns} columns gave a board of ${caps.width}`);
    }
  });

  // Every row is budgeted to land at exactly `width`, so there is no such thing as a board that
  // is merely cramped: below the layout's own minimum the caller is told to draw no block at all.
  test("and says so rather than quietly overflowing when the window is smaller than the layout", () => {
    assert.equal(capabilities(term({ columns: 24 }), {}).tight, true);
    assert.equal(capabilities(term({ columns: 80 }), {}).tight, false);
    assert.equal(capabilities(term({ columns: MIN_WIDTH + 1 }), {}).tight, false);
  });
});

describe("theme", () => {
  test("nothing but the text comes out down a pipe", () => {
    assert.equal(tPlain.paint("accent", "hello"), "hello");
    assert.equal(tPlain.link("https://x", "hello"), "hello");
  });

  test("256 and 16 colour are different escapes for the same text", () => {
    assert.match(t256.paint("accent", "x"), /38;5;39/);
    assert.doesNotMatch(t16.paint("accent", "x"), /38;5;/);
    assert.equal(strip(t256.paint("accent", "x")), "x");
    assert.equal(strip(t16.paint("accent", "x")), "x");
  });

  // conhost renders italic as inverse video, which turns a de-emphasised row into the loudest
  // thing on the board — the exact opposite of what it is for.
  test("no italic anywhere", () => {
    for (const role of ["bright", "text", "muted", "faint", "accent", "good", "warn", "bad"]) {
      assert.doesNotMatch(t256.paint(role, "x"), /\[3m/);
    }
  });
});

describe("cols", () => {
  test("counts code points, and emoji as the two cells they take", () => {
    assert.equal(cols("abc"), 3);
    assert.equal(cols("⚙️"), 2);
    assert.equal(cols("日本"), 4);
  });
});

describe("elapsed", () => {
  test("m:ss under an hour, zero-padded seconds", () => {
    assert.equal(elapsed(12_000), "0:12");
    assert.equal(elapsed(104_000), "1:44");
    assert.equal(elapsed(0), "0:00");
  });

  test("h:mm:ss over an hour", () => {
    assert.equal(elapsed(3_600_000), "1:00:00");
    assert.equal(elapsed(5_425_000), "1:30:25");
  });

  test("a negative reading is zero, never a minus sign in the clock slot", () => {
    assert.equal(elapsed(-5_000), "0:00");
  });
});

describe("clockAt", () => {
  const at = 1_789_134_000;

  test("a wait is a time and a distance", () => {
    assert.match(clockAt(at, at * 1000 - 25 * 60_000), /, in 25m$/);
    assert.match(clockAt(at, at * 1000 - 95 * 60_000), /, in 1h35$/);
  });

  test("a window already open is just the time", () => {
    assert.doesNotMatch(clockAt(at, at * 1000), /in /);
  });

  test("milliseconds and seconds both read as the same instant", () => {
    assert.equal(clockAt(at, at * 1000), clockAt(at * 1000, at * 1000));
  });

  test("no reset time says so rather than printing an epoch", () => {
    assert.equal(clockAt(0), "an unknown time");
  });
});

describe("act", () => {
  // The board showed the raw command. `description` is the line the model wrote for a person to
  // read; the command is the one it wrote for a shell.
  test("a shell call prefers the description it was given", () => {
    assert.equal(
      act({ name: "Bash", input: { command: "npm run loop:test -- --x", description: "run the loop suite" } }),
      "run the loop suite",
    );
  });

  test("and falls back to the command's first line when there is none", () => {
    assert.equal(act({ name: "Bash", input: { command: "git status\ngit log" } }), "git status");
  });

  // The worktree prefix is the same forty characters on every row and says nothing.
  test("a file call is its basename", () => {
    assert.equal(act({ name: "Edit", input: { file_path: "C:\\w\\murlan\\lib\\theme.ts" } }), "theme.ts");
    assert.equal(act({ name: "Read", input: { file_path: "tools/loop/land.ts" } }), "land.ts");
  });

  test("a search call is its pattern, an agent call its description", () => {
    assert.equal(act({ name: "Grep", input: { pattern: "a11ySecondsLeft" } }), "a11ySecondsLeft");
    assert.equal(act({ name: "Agent", input: { subagent_type: "reviewer" } }), "reviewer");
  });

  test("an unknown tool yields a string, never undefined in the middle of a row", () => {
    assert.equal(act({ name: "Frobnicate" }), "");
    assert.equal(act({ name: "Frobnicate", input: {} }), "");
  });
});

describe("thought", () => {
  test("the last line, because that is the one that describes what happens next", () => {
    assert.equal(thought("Read the ticket.\nNow the review round."), "Now the review round.");
  });

  test("markdown written for a human is not written for a status row", () => {
    assert.equal(thought("**Spec axis** — round `2`"), "Spec axis — round 2");
    assert.equal(thought("- restoring the file"), "restoring the file");
    assert.equal(thought("#### Phase D"), "Phase D");
  });

  test("nothing to say is null, not an empty row", () => {
    assert.equal(thought(""), null);
    assert.equal(thought("\n\n  \n"), null);
    assert.equal(thought(undefined), null);
  });
});

describe("bar", () => {
  test("never escapes its width, whatever it is handed", () => {
    for (const frac of [-1, 0, 0.5, 1, 2, NaN, Infinity]) {
      assert.equal(cols(strip(bar(frac, 20, t256))), 20, `at ${frac}`);
      assert.equal(cols(bar(frac, 20, tPlain)), 20, `at ${frac}, unpainted`);
    }
  });

  test("full is full and empty is empty", () => {
    assert.equal(bar(1, 8, tPlain), "█".repeat(8));
    assert.equal(bar(0, 8, tPlain), "░".repeat(8));
  });

  // A bar that jumps a whole cell at a time reads as stalled between jumps.
  test("a fraction of a cell shows as a fraction of a cell", () => {
    assert.match(bar(0.5 + 1 / 32, 8, tPlain), /████[▏▎▍▌▋▊▉]/);
  });
});

describe("progress", () => {
  test("names the phase rather than its letter", () => {
    assert.match(strip(progress({ letter: "D" }, t256)), /review/);
    assert.doesNotMatch(strip(progress({ letter: "D" }, t256)), /\bD\b/);
  });

  test("an unnamed phase says so instead of showing a full bar", () => {
    const line = strip(progress({ letter: "?" }, tPlain));
    assert.match(line, /no phase/);
    assert.doesNotMatch(line, /█/);
  });

  // A bar whose right edge moves as the label changes reads as jitter. `lastIndexOf`, because the
  // closing bracket and the eighth-block partial fill are the same character.
  test("the bar is the same width at every phase", () => {
    const widths = [...PHASES.map(([l]) => l), "?"].map((l) =>
      strip(progress({ letter: l }, tPlain)).lastIndexOf("▏"),
    );
    assert.equal(new Set(widths).size, 1, `edges at ${widths.join(", ")}`);
  });
});

describe("phaseRow", () => {
  test("the supervisor's own phase is one the list knows, and reads as a word", () => {
    assert.ok(PHASES.some(([l]) => l === LAND), `${LAND} names no phase, so its row would say the letter`);
    assert.match(strip(phaseRow({ letter: LAND, ms: 0 }, tPlain)), /land/);
  });

  test("a finished phase carries its name, its detail and its clock", () => {
    const line = strip(phaseRow({ letter: "C", detail: "8 files", ms: 92_000 }, tPlain));
    assert.match(line, /✓ {2}build/);
    assert.match(line, /8 files/);
    assert.match(line, /1:32$/);
  });

  test("a state of its own for a phase that did not finish", () => {
    assert.match(strip(phaseRow({ letter: "C", ms: 1, state: "failed" }, tPlain)), /✗/);
    assert.match(strip(phaseRow({ letter: "D", ms: 1, state: "resumed" }, tPlain)), /↻ {2}review/);
  });

  // `trail()` placed the mark by the letter's index, so an unrecognised letter dropped the glyph
  // entirely and the row read as a phase that never closed.
  test("a letter no phase owns still gets a row and a mark", () => {
    const line = strip(phaseRow({ letter: "?", ms: 1_000 }, tPlain));
    assert.match(line, /✓ {2}\?/);
  });
});

describe("activity", () => {
  const live = {
    said: "Restoring and committing.",
    recent: [
      { name: "Bash", what: "run the loop suite" },
      { name: "Edit", what: "useTurnCountdown.ts" },
      { name: "Read", what: "RULES.md" },
      { name: "Grep", what: "yourTurn" },
      { name: "Glob", what: "**/*.ts" },
    ],
    ms: 260_000,
    frame: 3,
  };

  test("the session's own sentence leads, with the calls under it", () => {
    const out = rows(strip(activity(live, tPlain)));
    assert.match(out[0], /Restoring and committing\./);
    assert.match(out[1], /Bash/);
    assert.match(out[0], /4:20$/);
  });

  test("with nothing said it falls back to the newest call, never to a blank row", () => {
    assert.match(rows(strip(activity({ ...live, said: null }, tPlain)))[0], /Bash · run the loop suite/);
    assert.match(rows(strip(activity({ said: null, recent: [], ms: 0, frame: 0 }, tPlain)))[0], /working/);
  });

  test("shows no more calls than it has room for", () => {
    assert.equal(rows(activity(live, tPlain)).length, 1 + RECENT);
  });

  // Brightness is the only thing saying which row is now. If every row is painted the same the
  // fade carries no information and the block reads as five equal things.
  test("exactly one row is bright, and the calls under it actually fade", () => {
    const out = rows(activity(live, t256));
    assert.equal(out.filter((r) => r.includes("38;5;255")).length, 1);
    // The colour of the call's own text, which is the only part the fade applies to — the tool
    // name beside it is painted by position and would hide a fade that had stopped happening.
    const shades = out.slice(1).map((r) => [...r.matchAll(/38;5;(\d+)/g)].at(-1)?.[1]);
    assert.equal(new Set(shades).size, 3, `the fade is flat: ${shades.join(", ")}`);
  });

  test("the spinner turns with the frame, and a negative frame is still a frame", () => {
    const at = (frame: number) => strip(activity({ ...live, frame }, tPlain))[3];
    assert.notEqual(at(0), at(1));
    assert.ok(SPIN.includes(strip(activity({ ...live, frame: -1 }, tPlain))[3]));
  });
});

describe("header", () => {
  const ticket = {
    number: 1004,
    title: "Give the turn countdown an accessible announcement",
    size: "size:M",
    url: "https://github.com/metasito/murlan/issues/1004",
    queue: { implement: 9, triage: 0, wayfinder: 0 },
  };

  test("carries the number, the title and the size", () => {
    const out = strip(header(ticket, tPlain));
    assert.match(out, /#1004/);
    assert.match(out, /Give the turn countdown/);
    assert.match(out, /size:M/);
  });

  // Printing zeroes for a ticket that never went through the picker reads as an empty queue.
  test("a resumed ticket says resumed rather than showing a depth of zero", () => {
    assert.match(strip(header({ ...ticket, queue: null }, tPlain)), /resumed/);
    assert.doesNotMatch(strip(header({ ...ticket, queue: null }, tPlain)), /0 queued/);
  });

  test("the number is the link, so the URL costs no row of its own", () => {
    const linked = theme(capabilities(term(), { WT_SESSION: "x" }));
    assert.match(header(ticket, linked), /\]8;;https:\/\/github\.com/);
    assert.doesNotMatch(strip(header(ticket, linked)), /https:\/\//);
  });

  test("a title far too long for the row is cut, not wrapped", () => {
    const out = rows(strip(header({ ...ticket, title: "x".repeat(400) }, tPlain)));
    assert.equal(out.length, 3);
    for (const r of out) assert.ok(cols(r) <= WIDTH, `${cols(r)} cells`);
  });
});

describe("keybar", () => {
  // A key bar that lies is worse than no key bar. Every letter it offers is pressed here, against
  // the real handler, and has to do something.
  test("offers nothing the ticker does not bind", () => {
    for (const [k, word] of KEYS) {
      const wrote: string[] = [];
      const out = { isTTY: true, columns: WIDTH + 1, rows: 40, getColorDepth: () => 1, write: (s: string) => wrote.push(s) };
      const tick = ticker(out as never, out as never, () => wrote.push("opened"));
      tick.start("C");
      tick.context({ url: "https://x", log: "x.jsonl" });
      const before = wrote.length;
      tick.key(k);
      tick.stop();
      assert.ok(wrote.length > before, `"${word}" is offered on ${k}, which does nothing`);
    }
  });

  test("a toggled key says what pressing it again would do", () => {
    assert.match(strip(keybar({ expanded: true }, tPlain)), /collapse/);
    assert.match(strip(keybar({ expanded: false }, tPlain)), /expand/);
  });

  // The pending stop rides on the key that set it: one place to look for what `s` did.
  test("a pending stop is shown on its own key", () => {
    assert.match(strip(keybar({ stopping: true }, tPlain)), /● stopping after this/);
  });

  test("keys are dropped from the right rather than cut in half", () => {
    const narrow = theme(capabilities(term({ columns: 41 })));
    const line = strip(keybar({ stopping: true }, narrow));
    assert.ok(cols(line) <= narrow.width, `${cols(line)} cells in ${narrow.width}`);
    assert.doesNotMatch(line, /sto$|expan$/);
  });
});

describe("stream", () => {
  const feed = [
    { kind: "call" as const, name: "Bash", what: "check for a live loop run" },
    { kind: "said" as const, text: "Worktree ready. Scoping the change." },
    { kind: "call" as const, name: "Edit", what: "ChipText.tsx" },
  ];

  test("shows the events themselves, said and called alike", () => {
    const out = strip(stream(feed, { ms: 1_000, frame: 0, letter: "D" }, tPlain));
    assert.match(out, /Worktree ready/);
    assert.match(out, /ChipText\.tsx/);
    assert.match(out, /review/);
  });

  test("takes the newest, because the oldest have scrolled past anyway", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ kind: "call" as const, name: "Bash", what: `step ${i}` }));
    const out = strip(stream(many, { ms: 0, frame: 0, letter: "C" }, tPlain, 5));
    assert.match(out, /step 39/);
    assert.doesNotMatch(out, /step 30/);
  });

  test("a take of zero still leaves a readable block", () => {
    assert.ok(rows(stream(feed, { ms: 0, frame: 0, letter: "C" }, tPlain, 0)).length >= 3);
  });
});

describe("tasksDetail", () => {
  test("nothing running is nothing to say", () => {
    assert.equal(tasksDetail([], 0), null);
  });

  test("names the agent that moved most recently, and how long the phase has run", () => {
    const out = tasksDetail([{ what: "Spec axis", tool: null }, { what: "Standards", tool: null }], 8 * 60_000);
    assert.match(out!, /2 agents/);
    assert.match(out!, /Standards/);
    assert.match(out!, /8m/);
  });

  test("one agent is not two", () => {
    assert.match(tasksDetail([{ what: null, tool: "Agent" }], 0)!, /^1 agent · /);
  });
});

describe("queueLine", () => {
  test("a depth that moved shows both readings", () => {
    const out = queueLine({ implement: 9, triage: 1, wayfinder: 0 }, { implement: 7, triage: 1, wayfinder: 0 }, tPlain);
    assert.match(out, /9→7 implement/);
    assert.match(out, /1 triage/);
  });

  test("an empty queue says so", () => {
    assert.match(queueLine({ implement: 1, triage: 0, wayfinder: 0 }, { implement: 0, triage: 0, wayfinder: 0 }, tPlain), /queue empty/);
  });
});

describe("closing", () => {
  const landed = { outcome: "landed", number: 998, files: 9, turns: 132, ms: 1_424_000, cost: 3.9 };

  test("a landed ticket carries its cost and its shape", () => {
    const out = strip(closing(landed, tPlain));
    assert.match(out, /#998/);
    assert.match(out, /9 files · 132 turns · 23:44 · \$3\.90/);
  });

  test("a parked one carries the reason instead, and its log", () => {
    const out = strip(closing({ outcome: "parked", number: 1003, ms: 1, cost: 0, why: "needs device pixels", log: ".loop-logs/park.md" }, tPlain));
    assert.match(out, /parked/);
    assert.match(out, /needs device pixels/);
    assert.match(out, /\.loop-logs\/park\.md/);
  });

  test("an outcome with no glyph of its own still prints a row", () => {
    assert.match(strip(closing({ outcome: "surprised", number: 1, ms: 0, cost: 0, why: "x" }, tPlain)), /#1/);
  });
});

describe("reportRow", () => {
  const run = { number: 1002, title: "Convert the renderHook-able probes", outcome: "landed", pr: 1023, ms: 3_104_000, cost: 16.76 };

  test("one line, with the clock and the money at the edge", () => {
    const line = reportRow(run, tPlain);
    assert.equal(rows(line).length, 1);
    assert.match(line, /51:44 {3}\$16\.76$/);
    assert.match(line, /PR #1023/);
  });

  // This is the file the morning is read from: a park exists to say why it parked.
  test("a reason too long to sit beside the title goes under the row in full", () => {
    const why = "the reviewer held it twice and this one needs device pixels rather than argument";
    const out = rows(reportRow({ ...run, outcome: "parked", pr: null, why }, tPlain));
    assert.ok(out.length > 1);
    // Every word of it, wherever the wrap put them — the point is that none was cut away.
    const said = out.join(" ").split(/\s+/).filter(Boolean);
    for (const word of why.split(" ")) assert.ok(said.includes(word), `"${word}" was dropped`);
  });

  test("nothing escapes the width, at any width", () => {
    for (const columns of [WIDTH + 1, 60, 47]) {
      const t = PLAIN();
      const narrow = theme(capabilities(term({ columns, getColorDepth: () => 1 })));
      for (const line of rows(reportRow(run, narrow))) {
        assert.ok(cols(line) <= narrow.width, `${cols(line)} cells in ${narrow.width}`);
      }
      assert.ok(cols(rows(reportRow(run, t))[0]) <= t.width);
    }
  });
});

describe("wrap", () => {
  test("nothing is allowed past the room, including one long word", () => {
    for (const line of wrap(`${"x".repeat(90)} and some words after it`, 20)) {
      assert.ok(cols(line) <= 20, `${cols(line)} cells: ${line}`);
    }
  });
});

describe("runTotal", () => {
  test("the night in one line", () => {
    assert.equal(
      runTotal({ tickets: 4, landed: 3, parked: 1, ms: 8_120_000, cost: 30.16 }),
      "4 tickets · 3 landed · 1 parked · 2:15:20 · $30.16",
    );
  });
});

describe("bell", () => {
  test("rings at a terminal and nowhere else", () => {
    let rung = 0;
    bell({ isTTY: true, write: () => (rung += 1) } as never);
    bell({ isTTY: false, write: () => (rung += 1) } as never);
    bell(undefined as never);
    assert.equal(rung, 1);
  });

  // A run must never end on a closed pipe.
  test("a stream that throws is not worth an exception", () => {
    assert.doesNotThrow(() =>
      bell({
        isTTY: true,
        write: () => {
          throw new Error("EPIPE");
        },
      } as never),
    );
  });
});

// A row one cell too wide wraps, and a wrapped row puts the next carriage return on the wrong line,
// which takes the whole redraw with it. Four of these were live bugs the day this test was written.
describe("every block fits the width it was given", () => {
  const live = {
    said: "Red for the stated reason. Restoring and committing.",
    recent: [{ name: "Bash", what: "run the loop suite before the review round" }],
    ms: 260_000,
    frame: 3,
  };
  const ticket = {
    number: 1004,
    title: "Give the turn countdown an accessible announcement",
    size: "size:M",
    url: "https://github.com/metasito/murlan/issues/1004",
    queue: { implement: 9, triage: 0, wayfinder: 0 },
  };
  const feed = [{ kind: "call" as const, name: "Agent", what: "Standards review of the diff" }];

  for (const [name, caps] of [
    ["a pipe", capabilities({ isTTY: false } as never, {})],
    ["256 colours", capabilities(term(), {})],
    ["16 colours", capabilities(term({ getColorDepth: () => 4 }), {})],
    ["46 columns", capabilities(term({ columns: 47 }), {})],
    ["links", capabilities(term(), { WT_SESSION: "x" })],
  ] as const) {
    test(name, () => {
      const t = theme(caps);
      const blocks = [
        header(ticket, t),
        phaseRow({ letter: "B", detail: "8 files · blocker #891 merged", ms: 92_000 }, t),
        progress({ letter: "C" }, t),
        activity(live, t),
        stream(feed, { ms: 1, frame: 0, letter: "D" }, t),
        keybar({ expanded: true, stopping: true }, t),
        closing({ outcome: "landed", number: 998, files: 9, turns: 132, ms: 1_424_000, cost: 3.9 }, t),
        reportRow({ number: 1002, title: "Convert the renderHook-able probes", outcome: "landed", pr: 1023, ms: 3_104_000, cost: 16.76 }, t),
      ];
      for (const block of blocks) {
        for (const line of rows(strip(block))) {
          assert.ok(cols(line) <= t.width, `${cols(line)} cells in ${t.width}: ${JSON.stringify(line)}`);
        }
      }
    });
  }

  // `.loop-logs/run-*.md` is read in the morning as text. An escape in it is invisible there and
  // mojibake everywhere else.
  test("and a pipe gets no escapes at all", () => {
    const t = PLAIN();
    const out = [
      header(ticket, t),
      progress({ letter: "C" }, t),
      activity(live, t),
      keybar({}, t),
      reportRow({ number: 1, title: "x", outcome: "landed", pr: 2, ms: 1, cost: 0 }, t),
    ].join("\n");
    assert.equal(out.indexOf(String.fromCharCode(27)), -1, "an escape reached a non-terminal");
  });
});
