---
description: Work one ticket, then exit — tools/loop/queue-loop.mjs starts the next process
argument-hint: "[issue-number]"
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, Task, Skill, SlashCommand, TodoWrite
model: opus
---

Read `docs/agents/RULES.md` now: it is the ruleset, cited here by number, and wins where this
procedure disagrees (fix this file then). One ticket at a time, one ticket per process:
`tools/loop/queue-loop.mjs` spawns `/queue <n>` and starts the next process when this one exits.
No run state is stored: `node tools/loop/loop-status.mjs` derives it from git and the tracker.

## In every phase

- **Report the phase** on a line of its own, in the same message as that phase's first command —
  each section's `PHASE <letter>` line — or as `echo "PHASE <letter>" &&` at the head of that
  command. Never send it alone: in print mode a turn that ends in text and no tool call is the
  final answer.
- **Never stall.** Answerable from the repo: look it up, or test it. A default exists in RULES.md,
  `CLAUDE.md`, an ADR or a ticket comment: follow it. Only the owner can decide: comment the
  option space on the issue (what each option costs), park it, declare, and **exit**. Never ask
  the user a question while a run is live.

  ```sh
  gh issue edit <n> --remove-label ready-for-agent --remove-label in-progress --add-label ready-for-human
  ```

  Then declare, as text:

  ```
  LOOP-RESULT {"ticket":<n>,"stoodDown":true,"why":"<one sentence>"}
  ```
- **The turn budget** is `$LOOP_TURNS`. Past two thirds with nothing committed, commit what works
  and narrow the slice.
- **On the context notice**, commit, post `HANDOFF <sha>` first-line on the issue
  (`gh issue comment <n> --body-file <file>`): steps left as `- [ ] …`, then `Read first:` file
  ranges. Declare `handoff` = your phase; its `"why"` is the next process's brief, in one sentence.
- **After a compaction** the `SessionStart` hook reruns `tools/loop/loop-status.mjs`. Preserve
  **failing test output** through it.
- **Scratch files go under `.loop-logs/`**, never outside the repo (rule 32).
- **Only an `agent:check` run passes the Bash tool its maximum `timeout`**: the default is shorter
  than the check.

## A — Start

1. **Is a run live?** In a loop process (`$LOOP_TURNS` is set), your first command is
   `loop-status.mjs`, sent before any `PHASE` line. Elsewhere the `SessionStart` hook's report is
   above; do not run `node tools/loop/loop-status.mjs` again, except with no hook report or when
   your own commit, fetch or claim made it stale.
   - **It names a phase**: a ticket is mid-run. Resume there, as its report says; do not re-plan,
     re-scope or **run the picker**.
   - **It names G**: the head is pushed and CI is the supervisor's. Declare and exit, touching
     nothing:
     ```
     LOOP-RESULT {"ticket":<n>,"phase":"G"}
     ```
   - **Silent**: no live worktree. Go on to step 2.
2. **Pick.**

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
   this ticket means it is claimed: `git fetch origin --quiet`, rebuild the worktree with
   `git worktree add -B agent/<n>-<slug> .worktrees/agent-<n> origin/agent/<n>-<slug>`, then
   resume where `loop-status.mjs` says. Work only in `.worktrees/agent-<n>`.
5. **You work the ticket you were given.** If it turns out wrong (a lost claim race, a false
   premise, a blocker in a comment), say so on the issue, remove `in-progress`, declare
   `stoodDown` and **exit**. Never pick another.
6. **The Definition of done is the body's `## Definition of done`**, as later comments amend it;
   phase F is judged against it. With none checkable, park it (**Never stall**).

## B — Scope

`PHASE B`

1. One `sonnet` subagent at `medium` effort maps the change. Its prompt starts with the output of
   `node tools/loop/brief.mjs scope <n> .worktrees/agent-<n>`, verbatim.
2. No file is out of scope. If the report names the schema, socket protocol, deploy runtime
   contract or a workflow, the PR body says what getting it wrong costs.

## C — Build

`PHASE C`

Build with `mattpocock-skills:tdd`; a bug goes through `mattpocock-skills:diagnosing-bugs` first.
Inside this loop those two outrank any general process skill.

### A fix round

