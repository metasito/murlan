/**
 * What the loop prints: state in, strings out. Nothing here writes or moves a cursor — `ticker` in
 * queue-loop.mjs is the only thing in the loop that knows a cursor exists.
 *
 * `styleText` emits escapes at a terminal and nothing down a pipe. Two rules follow: paint only
 * after a line's width is settled, since an escape is bytes with no width; and leave `reportRow`
 * and `runTotal` unpainted, because those go into `.loop-logs/run-*.md`.
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
 * `left` padded out to meet `right` at `width`. `left` is what gets truncated: the right-hand side
 * is the timer or the cost, which is what the line is read for. `style` paints after the padding.
 *
 * @param {(l: string, r: string) => string} [style]
 */
function fit(left, right, width = WIDTH, style = (l, r) => l + r) {
  const room = width - right.length;
  const shown = left.length < room ? left : left.slice(0, Math.max(0, room - 2)) + "…";
  return style(shown + " ".repeat(Math.max(1, room - shown.length)), right);
}

/** The six phases as a progress trail: passed, here, not reached. */
export function trail(letter, here = "▸") {
  const i = PHASES.findIndex(([l]) => l === letter);
  return PHASES.map((_, n) => (n < i ? "✓" : n === i ? here : "·"));
}

const MARK_STYLE = { "✓": ["green"], "✗": ["red"], "↻": ["yellow"] };

/**
 * One phase's row: the trail, the letter, its name, the detail, the clock. `here` is the glyph
 * standing on the current phase — a spinner frame while it runs, an outcome mark once it is done —
 * so the finished line covers the live one exactly.
 *
 * The trail is painted in three spans rather than six: the live row is rewritten eight times a
 * second and each escape is paid again every frame.
 */
function phaseRow({ letter, detail = "", ms, here, width = WIDTH }) {
  const at = PHASES.findIndex(([l]) => l === letter);
  const glyphs = trail(letter, here).join("");
  const painted =
    at < 0
      ? paint(["dim"], glyphs)
      : paint(["green"], glyphs.slice(0, at)) +
        paint(MARK_STYLE[here] ?? ["cyan"], glyphs[at]) +
        paint(["dim"], glyphs.slice(at + 1));
  return fit(
    `  ${glyphs}  ${letter} ${(PHASES[at]?.[1] ?? "").padEnd(7)}${detail}`,
    `${elapsed(ms)} `,
    width,
    (l, r) => l.replace(glyphs, painted) + paint(["dim"], r),
  );
}

export const phaseLine = ({ mark = "✓", ...row }) => phaseRow({ ...row, here: mark });

/** Braille, because every frame is one column wide in every terminal font. */
export const SPIN = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export const activeLine = ({ frame = 0, ...row }) =>
  phaseRow({ ...row, here: SPIN[((frame % SPIN.length) + SPIN.length) % SPIN.length] });

const DETAIL = 44;

/**
 * A resumed ticket never went through the picker, so it has no queue depths; printing zeroes for
 * them would read as an empty queue.
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
    fit(`    ${url}`, `${depths} `, WIDTH, (l, r) => paint(["dim"], l + r)),
    paint(["dim"], rule),
  ].join("\n");
}

/**
 * What the session is doing, as one short phrase. A middot marks a review subagent's call.
 *
 * Any tool carrying a command shows it: naming the shell tools instead means the board goes blank
 * on whichever shell is not on the list, and this machine's primary shell is PowerShell.
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
 * The queue after a ticket, against the queue before it. The header carries the depth; the
 * direction is what matters across an unattended night — a frontier that grows every ticket is the
 * loop filing follow-ups faster than it lands them.
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
 * The title is shortened when the line will not fit, never the reason: a parked row exists to say
 * why it parked.
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
