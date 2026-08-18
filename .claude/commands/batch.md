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

In the plan's order, **one commit per finding**: `fix(<ID>): <what changed>`. Reverting a single
finding out of a merged batch depends on that.

**Use `superpowers:subagent-driven-development` only where blast radius earns its review gate** —
the batches the plan marks `max` effort (3, 13) and those rewriting `server/socket.ts` (4, 5).
Everywhere else implement inline. Eleven Low/S fixes in eleven different files do not need eleven
context rebuilds and eleven review gates.

**One commit per finding is a git rule, not a dispatch rule.** One agent can make three commits.
Every dispatch costs a full context rebuild — the agent re-reads the same files and re-runs the
same suite — so group findings that share a file into **one** brief listing each fix in order
with its commit message, and expect two or three dispatches per batch, not one per row. Split
only where the work genuinely differs (server vs client), and never run two implementers on the
same file at once — that is the real limit on parallelism. **Review once over the whole branch**
before the PR, not after every task; the exception is a finding the plan marks Critical or one
carrying an ordering hazard, which gets reviewed on its own immediately because later findings
build on it. Write the brief properly — defect, fix, settled decisions, acceptance criteria —
and it needs no round trip.

**The review loop is bounded: one review, one fix pass, one full-suite run, push.** Fixing review
findings is ordinary work — touched-file tests while you fix, then the batch's verification
command once, then push. Do not re-review the branch because you changed it; a second review is
warranted only if a fix touched code the first review never saw. A batch whose edits total a few
hundred lines should not spend most of its wall-clock re-proving work that already passed.

- **Comment discipline is a hard rule here, not a preference** — see `CLAUDE.md` § Comments.
  The default is no comment. Do not explain the defect you just fixed: that belongs in the commit
  message and the finding entry. 23% of everything the first seven batches added to this repo was
  a comment; do not add to it.
- **Do not improvise.** Each finding's "Proposed fix" names files and approach. If you think one
  is wrong, stop and say so — do not substitute your own.
- **Check § Treatment per batch in PROGRESS.md first.** It says how many dispatches this batch
  takes, whether it needs subagents, and what to verify locally. It was decided from what the
  finished batches actually cost — follow it rather than re-deriving it.
- **Run the touched tests while you work; run the full suite once, at the end.**
  `node --test tests/thatFile.test.ts` is seconds. `npm test` is two minutes and you do not need
  it after every finding — run the batch's full verification command once, immediately before you
  push. Iterating on the whole suite is the single largest waste in a batch.
- **Acceptance criteria are binding — but they say what must be *true*, not that a new test file
  must exist.** Where the existing suite already proves it, name the test that does and move on.
  Write a new test for every Critical and High finding regardless of what exists.
- Integration criteria need Postgres — start one, do not report them unrunnable. Leave the
  container running between batches; it costs nothing idle and the next batch reuses it. Bound
  to 55433, not 55432: `scripts/dev-stack.mjs` defaults its own disposable E2E database
  (`murlan-dev-pg`) to 55432, and running both at once needs them on different ports.
  ```bash
  docker start murlan-pg 2>/dev/null || docker run -d --name murlan-pg \
    -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=murlan_test \
    -p 55433:5432 postgres:16-alpine
  export DATABASE_URL="postgres://postgres:postgres@localhost:55433/murlan_test"
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

**Do not wait for the previous batch's CI to start the next one** — different branches, no shared
state. Batches 1–5 are serial because they rewrite the same file; after that `PROGRESS.md`
§ Run order splits 6–11 into two independent tracks that can run at the same time.
