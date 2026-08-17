---
description: Implement one batch of the Murlan audit remediation
argument-hint: <batch number, or "next", or "status">
---

Implement batch **$1** of the Murlan audit remediation.

If `$1` is `status`, just print `audit/2026-08-17/PROGRESS.md` and stop — do not start work.

If `$1` is `next` or empty, read `audit/2026-08-17/PROGRESS.md` and take the first batch whose
box is unchecked. Say which one you picked before you start.

## Read these first, in this order. Do not skip any.

1. `audit/2026-08-17/PROGRESS.md` — confirm this batch is not already done, that the batches it
   depends on are, and **check the § Carried forward table for rows owed by this batch.** Those
   are unfinished items an earlier batch handed to you; they are part of your scope and you
   clear the row when you do them.
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

## Start from an up-to-date main. Do this before anything else.

Batches merge while other batches run, so `main` moves under you. A branch cut from a stale
`main`, or from whatever branch happened to be checked out, silently omits merged work and
produces a PR full of phantom reverts.

**Run this exactly, before your first read and before any code:**

```bash
git fetch origin --prune
git status --porcelain            # must be empty
```

**If the working tree is not clean, stop and tell me.** Do not stash, do not commit someone
else's work-in-progress, do not proceed — another session may be mid-batch in this checkout.

Then, depending on whether your batch's branch already exists:

```bash
# NEW branch — cut it from origin/main, not from wherever HEAD is:
git checkout -B audit/batch-$1-<slug> origin/main

# RESUMING an existing branch — bring main into it:
git checkout audit/batch-$1-<slug>
git merge --no-edit origin/main
```

`checkout -B … origin/main` is the whole point: it pins the new branch to `origin/main`
regardless of what was checked out, so nothing merged can be missed.

**Merge `origin/main` in — never rebase.** The rules below forbid force-pushing, and a rebase
after a push needs one. A merge commit is also safe for a branch another session may be holding.

**Then, immediately before you push and open the PR, do it again:**

```bash
git fetch origin && git merge --no-edit origin/main
```

`main` may well have moved while the batch ran. If that merge conflicts, resolve it, re-run the
batch's verification command, and say so in your report — do not open a PR on an unmerged
conflict.

## How to execute

Use the `superpowers:subagent-driven-development` skill. One task per finding, in the order
the batch section gives, on the branch you created above.

**One commit per finding**, message `fix(<ID>): <what changed>`. This is not cosmetic — the
rollback story in the plan depends on being able to revert a single finding out of a merged
batch.

## Rules

- **Do not improvise a fix.** Each finding's "Proposed fix" names the files and the approach.
  Follow it. If you believe one is wrong, stop and say so — do not silently substitute your
  own judgement for an audited finding.
- **Every finding's "Acceptance criteria" must be satisfied by a real test before you commit
  it.** If the criteria ask for an integration test, it needs `DATABASE_URL` set against a live
  Postgres. **Start one — do not report the integration suites as unrunnable.** A Docker
  container is enough and the tests are the only thing that touches it:

  ```bash
  docker start murlan-pg 2>/dev/null || docker run -d --name murlan-pg \
    -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=murlan_test \
    -p 55432:5432 postgres:16-alpine
  export DATABASE_URL="postgres://postgres:postgres@localhost:55432/murlan_test"
  ```

  `server/schemaDdl.ts` builds the schema on the first boot, so an empty container is ready
  as-is. **Confirm the run reports `skipped 0` and contains no `DATABASE_URL not set` line** —
  that line means the integration suites silently did not run and the batch is unverified.
  Only if Docker itself is unavailable do you report it, and then say so plainly rather than
  marking the finding done.
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
2. Update `audit/2026-08-17/PROGRESS.md` and commit it **on the batch branch, before you open
   the PR**: **tick this batch's box** (`- [ ]` → `- [x]`), fill in the branch, date and status,
   clear any § Carried forward row you were owed, and **write a row into § Carried forward for
   anything you did not finish.**

   Tick the box in the same commit that opens the PR, not afterwards. The box means "this batch
   is finished and merging"; a batch that stops at the merge gate leaves it unticked and says
   why. **Never tick it in a separate commit on `main`** — see the push rule below.

   **A deferral that exists only in your chat report does not exist.** If you leave something
   undone — a step omitted because a tool was flaky, a check you could not run, a fix scoped
   down — it needs a row naming *what*, *why now*, and *which batch owes it*. If no later batch
   is a natural owner, say so in your report and stop rather than inventing one.

   If you scoped something down *deliberately and it is now finished in that form* — an
   exclusion the plan asked for, say — record it under "Not carried forward — closed as
   designed" with the reason, so nobody later reads it as missing work.
3. **Push the branch.** `git push -u origin <branch>`. Never force-push, never `--no-verify`.
   If a hook fails, fix the underlying problem rather than skipping it.

   **Nothing ever reaches `main` except through a merged PR.** No `git push origin main`, no
   commit made while `main` is checked out, not for a one-line docs fix and not for the
   PROGRESS.md tick. Every commit you make belongs on the batch branch. This is not style:
   Batch 2's findings were pushed straight to `main` *and* committed on the branch, which
   produced two copies of the same three fixes, a conflicting PR, and a rollback story where
   reverting one finding now takes two reverts. Check `git branch --show-current` before your
   first commit; if it says `main`, branch first.
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

6. **Send me a push notification with `PushNotification`** — I am usually away while a batch
   runs, and this is how I find out it is done. Send exactly one, at the very end, whatever the
   outcome. Keep it to a sentence or two that is useful on a lock screen:

   - merged cleanly → `Batch <N> merged. <k> findings, CI green. Next: batch <N+1>.`
   - stopped at the gate → `Batch <N> needs you: <the one condition that blocked it>.`
   - failed → `Batch <N> failed: <what broke>.`

   Do not send progress pings mid-batch, and do not skip it because the outcome was boring —
   "merged, nothing to do" is exactly what I want to know without opening the laptop.

7. Report back in chat: what passed, what you verified and how, and anything you found that the
   audit missed. If you merged, say so and give the merge SHA. If you did not, say exactly
   which condition stopped you.
8. Tell me what the next batch is.

Some batches must push earlier than this — Batch 1's `TEST-01` can only be verified on a
runner, so it pushes mid-batch to confirm CI goes red. That is expected; the final push, PR and
merge still happen at the end.

**Two things to flag loudly in your report rather than merging quietly past them:**
`ARCH-06` (Batch 13) bumps `GAME_SCHEMA_VERSION`, which disposes every live game on the next
rejoin — merge it, but say so. And any batch that changes a persisted shape or a rule in
`docs/BRIEF.md` §3.1 deserves a line in the report saying which.
