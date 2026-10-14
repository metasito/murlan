import { spawn } from "node:child_process";
import fs, { writeFileSync } from "node:fs";
import {
  activity,
  ahead,
  capabilities,
  elapsed,
  help,
  keybar,
  notice,
  phaseRow,
  progress,
  RECENT,
  stepRow,
  stepTitle,
  stream as streamBlock,
  theme,
  UNNAMED,
} from "./loop-render.mjs";

export const STOP_FILE = ".loop-stop";
export const PARK_FILE = ".loop-park";

/** Whether the owner asked, from the board, to park this ticket once its session has exited. */
export const parkAsked = (number, read = (f) => fs.readFileSync(f, "utf8")) => {
  if (number == null) return false;
  try {
    return Number(read(PARK_FILE).trim()) === number;
  } catch {
    return false;
  }
};

const ERASE = "\r\u001B[2K";
const HIDE = "\u001B[?25l";
const SHOW = "\u001B[?25h";
const REDRAW_MS = 120;
const ESC = String.fromCharCode(27);
// `[0A` is not "up none": ECMA-48 reads a parameter of 0 as 1, so an unguarded zero moves the
// cursor a row it was never asked to move.
const UP = (n) => (n > 0 ? `${ESC}[${n}A` : "");
const CTRL_C = String.fromCharCode(3);
const BEL = String.fromCharCode(7);

/** Rows the block never claims: the header above it, and slack so it cannot scroll itself. */
const CHROME = 8;

/**
 * How much of the stream the `e` key can reach back through. A phase can run for hours and both
 * `call()` and `said()` push on every turn, while `stream()` only ever reads the last screenful —
 * so without a ceiling this grows all night and nothing past the first screen is reachable anyway.
 */
const FEED = 200;

/**
 * The only thing in the loop that knows a cursor or a keyboard exists.
 *
 * The board is a block, not a line, and a block is redrawn by counting rows back up. Three rules
 * hold that together, and each was a bug before it was a rule.
 *
 * **Erase before the text, never after.** `[2K` clears the whole row the cursor sits on, so a row
 * written and then erased is a row that was never on screen.
 *
 * **Rows are joined with `\r\n`.** Without the carriage return each row starts one indent further
 * right than the last and the block walks diagonally off the screen.
 *
 * **The block is never taller than the window.** `[<n>A` counts rows, so a block that scrolls the
 * terminal as it is drawn moves its own origin out from under the next frame.
 *
 * Finished phases are written above the block as ordinary scrollback, so the record is what is
 * still on screen in the morning and the moving part is only ever the bottom few rows.
 *
 * At anything that is not a terminal every escape is suppressed and nothing is redrawn: the output
 * is the append-only stream `loop-render.mjs` produces, which is what `.loop-logs/run-*.md` wants.
 */
