# Issue tracker: GitHub

Issues and specs for this repo live as GitHub issues. Use the `gh` CLI for all operations.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> --comments`, filtering comments by `jq` and also fetching labels.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Labels**: `needs-triage` / `needs-info` / `ready-for-agent` / `ready-for-human` / `rejected`,
  `size:XS`…`size:XL`, and `in-progress` (see *Claiming an item*).
- **Close**: `gh issue close <number> --comment "..."`

Infer the repo from `git remote -v`; `gh` does this automatically when run inside a clone.

## Claiming an item

Sessions run in parallel against one repo, and every one of them authenticates as the same
GitHub account — so `--add-assignee @me` cannot tell two sessions apart. The branch name
can, and that is what the claim carries.

- **The free queue** — the listing every session picks from:
  `gh issue list --label ready-for-agent --state open --search "-label:in-progress" --json number,title,labels`
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

An agent working the queue gets the issue body and nothing else. It cannot ask a follow-up
question. So the body is the whole specification, and the test of a good one is that a
competent stranger could land the change without guessing.

Six sections, in this order. Drop any that would be empty — an empty heading is noise.

```markdown
## Question            ← or "The defect" / "The opportunity". One sentence: what is being decided or fixed.
## Why this exists     ← 2-4 lines. Quote the reporter verbatim where their words exist.
## Ground truth        ← a table of `file.ts:line` pointers and prior issues. "Read before anything else."
## What to settle      ← `- [ ]` checkboxes, one per sub-decision. Empty tables to fill in beat prose.
## Constraints         ← `> [!IMPORTANT]` — the invariants this change can break, and how.
## Definition of done  ← `- [ ]` per artefact. What must exist for this to close.
## Not this ticket     ← the adjacent work it will be tempting to absorb, with issue numbers.
```

What makes the difference in practice:

- **Point at code, not at concepts.** `components/GameTable.tsx:827` costs the agent one
  `sed`; "the sound preloading" costs it a search and a guess.
- **Name the invariant *and* its enforcement.** "`CARD_W` is declared once, and
  `tests/gameTableModel.test.ts` source-scans for a second declaration" tells an agent both
  what not to do and what will catch it.
- **Checkboxes over prose.** They render as progress on the issue, and an agent can report
  against them. A wall of paragraphs makes partial completion invisible.
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
## Wayfinding operations

Used by `/wayfinder`. The **map** is a single issue with **child** issues as tickets.

- **Map**: a single issue labelled `wayfinder:map`, holding the Notes / Decisions-so-far / Fog body. `gh issue create --label wayfinder:map`.
- **Child ticket**: an issue linked to the map as a GitHub sub-issue (`gh api` on the sub-issues endpoint). Where sub-issues aren't enabled, add the child to a task list in the map body and put `Part of #<map>` at the top of the child body. Labels: `wayfinder:<type>` (`research`/`prototype`/`grilling`/`task`). Once claimed, the ticket is assigned to the driving dev.
- **Blocking**: GitHub's **native issue dependencies**, the canonical, UI-visible representation. Add an edge with `gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`, where `<blocker-db-id>` is the blocker's numeric **database id** (`gh api repos/<owner>/<repo>/issues/<n> --jq .id`, _not_ the `#number` or `node_id`). GitHub reports `issue_dependencies_summary.blocked_by` (open blockers only, the live gate). Where dependencies aren't available, fall back to a `Blocked by: #<n>, #<n>` line at the top of the child body. A ticket is unblocked when every blocker is closed.
- **Frontier query**: list the map's open children (`gh issue list --state open`, scoped to the map's sub-issues / task list), drop any with an open blocker (`issue_dependencies_summary.blocked_by > 0`, or an open issue in the `Blocked by` line) or an assignee; first in map order wins.
- **Claim**: as in *Claiming an item* above — `--add-label in-progress` plus a claim comment naming the branch. Assignee cannot disambiguate two sessions, because every session authenticates as the same account.
- **Resolve**: `gh issue comment <n> --body "<answer>"`, then `gh issue close <n>`, then append a context pointer (gist + link) to the map's Decisions-so-far.
