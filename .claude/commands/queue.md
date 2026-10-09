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
  each section's `PHASE <letter>` line — or as `echo "PHASE <letter>" &&` at the head of that
  command. Never send it alone: in print mode a turn that ends in text and no tool call is the
  final answer.
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
- **The turn budget** is `$LOOP_TURNS`. Past two thirds with nothing committed, commit what works
  and narrow the slice.
- **On the context notice**, commit, post `HANDOFF <sha>` first-line on the issue
  (`gh issue comment <n> --body-file <file>`): steps left as `- [ ] …`, then `Read first:` file
  ranges. Declare `handoff` = your phase.
- **A handoff's `"why"`** is the next process's brief, in one sentence.
- **Scratch files go under `.loop-logs/`**, never outside the repo (rule 32).
- **Only an `agent:check` run passes the Bash tool its maximum `timeout`**: the default is shorter
  than the check.

## A — Start

1. **Is a run live?**
   **In a loop process (`$LOOP_TURNS` is set), your first command is `loop-status.mjs`**, sent
   before any `PHASE` line. Elsewhere the `SessionStart` hook's report is above. Do not run it again,
   except with no hook report or when your own commit, fetch or claim made it stale:

   ```sh
   node tools/loop/loop-status.mjs
   ```

   - **It names a phase**: a ticket is mid-run. Resume there, as its report says; do not re-plan,
     re-scope or **run the picker**.
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
   node tools/loop/next-ticket.mjs $ARGUMENTS
   ```

   `queue:pre` red: **Halt**. `$ARGUMENTS` is the ticket the supervisor passed; a bare `/queue`
   picks from the live queue, and **a later comment overrides the body**.

3. **Route** (rule 27). `triage` runs `/triage`; `wayfinder` runs `/wayfinder`; `handoff` goes to
   **Halt**. Only `implement` continues here.

4. **Claim.** The loop's `tools/loop/claim.mjs` has already claimed it and made the worktree. A
   by-hand run claims with `npm run queue:claim -- <n> "<title>"`. An **open pull request** on
   this ticket means it is claimed: rebuild the worktree, then resume where
   `node tools/loop/loop-status.mjs` says:

   ```sh
   git fetch origin --quiet
   git worktree add -B agent/<n>-<slug> .worktrees/agent-<n> origin/agent/<n>-<slug>
   ```

   Work only in `.worktrees/agent-<n>`.

5. **You work the ticket you were given.** If it turns out wrong (a lost claim race, a false
   premise, a blocker in a comment), say so on the issue, remove `in-progress`, declare
   `stoodDown` and **exit**. Never pick another.

6. **The Definition of done is the body's `## Definition of done`**, as later comments amend it;
   phase F is judged against it. With none checkable, park it (**Never stall**).

Done when the worktree stands and the Definition of done is checkable.

## B — Scope

`PHASE B`

1. One `sonnet` subagent maps the change. Its prompt starts with the output of this, verbatim:

   ```sh
   node tools/loop/brief.mjs scope <n> .worktrees/agent-<n>
   ```

2. **A `size:L` ticket with three or more independent feature groups, or any ticket whose scope
   report names more than 10 files to change in two or more, is split before it is built.** The
   scope report lists the groups. Keep the first group here; file each other group
   as its own ticket, carrying its boxes and any owner ruling word for word:

   ```sh
   gh issue create --title "<group> (split from #<n>)" --body-file <file> --label ready-for-agent --label size:<S|M>
   ```

   Then post a new Definition of done on #<n> naming only the first group's boxes and each child
   ticket; build only that group.

3. No file is out of scope. If the report names the schema, socket protocol, deploy runtime
   contract or a workflow, the PR body says what getting it wrong costs.

Done when the scope report is in hand and any split filed.

## C — Build

`PHASE C`

Build with `mattpocock-skills:tdd`; a bug goes through `mattpocock-skills:diagnosing-bugs` first.
Inside this loop those two outrank any general process skill.

### A fix round

Phase C is a fix round when `loop-status.mjs` says `fix round`. Skip the planning.

1. **Read the thread's `CI-RED` and any `FIX-NOTES` comments first**, with rule 25's command.
2. **Run the command the `CI-RED` comment carries and read the failure itself.** Where it states
   how many files are red, a round that diagnosed fewer has not finished, whatever it fixed;
   where none parses, the step's own output is the count. With no `CI-RED` comment, use `.loop-logs/ci-<n>.log`, else CI itself:

   ```sh
   gh run list --branch agent/<n>-<slug> --limit 1 --json databaseId --jq '.[0].databaseId' \
     | xargs -I{} gh run view {} --log-failed
   ```

