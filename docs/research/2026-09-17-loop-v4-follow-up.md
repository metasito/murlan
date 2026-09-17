# Loop v4 follow-up (#1134) — what was changed, and what it was measured against

The baseline these changes are judged against is `2026-09-17-loop-audit.md` §5. The measurement
over ten or more tickets (#1134 Part 1) runs once this lands; its results go in §5 below. Part 1
now measures v4 with these changes in, not v4 alone. That is the order the owner asked for, and
it means each part's own saving is only visible in its own figure: cache writes, E+F processes,
HOLD share and phase-C carried tokens.

## 1. Prompt prefix (Part 3)

Claude Code 2.1.274, `claude -p` with the loop's own flags (`--strict-mcp-config`, the `--tools`
list, `--model opus`) and a one-word prompt, run back to back from the same checkout. Figures are
the first assistant turn's `usage`.

| Run | cache write | cache read | turn cost |
|---|---|---|---|
| plain, 1st | 31,767 | 0 | $0.321 |
| plain, identical 2nd | 25,712 | 7,948 | $0.265 |
| `--exclude-dynamic-system-prompt-sections`, identical 2nd | 0 | 33,409 | $0.024 |
| same flag, untracked file added between runs | 26,454 | 6,965 | $0.273 |
| flag + `CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS=1`, file added between | 0 | 32,784 | $0.020 |
| flag + env, `LOOP_PHASE` C then D (hook report differs) | 25,979 | 6,818 | $0.268 |
| flag + env + silent startup hook, phase and file both changed | 0 | 33,332 | $0.020 |

Where things land, read off those figures:

- Without the flag, something in the system prompt differs between two identical processes, and
  only the ~8k ahead of it is reused.
- The flag moves the per-machine sections into the first user message. The git status snapshot
  is one of them, and it sits ~7k in, ahead of `CLAUDE.md`, the memory index, `queue.md` and the
  skill list. So any commit rebills ~26k.
- The `SessionStart` hook's `additionalContext` lands at the same depth. A `loop-status` report
  that names a different phase rebills the same ~26k.

The comment in `queue-loop.mjs` that rejected the flag measured it with a git-status change
between the two runs. That change is exactly what hides the flag's effect.

**Change.** The spawn passes the flag and sets `CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS=1`. The
`startup` hook runs `loop-status.mjs --startup`, which is silent when `LOOP_TURNS` is set, and a
loop process runs `loop-status` as its first command. The git instructions also carried the
`Co-Authored-By` trailer, so `queue.md` now states it.

**Expected.** Roughly 26k cache-write tokens saved on each process after a ticket's first. At the
audit's $6.25/M written against $0.50/M read, that is about $0.15 per process, or $0.6–0.9 per
ticket. §5 confirms or refutes it from the ledger's cache-write share.

## 2. A faster loop (Part 5)

| Item | Outcome |
|---|---|
| 1. CI starts when review starts | Done. A D handoff that passes `loop-gate --build` pushes and opens a draft. `poll` marks a green draft ready. It merges only a head that a `VERDICT: LAND` and a `REVIEW` cover, or a clean `update-branch` merge on top of one (its tree must equal `git merge-tree`'s), and it passes `--match-head-commit`. |
| 2. Cheaper `agent:check` | typecheck, typecheck:strict and lint run in parallel. `tsc` is incremental (warm 19.5 s → 6.7 s; strict 6.1 s → 3.1 s), and its build info sits beside each config, not under the junctioned `node_modules`. `tools/loop/tests/incrementalTypecheck.test.ts` edits a dependency and expects the error on two runs in a row. `eslint --cache` is ruled out: the config enables `import/no-unresolved`, `import/namespace` and `import/no-named-as-default`, which read other files, and a per-file cache replays a pass after those files change. |
| 3. Parallel reviewers | Already parallel. Since the Sep 14 rework, every Standards/Spec pair in `.loop-logs` (#1077, #1079, #1082) was sent in one message. The wording is now in D and pinned by `loopDocsAreExecutable`. |
| 4. C reads its own diff | Added before the D handoff. Keep it only if §5 shows a lower HOLD share for the cost. |
| 5. Landing folded into D | Done. On LAND, D goes on to E and F in the same process, which saves one process per ticket. E stays as the phase a restart resumes at, on sonnet. |
| 6. Playwright browser cache | Ruled out. On the last main run, `playwright install chromium` took 9–12 s per shard. A cache restore still has to download the same browser (not measured), and a key on the Playwright version adds a way to go stale. That saves seconds per shard at most, not worth it. |

## 3. Build reads less (Part 2)

B now returns `path:start-end — purpose` targets. C reads those ranges and sends cross-file
questions, long logs and files it will not edit to a `sonnet` subagent. Whether this lowers
phase-C carried tokens and peak context is a §5 figure.

## 4. Serena (Part 4) — not wired

Serena is a matched-pair experiment: with and without it, on tickets of a similar size. Wiring it
now would put a third variable into the Part 1 run. It also needs `uv` and a language-server
install on this machine, and a `--mcp-config` beside `--strict-mcp-config`, which the loop has
never run under. It is left for after §5.

## 5. Results over ≥10 tickets

Pending: `npm run loop:cost -- <first ticket>+` once the loop has run on this branch's merge.
