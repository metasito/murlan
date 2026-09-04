/**
 * The loop's evidence gate: refuses to push a ticket whose phases did not all happen.
 *
 * `/queue` writes one line per phase into the state's Evidence block. A phase that was skipped —
 * or that a compaction landed in the middle of — leaves its line blank, and a blank line is the
 * only reliable trace of it. Phase E calls this before `git push`, so "don't forget the review" is
 * a check rather than a promise.
 *
 * Two rules govern what it will believe:
 *
 * - **Only an explicit LAND allows a push.** Anything else — a HOLD, a blank, a verdict written in
 *   some other shape — refuses. It read `/^VERDICT:\s*HOLD/` before, which meant the template's own
 *   `HOLD - reason` hint passed: the gate printed the word HOLD and exited 0.
 * - **The state file is a claim, and git is the evidence.** A state asserting a finished run over
 *   an empty diff exited 0, so the one thing the gate was built not to trust was the only thing it
 *   consulted. Commits and a non-empty diff are now required.
 *
 * Usage: node scripts/loop-gate.mjs [--base <ref>]
 *        exit 0 - every phase has evidence, git agrees, and the reviewer said LAND
 *        exit 1 - names what is missing; exit 2 - no live run to judge
 */
import { execFileSync } from "node:child_process";
import { readState, readFields, isRunning, statePath } from "./loop-state.mjs";

/** Required before a push. `gate`, `ci_run` and `pr` are filled by phase E itself, after this. */
const REQUIRED = {
  ticket: "phase A never claimed a ticket",
  branch: "phase A never stood up a branch",
  dod: "phase A never wrote the ticket's Definition of done",
  recon: "phase B never ran",
  verdict: "phase D never ran, or its reviewer gave no VERDICT line",
};

/**
 * Paths the loop may not change on its own. Each either takes production down or is the thing that
 * would have caught it: `schemaDdl.ts` is the only creator of tables, `.replit` is the production
 * runtime, `.github/workflows/` is CI itself. A diff touching one of these is a decision.
 *
 * `tests/loopProtectedPaths.test.ts` pins this list against the copy in CLAUDE.md, because a list
 * an agent reads and a list a program enforces are two lists the moment nothing compares them.
 */
export const PROTECTED = [
  "shared/schema.ts",
  "shared/events.ts",
  "server/socket.ts",
  "server/schemaDdl.ts",
  "drizzle.config.ts",
  ".replit",
  ".github/workflows/",
];

/**
 * "Anything under `server/` that touches auth or the session table" is the one entry a path cannot
 * decide, so it is decided on the changed lines. Broad on purpose: a false stop costs a park, and
 * the failure it prevents is an impersonation vector.
 */
const SENSITIVE = /\b(session|auth|passport|cookie|credential|token|password|secret)/i;

const git = (args, cwd) => execFileSync("git", args, { encoding: "utf8", cwd });

/** @param {string} base @param {string} [cwd] @returns {string[]} */
export function protectedHits(base = "origin/main", cwd = undefined) {
  let files;
  try {
    files = git(["diff", "--name-only", `${base}...HEAD`], cwd).split(/\r?\n/).filter(Boolean);
  } catch {
    return [];
  }
  const hits = files.filter((f) => PROTECTED.some((p) => f === p || f.startsWith(p)));
  for (const f of files.filter((f) => f.startsWith("server/") && !hits.includes(f))) {
    try {
      const patch = git(["diff", "-U0", `${base}...HEAD`, "--", f], cwd);
      const changed = patch
        .split(/\r?\n/)
        .filter((l) => /^[+-][^+-]/.test(l))
        .join("\n");
      if (SENSITIVE.test(changed)) hits.push(`${f} (touches auth or the session table)`);
    } catch {
      /* an unreadable patch is not evidence of a violation */
    }
  }
  return hits;
}

/**
 * What git says happened, as against what the state file claims. A run with nothing committed has
 * not built anything, whatever its Evidence block says.
 *
 * @param {string} base
 */
export function workEvidence(base = "origin/main") {
  try {
    const commits = Number(git(["rev-list", "--count", `${base}..HEAD`]).trim());
    const changed = git(["diff", "--name-only", `${base}...HEAD`]).split(/\r?\n/).filter(Boolean);
    return { commits, changed: changed.length, readable: true };
  } catch {
    return { commits: 0, changed: 0, readable: false };
  }
}

/**
 * Fail closed. Only `VERDICT: LAND` — the exact line phase D is told to end on — is permission;
 * every other shape is a reviewer whose answer could not be read, which is not a yes.
 */
export function verdictAllows(verdict) {
  return /^VERDICT:\s*LAND\s*$/i.test((verdict ?? "").trim());
}

export function check(fields) {
  const blank = Object.entries(REQUIRED)
    .filter(([k]) => !fields[k])
    .map(([k, why]) => `${k}: ${why}`);
  return { blank, verdict: fields.verdict ?? "" };
}

function main(argv) {
  const baseAt = argv.indexOf("--base");
  const base = baseAt === -1 ? "origin/main" : argv[baseAt + 1];

  const text = readState();
  if (!text) {
    console.error(`loop-gate: no run state at ${statePath()}`);
    return 2;
  }

  const fields = readFields(text);
  if (!isRunning(fields)) {
    console.error(`loop-gate: status is ${fields.status || "(unset)"}, not RUNNING`);
    return 2;
  }

  const n = fields.ticket || "<n>";
  const refuse = (headline, lines) => {
    console.error(`loop-gate: BLOCKED on #${n} — ${headline}\n`);
    for (const l of lines) console.error(`  ${l}`);
    return 1;
  };

  const hits = protectedHits(base);
  if (hits.length) {
    return refuse("this diff changes what the loop may not change on its own", [
      ...hits,
      "",
      "Park it, then say on the issue what the change would be and why it needs you:",
      `  gh issue edit ${n} --remove-label ready-for-agent --remove-label in-progress ` +
        `--add-label ready-for-human`,
    ]);
  }

  const { blank, verdict } = check(fields);
  if (blank.length) return refuse("redo the phase, not the ticket", blank);

  const work = workEvidence(base);
  if (!work.readable) {
    console.error(`loop-gate: cannot read the branch's history against ${base}`);
    return 2;
  }
  if (work.commits === 0 || work.changed === 0) {
    return refuse("the state claims a finished run over a branch with no work on it", [
      `${work.commits} commit(s), ${work.changed} changed file(s) against ${base}`,
      "Phase C commits each slice as it lands. Nothing committed means nothing was built.",
    ]);
  }

  if (!verdictAllows(verdict)) {
    return refuse("the reviewer did not clear this diff", [
      `verdict: ${verdict || "(blank)"}`,
      "Only the exact line `VERDICT: LAND` is permission. Anything else is a hold.",
    ]);
  }

  console.log(
    `loop-gate: #${n} — ${work.commits} commit(s), ${work.changed} file(s), every phase has ` +
      `evidence, reviewer said LAND`
  );
  return 0;
}

if (process.argv[1]?.endsWith("loop-gate.mjs")) process.exit(main(process.argv.slice(2)));
