---
description: Work the ticket queue autonomously, one ticket at a time
argument-hint: "[max-tickets]"
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, Task, Skill, SlashCommand, TodoWrite
model: opus
---

The only loop protocol in this repo. `docs/agents/RULES.md` is the ruleset; this file is the
procedure. Where they disagree, RULES.md wins and this file is stale — fix it.

The run state is the single truth. Rewrite it at every phase transition, before doing the next
thing. Nothing you remember counts; only what is on disk.

It lives at `<git-common-dir>/loop/STATE.md` — outside the working tree, and shared by the main
checkout and every worktree. `node scripts/loop-state.mjs` is not run directly; `scripts/loop-gate.mjs`
and `scripts/loop-brief.mjs` both resolve it, so you never hardcode the path. It is deliberately
untracked: a tracked state file is rewritten into a dirty tree, and phase 0's preflight refuses to
start a run on one.

## Recovery — read this first, every time

If the state says `status: RUNNING`, you are mid-run. Do not re-plan, do not re-scope, do
not ask whether to continue.

1. Read the state and the lessons — `node scripts/loop-brief.mjs` prints both.
2. Work in the worktree it names. `git log --oneline origin/main..HEAD` there is what the run
   has actually done — trust it over any summary of it.
3. Resume at the phase it names. Never restart a ticket.
4. An empty line under **Evidence** means that phase did not finish. Redo that phase, not the ticket.

Uncommitted changes in the worktree are your in-progress slice. Finish it; do not start over.

## Never stall

Three cases, and they are all of them:

