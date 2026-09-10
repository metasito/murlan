/**
 * What the loop prints. Pure: state in, strings out, so every line is a unit test and none of it
 * needs a terminal.
 *
 * Append-only by design — one line as each phase closes, never a redraw. The same output has to be
 * right in a terminal, in a pipe, and in a file, and cursor control is right in exactly one of
 * those.
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

const money = (n) => `$${Number(n ?? 0).toFixed(2)}`;
const rule = "━".repeat(WIDTH);

function fit(left, right) {
  const gap = WIDTH - left.length - right.length;
  if (gap >= 1) return left + " ".repeat(gap) + right;
  return left.slice(0, Math.max(0, WIDTH - right.length - 2)) + "… " + right;
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

export function phaseLine({ letter, detail, ms }) {
  const i = PHASES.findIndex(([l]) => l === letter);
  const name = PHASES[i]?.[1] ?? "";
  return fit(`  ✓ [${i + 1}/6] ${letter}  ${name.padEnd(9)}${detail}`, `${elapsed(ms)} `);
}

const MARK = { landed: "✅", merged: "✅", parked: "⚠️", failed: "❌", rate_limited: "⏸" };

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
