/**
 * Where the loop's run state lives, and the one parser that reads it.
 *
 * Not in the working tree. `STATE.md` is rewritten at every phase transition, so a tracked copy
 * makes the tree dirty from phase B onward — and `preflight.mjs`, which the loop is told to halt
 * on, refuses to start a run on a dirty tree. Tracked state meant the loop could run exactly once.
 * A worktree makes it worse: it is checked out from `origin/main`, so it carries the *committed*
 * state rather than the live one, and the gate reads `IDLE` while a run is underway.
 *
 * `--git-common-dir` is the one directory the main checkout and every worktree already share, and
 * git never tracks its contents. So the state is reachable by the same path from anywhere the loop
 * works, cannot dirty a tree, and cannot be stale in a worktree — three failures with one cause,
 * fixed at the cause.
 *
 * The trade is that the state does not survive a fresh clone. That is correct: a half-finished run
 * belongs to the machine that was running it, and nobody else can resume it.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const TEMPLATE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  ".claude",
  "loop",
  "STATE.template.md"
);

/** The shared `.git`, absolute, from the main checkout or any worktree. */
export function stateDir() {
  const raw = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
    encoding: "utf8",
  }).trim();
  return path.join(raw, "loop");
}

export function statePath() {
  return path.join(stateDir(), "STATE.md");
}

/** Lessons outlive a run but not the machine, so they sit beside the state rather than in git. */
export function lessonsPath() {
  return path.join(stateDir(), "LESSONS.md");
}

/** Creates the state directory and lays down a fresh state from the tracked template. */
export function initState() {
  fs.mkdirSync(stateDir(), { recursive: true });
  const target = statePath();
  if (!fs.existsSync(target)) fs.copyFileSync(TEMPLATE, target);
  const lessons = lessonsPath();
  if (!fs.existsSync(lessons)) fs.writeFileSync(lessons, "# LESSONS\n\n", "utf8");
  return target;
}

export function readState() {
  try {
    return fs.readFileSync(statePath(), "utf8");
  } catch {
    return "";
  }
}

export function readLessons() {
  try {
    return fs.readFileSync(lessonsPath(), "utf8");
  } catch {
    return "";
  }
}

/**
 * A field's value is what follows its colon, plus any indented or bulleted lines under it — `dod`
 * is a checklist and spans several. A trailing `# ...` is the template's own hint, not evidence,
 * so it is stripped: without that, every untouched field reads as filled.
 *
 * This is the only reader of the format. There were two, and they disagreed: `status:  RUNNING`
 * with two spaces passed the gate and left the compaction brief silent, so a run could be judged
 * live by the thing that allows a push and dead by the thing that restores it.
 *
 * @param {string} text
 * @returns {Record<string, string>}
 */
export function readFields(text) {
  /** @type {Record<string, string>} */
  const out = {};
  let current = null;
  for (const line of text.split(/\r?\n/)) {
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

/** One definition of "a run is live", used by the gate and by the compaction brief alike. */
export function isRunning(fields) {
  return fields.status === "RUNNING";
}
