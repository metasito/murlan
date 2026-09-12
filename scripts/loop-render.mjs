/**
 * What the loop prints. Pure: state in, strings out, so every line is a unit test and none of it
 * needs a terminal.
 *
 * Nothing here writes, moves a cursor or reads a terminal — `ticker` in queue-loop.mjs is the only
 * thing in the loop that knows a cursor exists. The same strings have to be right in a terminal, in
 * a pipe, and in a file, and cursor control is right in exactly one of those.
 *
 * `styleText` is stdlib and decides for itself: escapes at a terminal, nothing down a pipe or into
 * a file. Colour is applied only after a line's width is settled, because an escape is bytes with
 * no width and measuring a painted string pads every line wrong — and only on lines that never
 * reach `.loop-logs/run-*.md`, which `reportRow` and `runTotal` do.
 */
import { styleText } from "node:util";

const WIDTH = 78;

/** @param {import("node:util").ForegroundColors[]|string[]} style */
const paint = (style, text) => (text ? styleText(style, text) : text);

/** @type {[string, string][]} */
export const PHASES = [
  ["A", "claim"],
  ["B", "scope"],
  ["C", "build"],
  ["D", "review"],
  ["E", "push"],
  ["F", "close"],
];

export function elapsed(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  const ss = String(s).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** The stream gives Unix seconds; a wait is only actionable as a time and a distance. */
export function clockAt(resetsAt, now = Date.now()) {
  if (!resetsAt) return "an unknown time";
  const ms = resetsAt > 1e12 ? resetsAt : resetsAt * 1000;
  const when = new Date(ms);
  const time = when.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const mins = Math.round((ms - now) / 60_000);
  if (mins <= 0) return time;
  const gap = mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, "0")}`;
  return `${time}, in ${gap}`;
}

const money = (n) => `$${Number(n ?? 0).toFixed(2)}`;
const rule = "━".repeat(WIDTH);

/**
 * `left` padded out to meet `right` at `width`, with `left` truncated rather than `right` — the
 * right-hand side is the timer or the cost, which is the thing the line is being read for.
 *
 * `style` paints the two halves after the padding is computed, never before.
 *
 * @param {(l: string, r: string) => string} [style]
 */
function fit(left, right, width = WIDTH, style = (l, r) => l + r) {
  const room = width - right.length;
  const shown = left.length < room ? left : left.slice(0, Math.max(0, room - 2)) + "…";
  return style(shown + " ".repeat(Math.max(1, room - shown.length)), right);
}

/**
 * The six phases as a progress trail: passed, here, not reached.
 *
 * `[3/6]` said how far along without saying what was behind it or what is left, which on a run
 * that resumes mid-way is the only question a person watching actually has.
 */
export function trail(letter, here = "▸") {
  const i = PHASES.findIndex(([l]) => l === letter);
  return PHASES.map((_, n) => (n < i ? "✓" : n === i ? here : "·"));
}

const paintTrail = (letter, here, colour) =>
  trail(letter, here)
    .map((g, n) => paint(g === "·" ? ["dim"] : n < PHASES.findIndex(([l]) => l === letter) ? ["green"] : colour, g))
    .join("");

/**
 * A resumed ticket never went through the picker, so it has no queue reading of its own — and
 * printing the zeroes it does not have read as an empty queue on every resumed run.
 *
 * @param {{number: number, title: string, url: string, size?: string|null,
 *   queue: {implement: number, triage: number, wayfinder: number}|null}} ticket
 */
export function header({ number, title, size, url, queue }) {
  const depths = queue
    ? `queue: ${queue.implement} · ${queue.triage} · ${queue.wayfinder}`
    : "resumed";
  return [
    "",
    paint(["dim"], rule),
    fit(` ⚙️  #${number} · ${title}`, size ? `${size} ` : "", WIDTH, (l, r) =>
      l.replace(`#${number}`, paint(["bold", "cyan"], `#${number}`)) + paint(["dim"], r),
    ),
    fit(`    ${url}`, `${depths} `, WIDTH, (l, r) => paint(["dim"], l) + paint(["dim"], r)),
    paint(["dim"], rule),
  ].join("\n");
}

const nameOf = (letter) => PHASES.find(([l]) => l === letter)?.[1] ?? "";

const MARK_STYLE = { "✓": ["green"], "✗": ["red"], "↻": ["yellow"] };

export function phaseLine({ letter, detail = "", ms, mark = "✓", width = WIDTH }) {
  const name = nameOf(letter);
  const glyphs = trail(letter, mark).join("");
  return fit(
    `  ${glyphs}  ${letter} ${name.padEnd(7)}${detail}`,
    `${elapsed(ms)} `,
    width,
    (l, r) =>
      l.replace(glyphs, paintTrail(letter, mark, MARK_STYLE[mark] ?? ["green"])) + paint(["dim"], r),
  );
}

/** Braille, because every frame is one column wide in every terminal font. */
export const SPIN = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/**
 * The open phase, for redrawing in place while it runs. `phaseLine` is the same line once it is
 * done, and the two are the same width so the finished one covers the live one exactly.
 *
 * `width` is what the terminal has room for: the detail is what gets cut, never the timer, which is
 * the one thing on the line that a person is reading it for.
 */