3. The `CI-RED` comment's `on main:` line names the failures main's own latest CI run has too.
   They are not this diff's: fix their root cause here in a commit of its own, naming main's run
   in `FIX-NOTES`. `none` means every failure is this diff's.
4. Fix what CI named, then run the suite it named as well as the usual check:

   ```sh
   npm run agent:check -- --also test:native   # or loop:test, comments; `test` always runs
   ```

5. Post what this round ruled out: each hypothesis on one line, with its evidence.
   `<sha>` is `git rev-parse --short HEAD`, taken after committing the fix:

   ```sh
   gh issue comment <n> --body-file <file>   # first line: FIX-NOTES <sha>
   ```

Then leave through **Leaving C**.

### How to work

- **Read ranges, not files.** Read the ranges phase B or the newest `HANDOFF` named. A question
  spanning files, a long log or a file you will not edit goes to one `sonnet` subagent that
  answers in a few lines. A failing check: its summary first, then only the failure you fix.
- **Watch the check fail first, for the reason you claim** (rule 6).
- **A native timing budget is judged only from CI's run**: time a file locally at most once; shrink
  or split one `test:native:related` marks at risk before D.
- **Fix the root cause across every caller.**
- **A diff that describes code is traced here, not in phase D** (rule 20).
- **Scope grows to what you find in its area** (not in a HOLD round): fix it in this diff, add a Definition-of-done box,
  name it in the PR body. File only what needs an owner decision, lies in an untouched subsystem,
  or would not fit the turn budget:
  `gh issue create --title "<what>" --body-file <file> --label <label> --label size:<size>` —
  `ready-for-agent` when its Definition of done has no open box, `ready-for-human` only when it
  needs an account, a device, a design or a policy call. If it cannot start until this lands,
  block it on this ticket with `docs/agents/issue-tracker.md`'s `blocked_by` recipe.
- **A ticket's prescribed form is a proposal.** If a test rules it out, build its intent; say
  why in the commit.
- **Commit each slice as you finish it**, by pathspec (rule 11), the message ending in
  `Co-Authored-By: <your model's name> <noreply@anthropic.com>`.

### Leaving C

`git rev-list --count origin/main..HEAD` must be non-zero. Then, in this order:

1. **The completeness check**: one `sonnet` subagent whose prompt starts with the output of this,
   verbatim:

   ```sh
   node tools/loop/brief.mjs completeness <n> .worktrees/agent-<n>
   ```

   Build what it reports partial or missing, failing test first, then ask once more on the new
   diff: at most twice per process. Post what the second answer still reports as `FIX-NOTES <sha>`
   under `Completeness left:`, and go on. Where wrong, check the code, not memory.
2. Read `git diff origin/main...HEAD` against phase D's two briefs and fix what either would raise.
   This does not replace phase D's review.
3. Then commit the last slice, and run `npm run agent:check`.
4. Post the Definition of done ticked against this head, first line `DOD-CHECK <sha>`
   (`git rev-parse --short HEAD`), then every box:
   `- [x] <box> — <path>:<line> · <test path>:<line> · red: <its failure line before the fix>`.
   A box you cannot close stays `- [ ]` with why: the ticket is not done, so keep building or park it (**Never stall**).
5. `node tools/loop/loop-gate.mjs --build` must exit 0. It prints what is missing.

Only then declare handoff D and exit. The supervisor re-gates it and opens a draft pull request,
so CI runs while D reviews.

```
LOOP-RESULT {"ticket":<n>,"branch":"agent/<n>-slug","phase":"C","handoff":"D","why":"<what-is-left>"}
```

## D — Review

`PHASE D`

The review is `mattpocock-skills:code-review`'s two axes. `<base>` is
`origin/main` in round 1, then the sha the previous round reviewed.

1. **Size the round.** A `CI-RED` comment newer than the last `VERDICT: LAND <landSha>` makes this
   a fix round. Run:

   ```sh
   node tools/loop/loop-gate.mjs --fix-delta <landSha>
   ```

   If its `lines` is at most 80: one `sonnet` reviewer, no refuter, whose prompt starts with the
   output of this, verbatim. Its comment's first line is `REVIEW <sha> fix`, still with both
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

