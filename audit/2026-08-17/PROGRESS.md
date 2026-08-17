# PROGRESS — audit remediation

Run `/batch next` to start the next unchecked batch. Run `/batch status` to print this file.
Each batch ticks its own box when it finishes and records the branch.

**Sequencing rule:** batches 1–5 touch `server/socket.ts` and must run **in order**. After
that, 6/7 and 8/9/11 are independent of each other and can run in parallel worktrees if you
want speed. Then 10 → 12 → 13 → 14.

| # | Batch | Findings | Effort | Model | Status | Branch | PR |
|---|---|---|---|---|---|---|---|
| - [x] 1 | Restore the safety net | 6 | medium | Sonnet | PR open — 2026-08-17 | `audit/batch-1-safety-net` | |
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

A batch is done when it is **committed, pushed, and open as a PR** — one commit per finding,
one branch per batch, one PR per branch. The batch author never merges; the owner reviews and
merges. Tick the box, fill in the branch and PR columns, and set status to `PR open`.

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

## Decisions

**All closed.** `DECISIONS.md` D1–D6 answer every question that blocked implementation.
**No batch is waiting on anything.** Two questions remain recorded there (the Expo Go landing
page, the severity rubric) and both carry a stated default, so no session will stop to ask.

If a batch tells you a decision is missing, that is a bug in the plan — say so rather than
guessing.