Phase C is a fix round when `loop-status.mjs` says `fix round`. Skip the planning.

1. **Read the thread's `CI-RED` and any `FIX-NOTES` comments first**, with rule 25's command.
2. **Run the command the `CI-RED` comment carries and read the failure itself.** Where it states
   how many files are red, a round that diagnosed fewer has not finished; where none parses, the
   step's own output is the count. With no `CI-RED` comment, use `.loop-logs/ci-<n>.log`, else CI:
   ```sh
   gh run list --branch agent/<n>-<slug> --limit 1 --json databaseId --jq '.[0].databaseId' \
     | xargs -I{} gh run view {} --log-failed
   ```
3. The `CI-RED` comment's `on main:` line names the failures main's own latest CI run has too.
   They are not this diff's: fix their root cause here in a commit of its own, naming main's run
   in `FIX-NOTES`. `none` means every failure is this diff's.
4. Fix what CI named, then run `npm run agent:check`.
5. Commit, then post what this round ruled out, each hypothesis on one line with its evidence:
   `gh issue comment <n> --body-file <file>`, first line `FIX-NOTES <sha>` (`git rev-parse --short
   HEAD`). Then leave through **Leaving C**.

### How to work

- **Read ranges, not files.** Read the ranges phase B or the newest `HANDOFF` named. A question
  spanning files, a long log or a file you will not edit goes to one `sonnet` subagent that
  answers in a few lines. A failing check: its summary first, then only the failure you fix.
- **Watch the check fail first, for the reason you claim** (rule 6).
- **A native timing budget is judged only from CI's run**: time a file locally at most once; shrink
  or split one `test:native:related` marks at risk before D.
- **Fix the root cause across every caller.** A diff that describes code is traced here, not in
  phase D (rule 20).
- **A defect in the lines this diff changes is fixed here** (outside a HOLD round): add a
  Definition-of-done box, name it in the PR body. A defect in your own tools, checks or worktree
  is rule 34's. Anything else is not built here. A security, data-loss or player-visible defect gets
  its own issue for the owner, never `ready-for-agent`:
  `gh issue create --title "<what>" --body-file <file> --label ready-for-human`. Anything smaller is
  one comment on the open issue labelled `noticed` (create it with that label if none is open).
- **A ticket's prescribed form is a proposal.** If a test rules it out, build its intent; say
  why in the commit.
- **Commit each slice as you finish it**, by pathspec (rule 11), the message ending in
  `Co-Authored-By: <your model's name> <noreply@anthropic.com>`.

### Leaving C

`git rev-list --count origin/main..HEAD` must be non-zero. Then, in this order:

1. **The completeness check, once per ticket**: skipped when a `DOD-CHECK` follows the issue's
   newest `Claimed by` comment (a HOLD or CI round). One `sonnet` subagent at `medium` effort whose
   prompt starts with the output of this, verbatim:
   ```sh
   node tools/loop/brief.mjs completeness <n> .worktrees/agent-<n>
   ```
   Build what it reports partial or missing, failing test first; post what you leave as
   `FIX-NOTES <sha>` under `Completeness left:`. Where wrong, check the code, not memory.
2. Then commit the last slice, and run `npm run agent:check`.
3. Post the Definition of done ticked against this head, first line `DOD-CHECK <sha>`
   (`git rev-parse --short HEAD`), then every box:
   `- [x] <box> — <path>:<line> · <test path>:<line> · red: <its failure line before the fix>`.
   A box you cannot close stays `- [ ]` with why: keep building or park it (**Never stall**).
4. `node tools/loop/loop-gate.mjs --build` must exit 0. It prints what is missing.

Only then declare handoff D and exit. The supervisor re-gates it.

```
LOOP-RESULT {"ticket":<n>,"branch":"agent/<n>-slug","phase":"C","handoff":"D","why":"<what-is-left>"}
```

## D — Review

`PHASE D`

One reviewer reads the change; only a Blocking finding sends it back. `<base>` is `origin/main` in
round 1, then the sha the previous round reviewed.

