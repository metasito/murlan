# Issue tracker: GitHub

Issues live in GitHub Issues (`metasito/murlan`); `gh` infers the repo inside a clone. The rules
for taking, claiming, reading and releasing work are `docs/agents/RULES.md` 21–28. This file is
the vocabulary, the recipes, and how to write a ticket.

## Labels

`tools/loop/next-ticket.mjs` routes on labels alone (`routeOf`, `classify`).

| Label | Means | Picker |
|---|---|---|
| `ready-for-agent` | Specified; every decision is made | route `implement` |
| `needs-triage`, or no label at all | Not yet a ticket | route `triage` |
| `wayfinder:research` / `prototype` / `grilling` / `task` | A child of a wayfinder map | route `wayfinder` |
| `wayfinder:map` | The map issue itself | never routed |
| `ready-for-human` / `needs-info` / `rejected` | The owner's; wins over `ready-for-agent`. `rejected` stays open (`docs/BRIEF.md`) | owner |
| `deferred` | Decided against for now; the owner can lift it | owner |
| `in-progress` | Claimed | skipped, unless *stranded* (below) |
| `blocked` | Ready and approved, but waiting on something external — a dead CI, an unreleased dependency | skipped |
| `size:XS` … `size:XL` | A promise about the diff; the supervisor sets the session's turn budget from it | — |
| `loop` | The loop's own machinery: `tools/loop`, the supervisor, its guards | — |
| `main-red` | Filed by the supervisor when main's CI is red (`tools/loop/mainHealth.ts`) | — |
| `soak` | Filed by the nightly soak (`.github/workflows/soak.yml`) | — |
| `gauntlet` | A piece in a gauntlet round, critiqued blind against a named bar | — |

- **`blocked` sits alongside `ready-for-agent`, never instead of it.** That label carries a
  decision the owner already made, and removing it to stop the picker is how the decision is lost.
  Take `blocked` off when the dependency returns, and say so on the issue.
- **Blocking between issues lives only in GitHub's native dependencies** — the picker gates on
  `issue_dependencies_summary.blocked_by`, and nothing else encodes it. A blocker stated in prose
  on the *other* issue is invisible to it (rule 23).

## Recipes

Every multi-line body goes through `--body-file` (the shell contract, `docs/agents/checks.md`).

```sh
# Read one issue: rule 25's command. Add `labels` to --json when they matter.
gh issue list --state open --label <label> --json number,title,labels \
  --jq '[.[] | {number, title, labels: [.labels[].name]}]'
gh issue create --title "<title>" --body-file <file> --label <label> --label size:<size>
gh issue comment <n> --body-file <file>
gh issue edit <n> --add-label <label> --remove-label <label>
gh issue close <n> --comment "<why>"

# <db-id> is the database id — gh api repos/{owner}/{repo}/issues/<n> --jq .id — never #<n> or node_id
gh api -X POST repos/{owner}/{repo}/issues/<n>/dependencies/blocked_by -F issue_id=<blocker-db-id>
gh api repos/{owner}/{repo}/issues/<n> --jq .issue_dependencies_summary.blocked_by   # open blockers
gh api -X POST repos/{owner}/{repo}/issues/<map>/sub_issues -F sub_issue_id=<child-db-id>
```

When a skill says **"publish to the issue tracker"**, create an issue. When it says **"fetch the
relevant ticket"**, run rule 25's read — title, body and thread together.

## Picking and claiming

The standard way to work an `implement` route is **`/queue`** (`.claude/commands/queue.md`): it
claims, builds in a worktree, has the diff reviewed by readers who did not write it, and hands CI
and the merge to the supervisor. `triage` and `wayfinder` go through `/triage` and `/wayfinder`
(rule 27), which run `mattpocock-skills:triage` and `mattpocock-skills:wayfinder`; those skills own
their procedures, and the command files carry only this repo's specifics.
`mattpocock-skills:implement` is not used: its closing full-suite run contradicts rule 2, so
`/queue` calls `mattpocock-skills:tdd` and `code-review` directly. Nothing in that pack picks a
ticket here: its frontier query drops candidates on assignee, and every session authenticates as
the same GitHub account.

