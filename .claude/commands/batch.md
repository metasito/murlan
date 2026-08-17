---
description: Implement one batch of the Murlan audit remediation
argument-hint: <batch number, or "next", or "status">
---

Implement batch **$1** of the Murlan audit remediation.

- `$1` = `status` → print `audit/2026-08-17/PROGRESS.md` and stop.
- `$1` = `next` or empty → take the first unchecked batch in `PROGRESS.md`. Say which.

## 1. Branch

```bash
git fetch origin --prune
git status --porcelain                              # must be empty
git checkout -B audit/batch-$1-<slug> origin/main   # resuming? checkout, then: git merge --no-edit origin/main
```

`main` moves while batches run, so cut from `origin/main`, never from whatever is checked out.
**If the tree is dirty, stop and say so** — another session may be mid-batch here. Merge, never
rebase: force-pushing is forbidden below, and rebase-after-push needs it.

## 2. Read

1. `audit/2026-08-17/PROGRESS.md` — check § Carried forward for rows **owed by this batch**.
   Those are yours to do and to clear.
2. `audit/2026-08-17/IMPLEMENTATION-PLAN.md` — Global Constraints, then the **Batch $1**
   section. It names the findings, order, files, tests, verification command and rollback, and
   tells you if you must read `CONFLICTS.md`.
3. `audit/2026-08-17/DECISIONS.md` — settled answers. Do not re-open or ask about them.
4. `audit/2026-08-17/BACKLOG.md` — the Batch $1 table. **Amended entries** and **Appendix**
   supersede the source reports.
5. Each finding's entry in `audit/2026-08-17/findings/` — Problem, Repro, Proposed fix,
   Acceptance criteria, Fix risk. Read before writing code for it.

## 3. Implement

`superpowers:subagent-driven-development`. One task per finding, in the plan's order, **one
commit per finding**: `fix(<ID>): <what changed>`. Reverting a single finding out of a merged
batch depends on that.

- **Do not improvise.** Each finding's "Proposed fix" names files and approach. If you think one
  is wrong, stop and say so — do not substitute your own.
- **Satisfy each finding's acceptance criteria with a real test.** Integration criteria need
  Postgres — start one, do not report them unrunnable:
  ```bash
  docker start murlan-pg 2>/dev/null || docker run -d --name murlan-pg \
    -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=murlan_test \
    -p 55432:5432 postgres:16-alpine
  export DATABASE_URL="postgres://postgres:postgres@localhost:55432/murlan_test"
  ```
  `server/schemaDdl.ts` builds the schema on first boot. The run must report `skipped 0` and no
  `DATABASE_URL not set` — that line means the integration suites did not run.
- **Stay in your batch.** Something new that the audit missed goes in your report, not in your
  diff.
- **Nothing reaches `main` except through a merged PR.** Check `git branch --show-current`
  before your first commit.

## 4. Finish

```bash
git fetch origin && git merge --no-edit origin/main   # main moved while you worked
<the batch's verification command>                    # paste the real output, do not summarise
git push -u origin <branch>                           # never force, never --no-verify
gh pr create --base main --title "Batch $1: <theme>"  # body: IDs fixed, verification output
gh pr checks --watch
gh pr merge --merge --delete-branch                   # --merge only: squash breaks per-finding revert
```

Before pushing, commit `PROGRESS.md` **on the branch**: tick the box, fill in branch/date/status,
clear any Carried-forward row you were owed, and **add a row for anything you did not finish**
(what, why now, which batch owes it). A deferral that exists only in chat does not exist. If you
scoped something down deliberately and it is now complete in that form, record it under "closed
as designed" instead.

**Merge only if all four hold** — otherwise stop and say which failed:
every check completed and green (pending is not green) · nothing deferred · every acceptance
criterion actually verified · nothing changed outside the batch's scope.

Then **send one `PushNotification`**, whatever the outcome — I am usually away:
- `Batch $1 merged. <k> findings, CI green. Next: batch <N+1>.`
- `Batch $1 needs you: <the one thing that blocked it>.`

Finally, report in chat: what you verified and how, the merge SHA, anything the audit missed.
Flag loudly any change to a persisted shape or to a rule in `docs/BRIEF.md` §3.1.
