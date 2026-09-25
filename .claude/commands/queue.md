---
description: Work one ticket, then exit — tools/loop/queue-loop.mjs starts the next process
argument-hint: "[issue-number]"
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, Task, Skill, SlashCommand, TodoWrite
model: opus
---

Read `docs/agents/RULES.md` now — this file cites it by number.

The only loop protocol in this repo. `docs/agents/RULES.md` is the ruleset; this file is the
procedure. Where they disagree, RULES.md wins and this file is stale — fix it.

One ticket at a time, one ticket per process: `tools/loop/queue-loop.mjs` spawns `/queue <n>` and
starts the next process when this one exits. No run state is stored: `node tools/loop/loop-status.mjs`
derives it from git and the tracker.

## In every phase

- **Report the phase** on a line of its own, in the same message as that phase's first command —
  the `PHASE <letter>` line at the top of each section below. Never send it alone: in print mode a
  turn that ends in text and no tool call is the final answer.
- **Never stall.** Answerable from the repo: look it up, or test it. A default exists in
  `docs/agents/RULES.md`, `CLAUDE.md`, an ADR or a ticket comment: follow it. Only the owner can decide:
  comment the option space on the issue (what each option costs), park it, declare, and **exit**:

  ```sh
  gh issue edit <n> --remove-label ready-for-agent --remove-label in-progress --add-label ready-for-human
  ```

  ```
  LOOP-RESULT {"ticket":<n>,"stoodDown":true,"why":"<one sentence>"}
  ```

  Never ask the user a question while a run is live.
- **The turn budget** is `$LOOP_TURNS`. Past two thirds of it with nothing committed, commit what
  works and narrow the slice.
- **On the context notice**, commit and declare `handoff` = your phase.
- **Only an `agent:check` run passes the Bash tool its maximum `timeout`**: the default is shorter
  than the check.

## A — Start

1. **Is a run live?**
   **In a loop process (`$LOOP_TURNS` is set), your first command is `loop-status.mjs`**, sent
   before any `PHASE` line. Elsewhere the `SessionStart` hook has already run it and its report is
   above. Do not run it again, except when there is no hook report, or when your own commit, fetch
   or claim has made that report stale:

   ```sh
   node tools/loop/loop-status.mjs
   ```

   - **It names a phase**: a ticket is mid-run. Resume at that phase, as its report says; do not
     re-plan or re-scope, and **do not run the picker**.
   - **It names G**: the head is pushed and CI is the supervisor's. Declare and exit, touching
     nothing:

     ```
     LOOP-RESULT {"ticket":<n>,"phase":"G"}
     ```

   - **Silent**: no live worktree. Go on to step 2.

2. **Pick.** Say which phase you are in:

   `PHASE A`

   ```sh
   npm run queue:pre                            # by-hand runs only: the loop has already run it
   node tools/loop/next-ticket.mjs $ARGUMENTS   # prints ROUTE, body, comments, blockers, takeability
   ```

   `queue:pre` red: **Halt**. `$ARGUMENTS` is the ticket the supervisor passed; a bare `/queue`
   picks from the live queue, and **a later comment overrides the body**.

3. **Route** (rule 27). `triage` runs `/triage`; `wayfinder` runs `/wayfinder`; `handoff` goes to
   **Halt**. Only `implement` continues here.

4. **Claim.** The loop's `tools/loop/claim.mjs` has already claimed it and made the worktree. A
   by-hand run claims with `npm run queue:claim -- <n> "<title>"`. If the picker shows an **open
   pull request** on this ticket, it is already claimed: do not claim it again. Rebuild the
   worktree, then resume where `node tools/loop/loop-status.mjs` says:

   ```sh
   git fetch origin --quiet
   git worktree add -B agent/<n>-<slug> .worktrees/agent-<n> origin/agent/<n>-<slug>
   ```

   Work only in `.worktrees/agent-<n>`.

5. **You work the ticket you were given.** If it turns out wrong — a lost claim race, a false
   premise, a blocker named in a comment — say so on the issue, remove `in-progress`, declare
   `stoodDown` and **exit**. Never pick another.

