/**
 * The loop's gate: refuses to push work that was not built, or not reviewed.
 *
 * It asks git and the tracker directly, so there is nothing to keep in sync and nothing that can
 * be stale. Four things must hold, and each is read rather than believed:
 *
 * - you are on an `agent/<n>-...` branch, which is what says the work belongs to ticket n;
 * - the branch has commits and a non-empty diff, so something was actually built;
 * - the issue carries `VERDICT: LAND <sha>` for **this** head, so the review read this code.
 *
 * That last binding is the whole point. The review names the commit it read, so committing again
 * after a review invalidates it automatically — there is no way to land a diff nobody looked at,
 * and no bookkeeping to forget.
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
 */
import { derive } from "./loop-derive.mjs";
import { isInvokedDirectly } from "../../scripts/lib/entry.mjs";

/**
 * Phase D's ceiling, here rather than in `queue.md`'s prose, because that is the difference
 * between a bound a test can fail and a sentence.
 *
 * It is the largest cost lever in the loop: phase D is 78% of a run's clock and every round is two
 * sonnet reviewers, so this one number multiplied out is 126 of the last 144 subagents. A ceiling,
 * never a target — phase D stops earlier when a round raises nothing new.
 */
export const MAX_REVIEW_ROUNDS = 4;

/** @param {{reviewRounds?: number|null}} s */
export function roundVerdict({ reviewRounds }) {
  // Fails closed, the same way the push gate does on an unreadable tracker: a count nobody could
  // read is not a count of zero, and reading it as one buys an unbounded review.
  if (reviewRounds == null) return { ok: false, why: "cannot reach the tracker to count the review rounds" };
  if (reviewRounds >= MAX_REVIEW_ROUNDS) {
    return {
      ok: false,
      why: `${reviewRounds} review round(s) already on the issue — the cap is ${MAX_REVIEW_ROUNDS}`,
    };
  }
  return { ok: true, why: `round ${reviewRounds + 1} of at most ${MAX_REVIEW_ROUNDS}` };
}

/**
 * Whether this head may be pushed. Fails closed on every unknown: an unreachable tracker is not a
 * review, a verdict on an older commit is not this diff's, and a `LAND` with no report behind it is
 * the shape that put two red branches on origin.
 *
 * The unreadable-tracker refusal is the one that carries no `lines`, and `main` reads that as
 * "cannot judge" — exit 2 — rather than as a refusal.
 *
 * @param {ReturnType<import("./loop-derive.mjs").derive>} s
 * @returns {{ok: boolean, why?: string, lines?: string[]}}
 */
export function pushVerdict(s) {
  if (s.commits === 0 || s.changed.length === 0)
    return { ok: false, why: "nothing was built on this branch", lines: [
      `${s.commits} commit(s), ${s.changed.length} changed file(s) against ${s.base} in ${s.cwd}`,
      "Phase C commits each slice as it lands.",
    ] };
  if (!s.trackerReadable) return { ok: false, why: `cannot reach the tracker to read the review of #${s.ticket}` };
  if (!s.verdict) return { ok: false, why: `no review of ${s.head.slice(0, 7)} on the issue`, lines: [
    "Phase D posts the reviewer's verdict as a comment on the issue, naming the commit it read:",
    `  VERDICT: LAND ${s.head.slice(0, 7)}   (or VERDICT: HOLD ${s.head.slice(0, 7)} — reason)`,
    "A commit made after a review moves the head, so that review no longer covers this diff.",
  ] };
  if (s.verdict.decision !== "LAND") return { ok: false, why: "the reviewer held this diff", lines: [s.verdict.line] };
  if (!s.review) return { ok: false, why: `no review report for ${s.head.slice(0, 7)} on the issue`, lines: [
    "A verdict is the session's read of two reports, and those reports are the record. Post them",
    "as their own comment before the verdict, first line the head they read:",
    `  REVIEW ${s.head.slice(0, 7)}`,
    "then `## Standards` and `## Spec`, unmerged. A LAND with nothing behind it is what put two",
    "red branches on origin.",
  ] };
  return { ok: true };
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
      "  Do not park for this. Fix anything that is an actual blocker, then post your own\n" +
      "  VERDICT: LAND <sha> naming what you are accepting, and go to phase E on that head.",
  );
  return 1;
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

  const v = pushVerdict({ ...s, base });
  if (!v.ok) {
    if (!v.lines) {
      console.error(`loop-gate: ${v.why}`);
      return 2;
    }
    return refuse(v.why, v.lines);
  }

  console.log(
    `loop-gate: #${s.ticket} — ${s.commits} commit(s), ${s.changed.length} file(s), ` +
      `${s.reviewRounds ?? "?"} review round(s), reviewed at ${s.head.slice(0, 7)}: ${s.verdict.line}`
  );
  return 0;
}

if (isInvokedDirectly(process.argv[1], import.meta.url)) {
  process.exit(process.argv.includes("--review-round") ? reviewRound() : main());
}
