---
description: Work one ticket, then exit — scripts/queue-loop.mjs starts the next process
argument-hint: "[issue-number]"
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, Task, Skill, SlashCommand, TodoWrite
model: opus
---

The only loop protocol in this repo. `docs/agents/RULES.md` is the ruleset; this file is the
procedure. Where they disagree, RULES.md wins and this file is stale — fix it.

One ticket at a time, one ticket per process: `scripts/queue-loop.mjs` starts the next process when
this one exits, so working more than one ticket concurrently is not a mode this procedure has.

**Nothing about the run is written down, because nothing needs to be.** Git knows the branch, the
commits and the diff; the tracker knows the ticket, its comments and the review. Every question the
loop asks is answered from those two, so there is no record to keep in sync and none that can go
stale. `node scripts/loop-status.mjs` computes the answer at any moment.

The branch name is the binding: `agent/<n>-<slug>` says which ticket the work belongs to, and git
will not let you be on two at once.

## Never stall

Three cases, and they are all of them:

- **Answerable from the repo** — look it up, or test it.
- **A default exists** in `docs/agents/RULES.md`, `CLAUDE.md`, an ADR or a ticket comment — follow
  it. (`docs/RULES.md` is the card game's spec, not the agent ruleset.)
- **Only the owner can decide** — comment the option space on the issue (what each option costs,
  not a bare question), then park it:
  ```sh
  gh issue edit <n> --remove-label ready-for-agent --remove-label in-progress --add-label ready-for-human
  ```
  then take the next ticket. The issue is the record; there is no parked-findings file.

Never ask the user a question while a run is live.

---

## A — Start

**Run this first, before anything else, every time — including a fresh process that has never seen
this ticket:**

```sh
node scripts/loop-status.mjs
```

Silent means no run is live — continue to the picker below. Anything else means a ticket is already
mid-run: resume at the phase it names, do not re-plan, do not re-scope, do not ask whether to
continue, and **do not run the picker below at all.** A ticket already claimed and mid-build is not
a competing option next to a fresh one — picking a new ticket while this one is unfinished is the
exact one-ticket-at-a-time violation this loop exists to prevent, not a matter of preference between
two takeable tickets. Uncommitted changes in that worktree are your in-progress slice; finish it,
don't start over.

Only once `loop-status.mjs` is silent:

```sh
node scripts/prune-worktrees.mjs          # a killed run never reached its own teardown
node scripts/preflight.mjs                # refuses to start on someone else's uncommitted work
node scripts/next-ticket.mjs $ARGUMENTS   # prints ROUTE, body, comments, blockers, takeability
```

If preflight fails, **halt** — do not work around it. `$ARGUMENTS` is normally empty, which picks
from the live queue. Pass an explicit issue number by hand (`/queue 911`) to inspect or work that
one ticket instead of picking — `next-ticket.mjs` already supports this as its `explicit` branch.

This runs once, for exactly one ticket, then phases B–F carry it to a close. `scripts/queue-loop.mjs`
is what keeps going — it is a fresh `claude -p "/queue"` invocation that starts the next ticket, not
this session continuing. There is no ticket-count budget: nothing survives past phase F for a budget
to protect.

Route `triage` runs `/triage`; route `wayfinder` runs `/wayfinder`; route `handoff` means no
agent-takeable work is left — go to **Halt**. Only route `implement` continues here.

That output is already the whole ticket — **body and comments together**, which is why the picker
prints both and you do not fetch them again. The comments are where the owner's ruling and the
answer to the body's own question live, and **a later comment overrides the body**. Read to the end
of the thread before scoping.

Claim it as the first write, before any code:

```sh
gh issue edit <n> --add-label in-progress
gh issue comment <n> --body-file <file>   # the file holds: Claimed by `agent/<n>-<slug>`.
gh issue view <n> --json title,body,comments --jq '.title, .body, (.comments[]|"--- "+.author.login+": "+.body)'
```

That last line is the race check: a fresh read *after* the write. It is rule 25's form, because
`--comments` prints the thread *instead of* the body and `--json body` alone drops the thread —
either one alone hides half of what decides whether you may take the ticket.

The claim goes through a file, not an inline `--body`. PowerShell eats the backticks around the
branch name — `` `agent/824-x` `` arrives as a BEL character — and `claimBranch()` in
`next-ticket.mjs` matches the claim *by* those backticks. An inline claim is a claim no peer can
see, and it fails silently.

Every session authenticates as the same account, so the branch name is the claim. That last read is
not a repeat of the picker's: it is the only way to see a peer who claimed the same ticket between
the pick and the write. An older claim comment wins — remove your label, say so in one line, take
the next ticket.

```sh
git fetch origin --quiet
git worktree add -b agent/<n>-<slug> .worktrees/agent-<n> origin/main
```

Work only in that worktree. Never change the shared checkout's branch.

**Post the ticket's Definition of done as a comment on the issue, now, before any code.** That
checklist is the contract, it is what phase F is judged against, and on the issue it is visible to
the owner and survives anything that happens to this session. A ticket with no checkable Definition
of done is not a ticket — park it.

## B — Scope

One subagent (`sonnet`), so the codebase never enters this context:

> Investigate issue #N in the worktree `.worktrees/agent-N`. Report: which files the change has to
> touch, existing patterns worth reusing, the risks, and whether the ticket makes sense at all.
>
> Lead with file paths and figures — but if the ticket is ambiguous, or its premise is wrong, or it
> asks for something the codebase already does, say so plainly in a sentence. That is the most
> valuable thing you can come back with, and it is worth more than a tidy list.
>
> Around 30 lines. Do not spawn any subagent, and do not run `npm run agent:check` — it waits on
> free memory and then runs a twenty-minute suite, so you would stall instead of answering. Phase E
> is where it runs.

No file is out of scope, and no file count is. If the recon names the schema, the socket protocol,
`.replit` or a workflow, that is a reason to build it carefully and to say in the PR body what it
costs to get wrong — not a reason to hand it back. The review in phase D is the check.

## C — Build

`mattpocock-skills:tdd`. A bug goes through `mattpocock-skills:diagnosing-bugs` first. Those two, by
those exact names — inside this loop they outrank any general instruction to reach for a superpowers
process skill, which would otherwise answer the same trigger differently each ticket.

How to solve it is yours. What follows constrains the process, never the design:

- **Watch the check fail first, for the reason you claim.** A check you never saw red is decoration.
- **Fix the root cause across every caller**, not the instance the ticket names.
- **A diff that describes code is traced here, not in phase D** (rule 20). The review confirms a
  map; it does not build one.
- Scope is exactly the ticket. A finding outside it is filed as its own issue, never folded into the
  diff: `gh issue create --title "<what>" --body-file <file> --label ready-for-human`.
- A bug three levels under the bug in hand: file it, do not follow it.
- **Commit each slice as you finish it** — `git add -- <paths>`, never `-A`. An unstaged edit is the
  only work this loop can lose.

Before leaving C, `git rev-list --count origin/main..HEAD` must be non-zero. Your account of what
you did is not evidence; git is.

## D — Review

`mattpocock-skills:code-review`, fixed point `origin/main`. Two fresh `opus` subagents (rule 29's
independent-review tier) that did not write the code, each given the diff and nothing else — never
your reasoning, which is the frame the review exists to escape:

- **Standards** — sources: `docs/agents/RULES.md` plus the skill's own Fowler smell baseline (paste
  it in full; the subagent has no other access to it). Brief: report every documented-rule violation
  by number, and any baseline smell, named and quoted; skip what tooling enforces. Around 25 lines.
