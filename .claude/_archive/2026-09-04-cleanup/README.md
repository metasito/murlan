# Retired 2026-09-04

Nothing here is live. Paths mirror where each file used to sit. The inner `.claude/` and `.agents/` were flattened to
`claude/` and `agents/` on the way in: Claude Code scans a nested `.claude/skills` even under
`_archive`, and the retired skills re-registered themselves the moment they landed there.

Before this cleanup, **five** things claimed to be the loop protocol at once: the Node
pipeline, a `PostCompact` hook, two prose protocols under `docs/agents/`, and an AFK prompt
in `.scratch/`. Whichever one an agent read first won. `/loop` is now the only one.

## The pipeline

| Path | What it was | Why retired |
|---|---|---|
| `scripts/ticket-pipeline.ts` | The queue runner: claim → worktree → implement(sonnet) → review(opus) → PR → second opinion → ci.yml → fix → merge → teardown. Node owned control flow; a model ran at three points. | Owner's call — it repeatedly failed in practice and was no longer trusted. Replaced by `/loop`. |
| `lib/ticketPipeline/` | Its eight modules. `ciVerdict.ts` and `land.ts` were **not** retired — see below. | Followed the runner. |
| `tests/ticketPipeline*.test.ts`, `tests/claimTicket.test.ts` | Their tests. | Followed the modules. |
| `claude/commands/ticket.md` | `/ticket [loop]`, which ran `npm run ticket`. | Replaced by `/loop`. |

**Kept out of it, deliberately:** `lib/loop/ciVerdict.ts` and `lib/loop/land.ts` (with
`tests/ciVerdict.test.ts` and `tests/landPr.test.ts`) were moved to `lib/loop/`, not archived.
They are the two steps prose cannot do reliably: reading a CI verdict from run data rather
than a command's exit status — piped, that status belongs to the pipe, which is how a red
branch once reached `main` — and deciding whether a green PR is landable or `BEHIND`. `/loop`
phase E calls both. Also kept: `scripts/next-ticket.mjs` (the only picker; nothing in the
mattpocock pack picks a ticket), `scripts/agent-check.mjs`, `scripts/preflight.mjs`,
`scripts/prune-worktrees.mjs`, `scripts/reap.mjs`.

## The competing protocols

| Path | What it was | Why retired |
|---|---|---|
| `docs/agents/SESSION-PROMPT.md` | Two parallel sessions in lanes (bugs / design), with a hand-rolled 13-step per-ticket contract and manual worktrees. 46 PRs in 24 hours. | Its per-ticket contract contradicted the pipeline that replaced it, and parallel sessions are what let four protocols disagree. Its lessons were folded into `/loop` and `docs/agents/RULES.md`. |
| `docs/agents/GAUNTLET-PROMPT.md` | Shumer's gauntlet: builder against a blind critic, judged against a named fetchable bar, looping until the work wins. | A quality-raising loop, not a backlog-draining one; keeping both meant two protocols. Its ideas survive in `/loop` (below). `docs/design/FEEL-BAR.md` still holds the bars themselves. |
| `scratch/loop-prompt.md`, `scratch/loop-watchdog.ps1`, `scratch/gate.mjs` | An earlier AFK loop, a PowerShell relauncher that killed the CLI on transcript staleness, and a standalone gate runner with per-step timeouts. | Superseded. `loop-prompt.md` also carried a standing "Actions minutes are exhausted — merge without CI" exception that has been false for weeks and read as current instruction. The watchdog killed processes by start time on a shared machine. |
| `docs/HANDOFF.md` | Session bootstrap. | Orphaned, and wrong: it told you to run `npm run verify`, which `RULES.md` rule 2 forbids. |
| `.claude/settings.local.json` → `PostCompact` hook | Injected a "STANDING SESSION CONTRACT" on every compaction: two parallel slots, never stop, pick by player impact. | Fired on every compaction and contradicted "one ticket at a time". Its two real rules survive in `/loop`. Replaced by a `SessionStart` hook that re-reads `STATE.md` from disk instead of asserting a contract from memory. |

## What survived, and where it went

