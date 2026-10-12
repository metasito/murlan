# 0011. Review converges, and the loop works toward launch

**Status:** Accepted
**Date:** 2026-10-11

## Context

The owner: "for every task we do 3 or 4 review rounds … the fixes themselves should be much smaller
than the original change and still you need 4 rounds to review them", and "I need more real work
and less overpolishing".

A read of 16 tickets closed on 2026-10-09 to 10-11:
- **Rounds:** 8 of the 16 hit the 4-round cap.
- **HOLD causes:** of 32 HOLDs, 7 were real bugs in the change, 13 were rule or style nits, and 8
  were problems in the previous round's fix.
- **How a ticket kept going:** each fix got a full fresh review, and any finding held it. "Fix every
  sibling" made each fix larger. CI was read only after a verdict. #1422 was red from round 1, and
  nothing acted on it until round 3.
- **Where tickets came from:** 73% of issues created since 2026-09-15 were filed by the loop itself
  (splits, leftovers, follow-ups), and the open count went from 24 to 51.
- **What the picker knew:** nothing about launch. It took the oldest `ready-for-agent` issue.

Anthropic's Code Review uses three severities and blocks on none of them by default. It suggests
reporting only Important findings after the first review.

## Decision

1. **One reviewer.**
   - One `opus` reviewer at `medium` reads the change (`brief.mjs review`).
   - The report sorts its findings into `## Blocking`, `## Nits` and `## Pre-existing`. Only a
     Blocking finding holds: a bug, an unmet Definition-of-done box, a regression or red CI the
     change causes, or a security or data-loss risk.
   - The verdict waits for CI.
   - The standards brief, spec brief, refuter and smell baseline are gone.
2. **A later round reviews only the fix.**
   - It reads the fix delta plus every caller of what it changed, and checks the previous round's
     Blocking findings.
   - The builder fixes only those findings: no sibling sweep and no nits.
   - `MAX_REVIEW_ROUNDS` is 3. A third review that still blocks sends the ticket to the owner; a
     ticket never lands at the cap.
3. **The loop files no agent work.**
   - No automatic split.
   - A security, data-loss or player-visible defect outside the ticket gets its own
     `ready-for-human` issue.
   - Anything smaller is a comment on the one open `noticed` issue.
4. **The picker works toward launch.** Its order is: stranded, then `main-red`, then the Launch
   milestone (which only the owner fills), then the rest. With nothing takeable, it names the
   owner's open asks.
   - **Amended 2026-10-12** (`docs/agents/loop-audit-2026-10-12.md` F2): `ci-flake` ranks with
     `main-red`. With Playwright retries gone, one flake reddened about one run in four, and its
     ticket (#1528) sat behind ordinary work. Only the owner adds `ci-flake`, so the loop's own
     filings cannot jump the queue.

## Consequences

- **What is given up:** nits and test-strength findings no longer cost a round. One reviewer and no
  refuter means a false Blocking finding is only checked by the verdict.
- **The red-team check:** every real-bug HOLD in the sample would still have blocked, and #1422's
  regression would have been caught in round 1.
- **#1424-style chains:** a chain where each fix causes the next bug now reaches the owner instead of
  landing at a cap.
- **Old review comments still pass:** `reviewFor` accepts a review with the old `## Standards` and
  `## Spec` headings, so a ticket already in review still passes `pushVerdict` and `mergeCleared`.
- **Supersedes ADR-0010's Decision 3** (two Opus reviewers plus an Opus refuter).
