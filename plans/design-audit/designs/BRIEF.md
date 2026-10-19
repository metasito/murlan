# Design session — shared brief

You are one of eleven parallel design sessions turning a verified design-audit ledger into a target
design for one area of Murlan (Expo/RN card game, Express + Socket.io server, Postgres via drizzle,
an autonomous "queue loop" that implements GitHub tickets). The owner wants a **holistic** result:
where several findings are symptoms of one wrong shape, redesign the shape instead of patching each
symptom. Small patches are right only where nothing structural is wrong.

## Inputs

- `MAIN` = `C:/Users/roton/AppData/Local/Temp/claude/C--Users-roton-murlan--claude-worktrees-codebase-design-audit-6b14f2/2185944d-3359-40dc-9b7f-f528c1073222/scratchpad/main2`
  — read-only snapshot of origin/main `a1d0ebb5` (newest). The ledger was verified at `3e2607e6`;
  since then #1603 (exchange view → `exchangeModel`/`useTableExchange`), #1604 (`TableFacts` built
  once, `HandRow` module), #1646 and #1638 merged. Re-check every cited line in MAIN.
- Ledger: `C:/Users/roton/murlan-plans/2026-10-16-design-audit/phase0/ledger.verified.json`. Read
  only your IDs (filter with node). Each entry has `problem`, `proposed`, `effect`, `files`,
  `verify` (verdict, evidence, correction, `fix_ok` concerns). **`verify.correction` and
  `verify.fix_ok` override the original proposal.**
- Owner's decisions (binding): kept everything in your ID list. Notes: L-058 → plain
  `resetTable()`, not one TableRecord (keeps #1602 per-slice memos); L-061 → narrow: re-export
  slice hooks, keep the six online contexts; L-144 → parts 1–2 only (no onlineReducer); L-028 →
  tombstone. Dropped (do not resurrect): L-018 (absorbed), L-033 (later), L-045, L-072, L-079,
  L-080, L-092, L-111, L-151, L-162, L-193.
- Area reports with fuller reasoning: `C:/Users/roton/murlan-plans/2026-10-16-design-audit/reports/*.md`.
- Recorded decisions you must not contradict: `MAIN/CONTEXT.md`, `MAIN/docs/adr/`,
  `MAIN/docs/GAME-RULES.md` § Decisions, `MAIN/CLAUDE.md`, `MAIN/components/CLAUDE.md`,
  `MAIN/server/CLAUDE.md`. If your design needs one changed, say so explicitly as a decision for
  the owner, with the reason.
- Open tickets (avoid overlap; reference them): `.../scratchpad/audit/open-issues.tsv`. Notable:
  #1624 (in progress: deal/exchange gates have an exit), #1639 (no bot play over round-1 deal,
  stale-callback races), #1628 (next-round vote deadline, drawn teams match), #1641 (loop:
  agent:check reaps orphans), #1521 (noticed table defects). `gh issue view <n> --repo
  metasito/murlan --comments` is allowed (read-only).
- Vocabulary: module, interface, depth, seam, adapter, leverage, locality, deletion test. One
  adapter = hypothetical seam; two = real. Interface = everything a caller must know.

## How the result is consumed

Tickets go to an autonomous loop: one fresh `claude -p` session per ticket, which cannot ask
questions; the ticket body is the whole spec (40–80 lines; `file:line` pointers first; checkbox
Definition of done; a fast "while iterating" check and a "before pushing" gate). Size labels set
budgets: S ≈ 320 turns/$30, M ≈ 505/$45, L ≈ 560/$70. Every ticket costs ~50k tokens of fresh
context just to start, so **fewer, coherent tickets beat many tiny ones**, but a ticket must land
as one reviewable PR without regressions. Order between tickets is native GitHub "blocked by" edges.
Two tickets that edit the same files must be ordered, never parallel.

## What to do

1. Read your ledger entries, then the code they cite in MAIN, end to end (callers included).
2. Find the shape: which entries share a root cause? What module, if deepened, makes several
   disappear? Apply the deletion test to existing modules.
3. Design it twice: at least two genuinely different interfaces for the central module(s); compare
   on depth, locality, seam placement, migration risk; pick one and say why.
4. Check each ledger entry is either covered by the design, kept as a standalone small fix, or
   (with evidence) no longer needed at MAIN. Every ID must appear in your coverage table.

Read-only: no edits to MAIN or any repo, no npm/tests/git writes, no subagents, no gh writes.

## Output

Write `.../scratchpad/designs/<NN>-<slug>.md` (your file name is in your prompt) with:

1. **Summary** — 5 lines: the shape now, the shape after, why.
2. **Current shape** — with `path:line` evidence at MAIN.
3. **Alternatives considered** — ≥2, with the comparison and the pick.
4. **Target design** — interfaces as TypeScript signatures plus the invariants, error modes and
   ordering a caller must know; what is deleted.
5. **Migration** — ordered steps, each leaving main green; what each step deletes.
6. **No-regression strategy** — the tests that pin current behaviour *before* the move (red/green
   where it is a bug), which existing tests/scans move or change, which checks catch what (note:
   unit tests can't see layout; only `tests/e2e/` does).
7. **Coverage table** — `ID | covered by (step/ticket) | note` for every ID in your list.
8. **Proposed tickets** — for each: title, size, files touched, blocked-by (within yours, and on
   other areas by name: engine, lastMove, time, server-runtime, server-output, http, client,
   table-ui, test-harness, static-checks, loop), Definition-of-done bullets, checks. Minimise the
   count without making any ticket unreviewable.
9. **Cross-area contracts** — what you need from / give to other areas (types, modules, files you
   touch that another area might too).
10. **Owner decisions needed** — anything that cannot be decided from the code and records.

Final message: one line with the file path and the ticket count by size.
