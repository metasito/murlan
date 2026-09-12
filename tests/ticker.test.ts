// tests/ticker.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ticker } from "../scripts/queue-loop.mjs";

const ESC = "";
const BEL = "";

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

describe("ticker", () => {
  test("a phase opens with a line and closes with the finished one", (t) => {
    t.mock.timers.enable({ apis: ["setInterval", "Date"] });
    const out = fake();
    const tick = ticker(out as never);
    tick.start("C");
    assert.match(all(out), /\[3\/6\] C/);
    tick.close();
    assert.match(all(out), /✓ \[3\/6\] C/);
  });

  // The trap: a console.log landing between two redraws leaves the tail of the spinner line in
  // front of it. Everything the loop prints goes through say(), which erases first.
  test("a line printed while a phase is open is not written into the spinner line", (t) => {
    t.mock.timers.enable({ apis: ["setInterval", "Date"] });
    const out = fake();
    const tick = ticker(out as never);
    tick.start("C");
    tick.say("something happened");
    const text = all(out);
    const at = text.indexOf("something happened");
    assert.ok(at > 0);
    // The erase has to be the thing immediately before it.
    assert.ok(text.slice(0, at).endsWith(`${ESC}[2K`), "say() must erase the live line first");
  });

  test("the message keeps its own line and the spinner comes back under it", (t) => {
    t.mock.timers.enable({ apis: ["setInterval", "Date"] });
    const out = fake();
    const tick = ticker(out as never);
    tick.start("C");
    tick.say("hello");
    assert.match(all(out).split("hello\n")[1] ?? "", /\[3\/6\] C/);
  });

  // The child's stderr is mirrored while the spinner turns, and it is the highest-volume writer
  // there is. It goes to stderr, so it cannot share say()'s stream.
  test("a warning erases the live line and goes to stderr, not stdout", (t) => {
    t.mock.timers.enable({ apis: ["setInterval", "Date"] });
    const out = fake();
    const err = fake();
    const tick = ticker(out as never, err as never);
    tick.start("C");
    tick.warn("a warning");
    assert.ok(!all(out).includes("a warning"), "a warning must not reach stdout");
    assert.match(all(err), /a warning\n/);
    assert.ok(out.wrote.at(-2)?.endsWith(`${ESC}[2K`), "warn() must erase the live line first");
    assert.match(out.wrote.at(-1) ?? "", /\[3\/6\] C/, "and redraw it after");
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

  test("starting a phase closes the one before it, and leaves one timer running", (t) => {
    t.mock.timers.enable({ apis: ["setInterval", "Date"] });
    const out = fake();
    const tick = ticker(out as never);
    tick.start("C");
    tick.start("D");
    assert.match(all(out), /✓ \[3\/6\] C/);
    out.wrote.length = 0;
    t.mock.timers.tick(1_200);
    const draws = all(out).split("[4/6] D").length - 1;
    assert.ok(draws >= 8 && draws <= 12, `expected one timer's worth of redraws, saw ${draws}`);
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
    assert.match(all(out), /✗ \[3\/6\] C/);
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
    assert.match(text, /✓ \[3\/6\] C/);
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
      for (const line of chunk.split("\n")) {
        const visible = line.split(ESC).join("").replace(/\[2K/g, "").replace(/\r/g, "");
        assert.ok(
          [...visible].length < 40,
          `wrote ${[...visible].length} columns into a 40-column terminal`
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
      const width = (out.wrote.at(-1) ?? "").length;
      tick.close();
      assert.equal((out.wrote.at(-1) ?? "").replace(/\n$/, "").length, width, `at ${columns} columns`);
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
