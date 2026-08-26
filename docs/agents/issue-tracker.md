# Issue tracker: GitHub

Issues and specs for this repo live as GitHub issues. Use the `gh` CLI for all operations.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> --comments`, filtering comments by `jq` and also fetching labels.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Labels**: `needs-triage` / `needs-info` / `ready-for-agent` / `ready-for-human` / `rejected`,
  `size:XS`…`size:XL`, `in-progress` (see *Claiming an item*), and `blocked`.
- **`blocked`** is for an item that is ready and approved but cannot be verified or landed
  until something external returns — a dead CI, an unreleased dependency. It sits *alongside*
  `ready-for-agent`, never instead of it: that label often carries a decision the owner has
  already made, and removing it to stop the picker routing there throws the decision away.
  `scripts/next-ticket.mjs` skips a `blocked` item the same way it skips `in-progress`. Take
  the label off when the dependency returns, and say so on the issue.
- **Close**: `gh issue close <number> --comment "..."`

Infer the repo from `git remote -v`; `gh` does this automatically when run inside a clone.

## Claiming an item

The standard way to work a ticket the picker routes to implement is **`/ticket`** — bare for one
item, `/ticket loop` to keep taking them until told to stop. It calls
`Workflow({ scriptPath: '.claude/workflows/ticket-pipeline.mjs' })`; the `name` form does not
resolve, because that registry does not read the project's `.claude/workflows/`. The picker's
other two routes have entry points of their own — `/triage` and `/wayfinder` — which work the
procedures below rather than replacing them. It claims,
gates, implements — reviewing its own diff with `/code-review --fix` before pushing — reads
`ci.yml`'s verdict, fixes a red run, lands and tears down. Everything below describes what it
does, and stays the instruction for anything worked by hand.

Sessions run in parallel against one repo, and every one of them authenticates as the same
GitHub account — so `--add-assignee @me` cannot tell two sessions apart. The branch name
can, and that is what the claim carries.

- **Pick** — `node scripts/next-ticket.mjs` (`--all` lists the frontier in pick
  order; a bare issue number inspects that ticket without picking it).
  The script encodes the precedence itself — implement the unblocked `ready-for-agent`
  frontier (native blockers applied, smallest `size:*` first) → triage → wayfinder →
  handoff — and prints the routed ticket's body, comments, blocker identities and its
  claim commands, so one call hands a session everything it needs. The claim is the
  `in-progress` label; a claim comment naming a branch that still lives on origin also
  removes a ticket from the frontier (the lost-label backstop). It is the single
  picker; do not re-derive a queue per session, and do not encode blocking anywhere
  but GitHub's dependency graph.
- **Execute the route through its command** — `/ticket`, `/triage` or `/wayfinder`, each
  taking `loop`. `/triage` and `/wayfinder` run `mattpocock-skills:triage` and
  `mattpocock-skills:wayfinder`, which own their procedures; the command files carry
  only what is specific to this repo.
  `mattpocock-skills:implement` is **not** among them: it is marked
  `disable-model-invocation`, so no agent can call it, and its "run the full test suite
  once at the end" contradicts this repo's rule that `ci.yml` owns the sweep. The
  implement stage spells its own workflow out instead — read the whole issue, write its
  Definition of done out as a checklist, build test-first, `/code-review --fix` the diff,
  then check the boxes against the code actually written.
- **Claim**, as the session's first write, before the branch and before reading the code:
  ```sh
  gh issue edit <n> --add-label in-progress
  gh issue comment <n> --body "Claimed by \`<branch-name>\`."
  ```
- **Confirm you won the race**: `gh issue view <n> --comments`. Labelling is not atomic, and
  two sessions can list the same free queue a second apart. If a claim comment predates
  yours, `gh issue edit <n> --remove-label in-progress`, comment that you are standing down,
  and take the next item.
- **Release**: `gh issue close` ends the claim with the issue. Otherwise
  `gh issue edit <n> --remove-label in-progress` — always when relabelling `ready-for-human`,
  and whenever you stop without landing the work. An `in-progress` label left behind is an
  item nobody will pick up.
- **Stale claim**: the branch named in the claim comment is in neither
  `git ls-remote --heads origin` nor `git worktree list`. Say so on the issue, then claim it.
- **Abandoned branch**: on origin, in no worktree, with **no open pull request**. A run that
  ended without landing leaves one, and it is residue rather than a claim — say so, delete it
  (`git push origin --delete <branch>`), then take the ticket. Left alone it satisfies the
  staleness test above and the ticket can never be picked up again; #294 refused every run for
  exactly this reason.

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Set to `yes` if this repo treats external PRs as feature requests; `/triage` reads this flag.)_

When set to `yes`, PRs run through the same labels and states as issues, using the `gh pr` equivalents:

- **Read a PR**: `gh pr view <number> --comments` and `gh pr diff <number>` for the diff.
- **List external PRs for triage**: `gh pr list --state open --json number,title,body,labels,author,authorAssociation,comments` then keep only `authorAssociation` of `CONTRIBUTOR`, `FIRST_TIME_CONTRIBUTOR`, or `NONE` (drop `OWNER`/`MEMBER`/`COLLABORATOR`).
- **Comment / label / close**: `gh pr comment`, `gh pr edit --add-label`/`--remove-label`, `gh pr close`.

GitHub shares one number space across issues and PRs, so a bare `#42` may be either: resolve with `gh pr view 42` and fall back to `gh issue view 42`.

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`.


## Writing an issue body an agent can execute

An agent working the queue cannot ask a follow-up question, so the issue is the whole
specification and the test of a good one is that a competent stranger could land the change
without guessing.

**The comments are part of it.** An owner's ruling, a decision a triage pass settled, a trap
found later — all of those arrive as comments, and the body is often the state of the question
before any of them. Read with `--comments` and treat a later ruling as overriding the body.

The design gate reads them apart, and the difference matters when you write one. A recorded
decision counts from either. Everything else — an open box under "What to settle", whether the
ticket weighs a dependency — is read from the **body only**, because the gate comments on the
issues it escalates, and reading its own notice back turned #278 into a loop that escalated on
its own words. So write the body to stand alone: a decision that changes the work is worth
folding back into it, and a decision left only in a comment will not move any gate but that one.

Eight sections, in this order. Drop any that would be empty — an empty heading is noise.

```markdown
## Question            ← or "The defect" / "The opportunity". One sentence: what is being decided or fixed.
## Why this exists     ← 2-4 lines. Quote the reporter verbatim where their words exist.
## Ground truth        ← a table of `file.ts:line` pointers and prior issues. "Read before anything else."
## What to settle      ← `- [ ]` checkboxes, one per sub-decision. Empty tables to fill in beat prose.
## Constraints         ← `> [!IMPORTANT]` — the invariants this change can break, and how.
## Definition of done  ← `- [ ]` per artefact. What must exist for this to close.
## Checks              ← what to run while iterating, and what to run once before pushing.
## Not this ticket     ← the adjacent work it will be tempting to absorb, with issue numbers.
```

What makes the difference in practice:

- **Point at code, not at concepts.** `components/GameTable.tsx:827` costs the agent one
  `sed`; "the sound preloading" costs it a search and a guess.
- **Name the invariant *and* its enforcement.** "`CARD_W` is declared once, and
  `tests/gameTableModel.test.ts` source-scans for a second declaration" tells an agent both
  what not to do and what will catch it.
- **Name the checks in two slots: the loop, and the gate.** `docs/agents/RULES.md` rules 3 to 5
  leave the slow suites to the agent, and an agent judging in the dark reads `loops.md`, hunts
  for a spec, probes for Docker, and then runs the two-minute native suite against a two-line
  diff. You have read the change coming; it has not. So write:

  ```markdown
  ## Checks

  While iterating: `node --test tests/gameTableModel.test.ts`
  Once before pushing: `npm run agent:check`
  Not `npm run test:native`: react-test-renderer never runs flexbox, so it cannot see this.
  ```

  **Never put a rebuilding command in the loop slot.** A Playwright spec is nine minutes and a
  full Metro rebuild for any change outside `tests/e2e/` — named as the loop, it becomes the
  loop: #349 ran one seven times, which was two thirds of that ticket's wall clock. A browser
  check belongs in the gate slot, bounded to red-once and green-once, with CI carrying the rest.
- **Checkboxes over prose.** They render as progress on the issue, and an agent can report
  against them. A wall of paragraphs makes partial completion invisible.
- **An open box under `## What to settle` means the ticket is not `ready-for-agent`.** That
  label promises the decisions are made; an unchecked box says they are not, and an agent that
  meets both builds on whichever reading it picked. Settle them and write the answers down, or
  label it `ready-for-human` and leave them open. The design gate escalates a ticket carrying
  both, so the contradiction costs a claim rather than a diff.