4. **CI has been running on this head since the handoff**; if it already failed, that is a finding:

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
   device job, an open question; wait with `node tools/loop/await-run.mjs <run-id>…`) before the
   verdict; HOLD only for what needs a commit: a HOLD is final for its head (`loop-derive.mjs`
   `verdictFor`). Never write a round's review yourself (rule 29); only the cap's LAND has no new
   review. Where you disagree with a finding, put one line in the commit body.

**Rounds.** Before each later round, run `node tools/loop/loop-gate.mjs --review-round`;
it exits non-zero at the cap, with guidance. **Stop before the cap when a round earns nothing**: a
round raising nothing new ends the review with `VERDICT: LAND`. At the cap, fix any actual blocker
without spending a round; for the rest, follow its guidance and say what you accepted in phase
F's Definition-of-done comment. Park only for a decision only the owner can make.

**A round is a process.** After a `HOLD`, say `PHASE C`, fix what it named, then leave through
phase C's steps 1–5. A failure only a local run showed, which neither the review nor CI named,
is not the round's to fix: rule it out (rule 37), file what survives (rule 35), name it in `FIX-NOTES`.
Then hand off:

```
LOOP-RESULT {"ticket":<n>,"branch":"agent/<n>-slug","phase":"D","handoff":"D","why":"<what-is-left>"}
```

After a `LAND`, go straight on to phase E and F in this process.

## E — Land

`PHASE E`

Phase D's LAND continues here; a process starts at E only to resume.

1. From the shared checkout:

   ```sh
   node tools/loop/loop-gate.mjs
   ```

   **A non-zero exit means redo that phase under its `PHASE` line, never push past it.**

2. In the worktree — it judges the tree it is invoked from:

   ```sh
   npm run agent:check
   ```

   Say its headline and any `NOT run` suites in the PR body. **If it is red, hand off to C**.
   Never push a red check or re-run it hoping
   for a different answer.

   ```
   LOOP-RESULT {"ticket":<n>,"branch":"agent/<n>-slug","phase":"E","handoff":"C","why":"<what-is-red>"}
   ```

3. Push and write the PR body:

   ```sh
   git push -u origin agent/<n>-<slug>
   gh pr edit <pr> --body-file <file>
   ```

   The supervisor opened the pull request as a draft when review started; only if none is open,
   `gh pr create --base main --head agent/<n>-<slug> --title "<title>" --body-file <file>`. Never
   mark it ready: the supervisor does, once CI is green on a head a `VERDICT: LAND` covers.

   The body says what changed, how you know, which Definition-of-done boxes are closed, and
   `Closes #<n>` (rule 13), through `--body-file`, never `--body` (`docs/agents/checks.md`).

CI and the merge are `tools/loop/queue-loop.mjs`'s. A red CI run comes back as a fix round at phase
C, with the log in a `CI-RED` comment and in `.loop-logs/ci-<n>.log`.

## F — Close out

`PHASE F`

1. Re-read the issue and its thread (rule 25's command).
2. Comment the Definition of done ticked against the code actually written, naming each box you
   did not close and why, plus one plain line on the effective diff.
3. **Leave your worktree standing**; the supervisor removes it once the ticket ends.
   `git -C .worktrees/agent-<n> status --short` should print nothing; commit and push what it
   names, or explain it on the issue.
4. **Say what you did, on one line, as the last thing you emit.**

   ```
   LOOP-RESULT {"ticket":891,"branch":"agent/891-slug","pr":1003,"phase":"F","stoodDown":false}
   ```

   Valid JSON after the marker, in the same message as any command. Omit `pr` only if you pushed
   none. Verification-only work posts its DOD-CHECK, runs `gh issue close <n> --reason completed`
   and omits `pr`: it is recorded closed. Commits with no pull request park. `stoodDown` means
   you gave the ticket up, with `"why"` in one sentence. Phase F never sets `handoff`. Exiting
   without it records an error: emit it even on bad news.
5. **Exit.** Never loop back to phase A.

## Compaction

After a compaction the `SessionStart` hook reruns `tools/loop/loop-status.mjs`. Preserve
**failing test output** through it.

## Halt

Queue empty · route `handoff` · `queue:pre` red · an owner decision parking cannot carry. Release
the claim, declare `stoodDown`, and say on the issue: the phase reached, what is committed where,
the exact failure, and the one decision needed. `.loop-stop` is the supervisor's.

## Output

Phase F step 4's `LOOP-RESULT` line is the last thing you emit, and the only summary you write.
