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
 * Usage: node scripts/loop-gate.mjs
 *        exit 0 - built, clean, and cleared by a review of this exact head
 *        exit 1 - says what is missing; exit 2 - not on a ticket, or cannot judge
 */
import { derive } from "./loop-derive.mjs";

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

  if (s.commits === 0 || s.changed.length === 0) {
    return refuse("nothing was built on this branch", [
      `${s.commits} commit(s), ${s.changed.length} changed file(s) against ${base} in ${s.cwd}`,
      "Phase C commits each slice as it lands.",
    ]);
  }

  // Fail closed. An unreachable tracker is not a review, and neither is a hold or a review of an
  // older commit.
  if (!s.trackerReadable) {
    console.error(`loop-gate: cannot reach the tracker to read the review of #${s.ticket}`);
    return 2;
  }
  if (!s.verdict) {
    return refuse(`no review of ${s.head.slice(0, 7)} on the issue`, [
      "Phase D posts the reviewer's verdict as a comment on the issue, naming the commit it read:",
      `  VERDICT: LAND ${s.head.slice(0, 7)}   (or VERDICT: HOLD ${s.head.slice(0, 7)} — reason)`,
      "A commit made after a review moves the head, so that review no longer covers this diff.",
    ]);
  }
  if (s.verdict.decision !== "LAND") {
    return refuse("the reviewer held this diff", [s.verdict.line]);
  }

  console.log(
    `loop-gate: #${s.ticket} — ${s.commits} commit(s), ${s.changed.length} file(s), ` +
      `reviewed at ${s.head.slice(0, 7)}: ${s.verdict.line}`
  );
  return 0;
}

if (process.argv[1]?.endsWith("loop-gate.mjs")) process.exit(main());