- **Pick** — `node tools/loop/next-ticket.mjs`, the single picker (rule 21). `--all` lists the
  unblocked implement frontier in pick order; a bare issue number inspects that ticket without
  picking it. Precedence: implement → triage → wayfinder → handoff. Implement takes *stranded*
  tickets first (`in-progress`, an open pull request, no worktree on this machine: a run whose
  supervisor died between CI rounds), then the oldest open `ready-for-agent` issue with no open
  native blocker and no open pull request on an `agent/<n>-` branch. It prints the route, the body,
  the comments, open blockers, any open pull request, whether it is takeable, and the claim
  commands when it is.
- **Claim** (rule 22). For `/queue`: `npm run queue:claim -- <n> "<title>"` — `.claude/commands/queue.md`'s
  phase A step 4 covers what it does. For `/triage` and `/wayfinder`: the label and comment the picker
  prints, then re-read the issue (rule 25) and stand down if an older claim is there. The comment
  reads exactly ``Claimed by `<branch>`.`` — the loop parses that shape.
- **Release** (rules 26 and 28). Closing the issue ends the claim. Otherwise remove `in-progress`
  — always when relabelling `ready-for-human`. A leftover `in-progress` hides the ticket from the
  picker for good.
- **Stale claim**: `in-progress`, and the branch in the claim comment has no worktree
  (`git worktree list`) and no open pull request. Say so on the issue, remove `in-progress`, then
  claim it.
- **Abandoned branch**: an `agent/<n>-<slug>` branch on origin, in no worktree, with no open pull
  request — residue of a run that ended without landing. `claim.mjs` builds the next worktree on
  top of a branch of the same name, so either resume it or delete it
  (`git push origin --delete <branch>`), and say which on the issue.

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Set to `yes` if this repo treats external PRs as feature
requests; `/triage` reads this flag.)_

When `yes`, PRs run through the same labels and states, with the `gh pr` equivalents: read with
the rule 25 shape on `gh pr view` plus `gh pr diff <n>`; list with
`gh pr list --state open --json number,title,body,labels,author,authorAssociation,comments`,
keeping only `authorAssociation` of `CONTRIBUTOR`, `FIRST_TIME_CONTRIBUTOR` or `NONE`. Issues and
PRs share one number space: resolve a bare `#42` with `gh pr view 42`, falling back to
`gh issue view 42`.

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
- **Name the checks in two slots: the loop, and the gate.** `docs/agents/RULES.md` rules 3 to 5
  leave the slow suites to the agent's judgement, and you have read the change coming; it has not.

  ```markdown
  ## Checks

  While iterating: `node --test tests/ui-rules/flightPhysics.test.ts`
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
- **Scope the ticket to an area, not to a list.** The queue fixes what it meets in the files and
  the defect class the ticket names, and adds a box for each (`queue.md` phase C). So
  `## Not this ticket` names only work another issue owns or a decision not yet made — never a
  same-area defect.
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
- **40–80 lines.** Longer is a spec, not a ticket: split it and let the blocking edges carry the
  order.
- **One `size:*` label is a promise about the diff**, not about the reading. A ticket whose body
  needs a research detour is not `size:S`, however small the edit turns out to be.

## Wayfinding operations

Used by `/wayfinder`. The **map** is one issue labelled `wayfinder:map`, holding the Notes /
Decisions-so-far / Fog body; its **children** are the tickets.

- **Child**: a GitHub sub-issue of the map (recipe above), labelled `wayfinder:<type>`
  (`research` / `prototype` / `grilling` / `task`).
- **Blocking**: native issue dependencies (recipe above). A child is unblocked when every blocker
  is closed.
- **Frontier**: the map's open children with no open blocker, no `in-progress` and no assignee;
  first in map order wins. The picker's wayfinder route does not apply that filter itself — `/wayfinder` does.
- **Claim**: as in *Picking and claiming* — the `in-progress` label and a claim comment, never an
  assignee.
- **Resolve**: comment the answer, close the child, then append a context pointer (gist + link)
  to the map's Decisions-so-far.
