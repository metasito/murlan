---
description: Work one ticket, then exit — tools/loop/queue-loop.mjs starts the next process
argument-hint: "[issue-number]"
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, Task, Skill, SlashCommand, TodoWrite
model: opus
---

The only loop protocol in this repo. `docs/agents/RULES.md` is the ruleset; this file is the
procedure. Where they disagree, RULES.md wins and this file is stale — fix it.

One ticket at a time, one ticket per process: `tools/loop/queue-loop.mjs` starts the next process
when this one exits. Nothing about the run is written down: git knows the branch and the commits,
the tracker knows the ticket and the review, and `node tools/loop/loop-status.mjs` computes where
the run stands from those two. The branch name `agent/<n>-<slug>` binds the work to its ticket.

## Never stall

- **Answerable from the repo** — look it up, or test it.
- **A default exists** in `docs/agents/RULES.md`, `CLAUDE.md`, an ADR or a ticket comment — follow
  it. (`docs/RULES.md` is the card game's spec, not the agent ruleset.)
- **Only the owner can decide** — comment the option space on the issue (what each option costs),
  then park it:
  ```sh
  gh issue edit <n> --remove-label ready-for-agent --remove-label in-progress --add-label ready-for-human
  ```
  and declare it and **exit** — `LOOP-RESULT {"ticket":<n>,"stoodDown":true,"why":"<one sentence>"}`.

Never ask the user a question while a run is live.

---

## A — Start

Say which phase you are in, on a line of its own, in the same message as that phase's first command:

`PHASE A`

The supervisor reads that line and nothing else about your progress. Never send it alone: in print
mode a turn that ends in text and no tool call is the final answer. Do the same in every phase.

**Run this first, every time:**

```sh
node tools/loop/loop-status.mjs
```

Silent means no live worktree — continue below. Anything else means a ticket is mid-run: resume at
the phase it names, do not re-plan or re-scope, and **do not run the picker**. Uncommitted changes
in that worktree are your in-progress slice; finish it.

If it names **G**, the head is pushed and CI is the supervisor's. Declare it and exit, touching
nothing:

```
LOOP-RESULT {"ticket":<n>,"phase":"G"}
```

Only once `loop-status.mjs` is silent:

```sh
npm run queue:pre                         # by-hand runs only: the loop has already run it
node tools/loop/next-ticket.mjs $ARGUMENTS   # prints ROUTE, body, comments, blockers, takeability
```

If that output shows an open pull request on this ticket, it is already claimed and its Definition
of done is posted. Do not claim it again; rebuild the worktree:

```sh
git fetch origin --quiet
git worktree add -B agent/<n>-<slug> .worktrees/agent-<n> origin/agent/<n>-<slug>
```

If it was blocked on a shared issue that is now closed — its last `CI-RED`'s `shared:` line names
another branch's `#<m>` — main has that fix and this branch does not. Merge it in first:

```sh
git -C .worktrees/agent-<n> merge --no-edit origin/main
```

Then resume where `node tools/loop/loop-status.mjs` says.

If `queue:pre` fails, **halt**. `$ARGUMENTS` is the ticket the supervisor passed; a bare `/queue`
picks from the live queue.

**You work the ticket you were given.** If it turns out wrong — a lost claim race, a false premise,
a blocker named in a comment — say so on the issue, remove your label, declare `stoodDown` and
**exit**. Never pick another.

Route `triage` runs `/triage`; `wayfinder` runs `/wayfinder`; `handoff` goes to **Halt**. Only
`implement` continues here.

The picker's output is the whole ticket. **A later comment overrides the body.**

`tools/loop/claim.mjs` has already claimed it and made the worktree; work only there. A by-hand
`/queue` claims with `npm run queue:claim -- <n> "<title>"`.

**Post the ticket's Definition of done as a comment on the issue, now, before any code.** It is
what phase F is judged against. A ticket with no checkable Definition of done is not a ticket — park
it.

## B — Scope

`PHASE B`

One subagent (`sonnet`), so the codebase never enters this context:

> Investigate issue #N in the worktree `.worktrees/agent-N`. Report: which files the change has to
> touch, existing patterns worth reusing, the risks, and whether the ticket makes sense at all. If
> it is ambiguous, its premise is wrong, or the codebase already does it, say so plainly. Around 30
> lines. Do not spawn any subagent, and do not run `npm run agent:check`.

No file is out of scope; if the recon names the schema, the socket protocol, `.replit` or a
workflow, say in the PR body what it costs to get wrong.

## C — Build

`PHASE C`

`mattpocock-skills:tdd`. A bug goes through `mattpocock-skills:diagnosing-bugs` first. Inside this
loop those two outrank any general process skill.

**A fix round** is phase C when `loop-status.mjs` says `fix round`. Skip the planning. **Read the
thread's `CI-RED` and any `FIX-NOTES` comments first**, so this round does not reopen ruled-out
ground. Only with no `CI-RED` comment, fall back to `.loop-logs/ci-<n>.log`, else CI itself:

```sh
gh run list --branch agent/<n>-<slug> --limit 1 --json databaseId --jq '.[0].databaseId' \
  | xargs -I{} gh run view {} --log-failed
```

The `CI-RED` comment's `shared:` line says whether the failure is red elsewhere too:
`#<m> owned here` means this branch owns shared issue #<m> — fix its root cause in this diff and put
`Closes #<m>` in the PR body beside `Closes #<n>` (the PR exists: phase E edits its body). Any other `#<m>` is another branch's to fix; do
not re-investigate it.

Fix what CI named, then run the suite it named as well as the usual check:

```sh
npm run agent:check -- --also test        # or loop:test, test:native, comments
```

Before handing off, post what this round ruled out, at most 15 lines, each hypothesis and its
evidence:

```sh
gh issue comment <n> --body-file <file>   # first line: FIX-NOTES <sha>
```

`<sha>` is `git rev-parse --short HEAD`, taken after the fix is committed.

How to solve it is yours. What constrains the process:

- **Watch the check fail first, for the reason you claim.**
- **Fix the root cause across every caller.**
- **A diff that describes code is traced here, not in phase D** (rule 20).
- **Scope grows to what you find in its area**: fix it in this diff, add a Definition-of-done box,
  name it in the PR body. File only what needs an owner decision, lives in an untouched subsystem,
  or would not fit the turn budget:
  `gh issue create --title "<what>" --body-file <file> --label <label> --label size:<size>` —
  `ready-for-agent` when its Definition of done has no open box, `ready-for-human` only when it
  needs an account, a device, a design or a policy call. If it cannot start until this lands:

  ```sh
  gh api -X POST repos/{owner}/{repo}/issues/<new>/dependencies/blocked_by \
    -F issue_id="$(gh api repos/{owner}/{repo}/issues/<this> --jq .id)"   # the database id, not #<this>
  ```
- **A ticket's prescribed form is a proposal.** If a test rules it out, build its intent and say
  why in the commit.
- **Commit each slice as you finish it**, by pathspec.
- **Batch what does not depend on the last answer.**

**You have a turn budget**, `$LOOP_TURNS`, and it ends the session wherever it stands, with no
chance to commit. Past two thirds of it with nothing committed, commit what works and narrow the
slice.

**On the context notice, commit and declare `handoff` = your phase.** A fresh process resumes
from git with none of this conversation.

Before leaving C, `git rev-list --count origin/main..HEAD` must be non-zero. Then, in this order:
commit the last slice; run `npm run agent:check`; run `node tools/loop/loop-gate.mjs --build`,
which must exit 0; only then declare handoff D and exit. The supervisor sends a handoff with no
local pass on a clean HEAD back to C.

```
LOOP-RESULT {"ticket":<n>,"branch":"agent/<n>-slug","phase":"C","handoff":"D"}
```

Phase D runs in a fresh process. Do not review your own build here.

## D — Review

`PHASE D`

`mattpocock-skills:code-review`. Round 1's fixed point is `origin/main`; every later round's is the
sha the previous round reviewed — that delta, plus the findings it left open.

**A fix round's review is sized to the fix.** A `CI-RED` comment newer than the last
`VERDICT: LAND <landSha>` makes this a fix round. Run:

```sh
node tools/loop/loop-gate.mjs --fix-delta <landSha>
```

If its `lines` is at most 80: one `sonnet` reviewer, given that delta and the `CI-RED` comment, with
both briefs below, and no refuter. Its comment's first line is `REVIEW <sha> fix`, still with both
headings. Otherwise, the full review below.

The full review: two fresh `sonnet` subagents (rule 29's independent reviewers), each given the diff
and nothing else — never your reasoning:

- **Standards** — sources: `docs/agents/RULES.md` plus the skill's Fowler smell baseline (paste it
  in full). Report only what affects correctness or breaks a documented rule, by number, quoted.
  Skip what tooling enforces. Around 15 lines.
- **Spec** — source: issue #N's body and comments. Report requirements missing or partial,
  behaviour not asked for, and anything implemented but wrong, quoting the issue. Around 15 lines.

**When the diff changes a contract** — what a function promises beyond its types — name it in the
Spec brief: `The diff changes this promise: <old> → <new>. Find every caller that still assumes the
old one, and every test that would pass either way.`

Both: `Do not spawn any subagent. Report findings only — what checked out is not reported. Every
finding names a file:line and either the rule number it breaks, a quoted line of the issue, or the
input that makes it go wrong. A finding carrying none of those three is a note, and notes are not
reported.`

Then one more `sonnet` subagent, given both reports and the same diff, and nothing else:

> For each finding below, try to kill it. A finding survives only if you can state the input or the
> sequence that makes the code wrong, or quote the rule or the issue line it breaks. Answer with the
> surviving findings and one sentence each on what killed the rest. Do not spawn any subagent, and
> do not review the diff for anything the reports did not raise.

Post both reports as one comment, unmerged, first line naming the head they read:

```
REVIEW <sha>

## Standards
...
## Spec
...
```

`loop-gate.mjs` refuses a `VERDICT: LAND` for a head with no `REVIEW` comment behind it. Each round
posts its own comment for its own head.

Then read them yourself and post the verdict as its own comment, where `<sha>` is
`git rev-parse --short HEAD`:

```sh
gh issue comment <n> --body-file <file>   # first line: VERDICT: LAND <sha>
```

or `VERDICT: HOLD <sha> — <one sentence>`. HOLD on any hard Standards violation or any missing or
wrong Spec finding; a baseline smell alone is a note. A commit after a verdict makes it stop
counting.

Before each round after the first:

```sh
node tools/loop/loop-gate.mjs --review-round
```

It exits non-zero at the cap. **Stop before the cap when a round earns nothing**: a round raising no
finding the previous one did not already raise ends the review, and you post `VERDICT: LAND`.

At the cap, do not park for that alone. Fix any actual blocker (breaks behaviour, loses data, a
security hole) without spending a round; for the rest, post your own `VERDICT: LAND <sha>` naming
what you accept and why, and say it in phase F's Definition-of-done comment. Park only for a
decision only the owner can make. Where you disagree with a finding, one line in the commit body.

**A round is a process.** After a `HOLD`, fix what it named, commit, and hand off:

```
LOOP-RESULT {"ticket":<n>,"branch":"agent/<n>-slug","phase":"D","handoff":"D"}
```

After a `LAND`, hand off the same way with `"handoff":"E"`.

## E — Land

`PHASE E`

```sh
node tools/loop/loop-gate.mjs
```

Run it from the shared checkout; it finds the worktree itself. It refuses the push when the branch
has no commits or an empty diff against `origin/main`, or when no `VERDICT: LAND <sha>` names the
commit you are pushing. A `HOLD` on a commit is final for that commit. **A non-zero exit means redo
that phase, never push past it**; exit 2 means it could not judge.

```sh
npm run agent:check       # in the worktree — it judges the tree it is invoked from
```

Read its verdict line: it names the tree and the base. Its headline is `LOCAL PASS` and it prints
how many suites it did not run; say both in the PR body.

**If it is red, do not fix it here.** Hand off to C, which fixes it and goes round again through D:

```
LOOP-RESULT {"ticket":<n>,"branch":"agent/<n>-slug","phase":"E","handoff":"C"}
```

Never push a red check, and never re-run it hoping for a different answer.

```sh
git push -u origin agent/<n>-<slug>
gh pr create --base main --head agent/<n>-<slug> --title "<title>" --body-file <file>
```

On a fix round the pull request already exists: skip `gh pr create`, push, and rewrite its body
with `gh pr edit <pr> --body-file <file>` when it changed (a new `Closes #<m>`).

The body says what changed, how you know, and which Definition-of-done boxes are closed. `Closes #<n>`
goes in the **body**, never in a commit message. Write the file with the Write tool or a bash
heredoc, never PowerShell's `Set-Content`.

CI and the merge are `tools/loop/queue-loop.mjs`'s. A red CI run comes back as a fix round at phase
C, with the log in a `CI-RED` comment and in `.loop-logs/ci-<n>.log`.

## F — Close out

`PHASE F`

1. Re-read the issue, body and thread in one read (rule 25):

   ```sh
   gh issue view <n> --json title,body,comments --jq '.title, .body, (.comments[]|"--- "+.author.login+": "+.body)'
   ```

2. Tick the Definition of done against the code actually written, as a comment. A box you did not
   close is named there, with why.
3. In that comment, one line on the effective diff in plain language.
   **Leave your worktree standing**; the supervisor removes it once the ticket lands or parks.
   `git -C .worktrees/agent-<n> status --short` should print nothing — commit and push anything it
   names, or say on the issue what it is.

4. **Say what you did, on one line, as the last thing you emit.**

   ```
   LOOP-RESULT {"ticket":891,"branch":"agent/891-slug","pr":1003,"phase":"F","stoodDown":false}
   ```

   Valid JSON after the marker, in the same message as any command. Omit `pr` only if you pushed
   none. `stoodDown` is true when you gave the ticket up, and then `"why"` says which in one
   sentence. Phase F never sets `handoff`. **This is not optional**: a session that exits without it
   is recorded as an error. Emit it even when the news is bad.

5. **Exit.** Do not loop back to phase A in this session.

## Compaction

After a compaction the `SessionStart` hook reruns `tools/loop/loop-status.mjs`. Preserve one thing
through it: **failing test output**.

## Halt

Queue empty · route `handoff` · preflight red · an owner decision parking cannot carry. Release the
claim, declare `stoodDown`, and say on the issue: the phase reached, what is committed where, the
exact failure, and the one decision needed. `.loop-stop` is read between tickets only.

## Output

Phase F step 4's `LOOP-RESULT` line is the last thing you emit, and the only summary you write.
The supervisor renders the board from it. No other section may claim the final line.

If you catch yourself narrating, invoke `caveman`.
