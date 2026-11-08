# Writing tickets

Read before writing or rewriting an issue body (`/triage`, `/audit`, a filed defect), before a
wayfinder operation, or before deciding whether a pull request is a request. The labels, recipes
and claiming are `docs/agents/issue-tracker.md`; the rules are `docs/agents/RULES.md` 22–28 and
33–35.

## Writing an issue body an agent can execute

An agent working the queue cannot ask a follow-up question, so the issue is the whole
specification. The test: a competent stranger could land the change without guessing.

**Write the body to stand alone.** Rulings, triage decisions and traps found later arrive as
comments, and a later comment overrides the body — so a decision that changes the work is worth
folding back into the body, where the next reader meets it first.

Eight sections, in this order. Drop any that would be empty — an empty heading is noise.

```markdown
## Question            ← or "The defect" / "The opportunity". One sentence: what is being decided or fixed.
## Why this exists     ← 2-4 lines. Quote the reporter verbatim where their words exist.
## Ground truth        ← a table of `file.ts:line` pointers and prior issues. "Read before anything else."
## What to settle      ← `- [ ]` checkboxes, one per sub-decision. Empty tables to fill in beat prose.
## Constraints         ← `> [!IMPORTANT]` — the invariants this change can break, and how.
## Definition of done  ← `- [ ]` per artefact. What must exist for this to close.
## Checks              ← what to run while iterating, and what to run once before pushing.
## Not this ticket     ← only work owned by another open issue or needing another decision, with issue numbers.
```

### What the sections need

- **Point at code, not at concepts.** `components/GameTable.tsx:827` costs the agent one read;
  "the sound preloading" costs it a search and a guess.
- **Name the invariant *and* its enforcement.** "`CARD_W` is declared once, and
  `tests/ui-rules/layoutConstantsPinned.test.ts` source-scans for a second declaration" says both
  what not to do and what will catch it.
- **Name the checks in two slots: the loop, and the gate.** `docs/agents/RULES.md` rule 3 has the
  agent run only the tests its change adds or edits, leaving the covering suites to CI, and rule 5
  says when a browser spec needs a rebuild. You have read the change coming; it has not.

  ```markdown
  ## Checks

  While iterating: `node --test tests/ui-rules/tableLayout.test.ts`
  Once before pushing: `npm run agent:check`
  Not `npm run test:native`: react-test-renderer never runs flexbox, so it cannot see this.
  ```

  **The loop slot holds only a fast, non-rebuilding command.** A Playwright spec is minutes plus a
  Metro rebuild for any change outside `tests/e2e/`; named as the loop, it becomes the loop. A
  browser check goes in the gate slot, bounded to red once and green once, with CI carrying the
  rest.
- **An open box under `## What to settle` means the ticket is not `ready-for-agent`.** That label
  promises the decisions are made. Settle them and write the answers down, or label it
  `ready-for-human` and leave them open.
- **A box a loop session is refused cannot be `ready-for-agent`.** The permission classifier
  refuses a loop session's edits to `.claude/settings.json` as self-modification. Such a box is
  the owner's: label the ticket `ready-for-human`, or move the box into a ticket of its own that is.
- **Write a same-area defect into the Definition of done.** The queue fixes only defects in the
  lines its diff changes (`queue.md` phase C) and files no agent work, so a defect in the ticket's
  area that the diff need not touch gets a box of its own, or nobody fixes it.
  `## Not this ticket` names only work another issue owns or a decision not yet made.
- **Check every prescribed form against what already pins the current one.** Grep the tests and
  `git log -S` for the command, pattern or path you tell the agent to use; a form a test forbids
  leaves the session nothing to do but park. Where unsure, state the intent and let the agent pick.
- **Checkboxes over prose**; they render as progress, and an agent can report against them.
- **An empty table is an instruction.** Its columns (`Event | Visual | Sound | Haptic | Fallback`)
  specify the shape of the answer more cheaply than describing it.
- **`> [!IMPORTANT]` and `> [!WARNING]` are load-bearing** — they survive skimming, and
  constraints are what get skimmed past.
- **Make the done-condition checkable and exhaustive.** "Every modified locale accounted for"
  forces the work; "update the locales" does not.
- **Point at `CLAUDE.md`, don't copy it.** It is in every session's context already. Write only
  how this change collides with an invariant there.
- **Prompt the positive.** "Bound every query" lands; "don't write unbounded queries" puts the
  unbounded query in context. Keep prohibitions for hard guardrails, paired with the target.
- **Cite the source** — a research file or the issue that surfaced it — so the claim can be
  checked rather than re-derived.
- **Verify the body's own claims before filing.** A defect asserted at a line that does not
  contain it sends an agent down a hole with no way out.

### Write it for cheap consumption

The reader pays for every token and cannot ask. Too little and it explores; too much and it skims
past the part that mattered.

- **Give the values, not a description of them.** `radius 14*s, no border, label Rajdhani 700
  12*s .16em uppercase` is one line to implement from; "rounded, bevelled, with a letterspaced
  label" is three to resolve.
- **Front-load the pointers.** An agent with `file.ts:line` in the first ten lines never runs the
  search.
- **Link the primary source; never paraphrase it** — a prototype URL, an ADR, a spec — and say
  which part to read. A paraphrase is a second copy that goes stale.
- **40–80 lines.** Longer is a spec, not a ticket: propose the split as `ready-for-human` tickets
  for the owner, the blocking edges carrying the order.
- **One `size:*` label is a promise about the diff**, not about the reading. A ticket whose body
  needs a research detour is not `size:S`, however small the edit turns out to be.

## Wayfinding operations

Used by `/wayfinder`. The **map** is one issue labelled `wayfinder:map`, holding the Notes /
Decisions-so-far / Fog body; its **children** are the tickets.

- **Child**: a GitHub sub-issue of the map (`docs/agents/issue-tracker.md` § Recipes), labelled
  `wayfinder:<type>` (`research` / `prototype` / `grilling` / `task`).
- **Blocking**: native issue dependencies (same recipes). A child is unblocked when every blocker
  is closed.
- **Frontier**: the map's open children with no open blocker, no `in-progress` and no assignee;
  first in map order wins. The picker's wayfinder route does not apply that filter itself — `/wayfinder` does.
- **Claim**: as in `docs/agents/issue-tracker.md` § Picking and claiming — the `in-progress` label
  and a claim comment, never an assignee.
- **Resolve**: comment the answer, close the child, then append a context pointer (gist + link)
  to the map's Decisions-so-far.

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Set to `yes` if this repo treats external PRs as feature
requests; `/triage` reads this flag.)_

When `yes`, PRs run through the same labels and states, with the `gh pr` equivalents: read with
rule 25's command (an issue's number space holds pull requests too) plus `gh pr diff <n>`; list with
`gh api 'repos/{owner}/{repo}/pulls?state=open&per_page=100' --paginate`, keeping only
`author_association` of `CONTRIBUTOR`, `FIRST_TIME_CONTRIBUTOR` or `NONE`. Issues and
PRs share one number space, so rule 25's command reads a bare `#42` whichever it is.
