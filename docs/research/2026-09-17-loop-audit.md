# The loop since the Sep 14 rework — audited

Read from `.loop-logs` on 2026-09-17: 22 ticket streams started after `d5854ea7` (one process per
phase, 2026-09-14 16:48), 25 ledger tickets in `tickets.jsonl` since then, and the tracker threads
of those tickets. `npm run loop:cost` reproduces the phase table when it is given the same files.
The plan this argues for is `docs/superpowers/plans/2026-09-17-loop-v4.md`.

## 1. What the rework bought

| | before (19 marked tickets, Sep 12–14) | after (22 tickets) |
|---|---|---|
| $ per landed ticket | $26.56 (`2026-09-14-loop-efficiency.md` §5) | **$14.86** (21 of 25 landed, $312.01) |
| never landed | 36% | **16%** |
| mean / median $ per ticket | $21.89 / $20.54 | **$13.61 / $12.72** |
| median wall clock | 60 min | 45 min |
| HOLD share of verdicts | 51% | 38% |
| tickets with a red CI round | 20% (sample of 15) | 27% (6 of 22) |

Per phase, after:

```
phase  turns  tokens  $/tkt  share
A        414    31.7M $ 0.78    6%
B        218     9.3M $ 0.14    1%
C       3197   411.5M $ 7.55   55%
D       3255   197.1M $ 3.87   28%
E        487    30.8M $ 0.92    7%
F        197    11.1M $ 0.24    2%
```

Review is no longer the bill; the build is. Review quality held: the sampled HOLDs (#1079 a
shutdown-ordering race, #1081 a failed Copy announced as a failed share, #1082 a same-millisecond
eviction tie leaving two sockets) were all correctness findings, none about prose.

