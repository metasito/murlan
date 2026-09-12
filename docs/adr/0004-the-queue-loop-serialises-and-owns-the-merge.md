# 0004. The queue loop serialises its tickets and the supervisor owns the merge

**Status:** Accepted
**Date:** 2026-09-12

## Context

The night of 2026-09-11 ran eleven tickets and reported five parks, one landing nothing
had touched, and two sessions that merged each other's pull requests to get past a branch
cut from a `main` that did not yet have the other's work.
`docs/research/2026-09-12-queue-loop-rearchitecture.md` numbers 43 defects behind that.
Almost all of them are one of two shapes: the supervisor and the session disagreeing about
which ticket is live, or the supervisor holding state in memory that nothing could recover.

The forces are measured, not assumed:

- A **merged** pull request answers `mergeStateStatus: UNKNOWN`, and so does one GitHub has
  not finished computing. `decideLanding` had no case for it, so five tickets that had
  already merged fell through to "unrecognised" and were parked — and `park()` left
  `ready-for-agent` on beside `ready-for-human`, which `classify()` reads as the owner's,
  so the frontier drained from 11 to 6 in one night.
- `gh pr merge` treats `UNSTABLE` — which includes *queued* — as immediately mergeable, and
  `--auto` is evaluated client-side and skipped for a pull request that is immediately
  mergeable. Neither flag is a queue.
- GitHub Merge Queue requires an organization-owned repository. `metasito/murlan` is
  user-owned, so it is not available at any price.
- Overlapping the next ticket with the previous one's CI wait was measured at about 22% of
  wall clock. It bought an in-memory pending pull request that nothing recovered when the
  process died, a worktree released out from under a live `derive()`, and the two
  cross-merges above.

## Decision

**One ticket at a time, and the supervisor merges it.**

The supervisor picks one ticket, passes its number to the session on the command line,
waits for the session to exit, reads CI, polls mergeability, merges, and records. It holds
no queue and no pending pull request: everything it knows is derived from git and the
tracker on each iteration, so a crash costs the current ticket and nothing else.

The session owns claim → build → review → gate → push, **and its own worktree teardown**,
because after a push its tree is dirty and it is the only process that knows whether that
is work or residue. `scripts/guard-bash.mjs` refuses `gh pr merge` from a session; the
merge is not a judgement, and a model reading a CI log to decide that green means merge is
a model spending turns on a switch statement.

The session reports its phase by saying `PHASE <letter>` on a line of its own. Nothing
else infers it.

## Consequences

Roughly 22% of wall clock is given up deliberately. In exchange, a whole class of defect
becomes unreachable rather than fixed: there is no second ticket for `derive()` to be
ambiguous about, no slot to orphan, and no branch cut from a `main` that is about to move.

Recovery is re-derivation. Restarting the loop after any failure is safe and is the
supported repair — there is no state file to reconcile, and `.loop-stop` is read without
being consumed so a scheduled restart sees it too.

A mechanical failure no longer reaches the tracker. `settleOutcome` counts it toward the
breaker and leaves the branch, the pull request and the labels intact for the next
iteration to find. Only a decision a person has to make becomes `ready-for-human`.

The phase board that inferred progress by regexing the session's shell commands is gone
(≈890 lines, and a `derive()` every twenty seconds at eight subprocesses a call). It missed
74 of 131 markers, because `queue.md` itself prescribes `git add -- <paths>` before
committing and the anchored pattern never fired.

Should the repository move to an organization, GitHub Merge Queue is worth re-reading
against this: it is the one force above that could change.