- **Spec** — source: issue #N's body and comments, already fetched in phase A. Brief: report
  requirements missing or partial, behaviour not asked for, and anything implemented but wrong,
  quoting the issue for each. Around 25 lines.

Both: `Do not spawn any subagent.`

Post both reports on the issue, under `## Standards` and `## Spec`, unmerged — the skill's own rule,
because a change can pass one axis and fail the other. Then read both yourself and write the one
line `loop-gate.mjs` needs: `VERDICT: LAND <sha>`, or `VERDICT: HOLD <sha> — <one sentence>`, where
`<sha>` is `git rev-parse --short HEAD` in that worktree. HOLD on any hard Standards violation or any
missing/wrong Spec finding; a baseline smell alone, or added behaviour with no correctness cost, is a
note, not a HOLD. Post that verdict as its own comment, first line the VERDICT:

```sh
gh issue comment <n> --body-file <file>   # first line: VERDICT: LAND <sha>
```

Two opus subagents plus this session's own read, not a third subagent for the verdict — that keeps
`loop-gate.mjs`'s single sha-bound line while still running the skill's real shape.

That is the whole record of the review, and the sha is what makes it trustworthy: the gate accepts
a verdict only if it names the commit being pushed. Commit again after a review and it stops
counting, so there is no way to land a diff nobody read, and nothing to remember.