The Sep 16–17 night alone: 10 tickets, 10 landed, $175.13, 10h10m — $16.35 mean, dearer than the
Sep 14–15 runs (~$9) because of two large builds (#1077 C $24.63, #1079 C $18.31) and red CI.

## 2. Red CI rounds cost 13% of the spend

| ticket | fix-round $ | ticket $ |
|---|---|---|
| #840 | 2.33 | 18.45 |
| #1028 | 1.03 | 7.71 (parked after 3 rounds) |
| #1072 | 4.01 | 18.40 |
| #1075 | 2.46 | 14.63 |
| #1077 | 15.80 | 42.91 |
| #1078 | 3.04 | 18.68 |
| #1079 | 3.55 | 32.02 |
| #1082 | 8.20+ | 15.75+ |

$40.42 of $312.01. Each round is a fresh phase-A process that rebuilds the worktree phase F deleted
before CI answered, then a full review round (two reviewers and a refuter), then an E+F process,
then ~8–25 minutes of CI.

#1077's round ran twice over the same failure: session `6bd382b5` (158 turns, $6.09) chased the
accountRecovery 401 through the CI traces and gave up; session `466b0d48` (153 turns, $5.04)
downloaded the same artefacts and re-tested the same hypotheses before finding the cause. Nothing
the first ruled out was written anywhere the second could read.

The same assertion (`tests/e2e/accountRecovery.spec.ts:80`, a 401 console error) then failed
#1082, an unrelated ticket. Nothing noticed it was the same failure.

## 3. Recovery defects

**D1 — derive() does not read CI.** `loop-derive.mjs:306` decides the phase from commits and the
verdict. At the 07:14 restart #1082's head `f13aabc` carried a `LAND` and a red CI run; derive
said E, the session ran the gate and `agent:check`, "pushed" nothing, posted "All eight boxes …
closed" on the issue, and the supervisor read the same red run again.

**D2 — the supervisor's counters live in memory.** `rounds`, `lastSha`, `spent`, `handoffs` and
`nextPhase` (`queue-loop.mjs:1915-1926`) reset on restart: #1082's third red run was announced as
"fix round 2/3", and the no-commit park could not fire because `lastSha` was null. A retry resets
neither `handoffs` nor `nextPhase` — #1079 reached 7 of `MAX_HANDOFFS`=8 while healthy — and a
retry session's cost is never added to `spent`. The overSpend, overHandoffs, no-commit and throw
parks write no ledger row.

**D3 — the worktree is deleted before CI answers.** Every red round pays for a rebuild in a new
process. The board labels that resumed phase A "claim" though nothing is claimed.

**D4 — nothing carries a fix round's findings, or notices a shared failure.** §2.

**D5 — phase C is unbounded.** #1077's build: 449 turns, context 40k → 360k, $24.63, the same full
`tsc --noEmit` twelve times (other builds: 1–3). Its E process found `agent:check` red and ran 153
turns back through C: the build handed to review without a local check.

**D6 — E and F run on opus.** `queue.md`'s frontmatter pins `model: opus` and `queueLoopArgs`
passes no `--model`; E/F processes are ~50k context, ~$0.7 each, two or three per ticket.

**D7 — a lockfile change is skipped while any worktree stands, and never retried.**
`queue-loop.mjs:274-279` keys on the fast-forward's diff, which no longer shows the lockfile on the
next pass, while `preflight.mjs:157-166` holds on the drift — twenty holds end the night.

**D8 — rule 29 says opus reviewers; `queue.md` runs sonnet ones** and calls that rule 29's tier.

## 4. Where the tokens go

Across 132 ledger rows: cache reads 68%, cache writes 32%, output 0.5%. What the model writes is
not the cost; the context it re-reads on every turn is. `queue.md` (29 KB) plus `CLAUDE.md` and
`RULES.md` are ~12k tokens on every turn of every process.

## 5. Baseline for the v4 gate

$13.61 mean · $14.86 per landed · 45 min median · 27% of tickets red in CI · fix rounds 13% of
spend · phase-C max context 360k · handoff cap reached 7/8 by a healthy ticket.

## 5a. v4 measured against that baseline (#1134 Part 1)

Six tickets ran on v4: #1085–#1088, #1090, #1091. Four landed, two parked.

| Metric | Baseline | Target | v4 |
|---|---|---|---|
| $ per landed ticket | $14.86 | ≤ $12 | **$20.34** — $81.35 spent, 4 landed |
| $ per ticket attempted | $13.61 | — | $13.56 mean, $15.64 median |
| Median minutes | 45 | ≤ 40 | 43 |
| Phase-C max context | 360k | ≤ 210k | **206k — met** (193k, 178k, 167k, 95k, 79k) |
| Healthy tickets parked | 0 | 0 | **2** — #1088, #1090 |

The context work paid and the cost work did not: landed tickets are near target, and the gap is
entirely the $34.57 spent on two tickets that landed nothing. Both parks are diagnosed in #1150 and
neither was a hard ticket.

Two things this table cannot yet say. The **per-phase** split is unreadable until a run produces
correctly-phased rows: `derive()` returned C for a claimed, unworked worktree, so every session
declared `PHASE C` before `PHASE B` and `loop-cost` billed the build to B (v4 reads B 52% of spend,
median 48.4 min; C 18%, median 4.7 min). And **fix-round share** is printed from the whole ledger
regardless of the ticket filter, so the 6% figure is not a v4 measurement.

One census does stand on its own: across every ticket log, baseline and v4 — 3,000+ tool calls —
**not one assistant message carried two `tool_use` blocks.** Control probes with and without
`--exclude-dynamic-system-prompt-sections` both batched nothing, so the cache flag is ruled out and
the cause is still open. `TURNS_BY_SIZE` is therefore a budget denominated in batched turns being
spent one command at a time; #1090 died at 121 of a size:S 120.

## 6. Spikes

**CLI `--model` overrides a slash command's `model:` frontmatter.** `.claude/commands/model-probe.md`
carried `model: opus`. `claude -p "/model-probe" --model sonnet --output-format stream-json
--verbose --max-turns 1 --strict-mcp-config` reported `"type":"system","subtype":"init",...,
"model":"claude-sonnet-5"` and every `assistant` event's `message.model` was `claude-sonnet-5`, never
an opus id. The reverse run with `--model haiku` reported `claude-haiku-4-5-20251001` on both the
init event and every assistant event, confirming the flag wins, not the frontmatter. The probe file
was deleted immediately after and is absent from `git status`.

**`gh pr merge --repo … --delete-branch` cannot delete a local branch, and does not error.** Per
`pkg/cmd/pr/merge/merge.go` (fetched from `cli/cli` trunk): `opts.CanDeleteLocalBranch =
!cmd.Flags().Changed("repo")` (merge.go:124), and `deleteLocalBranch()` returns nil immediately
when `!m.opts.CanDeleteLocalBranch` (merge.go:398: `if !m.deleteBranch || !m.opts.CanDeleteLocalBranch
|| !m.localBranchExists { return nil }`). Passing `--repo` unconditionally clears
`CanDeleteLocalBranch`, so `--delete-branch` silently no-ops on the local branch (remote branch
deletion is unaffected) — it is a silent skip, not an error, so a caller cannot detect it from exit
code or stderr. Local `gh --version`: `gh version 2.93.0 (2026-05-27)`. This backs R8: any local
worktree/branch cleanup after a cross-repo merge must be done explicitly by the caller, never assumed
from `--delete-branch`.
