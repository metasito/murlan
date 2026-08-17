---
description: Implement one batch of the Murlan audit remediation
argument-hint: <batch number, or "next", or "status">
---

Implement batch **$1** of the Murlan audit remediation.

If `$1` is `status`, just print `audit/2026-08-17/PROGRESS.md` and stop — do not start work.

If `$1` is `next` or empty, read `audit/2026-08-17/PROGRESS.md` and take the first batch whose
box is unchecked. Say which one you picked before you start.

## Read these first, in this order. Do not skip any.

1. `audit/2026-08-17/PROGRESS.md` — confirm this batch is not already done, and that the
   batches it depends on are.
2. `audit/2026-08-17/IMPLEMENTATION-PLAN.md` — the **Global Constraints** section in full,
   then the **Batch $1** section in full. The batch section names its own findings, order,
   files, tests, verification command and rollback story. It also tells you if you must read
   `CONFLICTS.md` — if it says so, read it, it contains ordering hazards that will cost you a
   session if you meet them cold.
3. `audit/2026-08-17/DECISIONS.md` — the owner's answers. **These are settled. Do not re-open
   them and do not ask about them.**
4. `audit/2026-08-17/BACKLOG.md` — the Batch $1 table. Every row is a finding you must fix.
   Check the **Amended entries** and **Appendix** sections for any of your IDs; where present,
   those supersede the source report.
5. For each finding, its full entry in `audit/2026-08-17/findings/` — the report named in the
   `Src` column, under the same ID. Read **Problem, Repro/proof, Proposed fix, Acceptance
   criteria, Fix risk** before you write any code for it.

## How to execute

Use the `superpowers:subagent-driven-development` skill. One task per finding, in the order
the batch section gives. Work on a branch named as the batch section specifies, or
`audit/batch-$1-<slug>` if it does not.

**One commit per finding**, message `fix(<ID>): <what changed>`. This is not cosmetic — the
rollback story in the plan depends on being able to revert a single finding out of a merged
batch.

## Rules

- **Do not improvise a fix.** Each finding's "Proposed fix" names the files and the approach.
  Follow it. If you believe one is wrong, stop and say so — do not silently substitute your
  own judgement for an audited finding.
- **Every finding's "Acceptance criteria" must be satisfied by a real test before you commit
  it.** If the criteria ask for an integration test, it needs `DATABASE_URL` set against a live
  Postgres; if you cannot run it, say so plainly in your report rather than marking the finding
  done.
- **Run the batch's exact verification command before you finish**, and paste the real output.
  Do not summarise it as "tests pass".
- **The app must stay deployable on Replit at every commit.** Port from `process.env.PORT`,
  database from `process.env.DATABASE_URL`, no build step needing local tooling.
- **Stay in your batch.** Do not fix findings belonging to other batches, even if you are
  looking right at them. If you spot something genuinely new that the audit missed, add it to
  your final report — do not fix it here.
- **Do not ask clarifying questions unless you are genuinely blocked.** Everything you need is
  in the five files above. The two known-open decisions are marked in the plan at their point
  of use (NET-06 in Batch 5, RULE-06 in Batch 10) — if you reach one and it is still
  unanswered, implement everything else in the batch, then stop and ask **one** question about
  that finding alone.

## When you finish

1. Run the batch's verification command and paste its **real output**. Do not summarise it as
   "tests pass".
2. Tick this batch's box in `audit/2026-08-17/PROGRESS.md`, and fill in the branch name, the
   date, and the status. Commit that too.
3. **Push the branch.** `git push -u origin <branch>`. Never force-push, never `--no-verify`.
   If a hook fails, fix the underlying problem rather than skipping it.
4. **Open a pull request** against `main` with `gh pr create`. Title:
   `Batch <N>: <batch theme>`. Body: the finding IDs fixed, the verification output, anything
   deferred and why. If `gh` is unavailable or unauthenticated, say so and give me the compare
   URL to open it myself — do not treat that as a failure of the batch.
5. **Wait for CI, then merge it yourself if it is green.**

   ```bash
   gh pr checks --watch
   gh pr merge --merge --delete-branch
   ```

   **Use `--merge`, never `--squash` and never `--rebase`.** The rollback story in the plan
   depends on the per-finding commits surviving into `main` so a single finding can be reverted
   out of a merged batch. Squashing destroys that and silently breaks the plan.

   **Merge only when all of these hold. If any fails, stop and tell me — do not merge:**
   - Every CI check has completed and every one is green. A pending check is not a green check.
   - You deferred nothing. A batch that skipped a finding is not finished.
   - Every finding's acceptance criteria were actually verified, not assumed.
   - Nothing you changed falls outside the batch's declared scope.

6. Report back: what passed, what you verified and how, and anything you found that the audit
   missed. If you merged, say so and give the merge SHA. If you did not, say exactly which
   condition above stopped you.
7. Tell me what the next batch is.

Some batches must push earlier than this — Batch 1's `TEST-01` can only be verified on a
runner, so it pushes mid-batch to confirm CI goes red. That is expected; the final push, PR and
merge still happen at the end.

**Two things to flag loudly in your report rather than merging quietly past them:**
`ARCH-06` (Batch 13) bumps `GAME_SCHEMA_VERSION`, which disposes every live game on the next
rejoin — merge it, but say so. And any batch that changes a persisted shape or a rule in
`docs/BRIEF.md` §3.1 deserves a line in the report saying which.