export function ticker(out = process.stdout, err = process.stderr, reveal = openExternally, copy = toClipboard) {
  // A window too narrow to lay a row out in is a window the block cannot be drawn in: every row
  // would wrap, and a wrapped row is the cursor arithmetic wrong for the rest of the run. The
  // append-only stream is what such a terminal gets, the same as a pipe — and it can become one
  // mid-run, so this is re-read on resize rather than settled at start-up.
  let live = Boolean(out.isTTY) && !capabilities(out).tight;
  let t = theme(capabilities(out));
  // A window resized mid-run leaves a board wider than the terminal, and every row of it then
  // wraps — which puts the next carriage return on the wrong line and takes the redraw with it for
  // the rest of the night. Rebuilt only when the width actually moves, since the block is
  // reassembled eight times a second and the detection is not free.
  const resized = () => {
    const caps = capabilities(out);
    const drawable = Boolean(out.isTTY) && !caps.tight;
    if (caps.width === t.width && drawable === live) return false;
    t = theme(caps);
    live = drawable;
    return true;
  };
  let open = null;
  let timer = null;
  let headed = null;
  let drawn = [];
  let hidden = false;
  let raw = false;
  const view = { expanded: false, stopping: false, parking: false, recap: false, help: false };
  let board = { typical: {}, recap: null };
  let ctx = { number: null, url: null, log: null, branch: null, session: null, pr: null, since: null };
  let titled = "";
  const setTitle = (text) => {
    if (!out.isTTY || text === titled) return;
    out.write(`${ESC}]0;${text}${BEL}`);
    titled = text;
  };

  const hide = () => {
    if (!live || hidden) return;
    out.write(HIDE);
    hidden = true;
  };
  const show = () => {
    if (!hidden) return;
    out.write(SHOW);
    hidden = false;
  };

  const block = () => {
    const ms = Date.now() - open.startedAt;
    // The frame comes from the clock, not from a count of draws: a redraw prompted by a new tool
    // call inside the same frame window would otherwise turn the spinner, which makes every frame
    // different from the last and defeats the only-write-on-change rule entirely.
    const frame = Math.floor(ms / REDRAW_MS);
    // Both branches, not just the expanded one. The collapsed block is nine rows whatever the
    // window is, and at nine rows or fewer drawing it scrolls the terminal — after which `[<n>A`
    // clamps at the top of the viewport and the block walks down the screen at eight frames a
    // second for the rest of the night.
    const room = Math.max(3, (out.rows ?? 30) - CHROME);
    const left = open.wait ? Math.max(0, open.wait.until - Date.now()) : 0;
    const next = ahead(open.letter, board.typical, t);
    const body = view.help
      ? help(t).join("\n")
      : view.recap && board.recap && !open.wait
        ? board.recap(t).join("\n")
        : open.wait
          ? [
              stepRow({ label: "waiting", detail: `${open.wait.label} · ${elapsed(left)} left`, state: "skipped" }, t),
              ...(open.wait.then ? [stepRow({ label: "then", detail: open.wait.then, state: "skipped" }, t)] : []),
              ...(board.recap ? ["", ...board.recap(t)] : []),
            ].join("\n")
          : view.expanded
            ? streamBlock(open.feed, { ms, frame, letter: open.letter }, t, room)
            : [
                progress({ letter: open.letter, round: open.round, ticketMs: ctx.since == null ? null : Date.now() - ctx.since }, t),
                ...next,
                "",
                activity({ said: open.said, recent: open.recent, ms, frame }, t, room - 4 - next.length),
              ].join("\n");
    // A wait already shows the recap, and `r` there would hide the countdown.
    const recap = open.wait ? null : board.recap;
    const offers = { ticket: ctx.number, waiting: open.wait, pr: ctx.pr, url: ctx.url, log: ctx.log, session: ctx.session, recap };
    // The key bar is cut last: it is the only way to end a wait or close a view.
    return [...body.split("\n").slice(0, Math.max(1, room - 2)), "", keybar({ ...view, recap: view.recap && Boolean(recap), offers }, t)];
  };

  const title = () =>
    ctx.number == null
      ? ""
      : stepTitle({
          number: ctx.number,
          letter: open?.letter,
          round: open?.round,
          waitMs: open?.wait ? Math.max(0, open.wait.until - Date.now()) : null,
          ticketMs: ctx.since == null ? null : Date.now() - ctx.since,
        });

  const draw = () => {
    if (!out.isTTY || !open) return;
    // Before the `live` gate, not after: a window narrowed past the point of drawing has to be
    // able to widen back. A narrower window also means the rows already on screen have wrapped and
    // their count is no longer what the cursor maths assumes — repainting from scratch is the only
    // honest recovery, and it leaves the wrapped rows behind as a one-time smear.
    if (resized()) drawn = [];
    setTitle(title());
    if (!live) return;
    const rows = block();
    if (rows.length === drawn.length && rows.every((r, i) => r === drawn[i])) return;
    hide();
    // Every row of the old block is painted over, including the ones a shorter new block does not
    // reach — otherwise a block that shrinks leaves the tail of the last one under it forever.
    const span = Math.max(rows.length, drawn.length);
    let text = drawn.length ? `${UP(drawn.length - 1)}\r` : "";
    for (let i = 0; i < span; i += 1) {
      text += ERASE + (rows[i] ?? "");
      if (i < span - 1) text += "\r\n";
    }
    if (span > rows.length) text += UP(span - rows.length);
    out.write(`${text}\r`);
    drawn = rows;
  };

  /**
   * Takes the block down, in one write, so `text` lands where the block's first row was. `text` is
   * a line to keep, or "" for the block alone.
   *
   * Every newline in it becomes a carriage return and a newline: raw mode turns off the output
   * translation that would otherwise supply the return, so a line ending in a bare `\n` leaves the
   * cursor at the column it ended on and the block redrawn under it starts there too.
   */
  const over = (text) => {
    const line = text ? `${text}\n` : "";
    // A resize since the last frame means the rows on screen have wrapped and their count is no
    // longer what walking back up assumes. Leaving them is a one-time smear; walking up by a
    // number that is now wrong erases rows belonging to the scrollback above.
    if (live && drawn.length && resized()) drawn = [];
    if (!live || !drawn.length) {
      if (line) out.write(live ? line.replace(/\n/g, "\r\n") : line);
      return;
    }
    let blank = `${UP(drawn.length - 1)}\r`;
    for (let i = 0; i < drawn.length; i += 1) blank += ERASE + (i < drawn.length - 1 ? "\r\n" : "");
    blank += UP(drawn.length - 1);
    drawn = [];
    out.write(`${blank}\r${line.replace(/\n/g, "\r\n")}`);
  };

  const clear = () => {
    if (timer) clearInterval(timer);
    timer = null;
  };

  const remember = (event) => {
    open.feed.push(event);
    if (open.feed.length > FEED) open.feed.splice(0, open.feed.length - FEED);
  };

  /**
   * One chunk from the keyboard, which is not one keystroke: raw flowing mode delivers whatever
   * arrived in one read, so an autorepeat, two quick presses or a paste come through as `"es"` or
   * `"\u0003x"`. Compared whole, none of those matched anything — including the interrupt, which
   * raw mode has already taken off the OS's hands.
   */
  const keys = (chunk) => {
    const text = String(chunk);
    if (text.includes(CTRL_C)) return interrupt();
    let moved = false;
    for (const k of text) moved = press(k) || moved;
    if (moved) draw();
  };

  /**
   * Ctrl+C, by hand, because raw mode cleared the input flag that made the console deliver it.
   *
   * The teardown runs here rather than through a signal: `process.kill(process.pid, "SIGINT")` on
   * win32 does not raise a signal at all — libuv terminates the process outright — so neither the
   * SIGINT handler nor the `exit` handler would run, and the ticket would keep its in-progress
   * label with the session still attached to the worktree. `emit` reaches the same handlers a real
   * signal would, on every platform.
   */
  const interrupt = () => {
    api.stop();
    if (process.listenerCount("SIGINT")) process.emit("SIGINT");
    else process.exit(130);
  };

  /** @returns {boolean} whether the board has anything new to show */
  const press = (k) => {
    // Whatever follows the question answers it, and only `y` is a yes: a stray key parks nothing.
    if (view.parking === "confirm") {
      if (k === "y") askPark(true);
      else view.parking = false;
      return true;
    }
    if (k === "e") view.expanded = !view.expanded;
    else if (k === "s") askStop(!view.stopping);
    else if (k === "k" && ctx.number != null) {
      if (view.parking === "asked") askPark(false);
      else view.parking = "confirm";
    } else if (k === "w" && open?.wait) open.wait.wake();
    else if (k === "p" && ctx.pr) reveal(ctx.pr);
    else if (k === "o" && ctx.url) reveal(ctx.url);
    else if (k === "l" && ctx.log) reveal(ctx.log);
    else if (k === "t" && ctx.session) handOver(`claude --resume ${ctx.session} --fork-session`);
    else if (k === "c" && ctx.log) handOver([ctx.branch, ctx.log].filter(Boolean).join("\n"));
    else if (k === "r" && board.recap && !open?.wait) view.recap = !view.recap;
    else if (k === "?") view.help = !view.help;
    else return false;
    return true;
  };

  /** Copied, and printed too: a clipboard nothing confirmed is a key that seemed to do nothing. */
  const handOver = (text) => {
    copy(text);
    over(stepRow({ label: "copied", detail: text.replace(/\n/g, " · "), state: "done" }, t));
  };

  /**
   * The stop key's shape, for the one other key that changes what the loop does: the file is the
   * request, so it survives this process, and the bar follows the file rather than the press. It
   * names the ticket, so a request left behind cannot park the next one.
   */
  const askPark = (wanted) => {
    try {
      if (wanted) writeFileSync(PARK_FILE, `${ctx.number}\n`);
      else fs.rmSync(PARK_FILE, { force: true });
    } catch (e) {
      api.notice("park", `could not ${wanted ? "write" : "remove"} ${PARK_FILE} — ${e}`);
    }
    view.parking = parkAsked(ctx.number) ? "asked" : false;
  };

  /**
   * The same file a person would write by hand, so the key and the shell agree, and so a stop asked
   * for here survives this process dying before it acts on it. The flag follows the file rather
   * than leading it: a bar reading "stopping after this" over a write that failed is the board
   * promising something the loop will not do.
   */
  const askStop = (wanted) => {
    try {
      if (wanted) writeFileSync(STOP_FILE, "asked for from the board\n");
      else fs.rmSync(STOP_FILE, { force: true });
      view.stopping = wanted;
    } catch (e) {
      api.notice("stop", `could not ${wanted ? "write" : "remove"} ${STOP_FILE} — ${e}`);
      view.stopping = fs.existsSync(STOP_FILE);
    }
  };

  const listen = () => {
    if (raw || !live || !process.stdin.isTTY) return;
    try {
      process.stdin.setRawMode(true);
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", keys);
      // The keyboard must never be the reason the process is still alive.
      process.stdin.unref?.();
      raw = true;
    } catch {
      /* no keyboard is not a reason to stop printing */
    }
  };

  // `api.close()`, not `this.close()`: the object is destructured by its callers and `this` does
  // not survive that.
  const api = {
    // The painter this screen is drawing with, so a caller rendering a permanent line paints it
    // for the same terminal the live block is drawn for — one detection, not one per call site.
    // A getter, because a resize replaces it and a snapshot taken at start-up would outlive it.
    get theme() {
      return t;
    },
    say(line) {
      over(line);
      draw();
    },
    /** The supervisor's own word. Board content, so stdout and the scrollback, not stderr. */
    notice(label, text) {
      over(notice(label, text, t));
      draw();
    },
    warn(text) {
      // The block belongs to stdout and stderr cannot clear it, so the erase goes out on the
      // stream that owns it before the warning prints on the other one.
      over("");
      show();
      const said = text.endsWith("\n") ? text : `${text}\n`;
      err.write(live ? said.replace(/\n/g, "\r\n") : said);
      draw();
    },
    // The same entry point the keyboard uses, so what the key bar offers can be checked against
    // what a press actually does. `process.stdin` is not a terminal under the test runner, and a
    // bar pinned against a handler nothing can call is a bar that pins nothing.
    key: (k) => keys(k),
    /**
     * Whether this ticket still wants a header box, and a record that it has now had one. `main()`
     * re-enters `runTicket` once per handoff, and the screen is the only thing that outlives a
     * phase — the child process is new every time.
     */
    needsHeader(number) {
      if (headed === number) return false;
      headed = number;
      return true;
    },
    /** What the keys act on. Set once per ticket, beside its header. */
    context(next = {}) {
      const { spentMs, ...rest } = next;
      // A ticket's pull request outlives the session that opened it: the next phase is the same ticket.
      const pr = rest.number != null && rest.number === ctx.number ? ctx.pr : null;
      ctx = { number: null, url: null, log: null, branch: null, session: null, pr, since: spentMs == null ? null : Date.now() - spentMs, ...rest };
      view.stopping = fs.existsSync(STOP_FILE);
      view.parking = parkAsked(ctx.number) ? "asked" : false;
    },
    /** What outlives every ticket: the per-step medians, and the run's recap as a render. */
    board(fields) {
      board = { ...board, ...fields };
    },
    /** What a ticket learns after its header: the session it is on, the pull request it opened. */
    set(fields) {
      ctx = { ...ctx, ...fields };
    },
    /**
     * A hold, as one live row counting down rather than a line every quarter hour. `w` ends it
     * early. At a pipe there is no live row, so the returned `say` is the heartbeat instead.
     * @param {string|null} [then]
     */
    wait(label, until, then = null) {
      let wake;
      const woken = new Promise((r) => (wake = r));
      api.start(UNNAMED);
      open.wait = { label, until, wake, then };
      draw();
      return { woken, say: live ? null : (m) => api.notice("waiting", m) };
    },
    start(letter, round = null) {
      // A placeholder, not a phase: the first marker replaces it rather than closing it as one.
      if (open?.letter === UNNAMED) {
        clear();
        open = null;
      } else api.close();
      open = { letter, round, startedAt: Date.now(), said: null, recent: [], feed: [] };
      if (!live) return;
      listen();
      timer = setInterval(draw, REDRAW_MS);
      // A redraw must never be the reason the process is still alive.
      timer.unref?.();
      draw();
    },
    /** One tool call. Newest first, and what falls off the board is kept for the `e` key. */
    call(name, what) {
      if (!open) return;
      open.recent.unshift({ name, what });
      open.recent.length = Math.min(open.recent.length, RECENT);
      remember({ kind: "call", name, what });
      draw();
    },
    /** The session's own account of what it is doing — the only channel that says why. */
    said(text) {
      if (!open || !text) return;
      open.said = text;
      remember({ kind: "said", text });
      draw();
    },
    close(state = "done", detail = "") {
      if (!open) return;
      const ms = Date.now() - open.startedAt;
      const done = open.wait
        ? stepRow({ label: "waited", detail: open.wait.label, ms, state: "skipped" }, t)
        : phaseRow({ letter: open.letter, round: open.round, ms, state, detail }, t);
      clear();
      open = null;
      show();
      over(done);
    },
    stop() {
      clear();
      open = null;
      over("");
      show();
      setTitle("");
      if (!raw) return;
      try {
        process.stdin.setRawMode(false);
        process.stdin.off("data", keys);
      } catch {
        /* the terminal is going away anyway */
      }
      raw = false;
    },
  };
  return api;
}

