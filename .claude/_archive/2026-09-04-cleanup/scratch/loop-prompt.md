# MISSION — work the Murlan backlog to empty. Sequentially. Autonomously. Without stopping.

Repo: `C:\Users\roton\murlan` (remote `metasito/murlan`). One ticket at a time, end-to-end
(pick → claim → branch → implement → verify locally → merge → close → next), until only
owner-gated work remains. Asking me anything is a FAILURE MODE: the owner is not watching
and will not respond. There is no question you may bring to a human mid-loop — only
escalation-by-label, defined below.

## PERMISSIONS — blanket and pre-granted by the owner. Never request confirmation.
- **Shell**: any command, any cwd inside the repo or `C:\Users\roton\AppData\Local\Temp\opencode`;
  long-running commands go through the gate runner (below), never inline.
- **Git**: branch/checkout/reset/revert/commit/push; delete only your own ticket branches;
  NEVER push to `main` directly, NEVER force-push, NEVER rewrite others' refs.
- **GitHub (`gh`)**: full read/write on issues, labels, comments, PRs — open AND merge PRs,
  close issues, post comments (AI-triage disclaimer where the skill demands); Actions read-only.
- **Docker**: disposable dev Postgres and E2E stack (`node scripts/dev-stack.mjs`, Playwright webServer).
- **Node/npm**: `npm ci`/`install`, any package.json script; NO new dependency without a filed,
  evidence-backed reason.
- **Filesystem**: create/edit/delete inside the repo and the temp dir above; delete your own
  scratch before landing unrelated work.
- **Network**: gh/api.github.com, raw fetches for research, package registries for installs.
- **Subagents**: spawn freely for exploration and verification; results come back to you.
- **Decision policy replacing questions**: judgment call ⇒ issue comment + `ready-for-human`
  label + move on. Fact answerable from the repo ⇒ look it up or test it. Default exists in
  CLAUDE.md/docs ⇒ follow it. That exhausts the space — always proceed.

## Standing exception — owner-authorized, TEMPORARY
Actions minutes are exhausted (billing failure; evidence in the comment on PR #225). Until
the owner announces restoration: CI is blind — do NOT watch runs, rerun workflows, or read
billing-failed checks as verdicts about your tree. You ARE authorized to merge without CI
iff the LOCAL GATE passes; write "local-verified during the Actions outage" in every PR body.
When the owner says Actions are back, this exception dies instantly and the normal rule
resumes: push → watch THE PULL REQUEST'S run → merge on green. Nothing here overrides
CLAUDE.md except this explicitly scoped CI substitution.

## Bootstrap (exactly once)
1. `cd C:/Users/roton/murlan`; read `docs/HANDOFF.md`; run its reality-check commands
   (`git log --oneline -5`, `git status --porcelain`, `gh auth status`).
2. `git checkout main` + `git pull --ff-only`. Tree must be clean.
3. Enter the loop.

## The loop
1. **PICK** — `node scripts/next-ticket.mjs`. Prints ROUTE (skill/ticket/title), STATUS
   counts, then the ticket's body, comments, blocker identities, takeability, claim commands.
   Sole picker: native blockers pre-applied, size-ordered, claim-aware (stderr SKIP lines =
   someone else's live claim — accept silently). Inspect any ticket by appending its number.
2. **CLAIM** — the printed claim commands as your FIRST write, before branching: `in-progress`
   label + comment `Claimed by \`<branch>\``, then confirm via `gh issue view <n> --comments`.
   An older claim wins: remove your label, stand down in one line, PICK again.
3. **BRANCH** — `agent/<issue#>-<slug>` off fresh `main`. One ticket = one branch = one commit
   (imperative mood, repo voice). No skipped hooks, ever.
4. **WORK through the named mattpocock skill**:
   - `implement`: TDD at pre-agreed seams; typecheck and single test files while iterating;
     prove a new test fails before the fix; full suite once at the end; `/code-review`
     before committing (the skill cascades it).
   - `triage`: verify claims against source, redundancy-check against existing and
     `rejected` issues, write agent briefs, flip labels, disclaimer on everything posted.
     AFK-safe steps only.
   - `wayfinder`: ONLY `wayfinder:research` / `wayfinder:task` children are yours. A grilling
     or prototype child needs the human: leave it open, treat that lane as owner-blocked,
     go to step 7. Never roleplay the human.
5. **LOCAL GATE — run the runner, never hand-roll verification**:
   `node .scratch/gate.mjs [--quick | --only=a,b,c | --e2e]`
   It enforces hard timeouts per step, kills process trees, closes stdin, sets CI=1, writes
   logs to `.scratch/gate/<step>.log`, exits non-zero with the last 40 lines on failure.
   - ALWAYS: default profile (lint → typecheck → devstack → unit → native).
   - BY DIFF: append `--e2e` when touching `app/`, `components/`, `context/`, `locales/`,
     or anything rendered/routed.
   - NEVER run suites inline in conversation. NEVER issue watch/poll/tail-style commands.
   - A timeout IS a FAIL: read its log, decide fix-forward vs abandon. Never wait longer.
   - Red ⇒ fix forward on the same branch. After ~3 honest attempts ⇒ abandon properly:
     back to main, delete branch, REMOVE in-progress, comment what blocked, PICK again.
6. **LAND** — push, open PR (what it delivers + how verified + outage note), merge yourself
   (`gh pr merge --merge --delete-branch`), CLOSE the issue with a two-line summary (what
   landed, how verified). No `Closes #n` in commit messages; close manually post-merge.
7. **ESCALATE instead of stalling** — owner call or design decision ⇒ relabel
   `ready-for-human` (remove `in-progress`), one-line why, PICK again. needs-info ⇒ same.
   The loop stops ONLY when STATUS shows `triage:0`, `wayfinder:0`, and the implement
   frontier is empty/blocked-only — or the owner interrupts.

## Context hygiene
- Delegate broad exploration and heavy verification to subagents/gate runner; keep decisions
  and edits in the main thread.
- The tracker is the only cross-ticket memory: closing comments carry what the next reader
  needs. No TODOs, no residue, no markdown backlogs.
- On compaction/restart: re-run Bootstrap, then PICK. Position survives because claims and
  labels live on GitHub, not in your context.

## Hard rules that outrank convenience
- CLAUDE.md binds fully: the invariants, design tokens, `t()` for every string, comments
  policy, no self-defeating safeguards, no workarounds, additive-DDL discipline around the
  live database.
- Untouchable: `ready-for-human` / `needs-info` / `rejected` issues, anyone else's
  in-progress claims, direct pushes to `main`.

Final act when stopped: one tally message — landed (with PR links), escalated (why),
blocked, last STATUS line.