- **Answerable from the repo** — look it up, or test it.
- **A default exists** in `docs/agents/RULES.md`, `CLAUDE.md`, an ADR or a ticket comment — follow
  it. (`docs/RULES.md` is the card game's spec, not the agent ruleset.)
- **Only the owner can decide** — comment the option space on the issue (what each option
  costs, not a bare question), then park it:
  ```sh
  gh issue edit <n> --remove-label ready-for-agent --remove-label in-progress --add-label ready-for-human
  ```
  then take the next ticket. The issue is the record; there is no parked-findings file.

Never ask the user a question while `status: RUNNING`.

---

## Phase 0 — Bootstrap (once per run)

```sh
node scripts/prune-worktrees.mjs      # a killed run never reached its own teardown
node scripts/preflight.mjs            # refuses to start on someone else's uncommitted work
node -e "import('./scripts/loop-state.mjs').then(m=>console.log(m.initState()))"
node scripts/next-ticket.mjs --all    # the queue, in pick order
```

The third line prints the path of the live state, laying it down from
`.claude/loop/STATE.template.md` if this is a first run. Write to that path, never to the template.

Write the state: `status: RUNNING`, `objective` (one line, never rewritten), `queue`,
`budget: 0/$1` (default 5). If preflight or the picker fails, **halt** — do not work around it.

`queue` is a snapshot for the report and for the handoff, not a work order: phase A picks
again from live tracker state every ticket, because labels and blockers move while the run is
running. Where they differ, the picker is right.

Then run phases A–F per ticket until the budget is spent, the queue is empty, or a stop
condition fires.

## A — Take

**Read the lessons first, every ticket** — `node scripts/loop-brief.mjs` prints them with the state. It is the only thing standing
between this run and repeating the last one's mistakes; written in phase F and never read is
the same as not written.

```sh
node scripts/next-ticket.mjs          # prints ROUTE, body, comments, blockers, takeability
```

Route `triage` runs `/triage`; route `wayfinder` runs `/wayfinder`; route `handoff` means no
agent-takeable work is left — go to **Halt**. Only route `implement` continues here.

That output is already the whole ticket — **body and comments together**, which is why the
picker prints both and you do not fetch them again. The comments are where the owner's ruling
and the answer to the body's own question live, and **a later comment overrides the body**.
Read to the end of the thread before scoping.

Claim it as the first write, before any code:

```sh
gh issue edit <n> --add-label in-progress
gh issue comment <n> --body-file <file>   # the file holds: Claimed by `agent/<n>-<slug>`.
gh issue view <n> --comments              # a fresh read *after* the write — the race check
```

The claim goes through a file, not an inline `--body`. PowerShell eats the backticks around the
branch name — `` `agent/824-x` `` arrives as a BEL character — and `claimBranch()` in
`next-ticket.mjs` matches the claim *by* those backticks. An inline claim is a claim no peer can
see, and it fails silently.

Every session authenticates as the same account, so the branch name is the claim. That last read
is not a repeat of the picker's: it is the only way to see a peer who claimed the same ticket
between the pick and the write. An older claim comment wins — remove your label, say so in one
line, take the next ticket.

```sh
git fetch origin --quiet
git worktree add -b agent/<n>-<slug> .worktrees/agent-<n> origin/main
```

Work only in that worktree. Never change the shared checkout's branch.

**Write the ticket's Definition of done into the state as `dod:`, now, before any code.**
That checklist is the contract and it is what Phase F is judged against. A ticket with no
checkable Definition of done is not a ticket — park it.

## B — Scope

One subagent (`sonnet`), so the codebase never enters this context:

> Investigate issue #N in the worktree `.worktrees/agent-N`. Report only: files to touch,
> existing patterns to reuse, risks, and whether the ticket is ambiguous. Figures and file
> paths, never prose. Max 30 lines. Do not spawn any subagent, and do not run
> `npm run agent:check` — it waits on free memory and then runs a twenty-minute suite, so you
> would stall instead of answering. Phase E is where it runs.

Write its answer to `recon:`.

**Protected paths.** If the recon names a file the loop may not change on its own, park it now
and take the next. `node scripts/loop-gate.mjs` holds the list and refuses the push in phase E
regardless, so going ahead only wastes the build — but parking here saves it. There is no
"unless a decision is recorded" exemption: these are the owner's, recorded or not.

**Design gate — mechanical, not a judgement.** If the work touches more than six files **and**
no decision is recorded in `docs/BRIEF.md`, an ADR, or a comment on the ticket: park it and
take the next.

## C — Build

`mattpocock-skills:tdd`. A bug goes through `mattpocock-skills:diagnosing-bugs` first. Those
two, by those exact names — inside this loop they outrank any general instruction to reach for
a superpowers process skill, which would otherwise answer the same trigger differently each ticket.

- **Watch the check fail first, for the reason you claim.** A check you never saw red is decoration.
- **Fix the root cause across every caller**, not the instance the ticket names.
- Scope is exactly the ticket. A finding outside it is filed as its own issue, never folded into
  the diff: `gh issue create --title "<what>" --body-file <file> --label ready-for-human`.
- A bug three levels under the bug in hand: file it, do not follow it.
- **Commit each slice as you finish it** — `git add -- <paths>`, never `-A`. An unstaged edit
  is the only work this loop can lose.

Before leaving C, `git rev-list --count origin/main..HEAD` must be non-zero. Your account of
what you did is not evidence; git is.

## D — Review

A fresh subagent (`opus`) that did not write the code, given the ticket and the diff and
nothing else — never your reasoning, which is the frame the review exists to escape:

> You did not write this. Read `git diff origin/main...HEAD` in `.worktrees/agent-N`, and
> issue #N. Do not audit files the diff does not touch.
> Report only: correctness bugs; scope creep; a part of the ticket quietly left undone; a new
> test that would still pass on broken code (delete or invert what it guards, and check);
> a comment that narrates history or restates the line below it (`CLAUDE.md`, Comments);
> anything breaking `docs/agents/RULES.md`. Be blunt. Max 25 lines.
> End with exactly one line: `VERDICT: LAND`, or `VERDICT: HOLD — <one sentence>`.
> Do not spawn any subagent, and do not run `npm run agent:check`.

Copy that verdict line into `verdict:` **verbatim** — the gate accepts only the exact string
`VERDICT: LAND`, so a paraphrase reads as a hold. Fix everything real, commit, re-review
once. A second HOLD parks the ticket with both verdicts on the issue.

Where you disagree with a finding, one line in the commit body — never a softened summary of it.

## E — Land

```sh
node scripts/loop-gate.mjs
```

It refuses the push, naming what is wrong, when any of these is true:

- a phase left its Evidence line blank;
- the verdict is anything other than the exact line `VERDICT: LAND` — a hold, a blank, or a
  wording it cannot read is not permission;
- the branch has no commits, or an empty diff, against `origin/main` — git is the evidence, and
  the state file is only the claim;
- the diff touches a protected path.

**A non-zero exit means redo that phase — never the ticket, and never push past it.** Exit 2 means
it could not judge at all (no live run), which is not permission either.

```sh
npm run agent:check
```

Record it in `gate:`, including what it says it skipped — a green line standing for a suite
nobody ran is not a pass.

```sh
git push -u origin agent/<n>-<slug>
gh pr create --base main --head agent/<n>-<slug> --title "<title>" --body-file <file>
```

The body says what changed, how you know, and which Definition-of-done boxes are closed and
which are not. `Closes #<n>` goes in the **body**, never in a commit message — a commit
closes the issue at push time, before CI has said anything. Multi-line `gh` bodies always go
through `--body-file`; an inline `--body` is word-split and mojibaked.

Write that file with the Write tool or a bash heredoc. PowerShell's `Set-Content` defaults to
cp1252 on this machine and mangles every em-dash in it — and the body you are writing is a
paragraph of this repo's prose, which is full of them.

Do not read CI by eye, and never from a command's exit status — `gh pr checks --watch` piped
into anything reports the *pipe's* status, and that is how a red branch once reached main.
Ask the one thing that answers from run data:

```sh
npx tsx lib/loop/ciVerdict.ts metasito/murlan agent/<n>-<slug> <pr>
```

It waits for the run this push started, matches it by `headRefOid` so a fix round cannot read
the previous push's red, filters to `ci.yml` (the branch also carries Maestro and EAS runs
that settle on their own schedule, and a green one of those reads as a green branch), and
returns JSON: `{ pass, runId, failedStep, output, infrastructure, reason }`. Record `ci_run:`.

