/**
 * The loop's gate: refuses to push work that was not built, or not reviewed.
 *
 * It asks git and the tracker directly, so nothing can be stale. The review names the commit it
 * read, so committing again after a review invalidates it: there is no way to land a diff nobody
 * looked at.
 *
 * Run it from anywhere in the repo. It finds the run's worktree itself, because the loop works in
 * `.worktrees/agent-<n>` and rule 40 keeps the shell out of it.
 *
 * Usage: node tools/loop/loop-gate.mjs
 *        exit 0 - built, clean, and cleared by a review of this exact head
 *        exit 1 - says what is missing; exit 2 - not on a ticket, or cannot judge
 *
 *        node tools/loop/loop-gate.mjs --review-round
 *        exit 0 - phase D may run another round; exit 1 - the cap is reached
 *
 *        node tools/loop/loop-gate.mjs --build [draft]    exit 0 iff a cached LOCAL PASS for a clean HEAD
 *                                                         and a DOD-CHECK of HEAD with every box ticked —
 *                                                         the draft file's, when one is named, else the tracker's
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { derive, dodCheckFor, locateRun, reviewFor, reviewRounds, ticketComments, verdictFor } from "./loop-derive.mjs";
import { cleanPassFor } from "./agent-check.mjs";
import { parseHeader } from "./brief.mjs";
import { COMMITTING } from "./loop-stream.mjs";
import { isInvokedDirectly } from "../../scripts/lib/entry.mjs";

function git(args, cwd) {
  return execFileSync("git", args, { encoding: "utf8", cwd }).trim();
}

/** A supervisor calls this in-process; the CLI below is the same read from a fresh one. */
export function buildPassed(cwd) {
  let head, dirty, gitDir;
  try {
    head = git(["rev-parse", "HEAD"], cwd);
    dirty = git(["status", "--porcelain"], cwd).length > 0;
    gitDir = git(["rev-parse", "--absolute-git-dir"], cwd);
  } catch {
    return false;
  }
  if (dirty) return false;
  try {
    const cache = JSON.parse(readFileSync(join(gitDir, "agent-check-cache.json"), "utf8"));
    return Boolean(cleanPassFor(cache, head));
  } catch {
    return false;
  }
}

/** A line that exists in `cwd`'s committed tree, so a cited `path:line` is checked, not believed. */
export function lineResolver(cwd) {
  return (path, line) => {
    try {
      return line >= 1 && line <= readFileSync(join(cwd, path), "utf8").split("\n").length;
    } catch {
      return false;
    }
  };
}

/**
 * @param {{body: string}[] | null} comments @param {string} head
 * @param {(path: string, line: number) => boolean} resolves
 * @param {boolean} [built] whether `buildPassed` holds for this head
 */
export function dodVerdict(comments, head, resolves, built = false) {
  const at = head.slice(0, 7);
  if (!comments) return { ok: false, why: "cannot reach the tracker to read the DOD-CHECK" };
  const d = dodCheckFor(comments, head, resolves, built);
  if (!d) return { ok: false, why: `no DOD-CHECK ${at} on the issue` };
  if (d.open.length) return { ok: false, why: `DOD-CHECK ${at} leaves open: ${d.open.join(" | ")}` };
  if (d.ticked === 0) return { ok: false, why: `DOD-CHECK ${at} ticks no box` };
  return { ok: true, why: `DOD-CHECK ${at}: ${d.ticked} box(es) ticked` };
}

/** What a D handoff needs, for the supervisor and `--build` both, so the two cannot disagree. */
export function buildReady(cwd, ticket, comments = ticketComments) {
  if (!buildPassed(cwd)) {
    return { ok: false, why: "no cached LOCAL PASS for HEAD on a clean tree; run `npm run agent:check`" };
  }
  return dodVerdict(comments(ticket, cwd), git(["rev-parse", "HEAD"], cwd), lineResolver(cwd), true);
}

/**
 * Phase D's ceiling, here rather than in `queue.md`'s prose, because that is the difference
 * between a bound a test can fail and a sentence.
 *
 * The full review, then at most two reviews of a fix. A third review that still blocks means each fix
 * is making the next defect, which a reviewer owes the owner, not another round.
 */
export const MAX_REVIEW_ROUNDS = 3;

/** CI fix rounds the reviewer held, which `MAX_REVIEW_ROUNDS` does not count. */
export const MAX_FIX_HOLDS = 2;