| Idea | From | Now in |
|---|---|---|
| Verdict read from run data, never a command's exit status; filter to `ci.yml`; a completed job with zero steps ran nothing | `ciVerdict.ts` | `lib/loop/ciVerdict.ts`, called by phase E |
| `BEHIND` → update-branch first; never `--admin` | `land.ts` | `lib/loop/land.ts`, called by phase E |
| Git is asked, never the agent's own report (`rev-list --count`) | `ticket-pipeline.ts` | Phase C |
| Commit each slice — an unstaged edit is the only losable work | `ticket-pipeline.ts` (`commitLeftovers`) | Phase C |
| Reviewer gets the diff and the ticket, never the builder's reasoning | pipeline second opinion | Phase D |
| A parseable `VERDICT: LAND` / `HOLD` line | `risk.ts` | Phase D, and `STATE.md` → `verdict:` |
| Adversarial lens: prove a new test passes on broken code. Comment-policy lens | the pipeline's own design spec, designed and never built | Phase D |
| Blind critic **picks**, no score; a loss returns its verbatim words | `GAUNTLET-PROMPT.md` | Phase D |
| A piece has a bar or it is not a piece | `GAUNTLET-PROMPT.md` | Phase A — a ticket with no checkable Definition of done is parked |
| Mechanical design gate (schema / socket / >6 files, and no recorded decision) | the design spec | Phase B |
| Delegate the reading, keep the deciding; a fresh agent's tool output never enters the lead's context | `GAUNTLET-PROMPT.md` | Phases B and D |
| A bug three levels down: file it, do not follow it | `GAUNTLET-PROMPT.md` | Phase C |
| Prune orphaned worktrees at run *start* — a killed run never reached teardown | `ticket-pipeline.ts` | Phase 0 |
| Detach the junction before any worktree delete | `ticket-pipeline.ts` | Phase F, via `npm run worktrees:remove` |
| Remove `in-progress` after a merge — the PR body closes the issue, nothing takes the label off | `ticket-pipeline.ts` | Phase E |
| Read body **and** comments in one command | `SESSION-PROMPT.md` | Phase A |
| Watch the check fail first; root cause across every caller | `SESSION-PROMPT.md` | Phase C |
| Never let a subagent run `npm run agent:check`; say "do not spawn any subagent" | `PostCompact` hook | Phases B and D |
| Three-branch never-stall policy: repo-answerable / default exists / owner-only | `scratch/loop-prompt.md` | `/loop`, *Never stall* |
| Per-step timeout, and a timeout is a failure | `scratch/gate.mjs` | Noted as an open gap — `agent:check` has no timeout |

**Dropped on purpose:** two parallel slots and lanes (they contradict one-ticket-at-a-time);
"pick by player impact" (re-decided every session, which is drift — it belongs in the picker's
sort); the staleness watchdog; the CI-bypass exception; the designed-never-built parallel
fleet; the pipeline's cost ledger (a token table per ticket grows context per ticket).

## Dead packs

| Path | What it was | Why |
|---|---|---|
| `claude/agents/` (7 subagents + `AGENTS-REFERENCE.md`) | A third-party Expo/RN agent pack, June 2026. | Never referenced by anything, and duplicates what `eslint.config.js`, `tests/tokenRoles.test.ts` and `tests/a11y*.test.ts` already enforce mechanically. |
| `claude/skills/expo-horizon` | Meta Quest / Horizon OS migration. | This is a card game on web, iOS and Android. |
| `claude/skills/vercel-composition-patterns`, `vercel-react-best-practices` | 8352 lines of Next.js/RSC performance guidance. | Expo React Native app; no Next.js. `react-native-best-practices` was kept. |
| `agents/memory/` | A second memory system, 4 notes. | Nothing read it. |
| `docs/superpowers/plans/` | Three completed a11y plans. | Landed; the code and its tests are the record. |
| `docs/superpowers/2026-08-24-autonomous-ticket-pipeline-design.md` | The design that produced `ticket-pipeline.ts`. | The thing it designed is retired. Two of its lenses were never built and are now in phase D. |
