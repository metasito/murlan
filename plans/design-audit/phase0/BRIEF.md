# Phase 0 slice review — brief (read fully before starting)

You are one of ten reviewers in a **complete, file-by-file** design audit of Murlan (an Expo/RN card game plus an Express/Socket.io server and an agent "queue loop"). Earlier audits sampled files and kept finding new issues on every run; this pass fixes that by giving every file exactly one reviewer. **Your job is to read every file in your slice list, in full, and leave nothing unread.**

All paths below are absolute. `SRC` is a read-only snapshot of `origin/main` @ `50144087`:
`C:/Users/roton/AppData/Local/Temp/claude/C--Users-roton-murlan--claude-worktrees-codebase-design-audit-6b14f2/2185944d-3359-40dc-9b7f-f528c1073222/scratchpad/src`
Read code from `SRC` (not from any git checkout); cite `path:line` relative to `SRC`.

## Inputs
- Your slice: `.../scratchpad/audit/slices/<SLICE>.txt` (one path per line, relative to `SRC`).
- Vocabulary and method — read first:
  - `C:/Users/roton/.claude/plugins/cache/claude-plugins-official/mattpocock-skills/1.2.3/skills/engineering/codebase-design/SKILL.md`
  - `.../codebase-design/DEEPENING.md` (same folder)
  Use its terms exactly: module, interface, depth, seam, adapter, leverage, locality, deletion test; "one adapter = hypothetical seam, two = real".
- Project rules: `SRC/CLAUDE.md`, `SRC/CONTEXT.md` (glossary and **recorded rejections** — do not re-propose something CONTEXT.md or `SRC/docs/adr/` already rejected unless you have new evidence, and say so), plus `SRC/components/CLAUDE.md` / `SRC/server/CLAUDE.md` when your slice touches those trees.
- Deterministic inventory (computed from SRC): `C:/Users/roton/murlan-plans/2026-10-16-design-audit/phase0/inventory.md` — sizes, functions ≥80 lines, cycles, layer violations, test-only exports, duplicated blocks, mock targets. Use it; verify every item touching your slice and say whether it is real.
- Prior audit reports (yesterday + today, written at `d8c34919`, 11 commits older than SRC): `C:/Users/roton/murlan-plans/2026-10-16-design-audit/reports/{domain,server,client,ui,tooling,tests}.md`. Read the ones named in your prompt fully, skim the rest.
- Tracker: `.../scratchpad/audit/open-issues.tsv` (open) and `recently-closed.tsv`.

## What to look for (every file)
1. **Shallow modules / missing seams** — interface nearly as big as implementation; logic reachable only by mocking; one adapter where two exist in practice (tests patch it).
2. **Duplication / multiple homes** for one decision or one fact (the same rule computed in two places is a bug class).
3. **Correctness defects** you can see in the code (races, unchecked nulls, swallowed errors, wrong condition, stale comments that lie, dead code, a check that exempts what it checks). Mark severity.
4. **Resilience**: error handling, timeouts, retries, cleanup/leaks (timers, listeners, processes), behaviour on reconnect/restart.
5. **Efficiency**: needless renders/work, O(n²) on hot paths, repeated I/O, slow tests.
6. **Tests** (test slices): tests that test past an interface, mocks of in-house modules, duplicated fixtures, regex/source scans that a type or lint rule could replace, green-by-construction or self-exempting checks, tests to delete once a seam lands, slow tests.
Do not report style nits, naming taste, or comment density unless a comment is false.

## Rules
- **Read-only.** Edit nothing in any repo or checkout. No `npm`, no tests, no `agent:check`, no git writes, no `gh` writes. Do not spawn subagents. Read with Read/Grep/Glob (Grep across SRC to check callers is encouraged).
- **Verify before claiming.** Every finding cites file:line you actually read. Prefer fewer verified findings over speculative ones; mark anything inferred as `confidence: medium/low`.
- **Dedupe against priors.** For each finding state `overlap:` one of `new`, `extends <report>-<F#>` (adds files/evidence/a sharper fix), `confirms <report>-<F#>`, `contradicts <report>-<F#>` (say why), or `ticket #N`. Also list prior-report findings in your area that you found **wrong or already fixed in SRC** — that is valuable.

## Output — write ONE file
Write your report with the Write tool to `.../scratchpad/audit/out/<SLICE>.md`. If the write fails, return the full report as your final message instead. Final message otherwise: one line with counts.

Report structure:
```
# <SLICE> — slice review (SRC 50144087)
## Findings
### <SLICE-ID>-F1 (P1|P2|P3, XS|S|M|L) <title>
- files: path:line, ...
- problem: ...
- proposed: interface / change (concrete signatures where useful)
- effect: what gets deleted/simplified, bug class removed, tests affected
- overlap: new | extends ui-F3 | confirms ... | ticket #N
- confidence: high|medium|low
...
## Prior findings that are wrong or already fixed
## Inventory items checked (real / false positive, one line each)
## Coverage
| file | lines | verdict |   <- EVERY file in your slice, one row each: finding ids, or `clean`, or `leave-alone: <why it is already deep>`
```
The coverage table is checked mechanically against your slice list: a missing row is a failed review.
Priorities: P1 = structural, large leverage or a real defect; P2 = clear win, contained; P3 = small.