- **An empty table is an instruction.** Giving the columns of a decision to be made
  (`Event | Visual | Sound | Haptic | Fallback`) specifies the shape of the answer far more
  cheaply than describing it.
- **`> [!IMPORTANT]` and `> [!WARNING]` are load-bearing**, not decoration — they survive
  skimming, and constraints are what get skimmed past.
- **State what is out of scope.** Scope creep in an autonomous queue is the failure mode,
  because nobody is watching the diff grow.
- **Cite the source.** A research file path or the issue that surfaced it, so the next reader
- **Point at `CLAUDE.md`, don't copy it.** It is already in the agent's context every turn, so restating an invariant in the body pays tokens to say nothing and creates a second copy that goes stale. Write only the part that is *not* discoverable: how this particular change collides with that invariant.
- **Make the done-condition checkable and exhaustive.** "Every modified locale accounted for" forces the work; "update the locales" does not. A vague bound invites stopping early, with attention already on the next ticket.
- **Prompt the positive.** "Bound every query" lands; "don't write unbounded queries" drags the unbounded query into context and makes it more available. Keep prohibitions for hard guardrails, and pair them with the target.
  can check the claim instead of re-deriving it.

Verify the body's own claims before filing. An issue that asserts a defect at a line that
does not contain it sends an agent down a hole with no way out.

