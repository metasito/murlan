// tools/loop/tests/ticker.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ticker } from "../queue-loop.mjs";

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
const ERASE = `\r${ESC}[2K`;
const HIDE = `${ESC}[?25l`;
const SHOW = `${ESC}[?25h`;

/** Phase C, as the trail renders it: two behind, the third either live or finished. */
const LIVE_C = /✓✓.···  C/;
const DONE_C = /✓ *✓✓✓···  C|✓✓✓···  C/;

const fake = (isTTY = true, columns: number | undefined = 80) => {
  const wrote: string[] = [];
  return {
    isTTY,
    columns,
    write: (s: string) => {
      wrote.push(s);
      return true;
    },
    wrote,
  };
};
const all = (out: { wrote: string[] }) => out.wrote.join("");
/** Everything a terminal would not show: CSI sequences and the carriage return before them. */
const visible = (s: string) => s.replace(new RegExp(`${ESC}\\[[0-9;?]*[a-zA-Z]`, "g"), "").replace(/\r/g, "");

describe("ticker", () => {
  test("a phase opens with a line and closes with the finished one", (t) => {
    t.mock.timers.enable({ apis: ["setInterval", "Date"] });
    const out = fake();
    const tick = ticker(out as never);
    tick.start("C");
    assert.match(all(out), LIVE_C);
    tick.close();
    assert.match(all(out), DONE_C);
  });

  // The flicker, measured. Erasing and then drawing is two writes with an empty row between them,
  // and at eight frames a second that blank is what a person sees.
  test("a frame is one write, never an erase followed by a draw", (t) => {
    t.mock.timers.enable({ apis: ["setInterval", "Date"] });
    const out = fake();
    ticker(out as never).start("C");
    t.mock.timers.tick(1_200);
    const bare = out.wrote.filter((w) => w === ERASE);
    assert.deepEqual(bare, [], "an erase on its own leaves the row blank until the next write");
    for (const w of out.wrote) {
      if (w.includes(ERASE)) assert.ok(w.length > ERASE.length, `erase written alone: ${JSON.stringify(w)}`);
    }
  });

  // Eight identical repaints a second is eight chances to tear, and the line only moves when the
  // spinner turns or a second ticks.
  test("a redraw with nothing to change writes nothing", (t) => {
    t.mock.timers.enable({ apis: ["setInterval", "Date"] });
    const out = fake();
    const tick = ticker(out as never);
    tick.start("C");
    const after = out.wrote.length;
    tick.detail("");
    tick.detail("");
    assert.equal(out.wrote.length, after, "an unchanged line must not be repainted");
  });

  // It sits at the end of the spinner, blinking and jumping a column with every frame.
  test("the cursor is hidden while the line is live and restored when it is not", (t) => {
    t.mock.timers.enable({ apis: ["setInterval", "Date"] });
    const out = fake();
    const tick = ticker(out as never);
    tick.start("C");
    assert.ok(all(out).includes(HIDE), "the spinner must not blink a cursor at its own tail");
    tick.close();
    assert.ok(all(out).lastIndexOf(SHOW) > all(out).lastIndexOf(HIDE), "a closed phase gives it back");
  });

  test("stop() restores the cursor, which is what the exit handler is for", (t) => {
    t.mock.timers.enable({ apis: ["setInterval", "Date"] });
    const out = fake();
    const tick = ticker(out as never);
    tick.start("C");
    tick.stop();
    assert.ok(all(out).endsWith(SHOW), "an interrupted run must not leave the cursor hidden");
  });

  // The trap: a console.log landing between two redraws leaves the tail of the spinner line in
  // front of it. Everything the loop prints goes through say(), which takes the row with it.
  test("a line printed while a phase is open is not written into the spinner line", (t) => {
    t.mock.timers.enable({ apis: ["setInterval", "Date"] });
    const out = fake();
    const tick = ticker(out as never);
    tick.start("C");
    tick.say("something happened");
    const said = out.wrote.find((w) => w.includes("something happened"));
    assert.ok(said?.startsWith(ERASE), "say() must take the live row down in its own write");
  });

  test("the message keeps its own line and the spinner comes back under it", (t) => {
    t.mock.timers.enable({ apis: ["setInterval", "Date"] });
    const out = fake();
    const tick = ticker(out as never);
    tick.start("C");
    tick.say("hello");
    assert.match(all(out).split("hello\n")[1] ?? "", LIVE_C);
  });

  // The child's stderr is mirrored while the spinner turns, and it is the highest-volume writer
  // there is. It goes to stderr, so the erase has to go out on the stream that owns the row.
  test("a warning erases the live line and goes to stderr, not stdout", (t) => {
    t.mock.timers.enable({ apis: ["setInterval", "Date"] });
    const out = fake();
    const err = fake();
    const tick = ticker(out as never, err as never);
    tick.start("C");
    tick.warn("a warning");
    assert.ok(!all(out).includes("a warning"), "a warning must not reach stdout");
    assert.match(all(err), /a warning\n/);
    assert.ok(all(out).includes(ERASE), "warn() must take the live row down before printing");
    assert.match(out.wrote.at(-1) ?? "", LIVE_C, "and redraw it after");
  });

  // A chunk with no trailing newline would otherwise share its row with the redrawn spinner, and
  // the next erase takes the whole row.
  test("a warning that does not end in a newline gets one", (t) => {
    t.mock.timers.enable({ apis: ["setInterval", "Date"] });
    const err = fake();
    const tick = ticker(fake() as never, err as never);
    tick.start("C");
    tick.warn("no newline here");
    assert.equal(all(err), "no newline here\n");
    tick.warn("already has one\n");
    assert.equal(all(err), "no newline here\nalready has one\n");
  });

  // The trap: an interval that outlives the run holds the event loop open and the loop never exits.
  test("closing a phase stops the redraw", (t) => {
    t.mock.timers.enable({ apis: ["setInterval", "Date"] });
    const out = fake();
    const tick = ticker(out as never);
    tick.start("C");
    tick.close();
    const after = out.wrote.length;
    t.mock.timers.tick(5_000);
    assert.equal(out.wrote.length, after, "a closed phase must not still be drawing");
  });

  test("stop() stops the redraw from an open phase too", (t) => {
    t.mock.timers.enable({ apis: ["setInterval", "Date"] });
    const out = fake();
    const tick = ticker(out as never);
    tick.start("C");
    tick.stop();
    const after = out.wrote.length;
    t.mock.timers.tick(5_000);
    assert.equal(out.wrote.length, after);
  });

  test("stop() is safe to call twice, which an exit handler after a signal does", (t) => {
    t.mock.timers.enable({ apis: ["setInterval", "Date"] });
    const out = fake();
    const tick = ticker(out as never);
    tick.start("C");
    tick.stop();
    const after = out.wrote.length;
    tick.stop();
    assert.equal(out.wrote.length, after);
  });

  // Two intervals drawing two different phases onto one row is the state the old close-then-start
  // ordering could leave behind, and it reads as the spinner flipping between phases.
  test("starting a phase closes the one before it, and leaves only its own timer drawing", (t) => {
    t.mock.timers.enable({ apis: ["setInterval", "Date"] });
    const out = fake();
    const tick = ticker(out as never);
    tick.start("C");
    tick.start("D");
    assert.match(all(out), DONE_C);
    out.wrote.length = 0;
    t.mock.timers.tick(1_200);
    const drawn = visible(all(out));
    assert.ok(drawn.includes("D review"), "the open phase must still be drawing");
    assert.doesNotMatch(drawn, /✓✓.···  C/, "the closed phase's timer is still running");
  });

  test("close on nothing open writes nothing", () => {
    const out = fake();
    ticker(out as never).close();
    assert.equal(out.wrote.length, 0);
  });

  test("the mark is the caller's, so a session that failed does not close on a tick", (t) => {
    t.mock.timers.enable({ apis: ["setInterval", "Date"] });
    const out = fake();
    const tick = ticker(out as never);
    tick.start("C");
    tick.close("✗");
    assert.match(visible(all(out)), /✓✓✗···  C/);
  });

  // The trap: piped to a file or a CI log, cursor control is line noise. It is also the shape the
  // whole module was built around — right in a terminal, in a pipe, and in a file.
  test("not a terminal means no cursor control at all", (t) => {
    t.mock.timers.enable({ apis: ["setInterval", "Date"] });
    const out = fake(false);
    const tick = ticker(out as never);
    tick.start("C");
    tick.detail("git push");
    t.mock.timers.tick(5_000);
    tick.say("hello");
    tick.close();
    const text = all(out);
    assert.ok(!text.includes(ESC), "no escape sequences outside a terminal");
    assert.ok(!text.includes("\r"), "no carriage returns outside a terminal");
    assert.match(text, /hello\n/);
    assert.match(text, DONE_C);
  });

  // The trap: a line wider than the terminal wraps, and a carriage return then lands at the start
  // of the last visual row — the erase misses every row above it and the screen fills with
  // spinner fragments.
  test("the live line never exceeds the terminal's width", (t) => {
    t.mock.timers.enable({ apis: ["setInterval", "Date"] });
    const out = fake(true, 40);
    const tick = ticker(out as never);
    tick.start("C");
    tick.detail("x".repeat(200));
    for (const chunk of out.wrote) {
      for (const line of visible(chunk).split("\n")) {
        assert.ok(
          [...line].length < 40,
          `wrote ${[...line].length} columns into a 40-column terminal`
        );
      }
    }
  });

  // Clipping the whole line takes the timer off the end of it, and the timer is the one thing on
  // the line a person is reading it for.
  test("a narrow terminal loses the detail, never the elapsed time", (t) => {
    t.mock.timers.enable({ apis: ["setInterval", "Date"] });
    const out = fake(true, 44);
    const tick = ticker(out as never);
    tick.start("C");
    tick.detail("x".repeat(200));
    t.mock.timers.tick(252_000);
    assert.match(out.wrote.at(-1) ?? "", /4:12 $/);
  });

  test("the finished line covers the live one exactly, at any width", (t) => {
    t.mock.timers.enable({ apis: ["setInterval", "Date"] });
    for (const columns of [40, 60, 80, 200]) {
      const out = fake(true, columns);
      const tick = ticker(out as never);
      tick.start("C");
      const width = [...visible(out.wrote.at(-1) ?? "")].length;
      tick.close();
      const done = [...visible(out.wrote.at(-1) ?? "").replace(/\n$/, "")].length;
      assert.equal(done, width, `at ${columns} columns`);
    }
  });

  test("a terminal that reports no width is assumed to be 80", (t) => {
    t.mock.timers.enable({ apis: ["setInterval", "Date"] });
    const out = fake(true, undefined);
    ticker(out as never).start("C");
    assert.ok(out.wrote.length > 0);
  });

  test("BEL is never part of a phase line", (t) => {
    t.mock.timers.enable({ apis: ["setInterval", "Date"] });
    const out = fake();
    const tick = ticker(out as never);
    tick.start("C");
    tick.close();
    assert.ok(!all(out).includes(BEL));
  });
});
