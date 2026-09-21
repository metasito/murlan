// tools/loop/tests/ticker.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ticker } from "../queue-loop.mjs";

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
const ERASE = `${ESC}[2K`;
/** The redraw interval, as queue-loop.mjs sets it. */
const REDRAW_MS = 120;
const HIDE = `${ESC}[?25l`;
const SHOW = `${ESC}[?25h`;

const fake = (isTTY = true, columns: number | undefined = 80, rows = 40) => {
  const wrote: string[] = [];
  return {
    isTTY,
    columns,
    rows,
    getColorDepth: () => 8,
    write: (s: string) => {
      wrote.push(s);
      return true;
    },
    wrote,
  };
};
const all = (out: { wrote: string[] }) => out.wrote.join("");
/** Everything a terminal would not show: CSI and OSC sequences, and the carriage returns. */
const visible = (s: string) =>
  s
    .replace(new RegExp(`${ESC}\\]8;;[^${BEL}]*${BEL}`, "g"), "")
    .replace(new RegExp(`${ESC}\\[[0-9;?]*[a-zA-Z]`, "g"), "")
    .replace(/\r/g, "");

/** How many rows a write moves the cursor down: one per separator, none for the trailing `\r`. */
const down = (s: string) => (s.match(/\r\n/g) ?? []).length;
const up = (s: string) =>
  [...s.matchAll(new RegExp(`${ESC}\\[([0-9]+)A`, "g"))].reduce((n, m) => n + Number(m[1]), 0);

