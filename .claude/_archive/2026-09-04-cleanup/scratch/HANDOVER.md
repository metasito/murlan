# Handover — backlog session, 2026-08-23/24

The table-port handover this file used to hold is spent: #191–#194, #197–#199 and #203 are
all closed and merged. What follows is what the next session needs that the repo does not
already say.

## Read this first: CI cannot run

**GitHub Actions starts no job on this repository.** Every run since #228 dies in the
`scope` job within seconds, no steps, annotated:

```
The job was not started because recent account payments have failed or your spending
limit needs to be increased.
```

Check it with `gh api repos/metasito/murlan/check-runs/<job-id>/annotations` before reading
any red run as a verdict — a billing non-start looks exactly like a failed suite from the
outside.

Consequence for every item: verify locally per CLAUDE.md's "When Actions cannot start", then
merge with `gh pr merge <n> --merge --admin --delete-branch`. Two issues are `blocked` purely
on this (#185, #186) — both are "change a CI job and read the result", which no local run can
substitute for.

## Traps that cost real time tonight

- **A Playwright spec must be given its config.** `npx playwright test tests/e2e/foo.spec.ts`
  runs with no `baseURL` and no `webServer`, and fails with
  `page.goto: url: expected string, got undefined`. That is a harness error, not a product
  failure — a previous session handed #206 over with a "failing spec" that was only this.
  Always `--config tests/e2e/playwright.config.ts`, and always a unique `E2E_PORT`.
- **`EXPO_PUBLIC_E2E_FAST=1` makes the bots play in zero milliseconds**, so an e2e run can
  never observe the table parked on an opponent's turn — the seed's turn is spent before the
  first screenshot. `lampSeats.spec.ts` is green and measures the viewer's turn in every state
  named for somebody else's (#237). To photograph a held state, use
  `npx expo start --web` and `app/capture.tsx`, which is `__DEV__`-only and therefore absent
  from the e2e bundle.
- **Do not run jest while Playwright is running.** 15 native suites "failed" that way; they
  are 5s per-test timeouts under CPU contention, exactly as the previous handover warned.
  Baseline first, one suite at a time, nothing else running.
- **`npm ci` can finish partially.** `node_modules/typescript` and `node_modules/tsx` were
  both missing after an apparently clean install, which made `npm test` report a *different*
  failure than the real one. If a test dies on `Cannot find module 'typescript'`, reinstall
  before believing anything it said.
- **Another session is working this repo in parallel.** One landed PR #233 four minutes
  before I read the same failure, and answered it by lowering a guard's floor. Re-read an
  issue after claiming it, and check `git log` on `main` before trusting a diagnosis.

## Worktrees in play

| Path | Branch | State |
| --- | --- | --- |
| `C:/Users/roton/murlan` | `main` | the main checkout |
| `C:/Users/roton/murlan-wt2` | `agent/141-exchange-preview-confirm` | someone else's, claimed |
| `C:/Users/roton/murlan-wt206` | `agent/206-fan-cap` | mine, item in flight |

Delete a worktree once its pull request merges — each carries its own `node_modules`.

## Standing method for an item

1. `node scripts/next-ticket.mjs` — it prints the route as well as the ticket.
2. Claim first (`in-progress` + a comment naming the branch), then re-read the issue.
3. Read **every comment**, not the body. Two items tonight had their entire specification in
   a late comment, and one had a body whose arithmetic was wrong.
4. Verify a body's factual claims before building on them. #206's "the step falls to ~4.7px
   at 21 cards" was false — measured 7.0px — and a test written to the body's premise could
   never have failed.
5. Prove any new guard fails **twice**: on the defect, and on the null case where it inspects
   nothing. A guard whose expectation is derived from the thing it checks can pass vacuously;
   that happened tonight and needed a floor under the check itself.
6. Two-axis review (`mattpocock-skills:code-review`) on sub-agents running **Sonnet**, then
   land through a pull request.

## Still open from the table port

- **#200 — the moments.** Deal, bomb, flush. Unbuilt. Keyframes are in the prototype's
  `<style>`; impact feedback stays timed by `impactDelayMs()`.
- **#195 — the rail settings sheet.** Our rail's top knob is still an X where the prototype
  has a hamburger, and the rail foot is empty. Any `<Modal>` needs `supportedOrientations`.
- **#204 — the throw does not leave the thrower's fan.** Sits with #200.

## The parity harness

`.scratch/parity/` (gitignored). `proto.html` is the prototype's saved source and the
authority for every number — it settled #203's 55% in one grep (`proto.html:872`). Re-fetch
with **WebFetch**, not `curl`:
`https://claude.ai/code/artifact/80607f3e-e852-416e-a6f1-91788d80f40f`.

`.parity-scratch/` at the repo root is an older session's leftover, untracked and not
gitignored. Not mine, left alone.
