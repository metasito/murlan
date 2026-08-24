# Autonomous ticket pipeline: design

## Why

The 2026-08-23 session merged 9 PRs solo-reviewed, then a requested 22-agent
audit (issue #246) found 11 real defects across 7 of them — a wrong-locale
string, a test that asserted nothing, an untested code path, dead code, two
latent engine gaps. Per-PR write-ups were genuinely rigorous (proofs,
reverts, measurements) — the failure wasn't skipped process, it was that the
same session that wrote the code was also the only one reviewing it. A
same-session review shares its author's blind spots regardless of checklist
quality.

The ask: a pipeline that takes queue tickets to merged **without live
intervention**, to the **same or higher bar** as the post-hoc audit, where
independent review is structural (always runs) rather than a step that
depends on being remembered. Plus: this is also the moment to fix what's
accumulated — stale docs, unverified invariants, an unaudited `CLAUDE.md`.

## Goals

- Every ticket that lands gets a fresh, independent, adversarial review
  before it can be pushed — not optional, not size-gated.
- "Without intervention" doesn't mean the pipeline decides everything: a
  ticket that genuinely needs an owner call (design-first triggers) is
  routed to `ready-for-human` automatically and the queue moves on.
- Every run cleans up fully after itself — worktrees, docker containers,
  background processes, stale branches — as literal commands the pipeline
  runs, not prose a future run might skip.
- `CLAUDE.md` and the docs it points at get one real audit: every invariant
  re-verified against source, dead sections removed, no reorg for its own
  sake.
- Phase 2 (parallel fleet) is designed for but not built until Phase 1 is
  proven on real tickets.

## Non-goals

- Not rebuilding `implement`'s TDD discipline — it already works; the gap is
  what happens after local tests pass.
- Not solving the `docker`-per-CI-substitute story beyond making its
  lifecycle scripted (start → use → **always** tear down). Whether to keep
  using a throwaway Postgres at all is out of scope.
- Not touching the currently-uncommitted #132 rating-breakdown work as part
  of this initiative — it's unrelated in-flight state, called out below only
  so it isn't lost.

## Phase 0 — one-time hygiene sweep

Runs once, before Phase 1 is trusted with the live queue, because a pipeline
that enforces "leave no residue" going forward while sitting on top of
existing residue is inconsistent.

1. **Invariant audit.** For every bullet under `CLAUDE.md`'s "Invariants" and
   "Known pitfalls" sections: verify it against current source (grep the
   file/line it names). Three outcomes per bullet — still true and clearly
   worded (keep), true but redundant with another bullet or with something
   `eslint`/a test already enforces mechanically (cut, note what enforces
   it), or no longer true (cut or rewrite). Output as a redline the user
   reviews before it's applied — this file is the owner's own working
   agreement, not something to silently rewrite.
2. **Doc sweep.** `docs/*.md` — for each file, is it current, superseded, or
   dead? (`docs/HANDOFF.md`, `docs/BUNDLE.md`, and the `docs/research/*.md`
   set are the likely candidates — research docs earn their keep only if
   still-relevant decisions cite them.) Superseded/dead docs get deleted,
   not archived, per `CLAUDE.md`'s own "leave no residue" rule.
3. **Repo residue.** `.scratch/felt.fixed.bak` and anything else matching
   `*.bak` / obviously-dead scratch output gets removed. (`murlan bug/` at
   the repo root is **not** treated as residue — it holds screenshots that
   look like real bug-report material never triaged; flagged to the user
   separately, not auto-deleted.)
4. Delivered as one PR, reviewed like any other change (this doc's Phase 1
   review gate doesn't exist yet, so this one gets a manual `/code-review`
   before merge).

## Phase 1 — per-ticket pipeline

### Shape

One `Workflow` script, invoked per ticket. Structure (pipeline stages, not a
single barrier — findings-fix only blocks the ticket that has findings):

```
claim (mechanical)
  → design-first gate (mechanical check)
  → implement (agent, TDD)
  → local verify (agent; picks checks per docs/agents/loops.md by files touched)
  → independent review, 4 lenses in parallel (fresh agents, no memory of implement stage)
  → clean?
      yes → push, PR, watch CI, merge, close issue
      no  → fix (agent, given findings) → re-verify touched files only →
            re-review only the fixed hunks → loop, capped at 2 rounds →
            still dirty at cap → ready-for-human, explain why, stop
  → [finally, always] cleanup stage
```

### Design-first gate

Mechanical, not judgment: does the ticket's file scope (from its body /
`Ground truth` pointers) touch `shared/schema.ts`, the socket protocol
(`server/socket*.ts`, `shared/events.ts` or equivalent), or plausibly >6
files — **and** is there no recorded decision already (`docs/BRIEF.md`, an
ADR under `docs/adr/`, or a comment on the issue itself resolving the
question)? If both hold: `ready-for-human`, comment why, release claim, next
ticket. This automates the convention `CLAUDE.md` already states by hand —
no new policy, just removing the dependency on me applying it consistently.

### The four review lenses

Each runs as an independent `agent()` call — fresh context, given only the
diff and the issue body, never the implementer's reasoning:

1. **Standards** — `mattpocock-skills:code-review`'s existing standards
   axis (documented conventions + the Fowler smell baseline).
2. **Spec** — same skill's spec axis: does the diff match the issue, any
   scope creep, anything that looks implemented but is wrong.