/** @param {{reviewRounds?: number|null, fixHolds?: number|null}} s */
export function roundVerdict({ reviewRounds, fixHolds = 0 }) {
  // Fails closed, the same way the push gate does on an unreadable tracker: a count nobody could
  // read is not a count of zero, and reading it as one buys an unbounded review.
  if (reviewRounds == null || fixHolds == null) return { ok: false, why: "cannot reach the tracker to count the review rounds" };
  if (reviewRounds >= MAX_REVIEW_ROUNDS) {
    return {
      ok: false,
      why: `${reviewRounds} review round(s) already on the issue — the cap is ${MAX_REVIEW_ROUNDS}`,
    };
  }
  if (fixHolds >= MAX_FIX_HOLDS) {
    return { ok: false, why: `${fixHolds} CI fix round(s) held — the cap is ${MAX_FIX_HOLDS}` };
  }
  return { ok: true, why: `round ${reviewRounds + 1} of at most ${MAX_REVIEW_ROUNDS}` };
}

const MERGE_WALK = 8;

/**
 * Whether `sha` may be pushed, armed or merged, and why not. A LAND and its report must cover
 * `sha`, or `sha` must be a merge of a commit on `main` into a head they cover whose tree is
 * exactly what a clean merge gives — which is what `gh pr update-branch` makes, and not a merge
 * carrying edits of its own. Fails closed on every unknown. A refusal without `lines` is "cannot
 * judge", which the CLI exits 2 on.
 *
 * @param {{body: string}[] | null} comments null when the tracker could not be read
 * @param {string} sha
 * @param {(args: string[]) => string} git trimmed stdout; throws on a non-zero exit
 * @returns {{ok: boolean, why: string, lines?: string[]}}
 */
export function landable(comments, sha, git, main = "origin/main") {
  const head = String(sha).slice(0, 7);
  try {
    const commits = Number(git(["rev-list", "--count", `${main}..${sha}`]));
    if (commits === 0 || !git(["diff", "--name-only", `${main}...${sha}`])) {
      return { ok: false, why: "nothing was built on this branch", lines: [
        `${commits} commit(s) against ${main} at ${head}`,
        "Phase C commits each slice as it lands.",
      ] };
    }
    if (!comments) return { ok: false, why: `cannot reach the tracker to read the review of ${head}` };
    const rounds = reviewRounds(comments);
    if (rounds > MAX_REVIEW_ROUNDS) return { ok: false, why: `${rounds} reviews, past the cap of ${MAX_REVIEW_ROUNDS}`, lines: [
      "A ticket never lands past the cap: stand down and leave it to the owner.",
    ] };
    let at = sha;
    for (let i = 0; i < MERGE_WALK; i++) {
      const verdict = verdictFor(comments, at);
      if (verdict) return verdictOn(comments, at, verdict);
      const [, mine, theirs, ...more] = git(["rev-list", "--parents", "-n", "1", at]).split(" ");
      if (!theirs || more.length) break;
      git(["merge-base", "--is-ancestor", theirs, main]);
      const clean = git(["merge-tree", "--write-tree", mine, theirs]).split("\n")[0];
      if (clean !== git(["rev-parse", `${at}^{tree}`])) break;
      at = mine;
    }
    return { ok: false, why: `no review of ${head} on the issue`, lines: [
      "Phase D posts the reviewer's verdict as a comment on the issue, naming the commit it read:",
      `  VERDICT: LAND ${head}   (or VERDICT: HOLD ${head} — reason)`,
      "A commit made after a review moves the head, so that review no longer covers this diff.",
    ] };
  } catch (err) {
    return { ok: false, why: `cannot read ${head} against ${main}: ${String(err?.message ?? err).split("\n")[0]}` };
  }
}

function verdictOn(comments, at, verdict) {
  const short = at.slice(0, 7);
  if (verdict.decision !== "LAND") return { ok: false, why: "the reviewer held this diff", lines: [verdict.line] };
  if (!reviewFor(comments, at)) return { ok: false, why: `no review report for ${short} on the issue`, lines: [
    "A verdict is the session's read of the reviewer's report, and that report is the record. Post",
    "it as its own comment before the verdict, first line the head it read:",
    `  REVIEW ${short}`,
    "then `## Blocking`, `## Nits` and `## Pre-existing`. A LAND with nothing behind it is what put",
    "two red branches on origin.",
  ] };
  return { ok: true, why: `reviewed at ${short}: ${verdict.line}` };
}