export function activeLine({ letter, detail = "", ms, frame = 0, width = WIDTH }) {
  const name = nameOf(letter);
  const spin = SPIN[((frame % SPIN.length) + SPIN.length) % SPIN.length];
  const glyphs = trail(letter, spin).join("");
  return fit(
    `  ${glyphs}  ${letter} ${name.padEnd(7)}${detail}`,
    `${elapsed(ms)} `,
    width,
    (l, r) => l.replace(glyphs, paintTrail(letter, spin, ["cyan"])) + paint(["dim"], r),
  );
}

// `activeLine`'s fixed prefix is 20 columns and its elapsed tail is up to 8, inside a WIDTH of 78.
const DETAIL = 44;

/**
 * What the session is doing, as one short phrase. A middot marks a review subagent's call.
 *
 * The command is shown whenever there is one, rather than for a named list of shell tools: this
 * machine's primary shell is PowerShell and the list had only `Bash` in it for a while, so the
 * loop's own board went blank for every command on the shell it actually runs.
 *
 * @param {{name: string, command?: string, parent?: string|null}} call
 */
export function toolDetail({ name, command = "", parent = null }) {
  const mark = parent ? "· " : "";
  const first = command.split("\n")[0].trim();
  if (!first) return `${mark}${name}`;
  const room = DETAIL - mark.length;
  return mark + (first.length > room ? `${first.slice(0, room - 1)}…` : first);
}

/**
 * The queue after a ticket, against the queue before it. The header carries the depth already; what
 * it cannot show is the direction, and across an unattended night the direction is the whole story
 * — a frontier that grows every ticket is the loop filing follow-ups faster than it lands them.
 */
export function queueLine(before, after) {
  if (!after.implement && !after.triage && !after.wayfinder) return paint(["dim"], "     queue empty");
  const moved = (k) => (before[k] === after[k] ? String(after[k]) : `${before[k]}→${after[k]}`);
  return paint(
    ["dim"],
    `     queue ${moved("implement")} implement · ${moved("triage")} triage · ${moved("wayfinder")} wayfinder`,
  );
}

/**
 * Rings once, and only at a terminal a person could be sitting at. Wrapped because a run must never
 * end on a closed pipe, and it goes to stderr so a piped stdout stays clean.
 */
export function bell(stream = process.stderr) {
  if (!stream?.isTTY) return;
  try {
    stream.write("");
  } catch {
    /* a bell is never worth an exception */
  }
}

const OUTCOME_STYLE = {
  landed: ["green"],
  merged: ["green"],
  retry: ["cyan"],
  parked: ["yellow"],
  stalled: ["yellow"],
  rate_limited: ["yellow"],
  failed: ["red"],
};

const MARK = {
  landed: "✅",
  merged: "✅",
  parked: "⚠️",
  stalled: "⚠️",
  retry: "🔁",
  failed: "❌",
  rate_limited: "⏸",
};

/**
 * @param {{outcome: string, number: number, ms: number, cost: number,
 *   files?: number, turns?: number, log?: string, why?: string}} run
 */
export function closing({ outcome, number, files, turns, ms, cost, log, why }) {
  const mark = MARK[outcome] ?? "•";
  const style = OUTCOME_STYLE[outcome] ?? ["dim"];
  const head =
    outcome === "landed" || outcome === "merged"
      ? `  ${mark} ${paint(["bold"], `#${number}`)} ${paint(style, outcome)} · ${files} files · ` +
        `${turns} turns · ${elapsed(ms)} · ${money(cost)}`
      : `  ${mark} ${paint(["bold"], `#${number}`)} ${paint(style, outcome.replace("_", " "))} — ${why}`;
  return log ? `${head}\n${paint(["dim"], `     log ${log}`)}` : head;
}

/**
 * The title is what gets shortened when the line will not fit, never the reason: a parked row
 * exists to say why it parked, and a row reading "no review …" has thrown away its only content.
 *
 * @param {{number: number, title: string, outcome: string, ms: number, cost: number,
 *   pr?: number|null, why?: string}} run
 */
export function reportRow({ number, title, outcome, pr, ms, cost, why }) {
  const tail = pr ? `PR #${pr}` : (why ?? "");
  const right = `${elapsed(ms)}  ${money(cost)}`;
  const label = `${MARK[outcome] ?? "•"} #${number} `;
  const middle = `${outcome.padEnd(8)}${tail}`;
  const room = WIDTH - right.length - label.length - middle.length - 2;
  const shown = title.length > room ? `${title.slice(0, Math.max(0, room - 1))}…` : title;
  return fit(`${label}${shown}`.padEnd(WIDTH - right.length - middle.length - 1) + middle, right);
}

export function runTotal({ tickets, landed, parked, ms, cost }) {
  return `${tickets} tickets · ${landed} landed · ${parked} parked · ${elapsed(ms)} · ${money(cost)}`;
}