describe("ticker", () => {
  test("a phase opens as a block and closes as one finished row", (t) => {
    t.mock.timers.enable({ apis: ["setInterval", "Date"] });
    const out = fake();
    const tick = ticker(out as never);
    tick.start("C");
    assert.match(visible(all(out)), /build/, "the open phase is on screen");
    tick.close();
    assert.match(visible(all(out)), /✓ {2}build/);
  });

  // The flicker, measured. Erasing and then drawing is two writes with an empty row between them,
  // and at eight frames a second that blank is what a person sees.
  test("a frame is one write, never an erase followed by a draw", (t) => {
    t.mock.timers.enable({ apis: ["setInterval", "Date"] });
    const out = fake();
    ticker(out as never).start("C");
    t.mock.timers.tick(1_200);
    for (const w of out.wrote) {
      if (w.includes(ERASE)) assert.ok(w.length > ERASE.length, `erase alone: ${JSON.stringify(w)}`);
    }
  });

  // `[2K` clears the whole row the cursor sits on, so a row written and then erased is a row that
  // was never on screen. The board rendered completely blank on exactly this.
  test("every row is erased before its text, never after", (t) => {
    t.mock.timers.enable({ apis: ["setInterval", "Date"] });
    const out = fake();
    const tick = ticker(out as never);
    tick.start("C");
    tick.said("building");
    for (const chunk of out.wrote) {
      for (const row of chunk.split("\r\n")) {
        const erase = row.indexOf(ERASE);
        if (erase === -1) continue;
        const text = visible(row.slice(0, erase)).trim();
        assert.equal(text, "", `text written before its own erase: ${JSON.stringify(row)}`);
      }
    }
  });

  // Raw mode turns off the translation that would otherwise supply the carriage return, and
  // without it every row starts one indent further right than the last.
  test("rows are joined with a carriage return, so the block does not walk right", (t) => {
    t.mock.timers.enable({ apis: ["setInterval", "Date"] });
    const out = fake();
    const err = fake();
    const tick = ticker(out as never, err as never);
    tick.start("C");
    // Every way a line reaches the terminal while the block is up: the block itself, a permanent
    // line printed above it, a finished phase, and the child's mirrored stderr.
    tick.say("picking");
    tick.said("building");
    tick.warn("a warning");
    tick.close();
    for (const chunk of [...out.wrote, ...err.wrote]) {
      const bare = chunk.split("\r\n").join("");
      assert.ok(!bare.includes("\n"), `a bare newline in ${JSON.stringify(chunk)}`);
    }
  });

  // `[<n>A` counts rows. A frame that ends lower than it began walks down the screen one row a
  // frame until the whole terminal is phase lines.
  test("a frame moves the cursor down only by what the block grew", (t) => {
    t.mock.timers.enable({ apis: ["setInterval", "Date"] });
    const out = fake();
    const tick = ticker(out as never);
    tick.start("C");
    const first = down(out.wrote.at(-1) ?? "");
    out.wrote.length = 0;
    let drift = 0;
    for (let i = 0; i < 20; i += 1) {
      t.mock.timers.tick(140);
      tick.call("Bash", `step ${i}`);
    }
    for (const chunk of out.wrote) drift += down(chunk) - up(chunk);
    const last = down(out.wrote.at(-1) ?? "");
    assert.equal(drift, last - first, "the block walked down the screen a row at a time");
  });

  // A block that scrolls the terminal as it is drawn moves its own origin out from under the
  // next frame, and every frame after it erases the wrong rows.
  // Collapsed as well as expanded. The collapsed block is nine rows whatever the window is, and
  // the version of this test that only pressed `e` first passed against a collapsed branch that
  // ignored `out.rows` entirely.
  test("the block never grows taller than the window", (t) => {
    t.mock.timers.enable({ apis: ["setInterval", "Date"] });
    for (const rows of [6, 9, 12, 40]) {
      for (const expand of [false, true]) {
        const out = fake(true, 80, rows);
        const tick = ticker(out as never);
        tick.start("C");
        if (expand) tick.key("e");
        for (let i = 0; i < 60; i += 1) tick.call("Bash", `step ${i}`);
        tick.said("a sentence the session wrote");
        assert.ok(
          down(out.wrote.at(-1) ?? "") < rows,
          `${expand ? "expanded" : "collapsed"} block filled a ${rows}-row window`,
        );
      }
    }
  });

  // Every row is budgeted to land at exactly the board's width, so a board wider than the window
  // wraps every row it draws and the cursor arithmetic never recovers. Below the width the layout
  // needs, there is no block to draw — only the append-only stream.
  test("a window too narrow to lay a row out in gets no block at all", (t) => {
    t.mock.timers.enable({ apis: ["setInterval", "Date"] });
    const out = fake(true, 24);
    const tick = ticker(out as never);
    tick.start("C");
    tick.said("building");
    t.mock.timers.tick(1_000);
    tick.close();
    assert.ok(!all(out).includes(ERASE), "a 24-column window was drawn into");
    assert.equal(up(all(out)), 0, "the cursor was walked back up a window with no block in it");
    assert.match(visible(all(out)), /✓ {2}build/, "and the permanent record is still printed");
  });

  // Eight identical repaints a second is eight chances to tear, and the block only moves when the
  // spinner turns or a second ticks.
  test("a redraw with nothing to change writes nothing", (t) => {
    t.mock.timers.enable({ apis: ["setInterval", "Date"] });
    const out = fake();
    const tick = ticker(out as never);
    tick.start("C");
    // Said twice, not skipped twice: an empty string returns before `draw()` is even reached, so
    // the comparison this test is named for would never have run.
    tick.said("building");
    const after = out.wrote.length;
    tick.said("building");
    assert.equal(out.wrote.length, after, "an unchanged block must not be repainted");
    t.mock.timers.tick(REDRAW_MS - 1);
    assert.equal(out.wrote.length, after, "a sub-frame tick repainted an identical block");
    t.mock.timers.tick(REDRAW_MS);
    assert.ok(out.wrote.length > after, "the spinner stopped turning");
  });

  // It sits at the end of the spinner, blinking and jumping a column with every frame.
  test("the cursor is hidden while the block is live and restored when it is not", (t) => {
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

  // The trap: a console.log landing between two redraws leaves the tail of the block in front of
  // it. Everything the loop prints goes through say(), which takes the block with it.
  test("a line printed while a phase is open is not written into the block", (t) => {
    t.mock.timers.enable({ apis: ["setInterval", "Date"] });
    const out = fake();
    const tick = ticker(out as never);
    tick.start("C");
    tick.say("something happened");
    const said = out.wrote.find((w) => w.includes("something happened"));
    assert.ok(said?.includes(ERASE), "say() must take the block down in its own write");
    assert.ok(
      said!.indexOf("something happened") > said!.lastIndexOf(ERASE),
      "the message was written above the erase that was meant to clear the block",
    );
  });

  test("the message keeps its own line and the block comes back under it", (t) => {
    t.mock.timers.enable({ apis: ["setInterval", "Date"] });
    const out = fake();
    const tick = ticker(out as never);
    tick.start("C");
    tick.say("hello");
    assert.match(visible(all(out)).split("hello\n")[1] ?? "", /build/);
  });

  // The child's stderr is mirrored while the block turns, and it is the highest-volume writer
  // there is. It goes to stderr, so the erase has to go out on the stream that owns the rows.
  test("a warning erases the block and goes to stderr, not stdout", (t) => {
    t.mock.timers.enable({ apis: ["setInterval", "Date"] });
    const out = fake();
    const err = fake();
    const tick = ticker(out as never, err as never);
    tick.start("C");
    tick.warn("a warning");
    assert.ok(!all(out).includes("a warning"), "a warning must not reach stdout");
    assert.match(visible(all(err)), /a warning\n/);
    assert.ok(all(out).includes(ERASE), "warn() must take the block down before printing");
    assert.match(visible(out.wrote.at(-1) ?? ""), /build/, "and redraw it after");
  });

  // A chunk with no trailing newline would otherwise share its row with the redrawn block, and
  // the next erase takes the whole row.
  test("a warning that does not end in a newline gets one", (t) => {
    t.mock.timers.enable({ apis: ["setInterval", "Date"] });
    const err = fake(false);
    const tick = ticker(fake(false) as never, err as never);
    tick.start("C");
    tick.warn("no newline here");
    assert.equal(all(err), "no newline here\n");
    tick.warn("already has one\n");
    assert.equal(all(err), "no newline here\nalready has one\n");
  });

  // Raw mode turns off the translation that supplies the carriage return, so a warning ending in a
  // bare newline leaves the cursor at the column it ended on — and the block redrawn under it
  // starts there too. The child's stderr is the highest-volume writer the board has.
  test("and at a terminal it gets a carriage return with it", (t) => {
    t.mock.timers.enable({ apis: ["setInterval", "Date"] });
    const err = fake();
    const tick = ticker(fake() as never, err as never);
    tick.start("C");
    tick.warn("no newline here");
    assert.equal(all(err), "no newline here\r\n");
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

  // Two intervals drawing two different phases into one block is the state the old
  // close-then-start ordering could leave behind, and it reads as the spinner flipping phases.
  test("starting a phase closes the one before it, and leaves only its own timer drawing", (t) => {
    t.mock.timers.enable({ apis: ["setInterval", "Date"] });
    const out = fake();
    const tick = ticker(out as never);
    tick.start("C");
    tick.start("D");
    assert.match(visible(all(out)), /✓ {2}build/);
    out.wrote.length = 0;
    t.mock.timers.tick(1_200);
    const drawn = visible(all(out));
    assert.ok(drawn.includes("review"), "the open phase must still be drawing");
    assert.doesNotMatch(drawn, /build {2}[0-9]/, "the closed phase's timer is still running");
  });

  test("close on nothing open writes nothing", () => {
    const out = fake();
    ticker(out as never).close();
    assert.equal(out.wrote.length, 0);
  });

  test("the state is the caller's, so a session that failed does not close on a tick", (t) => {
    t.mock.timers.enable({ apis: ["setInterval", "Date"] });
    const out = fake();
    const tick = ticker(out as never);
    tick.start("C");
    tick.close("failed");
    assert.match(visible(all(out)), /✗ {2}build/);
  });

  // The trap: piped to a file or a CI log, cursor control is line noise. It is also the shape the
  // whole module was built around — right in a terminal, in a pipe, and in a file.
  test("not a terminal means no cursor control at all", (t) => {
    t.mock.timers.enable({ apis: ["setInterval", "Date"] });
    const out = fake(false);
    const tick = ticker(out as never);
    tick.start("C");
    tick.call("Bash", "git push");
    t.mock.timers.tick(5_000);
    tick.say("hello");
    tick.close();
    const text = all(out);
    assert.ok(!text.includes(ESC), "no escape sequences outside a terminal");
    assert.ok(!text.includes("\r"), "no carriage returns outside a terminal");
    assert.match(text, /hello\n/);
    assert.match(text, /✓ {2}build/);
  });

  // The trap: a row wider than the terminal wraps, and a carriage return then lands at the start
  // of the last visual row — the erase misses every row above it and the screen fills with
  // fragments of the block.
  test("no row ever exceeds the terminal's width", (t) => {
    t.mock.timers.enable({ apis: ["setInterval", "Date"] });
    for (const columns of [40, 60, 80, 200]) {
      const out = fake(true, columns);
      const tick = ticker(out as never);
      tick.start("C");
      tick.said("x".repeat(300));
      tick.call("Bash", "y".repeat(300));
      for (const chunk of out.wrote) {
        for (const row of visible(chunk).split("\n")) {
          assert.ok(
            [...row].length < columns,
            `wrote ${[...row].length} columns into a ${columns}-column terminal`,
          );
        }
      }
    }
  });

  // Clipping a whole row takes the timer off the end of it, and the timer is the one thing on the
  // row a person is reading it for.
  test("a narrow terminal loses the detail, never the elapsed time", (t) => {
    t.mock.timers.enable({ apis: ["setInterval", "Date"] });
    const out = fake(true, 44);
    const tick = ticker(out as never);
    tick.start("C");
    tick.said("x".repeat(200));
    t.mock.timers.tick(252_000);
    assert.match(visible(out.wrote.at(-1) ?? ""), /4:12/);
  });

  // A window resized mid-run leaves a board wider than the terminal, and every row of it then
  // wraps — which is the redraw broken for the rest of the night.
  test("a window resized mid-run narrows the board with it", (t) => {
    t.mock.timers.enable({ apis: ["setInterval", "Date"] });
    const out = fake(true, 80);
    const tick = ticker(out as never);
    tick.start("C");
    out.columns = 50;
    t.mock.timers.tick(140);
    for (const row of visible(out.wrote.at(-1) ?? "").split("\n")) {
      assert.ok([...row].length < 50, `${[...row].length} columns after the window went to 50`);
    }
    assert.ok(tick.theme.width < 50, "the painter kept the width the terminal used to have");
  });

  test("a terminal that reports no width is assumed to be wide enough", (t) => {
    t.mock.timers.enable({ apis: ["setInterval", "Date"] });
    const out = fake(true, undefined);
    ticker(out as never).start("C");
    assert.ok(out.wrote.length > 0);
  });

  test("BEL is never part of the block", (t) => {
    t.mock.timers.enable({ apis: ["setInterval", "Date"] });
    const out = fake();
    const tick = ticker(out as never);
    tick.start("C");
    tick.close();
    assert.ok(!all(out).includes(BEL));
  });

  describe("keys", () => {
    test("e swaps the summary for the stream, and back", (t) => {
      t.mock.timers.enable({ apis: ["setInterval", "Date"] });
      const out = fake();
      const tick = ticker(out as never);
      tick.start("C");
      tick.call("Bash", "run the loop suite");
      assert.doesNotMatch(visible(out.wrote.at(-1) ?? ""), /events/);
      tick.key("e");
      assert.match(visible(out.wrote.at(-1) ?? ""), /events/, "e did not expand anything");
      tick.key("e");
      assert.doesNotMatch(visible(out.wrote.at(-1) ?? ""), /events/, "e did not collapse again");
    });

    // The key and the shell have to agree, and a stop asked for here has to survive this process
    // dying before it acts on it — which is exactly what the file is for.
    test("s writes the stop file, and pressing it again takes it back", (t) => {
      t.mock.timers.enable({ apis: ["setInterval", "Date"] });
      const dir = mkdtempSync(join(tmpdir(), "loop-stop-"));
      const cwd = process.cwd();
      process.chdir(dir);
      try {
        const tick = ticker(fake() as never);
        tick.start("C");
        tick.key("s");
        assert.ok(existsSync(".loop-stop"), "s did not ask for a stop");
        tick.key("s");
        assert.ok(!existsSync(".loop-stop"), "s did not take the stop back");
      } finally {
        process.chdir(cwd);
        rmSync(dir, { recursive: true, force: true });
      }
    });

    test("and the bar says a stop is pending", (t) => {
      t.mock.timers.enable({ apis: ["setInterval", "Date"] });
      const out = fake();
      const dir = mkdtempSync(join(tmpdir(), "loop-stop-"));
      const cwd = process.cwd();
      process.chdir(dir);
      try {
        const tick = ticker(out as never);
        tick.start("C");
        tick.key("s");
        assert.match(visible(out.wrote.at(-1) ?? ""), /stopping after this/);
      } finally {
        process.chdir(cwd);
        rmSync(dir, { recursive: true, force: true });
      }
    });

    // A stop written at the shell before the board opened is still a stop.
    test("a stop file already on disk is reported as pending, not offered afresh", (t) => {
      t.mock.timers.enable({ apis: ["setInterval", "Date"] });
      const out = fake();
      const dir = mkdtempSync(join(tmpdir(), "loop-stop-"));
      const cwd = process.cwd();
      process.chdir(dir);
      try {
        writeFileSync(".loop-stop", "by hand\n");
        const tick = ticker(out as never);
        tick.context({});
        tick.start("C");
        assert.match(visible(out.wrote.at(-1) ?? ""), /stopping after this/);
      } finally {
        process.chdir(cwd);
        rmSync(dir, { recursive: true, force: true });
      }
    });

    test("o and l open what the ticket was given, and nothing when it was given nothing", (t) => {
      t.mock.timers.enable({ apis: ["setInterval", "Date"] });
      const opened: string[] = [];
      const tick = ticker(fake() as never, fake() as never, (target: string) => opened.push(target));
      tick.start("C");
      tick.key("o");
      tick.key("l");
      assert.deepEqual(opened, [], "a key opened something before the ticket was named");
      tick.context({ url: "https://x/1004", log: ".loop-logs/1004.jsonl" });
      tick.key("o");
      tick.key("l");
      assert.deepEqual(opened, ["https://x/1004", ".loop-logs/1004.jsonl"]);
    });

    test("k asks first, and only y parks", (t) => {
      t.mock.timers.enable({ apis: ["setInterval", "Date"] });
      const out = fake();
      const dir = mkdtempSync(join(tmpdir(), "loop-park-"));
      const cwd = process.cwd();
      process.chdir(dir);
      try {
        const tick = ticker(out as never);
        tick.context({ number: 1142 });
        tick.start("C");
        tick.key("k");
        assert.match(visible(out.wrote.at(-1) ?? ""), /park this ticket\?/);
        tick.key("e");
        assert.ok(!existsSync(".loop-park"), "a stray key parked the ticket");
        tick.key("k");
        tick.key("y");
        assert.equal(readFileSync(".loop-park", "utf8").trim(), "1142");
        assert.match(visible(out.wrote.at(-1) ?? ""), /parking after this/);
        tick.key("k");
        assert.ok(!existsSync(".loop-park"), "k did not take the park back");
      } finally {
        process.chdir(cwd);
        rmSync(dir, { recursive: true, force: true });
      }
    });

    test("w ends a wait early, and the wait counts down in the title", async (t) => {
      t.mock.timers.enable({ apis: ["setInterval", "Date"] });
      const out = fake();
      const tick = ticker(out as never);
      tick.context({ number: 7 });
      const { woken } = tick.wait("usage resets 14:00", Date.now() + 60 * 60_000);
      assert.match(all(out), new RegExp(`${ESC}\\]0;#7 ▸ waiting · [^${BEL}]*left`));
      let done = false;
      woken.then(() => (done = true));
      tick.key("w");
      await Promise.resolve();
      assert.ok(done, "w did not wake the wait");
      tick.stop();
      assert.ok(all(out).includes(`${ESC}]0;${BEL}`), "the title was not cleared");
    });

    test("a wait says what runs when it ends, and shows the run so far", (t) => {
      t.mock.timers.enable({ apis: ["setInterval", "Date"] });
      const out = fake();
      const tick = ticker(out as never);
      tick.board({ recap: () => ["run so far"] });
      tick.wait("usage resets 14:00", Date.now() + 60_000, "#7 resumes from its worktree");
      const shown = visible(all(out));
      assert.match(shown, /then\s+#7 resumes from its worktree/);
      assert.match(shown, /run so far/);
      tick.stop();
    });

    test("r swaps the board for the run's recap and back, and the step row has what comes next", (t) => {
      t.mock.timers.enable({ apis: ["setInterval", "Date"] });
      const out = fake();
      const tick = ticker(out as never);
      tick.board({ recap: () => ["run so far"], typical: { D: 360_000 } });
      tick.start("C");
      assert.match(visible(all(out)), /next\s+review/);
      assert.ok(!visible(all(out)).includes("run so far"));
      tick.key("r");
      assert.match(visible(out.wrote.at(-1) ?? ""), /run so far/);
      tick.key("r");
      assert.match(visible(out.wrote.at(-1) ?? ""), /next\s+review/);
      tick.stop();
    });

    test("a ticket's pull request stays on p across its next session, and not onto the next ticket", (t) => {
      t.mock.timers.enable({ apis: ["setInterval", "Date"] });
      const opened: string[] = [];
      const tick = ticker(fake() as never, fake() as never, (u: string) => opened.push(u));
      tick.start("C");
      tick.context({ number: 7 });
      tick.set({ pr: "https://x/pull/9" });
      tick.context({ number: 7 });
      tick.key("p");
      tick.context({ number: 8 });
      tick.key("p");
      assert.deepEqual(opened, ["https://x/pull/9"]);
    });

    test("t and c copy what they hand over, and say so", (t) => {
      t.mock.timers.enable({ apis: ["setInterval", "Date"] });
      const out = fake();
      const copied: string[] = [];
      const tick = ticker(out as never, fake() as never, () => {}, (s: string) => copied.push(s));
      tick.start("C");
      tick.key("t");
      tick.key("c");
      assert.deepEqual(copied, [], "a key copied something before the ticket was named");
      tick.context({ number: 7, log: "l.jsonl", branch: "agent/7-x" });
      tick.set({ session: "abc" });
      tick.key("t");
      tick.key("c");
      assert.deepEqual(copied, ["claude --resume abc --fork-session", "agent/7-x\nl.jsonl"]);
      assert.match(visible(all(out)), /copied/);
    });

    // Raw flowing mode delivers whatever arrived in one read, not one keystroke: an autorepeat,
    // two quick presses or a paste arrive as one chunk. Compared whole, none of them matched —
    // including the interrupt, which raw mode has already taken off the OS's hands.
    test("a chunk carrying several keys is several presses", (t) => {
      t.mock.timers.enable({ apis: ["setInterval", "Date"] });
      const out = fake();
      const opened: string[] = [];
      const tick = ticker(out as never, fake() as never, (x: string) => opened.push(x));
      tick.start("C");
      tick.context({ url: "https://x", log: "x.jsonl" });
      tick.key("eo");
      assert.match(visible(out.wrote.at(-1) ?? ""), /events/, "the e in a two-key chunk was lost");
      assert.deepEqual(opened, ["https://x"], "the o in a two-key chunk was lost");
    });

    // `process.kill(process.pid, "SIGINT")` does not raise a signal on win32 — libuv terminates
    // the process outright, so neither the SIGINT handler nor the exit handler runs, the ticket
    // keeps its in-progress label and the session stays attached to the worktree.
    test("^C anywhere in a chunk runs the handlers a real signal would", (t) => {
      t.mock.timers.enable({ apis: ["setInterval", "Date"] });
      let caught = 0;
      const onInt = () => {
        caught += 1;
      };
      process.on("SIGINT", onInt);
      try {
        const tick = ticker(fake() as never);
        tick.start("C");
        tick.key(`x${String.fromCharCode(3)}`);
        assert.equal(caught, 1, "the interrupt did not reach the process's own handlers");
      } finally {
        process.off("SIGINT", onInt);
      }
    });

    // The bar reported what it had been asked for rather than what happened, so a press whose
    // write or removal failed left it promising something the loop would not do. `takeStopFile`
    // is `existsSync`, so the disk is the only thing that decides, and the bar has to say the same.
    test("s reports the disk, not the press", (t) => {
      t.mock.timers.enable({ apis: ["setInterval", "Date"] });
      const out = fake();
      const dir = mkdtempSync(join(tmpdir(), "loop-stop-"));
      const cwd = process.cwd();
      // A directory where the file should be: both the write and the removal fail, and the loop
      // still reads it as a stop.
      mkdirSync(join(dir, ".loop-stop"));
      process.chdir(dir);
      try {
        const tick = ticker(out as never, fake() as never);
        tick.start("C");
        tick.key("s");
        tick.key("s");
        assert.ok(existsSync(".loop-stop"), "the fixture stopped being a stop");
        assert.match(
          visible(out.wrote.at(-1) ?? ""),
          /stopping after this/,
          "the bar took the stop back while the loop will still stop",
        );
      } finally {
        process.chdir(cwd);
        rmSync(dir, { recursive: true, force: true });
      }
    });

    test("a key nothing is bound to changes nothing", (t) => {
      t.mock.timers.enable({ apis: ["setInterval", "Date"] });
      const out = fake();
      const tick = ticker(out as never);
      tick.start("C");
      const after = out.wrote.length;
      tick.key("z");
      assert.equal(out.wrote.length, after);
    });
  });
});