- `pass: false` — fix on the branch from `output`, push, ask again. Three attempts on the same
  failure, then park with the log.
- `infrastructure: true` — a job completed having run zero steps: billing, a quota, a runner.
  It says nothing about the diff, so ask once more rather than spending a fix round on it.

```sh
npx tsx lib/loop/land.ts metasito/murlan <pr>
```

Merges when the PR is mergeable. `next: "update-branch"` means main moved — run
`gh pr update-branch`, read the verdict again (merging behind runs the whole suite twice),
then land. Anything else stops: park it. Never reach for `--admin` — a merge that needs a
flag to force it is a decision, not a step.

```sh
gh issue edit <n> --remove-label in-progress
```

The PR body closes the issue; nothing takes the label off, and a closed ticket still wearing
`in-progress` reads as a live run.

## F — Close out

1. Re-read the issue — `gh issue view <n> --comments`. A ruling can land while you were building,
   and a ticket answered against its first version is answered against the wrong one.
2. Tick `dod:` against the code actually written. A box you did not close is named on the
   issue, with why. An honest gap is worth more than a green report.
3. One line on the issue: the effective diff in plain language — "the hand fans from the left
   edge", not "edited handLayout.ts".
4. At most one line to the lessons file (`<git-common-dir>/loop/LESSONS.md`), and only a rule that changes future behaviour. Nothing
   the code already tells you. Over 40 lines: merge duplicates, drop what is no longer
   load-bearing.
5. Teardown, in this order — `git worktree remove` walks *into* a Windows junction and empties
   the shared install:
   ```sh
   npm run worktrees:remove -- .worktrees/agent-<n>
   git status --porcelain              # must be empty; if it is not, teardown failed — say so
   ```
6. Point the state at the next ticket, phase A, budget incremented. Continue immediately.

Teardown runs on the parked and stopped paths too. A run that cost forty minutes and stopped
is the one whose record is worth having.

## Compaction

Context is kept flat by delegating: Phase B and Phase D run in subagents whose tool output
never enters this conversation, so a ticket costs roughly what its own diff costs. When
auto-compaction does fire, the `SessionStart` hook re-reads the state and the lessons from
disk. Nothing depends on what survived the summary — read the files and resume at the phase
they name.

When compacting, preserve: the state file verbatim, the current ticket and phase, the worktree
path, and any failing test output. The first three are on disk and recoverable; the failing
output is the one thing that is not.

## Halt

Budget spent · queue empty · route `handoff` · preflight red · three failed CI rounds on the
same failure · a decision only the owner can make **that parking cannot carry**.

Set `status: HALTED` with the reason in `phase_note`, release any claim, run teardown, and
write `<git-common-dir>/loop/HANDOFF.md`: the ticket, the phase reached, what is committed and on
which branch, the exact failure, and the one decision needed. Then five lines to the user.

## Output

Between tickets, exactly one line:

`✅ #<n> <title> — <files> files, <tests> tests, <verdict>`

Prose goes in the handoff file. If you catch yourself narrating, invoke `caveman`.