const REVIEWERS = new Set(["loop-review", "loop-fix"]);
const LAND = /VERDICT:\s*LAND\b/;
const SHELLS = new Set(["Bash", "PowerShell"]);
const mainCall = (f, test) => f?.kind === "assistant" && f.calls.some((c) => !c.parent && test(c));

/**
 * Whether ticket `n`'s reviewer ran to completion inside the process that posted its LAND, after
 * that process's last commit and before the post, read from the ticket's stream facts. Every
 * process appends to that stream, so the bounds are its `init` and its commands, never a phase the
 * model wrote. With no LAND in the stream, the last process is the one judged.
 *
 * @param {ReturnType<import("./loop-stream.mjs").readLine>[]} facts
 * @param {number} n
 */
export function reviewerRan(facts, n) {
  const posted = facts.findLastIndex((f) => mainCall(f, (c) => LAND.test(JSON.stringify(c.input ?? {}))));
  const before = facts.slice(0, posted < 0 ? facts.length : posted);
  const started = before.findLastIndex((f) => f?.kind === "init");
  const built = before.findLastIndex((f) => mainCall(f, (c) => SHELLS.has(c.name) && COMMITTING.test(c.command)));
  const round = before.slice(Math.max(started, built) + 1);
  const mine = new Set(
    round.filter((f) => f?.kind === "task" && REVIEWERS.has(f.agent) && parseHeader(f.brief)?.n === n).map((f) => f.id),
  );
  return round.some((f) => f?.kind === "task" && mine.has(f.id) && f.status === "completed");
}

function reviewRound() {
  const s = derive();
  if (!s.onTicket) {
    console.error(`loop-gate: ${s.why} (${s.branch ?? "no branch"}) — nothing to judge`);
    return 2;
  }
  const round = roundVerdict(s);
  if (round.ok) {
    console.log(`loop-gate: #${s.ticket} — ${round.why}`);
    return 0;
  }
  console.error(
    `loop-gate: #${s.ticket} — ${round.why}\n\n` +
      "  Do not review again and do not land. Say on the issue which Blocking finding is still open,\n" +
      '  then stand down: declare {"ticket":<n>,"phase":"D","handoff":null,"stoodDown":true,"why":"<the finding>"}',
  );
  return 1;
}

function buildGate(draft) {
  const at = locateRun(undefined, process.env.LOOP_WORKTREE);
  if (!at.ticket) {
    console.error(`loop-gate: not on a ticket (${at.branch ?? "no branch"}) — nothing to judge`);
    return 2;
  }
  let comments = ticketComments;
  if (draft) {
    try {
      const body = readFileSync(draft, "utf8");
      comments = () => [{ body }];
    } catch (err) {
      console.error(`loop-gate: cannot read the draft ${draft} — ${err.message}`);
      return 2;
    }
  }
  const v = buildReady(at.cwd, at.ticket, comments);
  (v.ok ? console.log : console.error)(`loop-gate: #${at.ticket} — ${v.why}`);
  return v.ok ? 0 : 1;
}

function main() {
  const s = derive();
  const base = s.base ?? "origin/main";

  if (!s.onTicket) {
    console.error(`loop-gate: ${s.why} (${s.branch ?? "no branch"}) — nothing to judge`);
    return 2;
  }

  const refuse = (headline, lines) => {
    console.error(`loop-gate: BLOCKED on #${s.ticket} — ${headline}\n`);
    for (const l of lines) console.error(`  ${l}`);
    return 1;
  };

  if (s.phase === "?") {
    console.error(`loop-gate: ${s.why}`);
    return 2;
  }

  const v = landable(ticketComments(s.ticket, s.cwd), s.head, (args) => git(args, s.cwd), base);
  if (!v.ok) {
    if (!v.lines) {
      console.error(`loop-gate: #${s.ticket} — ${v.why}`);
      return 2;
    }
    return refuse(v.why, v.lines);
  }

  console.log(
    `loop-gate: #${s.ticket} — ${s.commits} commit(s), ${s.changed.length} file(s), ` +
      `${s.reviewRounds ?? "?"} review round(s), ${v.why}`
  );
  return 0;
}

if (isInvokedDirectly(process.argv[1], import.meta.url)) {
  const args = process.argv.slice(2);
  const draft = args[args.indexOf("--build") + 1];
  const code = args.includes("--review-round") ? reviewRound() : args.includes("--build") ? buildGate(draft) : main();
  process.exit(code);
}
