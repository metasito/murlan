/**
 * The loop's evidence gate: refuses to push a ticket whose phases did not all happen.
 *
 * `/loop` writes one line per phase into STATE.md's Evidence block. A phase that was skipped —
 * or that a compaction landed in the middle of — leaves its line blank, and a blank line is the
 * only reliable trace of it: the model's own account of what it did is exactly what cannot be
 * trusted here. Phase E calls this before `git push`, so "don't forget the review" is a check
 * rather than a promise.
 *
 * Usage: node scripts/loop-gate.mjs [--state <path>]
 *        exit 0 - every required field carries evidence
 *        exit 1 - names the blank ones; exit 2 - STATE.md is unreadable or not RUNNING
 */
import fs from "node:fs";

/** Required before a push. `gate`, `ci_run` and `pr` are filled by phase E itself, after this. */
const REQUIRED = {
  ticket: "phase A never claimed a ticket",
  branch: "phase A never stood up a branch",
  dod: "phase A never wrote the ticket's Definition of done",
  recon: "phase B never ran",
  verdict: "phase D never ran, or its reviewer gave no VERDICT line",
};

/**
 * A field's value is what follows its colon, plus any indented or bulleted lines under it — `dod`
 * is a checklist and spans several. A trailing `# ...` is the template's own hint, not evidence,
 * so it is stripped: without that, every untouched field reads as filled.
 *
 * @param {string} text
 * @returns {Record<string, string>}
 */
export function readFields(text) {
  const lines = text.split(/\r?\n/);
  /** @type {Record<string, string>} */
  const out = {};
  let current = null;
  for (const line of lines) {
    if (/^\s+\S/.test(line) || /^\s*-\s/.test(line)) {
      if (current) out[current] += ` ${line.trim()}`;
      continue;
    }
    const m = /^([a-z_]+):(.*)$/.exec(line);
    if (!m) {
      current = null;
      continue;
    }
    current = m[1];
    out[current] = m[2].replace(/#.*$/, "").trim();
  }
  return out;
}

/** A HOLD is evidence that phase D ran, and a reason not to push. Both are reported. */
export function check(fields) {
  const blank = Object.entries(REQUIRED)
    .filter(([k]) => !fields[k])
    .map(([k, why]) => `${k}: ${why}`);
  const held = /^VERDICT:\s*HOLD\b/i.test(fields.verdict ?? "");
  return { blank, held, verdict: fields.verdict ?? "" };
}

function main(argv) {
  const at = argv.indexOf("--state");
  const path = at === -1 ? ".claude/loop/STATE.md" : argv[at + 1];

  let text;
  try {
    text = fs.readFileSync(path, "utf8");
  } catch {
    console.error(`loop-gate: cannot read ${path}`);
    return 2;
  }

  const fields = readFields(text);
  if (fields.status !== "RUNNING") {
    console.error(`loop-gate: status is ${fields.status || "(unset)"}, not RUNNING`);
    return 2;
  }

  const { blank, held, verdict } = check(fields);
  if (blank.length) {
    console.error(`loop-gate: BLOCKED on #${fields.ticket || "?"} — redo the phase, not the ticket\n`);
    for (const b of blank) console.error(`  ${b}`);
    return 1;
  }
  if (held) {
    console.error(`loop-gate: BLOCKED on #${fields.ticket} — the reviewer held it\n\n  ${verdict}`);
    return 1;
  }
  console.log(`loop-gate: #${fields.ticket} has evidence for every phase — ${verdict}`);
  return 0;
}

if (process.argv[1]?.endsWith("loop-gate.mjs")) process.exit(main(process.argv.slice(2)));