6. **The Definition of done is the body's `## Definition of done`**, as later comments amend it;
   phase F is judged against it. A ticket with no checkable Definition of done is not a ticket:
   park it (**Never stall**).

Done when the worktree stands and the Definition of done is checkable.

## B — Scope

`PHASE B`

1. One `sonnet` subagent maps the change. Its prompt starts with the output of this, verbatim:

   ```sh
   node tools/loop/brief.mjs scope <n> .worktrees/agent-<n>
   ```

2. **A `size:L` ticket with three or more independent feature groups is split before it is
   built.** The scope report lists the groups. Keep the first group here; file each other group
   as its own ticket, carrying its boxes and any owner ruling word for word:

   ```sh
   gh issue create --title "<group> (split from #<n>)" --body-file <file> --label ready-for-agent --label size:<S|M>
   ```

   Then post a new Definition of done on #<n> naming only the first group's boxes and each child
   ticket, and build only that group.

3. No file is out of scope. If the report names the schema, the socket protocol, the deploy
   runtime contract or a workflow, the PR body says what it costs to get wrong.

Done when the scope report is in hand and any split is filed.

## C — Build

`PHASE C`

Build with `mattpocock-skills:tdd`; a bug goes through `mattpocock-skills:diagnosing-bugs` first.
Inside this loop those two outrank any general process skill. How to solve it is yours.

### A fix round

Phase C is a fix round when `loop-status.mjs` says `fix round`. Skip the planning.

1. **Read the thread's `CI-RED` and any `FIX-NOTES` comments first.**
2. **Run the command the `CI-RED` comment carries and read the failure itself.** Where it states
   how many files are red, a round that has diagnosed fewer than that number has not finished,
   whatever it has fixed; where none parses, the step's own output is the count. A cheap subagent
   may do the reading and return the list. With no `CI-RED` comment, fall back to
   `.loop-logs/ci-<n>.log`, else CI itself:

   ```sh
   gh run list --branch agent/<n>-<slug> --limit 1 --json databaseId --jq '.[0].databaseId' \
     | xargs -I{} gh run view {} --log-failed
   ```

3. The `CI-RED` comment's `on main:` line names the failures main's own latest CI run has too.
   They did not come from this diff: fix their root cause here in a commit of its own, and name
   main's run in `FIX-NOTES`. `none` means every failure is this diff's.
4. Fix what CI named, then run the suite it named as well as the usual check:

   ```sh
   npm run agent:check -- --also test:native   # or loop:test, comments; `test` always runs
   ```

5. Post what this round ruled out, at most 15 lines, each hypothesis and its evidence.
   `<sha>` is `git rev-parse --short HEAD`, taken after the fix is committed:

   ```sh
   gh issue comment <n> --body-file <file>   # first line: FIX-NOTES <sha>
   ```

Then leave through **Leaving C**.

### How to work

