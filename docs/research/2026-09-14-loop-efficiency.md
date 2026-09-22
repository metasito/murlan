# What the loop spends, and what it buys — measured

Read from `.loop-logs` on 2026-09-14, 32 ticket streams, 14 ledger rows at schema 3.
Every figure here is reproducible with `npm run loop:cost`.

## 1. The bill is the session re-reading itself

Ticket #1043 (`size:S`, correct three false claims in test comments), PR #1050:

```
MAIN SESSION, 184 requests
  uncached input   0.00M   $0.00
  cache WRITE      0.28M   $1.74
  cache READ      25.64M   $12.82
  output           0.00M   $0.04
  cache hit rate   98.9%
context: 40k at the first request → 247k at the last
```

**Caching is already at 98.9% and is not a lever.** Without it this ticket would have cost
~$130 rather than $25.11. There is no headroom left there.

The cost decomposes exactly:

```
Σ(context at each turn) = 184 × 40k fixed prefix      =  7.4M  (29%)
                        + the conversation re-reading itself = 18.5M  (71%)
                        = 25.9M × $0.50/MTok          = $12.82
```

**71% of the main-session bill is history being re-read.** Context grows monotonically and
nothing is ever shed, so every turn pays for every turn before it. A ticket taking twice the
turns costs roughly four times as much.

The fixed 40k prefix is already minimal: `queue-loop.mjs` passes `--strict-mcp-config`, there is
no `.mcp.json`, and `--tools` is an explicit allowlist. Shrinking `queue.md` further would save
about $0.30 a ticket. That lever is spent.

## 2. Each tool call costs about seven cents

160 main-session tool calls: 97 Bash, 50 Edit, 13 Write. At the run's mean 141k context, each
call is one full context re-read ≈ $0.07. Many of the 97 Bash calls were single one-liners
(`perl -pi -e …`, `awk …`) that could have travelled together.

## 3. Phase D is 81% of the ticket, and the reviewers are not why

```
phase  turns   tokens   $/tkt  share
D        397    41.1M  $20.26   81%
C         62     4.8M  $ 2.02    8%
A         17     0.7M  $ 0.99    4%
B         27     1.1M  $ 0.29    1%
E          7     1.7M  $ 0.62    2%
F          9     2.2M  $ 0.79    3%
```

Within the run, **all nine subagents together used 5.2M tokens against the main session's
25.9M.** Reviewing is cheap. *Supervising* the review — dispatching it, reading its full output
into the session's context, and then carrying that context through every later turn of phases D,
E and F — is what costs.

**The work itself (A+B+C) cost $3.30. Everything around it cost $21.81.**

## 4. Review rounds are not over-bought. The opposite

Verdict sequences, read from the issues:

| Ticket | Verdicts | CI |
|---|---|---|
| #1036 | HOLD → HOLD → HOLD → LAND | green |
| #1034 | HOLD → HOLD → LAND | green |
| #1008 | HOLD → HOLD → LAND | green |
| #1002 | HOLD → HOLD → LAND | green |
| #1039 | HOLD → HOLD → LAND | green |
| #1018 | HOLD → LAND | green |
| #1032 | HOLD → LAND | green |
| **#1004** | **LAND → LAND** | **red** |
| **#1043** | **LAND** | **red** |

**Every round before the final one was a HOLD. Not one wasted round in the fleet.** And both red
pull requests are exactly the two that issued a `LAND` without a single HOLD ever being recorded.

This refutes the premise of `docs/plans/2026-09-14-agent-loop-overhaul.md` Task 5
("rounds 3 and 4 have been changing docblocks"). Cutting rounds would remove the only mechanism
that correlates with landing green.

**#1043 spawned eight reviewer subagents — four rounds — spent $20.26, and posted exactly one
verdict: `LAND`.** The review ran in full and its findings bound nothing. That is the defect:
not too much review, but review whose output never reached the gate.

## 5. Fleet economics

14 tickets, $239.07, 9 merged: **$26.56 per landed ticket, with a 36% never-landed rate**
(2 parked, 2 red, 1 refused). For a `size:S` documentation correction that is poor. Against a
developer at $100/hr for the same 50 minutes it is cheap. Both are true.

## 6. Two reliability defects that no amount of budget fixes

**`agent:check` prints PASS for suites it never ran.** Its own verdict block on #1043:

```
agent:check  PASS  (tree e8b1e870)
  ran here:      typecheck, typecheck:strict, lint
  ci.yml verify: npm test          ← listed, not run
```

`tests/sourceScan.test.ts` — the test that failed CI — is in `npm test`. Three of eight steps ran
and the word the session acted on was `PASS`. `queue.md` anticipates this in prose ("a green line
standing for a suite nobody ran is not a pass") and nothing enforces it.

**A red-CI fix round is reachable only from the supervisor process that observed the red run.**
`queue-loop.mjs` writes `.loop-logs/ci-<n>.log` and hands the number back in-process. A fresh
supervisor runs `next-ticket.mjs`, which skips `in-progress` at `next-ticket.mjs:53`. #1043 now
carries `in-progress`, an open red PR and an unread `ci-1043.log`, and no future loop will take
it.

## 7. What #1043 actually delivered

Final diff +201/−58 across 6 files; the five commits wrote +309/−166, so **35% of lines written
were rewritten by a later round.** The ticket asked for three corrected claims; the branch also
added an unrequested ADR (41 lines) and a test helper (30 lines). Nothing charges a session for
the extra review rounds a wider surface causes.

## 8. What follows

Ranked by measured dollars on #1043:

| Lever | Saves | Why |
|---|---|---|
| Phase D in its own process | ~$5.5 | kills the largest share of the 71% |
| Batch independent shell calls | ~$4.7 | 67 fewer turns × 141k |
| Bind spend to evidence | — | the $20.26 that produced one unbacked LAND |
| Honest pre-push verdict | — | the red push |
| Re-pickable fix round | — | the stranded ticket |
| Shrink the fixed prefix | ~$0.30 | already minimal |

Each fresh process pays its 40k prefix as a cache *write* at $6.25/MTok ≈ **$0.25 per process**,
so a split is only worth it where the phase it isolates is long. Splitting phase D buys ~$5.5 for
$0.25. Splitting phase F, nine turns long, buys nothing.

**Do not cut review rounds.** Section 4 is the reason.
