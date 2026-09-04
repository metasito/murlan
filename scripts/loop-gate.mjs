/**
 * The loop's evidence gate: refuses to push a ticket whose phases did not all happen.
 *
 * `/loop` writes one line per phase into STATE.md's Evidence block. A phase that was skipped —
 * or that a compaction landed in the middle of — leaves its line blank, and a blank line is the
 * only reliable trace of it: the model's own account of what it did is exactly what cannot be
 * trusted here. Phase E calls this before `git push`, so "don't forget the review" is a check
 * rather than a promise.
 *
 * Usage: node scripts/loop-gate.mjs [--state <path>] [--base <ref>]
 *        exit 0 - every required field carries evidence
 *        exit 1 - names the blank ones; exit 2 - STATE.md is unreadable or not RUNNING
 */
import fs from "node:fs";
import { execFileSync } from "node:child_process";

/** Required before a push. `gate`, `ci_run` and `pr` are filled by phase E itself, after this. */
const REQUIRED = {
  ticket: "phase A never claimed a ticket",
  branch: "phase A never stood up a branch",
  dod: "phase A never wrote the ticket's Definition of done",
  recon: "phase B never ran",
  verdict: "phase D never ran, or its reviewer gave no VERDICT line",
};

/**
 * Paths the loop may not change on its own. Each one either takes production down or is the
 * thing that would have caught it: `schemaDdl.ts` is the only creator of tables, `.replit` is
 * the production runtime, `.github/workflows/` is CI itself. A diff touching one of these is a
 * decision, and decisions belong to the owner.
 *
 * This used to be a sentence in CLAUDE.md and a shorter, *contradicting* list in the command
 * file, which granted an exemption ("unless a decision is recorded") that the sentence did not.
 * Two rules that cannot both be followed are worse than either alone, so the list lives here,
 * once, where it is executed rather than remembered.
 */
const PROTECTED = [
  "shared/schema.ts",
  "server/socket.ts",
  "shared/events.ts",
  "drizzle.config.ts",
  ".replit",
  ".github/workflows/",
];

/**
 * "Anything under `server/` that touches auth or the session table" is the one entry that a path
 * cannot decide, so it is decided on the changed lines instead. Broad on purpose: a false stop
 * costs a park, and the failure it prevents is an impersonation vector.
 */
const SENSITIVE = /\b(session|auth|passport|cookie|credential|token|password|secret)/i;

/** @param {string} base @returns {string[]} */
export function protectedHits(base = "origin/main") {
  /** @param {string[]} args */
  const git = (args) => execFileSync("git", args, { encoding: "utf8" });
  let files;
  try {
    files = git(["diff", "--name-only", `${base}...HEAD`]).split(/\r?\n/).filter(Boolean);
  } catch {
    return []; // no diff to judge is not a violation; the other checks still run
  }
  const hits = files.filter((f) => PROTECTED.some((p) => f === p || f.startsWith(p)));
  for (const f of files.filter((f) => f.startsWith("server/") && !hits.includes(f))) {
    try {
      const patch = git(["diff", "-U0", `${base}...HEAD`, "--", f]);
      const changed = patch
        .split(/\r?\n/)
        .filter((l) => /^[+-][^+-]/.test(l))
        .join("\n");
      if (SENSITIVE.test(changed)) hits.push(`${f} (touches auth or the session table)`);
    } catch {
      /* unreadable patch is not evidence of a violation */
    }
  }
  return hits;
}

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

  const baseAt = argv.indexOf("--base");
  const protectedFiles = protectedHits(baseAt === -1 ? undefined : argv[baseAt + 1]);
  if (protectedFiles.length) {
    const n = fields.ticket || "<n>";
    console.error(
      `loop-gate: BLOCKED on #${n} — this diff changes what the loop may not change on its own\n`
    );
    for (const f of protectedFiles) console.error(`  ${f}`);
    console.error(
      `\nPark it, then say on the issue what the change would be and why it needs you:\n` +
        `  gh issue edit ${n} --remove-label ready-for-agent --remove-label in-progress ` +
        `--add-label ready-for-human`
    );
    return 1;
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
