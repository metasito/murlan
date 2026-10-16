# Weekly drift audit (design, not built)

The phase D review (`.claude/agents/loop-review.md`) reads one change, so it blocks a breach of
`docs/agents/RULES.md` 47–49 inside that change. It cannot see two merges that each add one copy
of a decision, or a copy merged outside the loop. This routine reads the week's merges together
to catch that, and files at most three tickets. It proposes; the owner promotes (rule 33).

## Shape

- **Trigger.** A cloud routine, Monday 06:00 Europe/Zurich, on `metasito/murlan` at `origin/main`.
  Cloud, so it never competes with the loop for this machine's memory (rule 37). Not created
  until the owner approves the schedule.
- **Input: last week's merges only.** `git log --first-parent --merges --since="7 days ago"
  origin/main`, and for each merge `M`, `git diff M^1 M`. Callers and owners a diff names are
  read on demand; no whole-repo sweep (`/audit` is that, and it is run by hand).
- **One reviewer**, opus at `medium` (rule 29), no subagents. Its question: does any merged diff,
  alone or together with another one from the week, breach rule 47, 48 or 49? Each finding names
  file:line for both copies or for the owner, the merges involved, and why the per-change review
  could not see it (cross-merge, merged outside the loop, or a miss).
- **Dedupe before filing.** Drop a finding an open issue already covers (`gh issue list --state
  open`, map #1650's sub-issues included). A finding on a file an open #1650 child
  is redesigning is dropped, since that child deletes the copies.
- **Output.** At most three issues, ranked by how many call sites the drift spans, each labelled
  `ready-for-human` plus `size:*`, never `wayfinder:*` and never attached to a map. Findings past
  three go as one comment on the open `noticed` issue. A run with nothing to file says so in that
  comment, so silence is never a pass.
- **The floor (rule 49).** A week with merges whose run reads zero diffs fails loudly instead of
  reporting clean. Before the schedule goes live, one run over the week before 2026-10-16 must
  re-find at least one drift the design audit found there; until it does, the routine is not
  trusted.
- **Feedback.** When a ticket's "why missed" is *a miss*, the ticket also proposes the
  `.claude/agents/loop-review.md` line that would have caught it; when it is *cross-merge*, it
  proposes a mechanical check instead, since no per-change review can.

## Cost

Unmeasured. One opus reviewer over a week's diffs; measure the first run before quoting a figure.

## Proposed schedule, for the owner

Weekly, Monday 06:00 Europe/Zurich, starting the Monday after the dry run above re-finds a
known drift. Approve and the trigger is created with `/schedule`; nothing runs until then.