1. **Dispatch one `opus` reviewer at `medium` effort**, labelled `Review #<n> round <k>`, its prompt
   starting with this output verbatim. A `CI-RED` newer than the last `VERDICT: LAND <landSha>` makes
   it a fix round: the `fix` kind, labelled `Fix review #<n>`, based on `<landSha>`. A later round appends the previous round's
   Blocking findings.
   ```sh
   node tools/loop/brief.mjs review <n> .worktrees/agent-<n> <base>
   node tools/loop/brief.mjs fix <n> .worktrees/agent-<n> <landSha>     # a fix round
   ```
2. **Then wait for CI** with `node tools/loop/await-run.mjs --pr=<pr> <run-id>`; the verdict needs
   both. A red this change caused is Blocking; one it did not may be rerun once, the verdict
   naming the test and attempt.
   ```sh
   gh run list --branch agent/<n>-<slug> --commit <full sha> --limit 1 --json databaseId,conclusion
   gh run view <databaseId> --log-failed | tail -40
   ```
3. **Post the report** as one comment, first line naming the head it read (`REVIEW <sha> fix`
   in a fix round, which the cap does not count):
   ```
   REVIEW <sha>
   ## Blocking
   ## Nits
   ## Pre-existing
   ```
4. **Post the verdict** as its own comment, first line `VERDICT: LAND <sha>`
   (`git rev-parse --short HEAD`), through `gh issue comment <n> --body-file <file>`.
   LAND when the report has no Blocking finding and CI is green on this head, or its only red is
   one already rerun once and named; otherwise
   `VERDICT: HOLD <sha> — <one sentence>`. A HOLD is final for its head (`loop-derive.mjs`
   `verdictFor`). Never write the report yourself (rule 29). Nits go in the PR body, unfixed. Where you disagree with a Blocking finding, put one line in the commit body.

**Rounds.** After a `HOLD`, run `node tools/loop/loop-gate.mjs --review-round` first. At the cap it
exits non-zero: fix nothing, say on the issue which Blocking finding is still open, and stand down.

**A round is a process.** Otherwise say `PHASE C`, fix exactly the Blocking findings (no
sweep for siblings, no nits) and list each in `FIX-NOTES`, then leave through **Leaving C**. A
product decision goes to the owner (**Never stall**), never into `FIX-NOTES`.
A failure only a local run showed, which neither the review nor CI named, is ruled out (rule 37)
and named in `FIX-NOTES`. Then hand off:

```
LOOP-RESULT {"ticket":<n>,"branch":"agent/<n>-slug","phase":"D","handoff":"D","why":"<what-is-left>"}
```

After a `LAND`, go straight on to phase E and F in this process.

## E — Land

`PHASE E`

Phase D's LAND continues here; a process starts at E only to resume.

1. From the shared checkout, `node tools/loop/loop-gate.mjs`. **A non-zero exit means redo that
   phase under its `PHASE` line, never push past it.**
2. In the worktree — it judges the tree it is invoked from — `npm run agent:check`. Say its
   headline and any `NOT run` suites in the PR body. **If it is red, hand off to C**. Never push a
   red check or re-run it hoping for a different answer.
   ```
   LOOP-RESULT {"ticket":<n>,"branch":"agent/<n>-slug","phase":"E","handoff":"C","why":"<what-is-red>"}
   ```
3. Push and write the PR body: `git push -u origin agent/<n>-<slug>`, then
   `gh pr edit <pr> --body-file <file>`. The supervisor opened the pull request as a draft when
   review started; only if none is open,
   `gh pr create --base main --head agent/<n>-<slug> --title "<title>" --body-file <file>`. Never
   mark it ready: the supervisor does, once CI is green on a head a `VERDICT: LAND` covers. The
   body says what changed, how you know, which Definition-of-done boxes are closed, and
   `Closes #<n>` (rule 13), through `--body-file`, never `--body` (`docs/agents/checks.md`).

CI and the merge are `tools/loop/queue-loop.mjs`'s; a red CI run comes back as a fix round.

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

## Halt

Queue empty · route `handoff` · `queue:pre` red · an owner decision parking cannot carry. Release
the claim, declare `stoodDown`, and say on the issue: the phase reached, what is committed where,
the exact failure, and the one decision needed. `.loop-stop` is the supervisor's.

## Output

Phase F step 4's `LOOP-RESULT` line is the last thing you emit, and the only summary you write.