3. **Adversarial** — given each new/changed test or guard, try to prove it
   passes on broken code (delete/invert the logic it claims to protect,
   check the test still would've caught it). This is the lens that would
   have caught tonight's vacuous test guard.
4. **Comment policy** — every new/changed comment in the diff, checked
   against `CLAUDE.md`'s four qualifying reasons (invisible constraint,
   non-obvious why, a contract types can't carry, pointer to authority).
   Flags anything that narrates history, restates the line below, or
   explains a bug that's already fixed — this is the lens that would have
   caught tonight's comment complaints directly.

Findings from all four are pooled; anything CONFIRMED blocks the push.

### Cleanup, as commands

The whole per-ticket run is wrapped in try/finally in the Workflow script.
The finally block always runs a cleanup agent, regardless of how the run
ended (merged, escalated, or errored), with a fixed checklist of commands —
not prose:

- `git worktree remove <path> --force` if a worktree was used for this
  ticket and still exists.
- `docker rm -f murlan-verify-pg` if the CI-substitute Postgres container
  (fixed name, not an ad hoc ID) was started this run.
- Kill anything still bound to the ports local verification uses (dev
  server / e2e webServer / the substitute Postgres) — `netstat`-then-`kill`
  on Windows, scoped to the ports `loops.md`'s local-substitute path names.
- `git branch -D <local-branch>` for a branch that was abandoned (escalated
  or capped-out) rather than merged, after confirming it has no unpushed
  work worth keeping (`git log origin/main..<branch>` empty check first).
- `git status --short` at the very end of the finally block — if it isn't
  clean, the cleanup itself failed and that's surfaced, not swallowed.

Named container/fixed ports mean teardown never depends on remembering an
ID from earlier in the run.

### What doesn't change

- `implement`'s TDD loop, PR write-up style, `gh run watch` + `--json
  conclusion` discipline, `--admin` merge given the billing block — all kept
  as-is; they're not what tonight's audit found wrong.
- Claim-before-work, `ready-for-human` / `blocked` labels, one-commit-per-
  item — all existing convention, just now enforced by a script instead of
  memory where this design adds a gate.

## Phase 2 — parallel fleet (designed now, built later)

N concurrent instances of the Phase 1 pipeline, each claiming a different
frontier ticket, each in its own `git worktree` (avoids the shared-git-index
loss already noted in prior sessions). Bounded concurrency — 2–3 — because
more parallel PRs racing to merge increases how often `main` moves under a
pending PR, forcing the full-suite rerun `CLAUDE.md`'s own merge-timing rule
warns about. Not built in Phase 1; revisit once Phase 1 has run on enough
real tickets to know its actual per-ticket cost and failure rate.

## Decisions

- **CI reality.** CI is currently billing-blocked (Actions never start).
  Phase 1's local-verify stage defaults to the local-substitute path (fixed-
  name throwaway Postgres, run the suites locally) rather than "push and
  watch CI" — that's what actually runs today. A "CI restored" path (revert
  to push + `gh run watch`) is a small follow-up once billing is fixed, not
  designed into this phase.
- **Verify runs `ci.yml`'s full sweep, not a scoped subset, while CI stays
  down.** With Actions not running at all, nothing else catches what a
  scoped-by-files-touched check misses — so every Verify call (the initial
  pass and every fix-round re-verify) runs all four of `ci.yml`'s jobs
  locally: `npm run typecheck`, `npm test`, `npm run test:native`,
  `npm run lint` (the `verify` job); `npm run test:e2e` (the `browser` job);
  and the `build` job's sequence (`npm run expo:web:build && npm run
  server:build`, `npm run bundle:budget`, `npm run expo:static:build`, then
  booting `server_dist/index.mjs` and confirming `/health` reports
  `"db":"connected"` — needs the same throwaway Postgres as everything
  else). `pickVerifyChecks`'s scoped-by-file selection stays as the CI-
  restored design (a fast local check while real CI is the backstop) but is
  not what runs today. Costs real wall-clock per verify call; that cost is
  accepted because there is currently no other net.
- **Phase 0 delivery.** The invariant/doc audit is applied on a branch and
  opened as a PR for review — not a chat list requiring line-by-line
  pre-approval, not silent auto-merge. Reviewed like any other change.
- **Adoption.** Once Phase 1 is built and passes its supervised trial (next
  bullet), `CLAUDE.md`'s "Autonomy" section is rewritten to mandate it as
  the standard way to work a queue item — no parallel undocumented process
  for the two to drift out of sync.
- **First run.** The first one or two live runs against real queue tickets
  are supervised (user watching, able to interrupt) before the pipeline is
  trusted fully unattended.

## Open items surfaced, not solved here

- `murlan bug/` at the repo root (4 images, untracked) — looks like
  untriaged bug-report material. Needs the user's read, not a cleanup pass.
- The uncommitted #132 rating-breakdown work sits stashed/restored,
  untouched by this initiative.

## Success criteria

- A ticket landed through Phase 1 has zero CONFIRMED findings if a second,
  separate audit (like #246) is run against it afterward.
- No ticket run leaves a worktree, container, bound port, or dangling
  branch behind — checked by `git worktree list`, `docker ps -a`, and
  `git branch` staying clean between runs.
- `CLAUDE.md` after Phase 0 is shorter or equal in length with zero bullets
  that fail their own "verify against source" test.
