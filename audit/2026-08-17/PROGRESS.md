# PROGRESS — audit remediation

Run `/batch next` to start the next unchecked batch. Run `/batch status` to print this file.
Each batch fills in its own row as it goes and ticks its box once its PR is **merged**.

**Sequencing rule:** batches 1–5 touch `server/socket.ts` and must run **in order**. After
that, 6/7 and 8/9/11 are independent of each other and can run in parallel worktrees if you
want speed. Then 10 → 12 → 13 → 14.

| # | Batch | Findings | Effort | Model | Status | Branch | PR |
|---|---|---|---|---|---|---|---|
| - [x] 1 | Restore the safety net | 6 | medium | Sonnet | merged — 2026-08-17 | `audit/batch-1-safety-net` | [#2](https://github.com/metasito/murlan/pull/2) |
| - [ ] 2 | Server operational integrity | 7 | medium | Sonnet | not started | | |
| - [ ] 3 | The match lifecycle | 7 | **max** | **Opus** | not started | | |
| - [ ] 4 | Reconnect and error surfacing | 9 | high | Opus | not started | | |
| - [ ] 5 | Robustness and session safety | 6 | high | Opus | not started | | |
| - [ ] 6 | Bytes on the wire | 6 | medium | Sonnet | not started | | |
| - [ ] 7 | Render hot path | 4 | high | Opus | not started | | |
| - [ ] 8 | Game feel | 11 | medium | Sonnet | not started | | |
| - [ ] 9 | Accessibility | 13 | high | Opus | not started | | |
| - [ ] 10 | Rules correctness | 10 | high | Opus | not started | | |
| - [ ] 11 | Layout and overflow | 11 | low | Sonnet | not started | | |
| - [ ] 12 | Test coverage where it matters | 13 | high | Opus | not started | | |
| - [ ] 13 | Architecture seams | 9 | **max** | **Opus** | not started | | |
| - [ ] 14 | Docs truth and housekeeping | 11 | low | Sonnet | not started | | |

A batch is done when it is **committed, pushed, opened as a PR, and merged once CI is green** —
one commit per finding, one branch per batch, one PR per branch. Merge with `--merge`, never
`--squash`: the rollback story depends on the per-finding commits reaching `main`.

Status values: `not started` → `in progress` → `PR open` → `merged`. Fill in the branch and PR
columns as you go, and only tick the box once the PR is **merged**.

**The merge gate — all four, or stop and ask the owner:** every CI check completed and green
(pending is not green); nothing deferred; every acceptance criterion actually verified rather
than assumed; nothing changed outside the batch's declared scope.

Merging does not deploy — Replit Cloud Run is triggered from its own UI, so merged work waits
on `main` for a human to ship it.

**123 findings total.** 3 Critical, 17 High, 61 Medium, 42 Low.

---

## Blocking notes

- **Batch 1 cannot be verified locally.** `TEST-01` fixes GitHub Actions' shell wrapper, which
  only exists on a runner. The batch requires pushing a deliberately failing test, confirming
  CI goes red, then removing it. A green CI proves nothing — that was the bug.
- **Batches 3, 4, 5, 10, 12, 13 need a live Postgres** for their integration acceptance
  criteria. Set `DATABASE_URL` before running `npm test`, and confirm the output contains no
  `DATABASE_URL not set` line.
- **Batch 3 must not start before its design doc exists.** `DECISIONS.md` D1 and D4 give the
  rules, so the doc is a *how*, not a *whether* — but `CLAUDE.md`'s standing agreement requires
  one for anything touching storage or the socket protocol.

## Carried forward

**Anything a batch does not finish is written here, or it is lost.** Reporting a deferral in
chat does not count — chat evaporates and the next session never sees it. A batch may only
close with an open item if that item has a row here naming which batch picks it up.

An entry is removed only when the work is actually done, by the batch that owns it.

| From | Item | Why it was not done then | Owed by | Status |
|---|---|---|---|---|
| Batch 1 · TEST-04 | Add `expo:static:build` to the CI build step | It runs `scripts/build.js`, which starts a Metro server — too slow and flaky on a runner until the script is hardened. Recorded at `.github/workflows/ci.yml:85-86`. | **Batch 12**, after TEST-05 and TEST-06 | open |

### Not carried forward — closed as designed

Recorded so nobody re-opens them looking for missing work:

- **Batch 1 · TEST-09** excluded `server/index.ts` from `tests/serverLoadable.test.ts`.
  Importing it binds a port and installs signal handlers, so it cannot be load-tested in
  isolation. The plan explicitly asked for a named exclusion rather than forcing it, and the
  reason is recorded at `tests/serverLoadable.test.ts:11`. **This is the finished state of
  TEST-09, not a deferral.**

---

## Decisions

**All closed.** `DECISIONS.md` D1–D6 answer every question that blocked implementation.
**No batch is waiting on anything.** Two questions remain recorded there (the Expo Go landing
page, the severity rubric) and both carry a stated default, so no session will stop to ask.

If a batch tells you a decision is missing, that is a bug in the plan — say so rather than
guessing.