/**
 * Hands a URL or a path to whatever the desktop opens it with. Never fatal, never awaited.
 *
 * On Windows the opener is `cmd`, and `spawn` only quotes an argument carrying whitespace or a
 * quote — so `&`, `|` and `^` would reach the shell as syntax. Both targets are ours today (a URL
 * from `gh`, a log path this file generated); this is the one place a string that is not entirely
 * ours is handed to a shell, so it is refused rather than escaped.
 */
function openExternally(target) {
  if (/[&|^<>"'`\r\n]/.test(target)) return;
  const [cmd, args] =
    process.platform === "win32"
      ? ["cmd", ["/c", "start", "", target]]
      : process.platform === "darwin"
        ? ["open", [target]]
        : ["xdg-open", [target]];
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
  } catch {
    /* a key that opens nothing is not a reason to stop the run */
  }
}

/** The platform's own clipboard command, fed on stdin. Never fatal, like `openExternally`. */
function toClipboard(text) {
  const [cmd, args] =
    process.platform === "win32" ? ["clip", []] : process.platform === "darwin" ? ["pbcopy", []] : ["xclip", ["-selection", "clipboard"]];
  try {
    const child = spawn(cmd, args, { stdio: ["pipe", "ignore", "ignore"] });
    child.on("error", () => {});
    child.stdin.on("error", () => {});
    child.stdin.end(text);
  } catch {
    /* a key that copies nothing is not a reason to stop the run */
  }
}