- **Read ranges, not files.** Read the ranges phase B named. A question spanning files ("where is
  X used", "how does Y flow"), a long log or a file you will not edit goes to one `sonnet`
  subagent that answers in a few lines. A failing check: its summary first, then only the failure
  you are fixing.
- **Watch the check fail first, for the reason you claim** (rule 6).
- **Fix the root cause across every caller.**
- **A diff that describes code is traced here, not in phase D** (rule 20).
- **Scope grows to what you find in its area**: fix it in this diff, add a Definition-of-done box,
  name it in the PR body. File only what needs an owner decision, lives in an untouched subsystem,
  or would not fit the turn budget:
  `gh issue create --title "<what>" --body-file <file> --label <label> --label size:<size>` —
  `ready-for-agent` when its Definition of done has no open box, `ready-for-human` only when it
  needs an account, a device, a design or a policy call. If it cannot start until this lands,
  block it on this ticket with `docs/agents/issue-tracker.md`'s `blocked_by` recipe.
- **A ticket's prescribed form is a proposal.** If a test rules it out, build its intent and say
  why in the commit.
- **Commit each slice as you finish it**, by pathspec (rule 11), the message ending in
  `Co-Authored-By: <your model's name> <noreply@anthropic.com>`.
- **Batch what does not depend on the last answer.**

### Leaving C

`git rev-list --count origin/main..HEAD` must be non-zero. Then, in this order:

1. **The completeness check**: one `sonnet` subagent whose prompt starts with the output of this,
   verbatim:

   ```sh
   node tools/loop/brief.mjs completeness <n> .worktrees/agent-<n>
   ```

   Build what it reports partial or missing, with the failing test first, and ask it again on the
   new diff until it reports nothing. Where wrong, check the code, not memory.
2. Read `git diff origin/main...HEAD` against phase D's two briefs and fix what either would raise.
   This does not replace phase D's review.
3. Then commit the last slice, and run `npm run agent:check`.
4. Post the Definition of done ticked against this head, first line `DOD-CHECK <sha>`
   (`git rev-parse --short HEAD`), then every box:
   `- [x] <box> — <path>:<line> · <test path>:<line>`. A box you cannot close stays `- [ ]` with why,
   and then the ticket is not done: keep building, or park it (**Never stall**).
5. `node tools/loop/loop-gate.mjs --build` must exit 0. It prints what is missing.

Only then declare handoff D and exit. The supervisor re-gates it: a failing one goes back to C, a
passing one becomes a draft pull request so CI runs while D reviews.

```
LOOP-RESULT {"ticket":<n>,"branch":"agent/<n>-slug","phase":"C","handoff":"D"}
```

## D — Review

`PHASE D`

The review is `mattpocock-skills:code-review`'s two axes. `<base>` is
`origin/main` in round 1; every later round's is the sha the previous round reviewed.

1. **Size the round.** A `CI-RED` comment newer than the last `VERDICT: LAND <landSha>` makes this
   a fix round. Run:

   ```sh
   node tools/loop/loop-gate.mjs --fix-delta <landSha>
   ```

   If its `lines` is at most 80: one `sonnet` reviewer whose prompt starts with the output of this,
   verbatim, with no refuter. Its comment's first line is `REVIEW <sha> fix`, still with both
   headings. Skip to step 3.

   ```sh
   node tools/loop/brief.mjs fix <n> .worktrees/agent-<n> <landSha>
   ```

2. **The full review**: two fresh `sonnet` subagents, dispatched in one message, each whose prompt
   starts with the output of one of these, verbatim:

   ```sh
   node tools/loop/brief.mjs standards <n> .worktrees/agent-<n> <base>
   node tools/loop/brief.mjs spec <n> .worktrees/agent-<n> <base>
   ```

   **When the diff changes a contract** — what a function promises beyond its types — append this
   to the Spec brief: `The diff changes this promise: <old> → <new>. Find every caller that still
   assumes the old one, and every test that would pass either way.`

   Then a `sonnet` refuter, given both reports, whose prompt starts with the output of this,
   verbatim:

   ```sh
   node tools/loop/brief.mjs refute <n> .worktrees/agent-<n> <base>
   ```

3. **Post the reports** as one comment, unmerged, first line naming the head they read.

   ```
   REVIEW <sha>

   ## Standards
   ...
   ## Spec
   ...
   ```

4. **CI has run on this head since the handoff**; a failure is a finding too:

   ```sh
   gh run list --branch agent/<n>-<slug> --commit <full sha> --limit 1 --json databaseId,conclusion
   gh run view <databaseId> --log-failed | tail -40       # if failure
   ```

5. **Post the verdict** as its own comment, after reading the reports yourself. `<sha>` is
   `git rev-parse --short HEAD`:

   ```sh
   gh issue comment <n> --body-file <file>   # first line: VERDICT: LAND <sha>
   ```

   or `VERDICT: HOLD <sha> — <one sentence>`. HOLD on any hard Standards violation or any missing
   or wrong Spec finding; a baseline smell alone is a note. Close evidence gaps (an unrun CI or
   device job, an open question) before the verdict; HOLD only for what needs a commit: a HOLD is
   final for its head (`loop-derive.mjs` `verdictFor`). Never write a round's review yourself
   (rule 29); only the cap's LAND has no new review. Where you disagree with a finding, one line
   in the commit body.

**Rounds.** Before each later round, run `node tools/loop/loop-gate.mjs --review-round`;
it exits non-zero at the cap, with guidance. **Stop before the cap when a round earns nothing**: a
round raising nothing new ends the review with `VERDICT: LAND`. At the cap, fix any actual blocker without spending a round; for the
rest, follow its printed guidance and say what you accepted in phase F's Definition-of-done
comment. Park only for a decision only the owner can make.

**A round is a process.** After a `HOLD`, say `PHASE C`, fix what it named, then leave through
phase C's steps 1–5, and hand off:

```
LOOP-RESULT {"ticket":<n>,"branch":"agent/<n>-slug","phase":"D","handoff":"D"}
```

After a `LAND`, go straight on to phase E and F in this process.

## E — Land

`PHASE E`

Phase D's LAND continues here; a process starts at E only when resuming one.

1. From the shared checkout (it finds the worktree itself):

   ```sh
   node tools/loop/loop-gate.mjs
   ```

   **A non-zero exit means redo that phase under its `PHASE` line, never push past it**; it prints
   why.

2. In the worktree — it judges the tree it is invoked from:

   ```sh
   npm run agent:check
   ```

   Say its headline and any `NOT run` suites in the PR body. **If it is red, hand off to C**,
   which fixes it and goes round again through D. Never push a red check, and never re-run it
   hoping for a different answer.

   ```
   LOOP-RESULT {"ticket":<n>,"branch":"agent/<n>-slug","phase":"E","handoff":"C"}
   ```

3. Push and write the PR body:

   ```sh
   git push -u origin agent/<n>-<slug>                  # no-op if already pushed
   gh pr edit <pr> --body-file <file>
   ```

   The supervisor opened the pull request as a draft when review started; only if none is open,
   `gh pr create --base main --head agent/<n>-<slug> --title "<title>" --body-file <file>`. Never
   mark it ready: the supervisor does, once CI is green on a head a `VERDICT: LAND` covers.

   The body says what changed, how you know, which Definition-of-done boxes are closed, and
   `Closes #<n>` (rule 13). Write the file with the Write tool or a bash heredoc, never an inline
   `--body` (`docs/agents/checks.md`).

CI and the merge are `tools/loop/queue-loop.mjs`'s. A red CI run comes back as a fix round at phase
C, with the log in a `CI-RED` comment and in `.loop-logs/ci-<n>.log`.

## F — Close out

`PHASE F`

1. Re-read the issue, body and thread in one read (rule 25's command).
2. Tick the Definition of done against the code actually written, as a comment. A box you did not
   close is named there, with why. In that comment, one line on the effective diff in plain
   language.
3. **Leave your worktree standing**; the supervisor removes it once the ticket lands or parks.
   `git -C .worktrees/agent-<n> status --short` should print nothing — commit and push anything it
   names, or say on the issue what it is.
4. **Say what you did, on one line, as the last thing you emit.**

   ```
   LOOP-RESULT {"ticket":891,"branch":"agent/891-slug","pr":1003,"phase":"F","stoodDown":false}
   ```

   Valid JSON after the marker, in the same message as any command. Omit `pr` only if you pushed
   none. `stoodDown` is true when you gave the ticket up, and then `"why"` says which in one
   sentence. Phase F never sets `handoff`. A session that exits without it is recorded as an
   error, so emit it even when the news is bad.
5. **Exit.** Do not loop back to phase A in this session.

## Compaction

After a compaction the `SessionStart` hook reruns `tools/loop/loop-status.mjs`. Preserve one thing
through it: **failing test output**.

## Halt

Queue empty · route `handoff` · `queue:pre` red · an owner decision parking cannot carry. Release
the claim, declare `stoodDown`, and say on the issue: the phase reached, what is committed where,
the exact failure, and the one decision needed. `.loop-stop` is the supervisor's.

## Output

Phase F step 4's `LOOP-RESULT` line is the last thing you emit, and the only summary you write.
The supervisor renders the board from it. No other section may claim the final line.
