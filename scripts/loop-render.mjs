/**
 * What the loop prints. Pure: state in, strings out, so every line is a unit test and none of it
 * needs a terminal.
 *
 * Nothing here writes, moves a cursor or reads a terminal — `ticker` in queue-loop.mjs is the only
 * thing in the loop that knows a cursor exists. The same strings have to be right in a terminal, in
 * a pipe, and in a file, and cursor control is right in exactly one of those.
 */
const WIDTH = 78;

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

function fit(left, right, width = WIDTH) {
  const gap = width - left.length - right.length;
  if (gap >= 1) return left + " ".repeat(gap) + right;
  return left.slice(0, Math.max(0, width - right.length - 2)) + "… " + right;
}

/**
 * @param {{number: number, title: string, url: string, queue: {implement: number, triage: number,
 *   wayfinder: number}, size?: string|null}} ticket
 */
export function header({ number, title, size, url, queue }) {
  const depths = `queue: ${queue.implement} · ${queue.triage} · ${queue.wayfinder}`;
  return [
    "",
    rule,
    fit(` ⚙️  #${number} · ${title}`, size ? `${size} ` : ""),
    fit(`    ${url}`, `${depths} `),
    rule,
  ].join("\n");
}

const stepOf = (letter) => {
  const i = PHASES.findIndex(([l]) => l === letter);
  return { n: i < 0 ? "?" : String(i + 1), name: PHASES[i]?.[1] ?? "" };
};

export function phaseLine({ letter, detail = "", ms, mark = "✓", width = WIDTH }) {
  const { n, name } = stepOf(letter);
  return fit(`  ${mark} [${n}/6] ${letter}  ${name.padEnd(9)}${detail}`, `${elapsed(ms)} `, width);
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
  const { n, name } = stepOf(letter);
  const spin = SPIN[((frame % SPIN.length) + SPIN.length) % SPIN.length];
  return fit(`  ${spin} [${n}/6] ${letter}  ${name.padEnd(9)}${detail}`, `${elapsed(ms)} `, width);
}

// `activeLine`'s fixed prefix is 22 columns and its elapsed tail is up to 8, inside a WIDTH of 78.
const DETAIL = 44;

/**
 * What the session is doing, as one short phrase. A middot marks a review subagent's call.
 *
 * @param {{name: string, command?: string, parent?: string|null}} call
 */
export function toolDetail({ name, command = "", parent = null }) {
  const mark = parent ? "· " : "";
  if (name !== "Bash" && name !== "PowerShell") return `${mark}${name}`;
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
  if (!after.implement && !after.triage && !after.wayfinder) return "     queue empty";
  const moved = (k) => (before[k] === after[k] ? String(after[k]) : `${before[k]}→${after[k]}`);
  return `     queue ${moved("implement")} implement · ${moved("triage")} triage · ${moved("wayfinder")} wayfinder`;
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

const MARK = { landed: "✅", merged: "✅", parked: "⚠️", stalled: "⚠️", failed: "❌", rate_limited: "⏸" };

/**
 * @param {{outcome: string, number: number, ms: number, cost: number,
 *   files?: number, turns?: number, log?: string, why?: string}} run
 */
export function closing({ outcome, number, files, turns, ms, cost, log, why }) {
  const mark = MARK[outcome] ?? "•";
  const head =
    outcome === "landed" || outcome === "merged"
      ? `  ${mark} #${number} ${outcome} · ${files} files · ${turns} turns · ${elapsed(ms)} · ${money(cost)}`
      : `  ${mark} #${number} ${outcome.replace("_", " ")} — ${why}`;
  return log ? `${head}\n     log ${log}` : head;
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