Fix everything real, commit, re-review — every new head gets its own verdict. A review will
always find *something*; that alone is not a reason to stop. Keep going while each round is
fixing real, newly-raised findings, up to a hard cap of **4 review rounds**, regardless of
ticket size.

At the cap, do not park for this reason alone. If round 4 landed, you're done. If it's still a
HOLD, read its findings yourself: fix anything that is an actual blocker (breaks behaviour,
loses data, a security hole) — that fix doesn't spend another round. For what's left — style,
a missing edge case in dev-only scaffolding, a nitpick — post your own
`VERDICT: LAND <sha>` naming what you're accepting and why the cap makes that the right call,
and continue to phase E on that head. A capped-out ticket still needs its DoD comment in phase F
to say plainly what's known-unresolved; that's what keeps this honest instead of a rubber stamp.

Park only for what parking was for: a decision only the owner can make.

Where you disagree with a finding, one line in the commit body — never a softened summary of it.

## E — Land

```sh
node scripts/loop-gate.mjs
```

It reads git and the issue, and refuses the push naming what is wrong when any of these is true:

- the branch has no commits, or an empty diff, against `origin/main`;
- no `VERDICT: LAND <sha>` on the issue names the commit you are pushing — a hold, a missing
  verdict, or a review of an earlier commit all refuse. A `HOLD` on a commit is final for that
  commit: a later `LAND` on the same sha does not lift it, and the only way past it is a fix, which
  moves the head and asks for a review of the new code.

Run it from the shared checkout. It finds the run's worktree itself, and takes no arguments — there
is nothing to point it at and no way to widen what it looks at.

**A non-zero exit means redo that phase — never the ticket, and never push past it.** Exit 2 means
it could not judge at all (not on a ticket branch, or the tracker is unreachable), which is not
permission either.

```sh
npm run agent:check
```

Say what it reported, including what it says it skipped — a green line standing for a suite nobody
ran is not a pass.

**If it is red, you are back in phase C.** Fix it, commit the fix, then go round again from phase D:
the new commit moves the head, so the review you were holding no longer covers what you would push,
and the gate says so. Never push a red check, and never re-run it hoping for a different answer — a
check that turns green on a second run with no change is a flake to report on the issue, not a pass.

```sh
git push -u origin agent/<n>-<slug>
gh pr create --base main --head agent/<n>-<slug> --title "<title>" --body-file <file>
```

The body says what changed, how you know, and which Definition-of-done boxes are closed and which
are not. `Closes #<n>` goes in the **body**, never in a commit message — a commit closes the issue
at push time, before CI has said anything. Multi-line `gh` bodies always go through `--body-file`;
an inline `--body` is word-split and mojibaked.

Write that file with the Write tool or a bash heredoc. PowerShell's `Set-Content` defaults to cp1252
on this machine and mangles every em-dash in it — and the body you are writing is a paragraph of
this repo's prose, which is full of them.