### Write it for cheap consumption

The body is read by an agent that pays for every token and cannot ask a follow-up. Two
failure modes cost the same: too little, and it explores; too much, and it skims past the
part that mattered. Both are avoidable.

- **Give the values, not a description of them.** `radius 14*s, no border, label Rajdhani 700
  12*s .16em uppercase` is one line an agent implements from. "Rounded, bevelled, with a
  letterspaced label" is three lines it has to go and resolve. Numbers, tokens and selectors
  are the cheapest thing you can write.
- **Front-load the pointers.** Ground truth first, prose second. An agent that has
  `file.ts:line` in the first ten lines never runs the search.
- **Link the primary source; never paraphrase it.** A prototype URL, an ADR, a spec. A
  paraphrase is a second copy that goes stale, and the agent still has to open the original.
  Say which part of it to read.
- **40–80 lines.** Longer is a spec, not a ticket — split it and let the blocking edges carry
  the order.
- **One `size:*` label is a promise about the diff**, not about the reading. A ticket whose
  body needs a research detour is not `size:S`, however small the edit turns out to be.
## Wayfinding operations

Used by `/wayfinder`. The **map** is a single issue with **child** issues as tickets.

- **Map**: a single issue labelled `wayfinder:map`, holding the Notes / Decisions-so-far / Fog body. `gh issue create --label wayfinder:map`.
- **Child ticket**: an issue linked to the map as a GitHub sub-issue (`gh api` on the sub-issues endpoint). Where sub-issues aren't enabled, add the child to a task list in the map body and put `Part of #<map>` at the top of the child body. Labels: `wayfinder:<type>` (`research`/`prototype`/`grilling`/`task`). Once claimed, the ticket is assigned to the driving dev.
- **Blocking**: GitHub's **native issue dependencies**, the canonical, UI-visible representation. Add an edge with `gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`, where `<blocker-db-id>` is the blocker's numeric **database id** (`gh api repos/<owner>/<repo>/issues/<n> --jq .id`, _not_ the `#number` or `node_id`). GitHub reports `issue_dependencies_summary.blocked_by` (open blockers only, the live gate). Where dependencies aren't available, fall back to a `Blocked by: #<n>, #<n>` line at the top of the child body. A ticket is unblocked when every blocker is closed.
- **Frontier query**: list the map's open children (`gh issue list --state open`, scoped to the map's sub-issues / task list), drop any with an open blocker (`issue_dependencies_summary.blocked_by > 0`, or an open issue in the `Blocked by` line) or an assignee; first in map order wins.
- **Claim**: as in *Claiming an item* above — `--add-label in-progress` plus a claim comment naming the branch. Assignee cannot disambiguate two sessions, because every session authenticates as the same account.
- **Resolve**: `gh issue comment <n> --body "<answer>"`, then `gh issue close <n>`, then append a context pointer (gist + link) to the map's Decisions-so-far.
