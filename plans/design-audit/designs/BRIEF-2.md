# Round-2 design brief: candidates on top of the planned programme

You design ONE candidate from the architecture review that ran on top of the already-planned
programme. Decide honestly whether it is worth doing; if yes, design it and propose tickets that
slot into the existing map.

## Inputs
- The review (your candidate's card): `C:/Users/roton/murlan-plans/2026-10-16-design-audit/architecture-review-20261016-171408.html`.
- The planned programme (the state you build on): `C:/Users/roton/murlan-plans/2026-10-16-design-audit/INTEGRATED.md`
  (§1 architecture, §2 resolutions R1–R11, §3 ticket table, §4 spec cards, §6 decisions D1–D28, all
  defaults approved by the owner). Area designs: `.../designs/01-engine.md` … `11-loop.md`.
- Filed tickets: `.../tickets.json` maps plan IDs to GitHub issues on map #1650 (`metasito/murlan`).
- Code at origin/main a1d0ebb5 (read-only): `C:/Users/roton/AppData/Local/Temp/claude/C--Users-roton-murlan--claude-worktrees-codebase-design-audit-6b14f2/2185944d-3359-40dc-9b7f-f528c1073222/scratchpad/main2`.
  Recorded decisions you must not contradict: `CONTEXT.md`, `docs/adr/`, `docs/GAME-RULES.md` § Decisions,
  `CLAUDE.md`, `components/CLAUDE.md`, `server/CLAUDE.md`.
- Vocabulary: module, interface, depth, seam, adapter, leverage, locality, deletion test; one adapter
  is a hypothetical seam, two make it real (codebase-design skill).

## Rules
- Read-only: no repo edits, no npm, no gh writes, no subagents.
- Build on the plan: never re-do what a planned ticket does; name the planned tickets yours depend on.
  If the cleanest result needs a planned ticket's scope changed, say exactly how, as an amendment.
- No game rule changes unless they go through GAME-RULES § Decisions. If a rule question arises, keep current
  behaviour and list it as an owner decision with a recommended default.
- Verdict first: `do it` / `do part of it` / `not worth it`, with evidence (bugs it prevents, copies it deletes,
  what it costs). The owner wants a near-bug-free, maintainable game, but a seam with one adapter or a
  ticket that only moves code is not worth its cost.
- Ticket economics: each ticket is one fresh loop session and one PR (S ≈ $30, M ≈ $45, L ≈ $70 caps).
  Fewer coherent tickets beat many tiny ones; each must land green alone, with red-first tests where
  behaviour changes and a green-on-main pin where code only moves.

## Output
Write `C:/Users/roton/murlan-plans/2026-10-16-design-audit/designs/<file named in your prompt>` with:
1. Verdict and why (5 lines).
2. The after-plan shape that hurts, with `path:line` evidence at MAIN plus the planned tickets that shape it.
3. Alternatives (≥2) and the pick.
4. Target design: plain-English module shape, interface sketch, invariants, what is deleted.
5. Migration steps, each green.
6. Owner decisions (with recommended defaults), and amendments to planned tickets, if any.
7. Ticket rows, in EXACTLY this table format (one row per ticket, IDs use your prefix):
   `| ID | title | area | size | ledger IDs | files/modules | blocked by | label | owner-eye? |`
   — `ledger IDs` = `review C<n>`; `blocked by` = planned IDs (e.g. `CLI-6, WIRE-2`) and/or your own IDs, or `—`;
   label `ready-for-agent` (or `ready-for-human` only if a loop session cannot do it); owner-eye `yes`/`no`.
8. Spec cards, one per ticket, in EXACTLY the INTEGRATED.md §4 format:
   `### <ID>: <title> (<size>)` then `- **Defect:**`, `- **Where:**`, `- **Build:**`, `- **Constraints:**`,
   `- **DoD:**` (sub-bullets `  - [ ] …`), `- **Checks:**` (fast loop command, then `Gate`, plus named suites),
   `- **Not this ticket:**`, `- **Source:**`. Continuation lines indented two spaces, sub-bullets `  - `.

Final message: the file path, the verdict, the ticket count by size, and the planned tickets you depend on.