Do not read CI by eye, and never from a command's exit status — `gh pr checks --watch` piped into
anything reports the *pipe's* status, and that is how a red branch once reached main. Ask the one
thing that answers from run data:

```sh
npx tsx lib/loop/ciVerdict.ts metasito/murlan agent/<n>-<slug> <pr>
```

It waits for the run this push started, matches it by `headRefOid` so a fix round cannot read the
previous push's red, filters to `ci.yml` (the branch also carries Maestro and EAS runs that settle
on their own schedule, and a green one of those reads as a green branch), and returns JSON:
`{ pass, runId, failedStep, output, infrastructure, reason }`.

- `pass: false` — fix on the branch from `output`, push, ask again. A fix is new code, so it needs
  its own review before it lands. Three attempts on the same failure, then park with the log.
- `infrastructure: true` — a job completed having run zero steps: billing, a quota, a runner. It
  says nothing about the diff, so ask once more rather than spending a fix round on it.

```sh
npx tsx lib/loop/land.ts metasito/murlan <pr>
```

Merges when the PR is mergeable. `next: "update-branch"` means main moved — run
`gh pr update-branch`, read the verdict again (merging behind runs the whole suite twice), then
land. Anything else stops: park it. Never reach for `--admin` — a merge that needs a flag to force
it is a decision, not a step.

```sh
gh issue edit <n> --remove-label in-progress
```

The PR body closes the issue; nothing takes the label off, and a closed ticket still wearing
`in-progress` reads as a live run.

## F — Close out

1. Re-read the issue, rule 25's way — the same command phase A ends with. A ruling can land while
   you were building, and a ticket answered against its first version is answered against the wrong
   one.

   ```sh
   gh issue view <n> --json title,body,comments --jq '.title, .body, (.comments[]|"--- "+.author.login+": "+.body)'
   ```

2. Tick the Definition of done against the code actually written, as a comment. A box you did not
   close is named there, with why. An honest gap is worth more than a green report.
3. In that same comment, one line on the effective diff in plain language — "the hand fans from the
   left edge", not "edited handLayout.ts".
4. Teardown, in this order — `git worktree remove` walks *into* a Windows junction and empties the
   shared install:
   ```sh
   npm run worktrees:remove -- .worktrees/agent-<n>
   git status --porcelain              # must be empty; if it is not, teardown failed — say so
   ```
5. **Exit.** One ticket per process, by design: `scripts/queue-loop.mjs` starts the next ticket in a
   clean process, so there is nothing here to reset and nothing that can leak forward. Do not loop
   back to phase A in this session.

Teardown runs on the parked and stopped paths too. A run that cost forty minutes and stopped is the
one whose record is worth having.

## Compaction

Context is kept flat by delegating: phase B and phase D run in subagents whose tool output never
enters this conversation, so a ticket costs roughly what its own diff costs.

When auto-compaction fires, the `SessionStart` hook runs `scripts/loop-status.mjs`, which recomputes
where the run stands from git and the tracker. Nothing depends on what survived the summary, and
nothing can be restored wrongly, because nothing was stored.

Preserve one thing through a compaction that the tools cannot give back: **failing test output**.
Everything else is derivable; that is not.

## Halt

Queue empty · route `handoff` · preflight red · three failed CI rounds on the same
failure · a decision only the owner can make **that parking cannot carry**. `queue-loop.mjs` checks
for an empty queue before it even starts a process; this list is the fallback for a `/queue` run
started by hand.

Release the claim, run teardown, and say on the issue: the phase reached, what is committed and on
which branch, the exact failure, and the one decision needed. Then five lines to the user. The issue
is the handoff — it is where the owner is already looking, and it cannot be lost with the session.

## Output

Between tickets, exactly one line:

`✅ #<n> <title> — <files> files, <tests> tests, <verdict>`

If you catch yourself narrating, invoke `caveman`.
