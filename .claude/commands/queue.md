---
description: Work one ticket, then exit — tools/loop/queue-loop.mjs starts the next process
argument-hint: "[issue-number]"
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, Task, Skill, SlashCommand, TodoWrite
model: opus
---

The only loop protocol in this repo. `docs/agents/RULES.md` is the ruleset; this file is the
procedure. Where they disagree, RULES.md wins and this file is stale — fix it.

One ticket at a time, one ticket per process: `tools/loop/queue-loop.mjs` starts the next process when
this one exits, so working more than one ticket concurrently is not a mode this procedure has.

**Nothing about the run is written down, because nothing needs to be.** Git knows the branch, the
commits and the diff; the tracker knows the ticket, its comments and the review. Every question the
loop asks is answered from those two, so there is no record to keep in sync and none that can go
stale. `node tools/loop/loop-status.mjs` computes the answer at any moment.

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
  then declare it and **exit** — `LOOP-RESULT {"ticket":<n>,"stoodDown":true,"why":"<one sentence>"}`,
  the phase F form. The supervisor starts the next ticket; a session that picks a second one spends
  one ticket's accounting on two. The issue is the record; there is no parked-findings file.

Never ask the user a question while a run is live.

---

## A — Start

Say which phase you are in, on a line of its own, in the same message as that phase's first command:

`PHASE A`

The supervisor reads that line and nothing else about your progress. A line of its own — a sentence
mentioning the phase is not a phase report. Send it *with* the command, never as a message by
itself: in print mode a turn that ends in text and no tool call is the final answer, so a marker
alone can end the session on turn one. Do the same at the top of every phase below.

**Run this first, before anything else, every time — including a fresh process that has never seen
this ticket:**

```sh
node tools/loop/loop-status.mjs
```

Silent means no live worktree — continue below. Anything else means a ticket is already mid-run:
resume at the phase it names, do not re-plan, do not re-scope, do not ask whether to continue, and
**do not run the picker below at all.** A ticket already claimed and mid-build is not
a competing option next to a fresh one — picking a new ticket while this one is unfinished is the
exact one-ticket-at-a-time violation this loop exists to prevent, not a matter of preference between
two takeable tickets. Uncommitted changes in that worktree are your in-progress slice; finish it,
don't start over.

If it names **G**, the head is pushed and CI is the supervisor's to settle — or could not be read,
which is the same answer. Declare it and exit, touching nothing:

```
LOOP-RESULT {"ticket":<n>,"phase":"G"}
```

Only once `loop-status.mjs` is silent:

```sh
npm run queue:pre                         # by-hand runs only: the loop has already run it
node tools/loop/next-ticket.mjs $ARGUMENTS   # prints ROUTE, body, comments, blockers, takeability
```

**Read that output for an open pull request on this ticket.** If there is one, the ticket is
already claimed, its Definition of done is already posted, and the branch already exists — a ticket
left `in-progress` with an open pull request and no worktree, whose supervisor may be gone. Do not
claim it again and do not start over. Rebuild the worktree, which is the rest of phase A here:

```sh
git fetch origin --quiet
git worktree add -B agent/<n>-<slug> .worktrees/agent-<n> origin/agent/<n>-<slug>
node tools/loop/loop-status.mjs
```

and resume where that second `loop-status.mjs` says.

`queue:pre` is the leftover worktree, the peer's uncommitted work and the orphaned processes — all
loop-level, none of it about this ticket, which is why `queue-loop.mjs` runs it before it spawns you
and you will normally see it already done.

If it fails, **halt** — do not work around it.

`tools/loop/queue-loop.mjs` passes the ticket number, so `$ARGUMENTS` is normally set and
`next-ticket.mjs $ARGUMENTS` inspects *that* ticket rather than picking. A bare `/queue` with no
argument picks from the live queue, which is the by-hand form.

**You work the ticket you were given.** If it turns out to be wrong — the claim race is lost, the
premise is false, a blocker is named in a comment — say so on the issue, remove your label, declare
it (`stoodDown`, phase F step 5) and **exit**. Do not pick another one: the supervisor starts the
next process, and a session that picks a second ticket spends one ticket's accounting on two.

This runs once, for exactly one ticket, then phases B–F carry it to a close. `tools/loop/queue-loop.mjs`
is what keeps going — it is a fresh `claude -p "/queue"` invocation that starts the next ticket, not
this session continuing. There is no ticket-count budget: nothing survives past phase F for a budget
to protect.

Route `triage` runs `/triage`; route `wayfinder` runs `/wayfinder`; route `handoff` means no
agent-takeable work is left — go to **Halt**. Only route `implement` continues here. Those four are
the whole set; anything else is a defect in `next-ticket.mjs`, not a route to improvise around.

That output is already the whole ticket — **body and comments together**, which is why the picker
prints both and you do not fetch them again. The comments are where the owner's ruling and the
answer to the body's own question live, and **a later comment overrides the body**. Read to the end
of the thread before scoping.

**The claim and the worktree are already done.** The supervisor ran `tools/loop/claim.mjs` before it
spawned you: the `in-progress` label, the claim comment, the race check against a peer, the fetch and
`git worktree add -b agent/<n>-<slug> .worktrees/agent-<n> origin/main`. `loop-status.mjs` above
named the worktree; work only in it, and never change the shared checkout's branch. A by-hand
`/queue` does the same with `npm run queue:claim -- <n> "<title>"`.

None of that needed a judgement, and as six model turns it was 17 turns and 1.2 minutes of phase A
for work a subprocess does in a second.

**Post the ticket's Definition of done as a comment on the issue, now, before any code.** That
checklist is the contract, it is what phase F is judged against, and on the issue it is visible to
the owner and survives anything that happens to this session. A ticket with no checkable Definition
of done is not a ticket — park it.

## B — Scope

`PHASE B`

One subagent (`sonnet`), so the codebase never enters this context:

> Investigate issue #N in the worktree `.worktrees/agent-N`. Report: which files the change has to
> touch, existing patterns worth reusing, the risks, and whether the ticket makes sense at all.
>
> Lead with file paths and figures — but if the ticket is ambiguous, or its premise is wrong, or it
> asks for something the codebase already does, say so plainly in a sentence. That is the most
> valuable thing you can come back with, and it is worth more than a tidy list.
>
> Around 30 lines. Do not spawn any subagent, and do not run `npm run agent:check` — phase E is
> where it runs, and recon is not the place to be running checks at all.

No file is out of scope, and no file count is. If the recon names the schema, the socket protocol,
`.replit` or a workflow, that is a reason to build it carefully and to say in the PR body what it
costs to get wrong — not a reason to hand it back. The review in phase D is the check.

## C — Build

`PHASE C`

`mattpocock-skills:tdd`. A bug goes through `mattpocock-skills:diagnosing-bugs` first. Those two, by
those exact names — inside this loop they outrank any general instruction to reach for a superpowers
process skill, which would otherwise answer the same trigger differently each ticket.

**A fix round** is phase C when `loop-status.mjs` says `fix round`: CI failed on the pushed head.
Skip the planning. Read what failed — the `CI-RED` comment on the issue, else
`.loop-logs/ci-<n>.log` (this machine's, and the supervisor that wrote it may be gone), else CI
itself:

```sh
gh run list --branch agent/<n>-<slug> --limit 1 --json databaseId --jq '.[0].databaseId' \
  | xargs -I{} gh run view {} --log-failed
```

Fix what it names, then run the suite CI actually named as well as the usual check:

```sh
npm run agent:check -- --also test        # or loop:test, test:native, comments
```

Commit and hand off to D: the fix moves the head, and the new head needs its own review.

How to solve it is yours. What follows constrains the process, never the design:

- **Watch the check fail first, for the reason you claim.** A check you never saw red is decoration.
- **Fix the root cause across every caller**, not the instance the ticket names.
- **A diff that describes code is traced here, not in phase D** (rule 20). The review confirms a
  map; it does not build one.
- **The ticket's scope grows to what you find in its area.** A defect in a file the diff already
  touches, another instance of the class the ticket names, or a gap your own change opens, is fixed
  in this diff: add it to the Definition-of-done comment as a new box and name it in the PR body.
  A follow-up issue for work this session could have finished is the failure this rule exists for —
  #1072 added a list and filed #1114 for the sweep that list needed.
  File separately only when the finding needs an owner decision, lives in a subsystem the ticket
  never touches, or would not fit in the turn budget below — then commit what you have and file the
  rest: `gh issue create --title "<what>" --body-file <file> --label <label> --label size:<size>`.
  **Choose that label, because it decides who the queue serves the ticket to.** `ready-for-agent`
  when you can write a Definition of done with no open box — research it and state the answer, the
  way you would have if the ticket were yours. `ready-for-human` only when closing it needs an
  account, a device, a design call or a policy call you cannot make. Defaulting to the owner is how
  #962 filed three agent-decidable tickets (#971, #973, #975) out of the queue in one run.

  If the thing you filed cannot be started until this ticket lands — it edits the same file, or it
  builds on what you are adding — record that, or the picker will serve it against a `main` that
  does not have your change and the session will be stuck the way #995 was:

  ```sh
  gh api -X POST repos/{owner}/{repo}/issues/<new>/dependencies/blocked_by -f issue_id=<this>
  ```
- A bug three levels under the bug in hand, in another subsystem: file it, do not follow it.
- **A ticket's prescribed form is a proposal, not a contract.** If a test or a commit already rules
  it out, build what satisfies the ticket's intent, say why in the commit, and tick the box against
  that. Park only when no form can satisfy the intent without an owner decision.
- **Commit each slice as you finish it** — `git add -- <paths>`, never `-A`. An unstaged edit is the
  only work this loop can lose.
- **Batch what does not depend on the last answer.** A ticket's 97 `Bash` calls were mostly one
  one-liner each, and each paid a full context read. `.loop-logs` counts the turns that did that.

Before leaving C, `git rev-list --count origin/main..HEAD` must be non-zero. Your account of what
you did is not evidence; git is.

**You have a turn budget, and it is the bound that actually stops you.** The supervisor sets it from
the ticket's size label and passes it as `$LOOP_TURNS`; `echo $LOOP_TURNS` reads it. Reaching it
ends the session wherever it stands, mid-edit, with no chance to commit and no message of its own —
which is why the commit rule above is the first rule of this phase and not a tidiness note. An
uncommitted edit at the budget is gone, and so is everything it was part of. If you are past two
thirds of it with nothing committed, commit what works now and narrow the slice.

**Then stop.** Commit the last slice, say what you did, and exit:

```
LOOP-RESULT {"ticket":<n>,"branch":"agent/<n>-slug","phase":"C","handoff":"D"}
```

The supervisor starts phase D in a fresh process, which is the point: review is 81% of a ticket's
cost and most of that is this conversation being re-read on every one of its turns. Your worktree
stays standing and the next process finds it from git. Do not review your own build here.

## D — Review

`PHASE D`

`mattpocock-skills:code-review`. Round 1's fixed point is `origin/main`; every later round's is the
sha the previous round reviewed — that delta, plus the findings that round left open. Round 1 and
the deltas together cover every line at its final state, so re-reading the whole diff each round
buys nothing.

Two fresh `sonnet` subagents (rule 29's independent-review reviewers) that did not write the code, each
given the diff and nothing else — never your reasoning, which is the frame the review exists to
escape:

- **Standards** — sources: `docs/agents/RULES.md` plus the skill's own Fowler smell baseline (paste
  it in full; the subagent has no other access to it). Brief: report only what affects correctness
  or breaks a documented rule, by number, quoted. A smell with no correctness cost is not a
  finding. Skip what tooling enforces. Around 15 lines.
- **Spec** — source: issue #N's body and comments, already fetched in phase A. Brief: report
  requirements missing or partial, behaviour not asked for, and anything implemented but wrong,
  quoting the issue for each. Around 15 lines.

**When the diff changes a contract, that is the Spec reviewer's subject.** A contract is what a
function promises its callers beyond its types: an order, a precondition, a thing it never returns.
Name it in the brief and ask for *every consumer that relied on the old one* — never for a list of
your own suspicions, which is a review of your suspicions. #1052 changed `readVerdict` from "blocks
until the run settles" to "answers now"; `land.ts` was the only consumer of that promise, nothing
opened it, every unit stayed green, and the next night handed three fix rounds a branch with no log.
The extra line is: `The diff changes this promise: <old> → <new>. Find every caller that still
assumes the old one, and every test that would pass either way.`

Both: `Do not spawn any subagent. Report findings only — what checked out is not reported. Every
finding names a file:line and either the rule number it breaks, a quoted line of the issue, or the
input that makes it go wrong. A finding carrying none of those three is a note, and notes are not
reported.` The tier is `sonnet` because the measured failure of this phase is precision, not depth:
automated review scores under 10% precision across the field, and is at its worst on exactly the
prose findings that cost this loop its third and fourth rounds.

Then one more `sonnet` subagent, given both reports and the same diff, and nothing else:

> For each finding below, try to kill it. A finding survives only if you can state the input or the
> sequence that makes the code wrong, or quote the rule or the issue line it breaks. Answer with the
> surviving findings and one sentence each on what killed the rest. Do not spawn any subagent, and
> do not review the diff for anything the reports did not raise.

Its output is what reaches the verdict. A third subagent for the *findings*, never for the verdict —
that stays this session's own read, which is what keeps `loop-gate.mjs`'s single sha-bound line.

Post both reports as one comment on the issue, unmerged — the skill's own rule, because a change can
pass one axis and fail the other. Its first line names the head they read, and the two headings are
exactly `## Standards` and `## Spec`:

```
REVIEW <sha>

## Standards
...
## Spec
...
```

`loop-gate.mjs` refuses a `VERDICT: LAND` for a head with no `REVIEW` comment behind it. #1043 spent
$20.26 over four rounds and posted one line — `VERDICT: LAND` — and the branch went out red; the
reports existed and reached nothing that could stop it. Each round posts its own comment naming its
own head: a round appended to the previous round's comment is a report for a sha that is no longer
the one being pushed.

Then read both yourself and write the one
line `loop-gate.mjs` needs: `VERDICT: LAND <sha>`, or `VERDICT: HOLD <sha> — <one sentence>`, where
`<sha>` is `git rev-parse --short HEAD` in that worktree. HOLD on any hard Standards violation or any
missing/wrong Spec finding; a baseline smell alone, or added behaviour with no correctness cost, is a
note, not a HOLD. Post that verdict as its own comment, first line the VERDICT:

```sh
gh issue comment <n> --body-file <file>   # first line: VERDICT: LAND <sha>
```

That is the whole record of the review, and the sha is what makes it trustworthy: the gate accepts
a verdict only if it names the commit being pushed. Commit again after a review and it stops
counting, so there is no way to land a diff nobody read, and nothing to remember.

Fix everything real, commit, re-review — every new head gets its own verdict. Ask before each
round after the first:

```sh
node tools/loop/loop-gate.mjs --review-round
```

It counts the verdicts already on the issue and exits non-zero at the cap, naming the count. The
cap is a number in `tools/loop/loop-gate.mjs`, not in this sentence — a ceiling stated only in prose
is one no test can fail, and this one bounds the most expensive phase there is.

**Stop before the cap when a round earns nothing.** A review will always find *something*, which is
exactly why a fixed count over-buys: a round that raises no finding the previous round did not
already raise ends the review on that head, and you post your `VERDICT: LAND`. The cap is the
ceiling, never the target.

That stopping rule is a judgement, not a measurement. No published work measures defects-per-round
across LLM review iterations, and the nearest evidence points the other way — parallel aggregation
improves findings, which is why the refutation pass above exists and a fifth sequential round does
not. It is the best available heuristic; say so if it is ever cited as more.

At the cap, do not park for this reason alone. If the last round landed, you're done. If it's still
a HOLD, read its findings yourself: fix anything that is an actual blocker (breaks behaviour,
loses data, a security hole) — that fix doesn't spend another round. For what's left — style,
a missing edge case in dev-only scaffolding, a nitpick — post your own
`VERDICT: LAND <sha>` naming what you're accepting and why the cap makes that the right call,
and continue to phase E on that head. A capped-out ticket still needs its DoD comment in phase F
to say plainly what's known-unresolved; that's what keeps this honest instead of a rubber stamp.

Park only for what parking was for: a decision only the owner can make.

Where you disagree with a finding, one line in the commit body — never a softened summary of it.

**A round is a process.** When you post a `HOLD`, fix what it named, commit, and hand off — the
re-review is a fresh reader of a new head, and it must not inherit this round's transcript:

```
LOOP-RESULT {"ticket":<n>,"branch":"agent/<n>-slug","phase":"D","handoff":"D"}
```

When you post a `LAND`, hand off to E the same way, with `"handoff":"E"`.

## E — Land

`PHASE E`

```sh
node tools/loop/loop-gate.mjs
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
npm run agent:check       # in the worktree — it judges the tree it is invoked from
```

Unlike the gate, this one is not the shared checkout's to run: it judges whatever tree it is
standing in, and refuses rather than passing when that tree holds nothing. Its verdict names the
tree and the base, so read that line — it is what tells a green about your branch from a green about
somebody else's.

Its headline is `LOCAL PASS`, never `PASS`, and it prints how many suites it did not run. Say both
numbers in the pull request body. CI is the gate; this is a filter in front of it, and #1043 read a
`PASS` that stood for three of eight steps and pushed a branch whose `npm test` was red.

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

CI is not yours to read, and neither is the merge. `tools/loop/queue-loop.mjs` waits for the run this
push started, updates the branch if main moved, merges when it is green and takes `in-progress` off.
None of that is a judgement, and a model reading a CI log to decide that green means merge is a
model spending turns on a switch statement. `tools/loop/guard-bash.mjs` blocks `gh pr merge` from a
session — two of them merged a peer's pull request to unblock themselves, and the supervisor then
parked the ticket that had just landed.

If CI goes red, the loop starts a fresh session on this same ticket and writes the failed log to
`.loop-logs/ci-<n>.log` for it. `loop-status.mjs` names that session's phase C a fix round: it
fixes what CI named, gets a fresh review of the new head, and pushes again. Three red rounds on one branch and the ticket goes to the owner.

## F — Close out

`PHASE F`

1. Re-read the issue, rule 25's way — body and thread in one read. A ruling can land while
   you were building, and a ticket answered against its first version is answered against the wrong
   one.

   ```sh
   gh issue view <n> --json title,body,comments --jq '.title, .body, (.comments[]|"--- "+.author.login+": "+.body)'
   ```

2. Tick the Definition of done against the code actually written, as a comment. A box you did not
   close is named there, with why. An honest gap is worth more than a green report.
3. In that same comment, one line on the effective diff in plain language — "the hand fans from the
   left edge", not "edited handLayout.ts".
4. **Tear down your worktree.**

   ```sh
   git -C .worktrees/agent-<n> status --short      # nothing unexpected left behind?
   npm run worktrees:remove -- .worktrees/agent-<n>
   git worktree list                               # yours is gone
   ```

   You are the only process that knows whether that tree is dirty, which is why this is yours and
   not the supervisor's. If the removal refuses, **read what it names** — that is work you have not
   committed. Commit it to your branch and push again, or say on the issue what it is. Never pass
   `--force` and never `rm -rf`: a `--force` removal walks *through* the `node_modules` junction
   into the shared install and exits 0. `tools/loop/guard-bash.mjs` blocks the form; the reason is
   measured, not theorised.

5. **Say what you did, on one line, as the last thing you emit.**

   ```
   LOOP-RESULT {"ticket":891,"branch":"agent/891-slug","pr":1003,"phase":"F","stoodDown":false}
   ```

   One line, valid JSON after the marker, in the same message as any command — the same rule the
   phase markers follow. Every field is something only you know at that moment, and step 4 has just
   deleted the worktree the supervisor would otherwise have had to reconstruct them from. Omit `pr`
   only if you genuinely pushed none. `stoodDown` is true when you gave the ticket up — a lost claim
   race, a false premise, a decision only the owner can make — and then `"why"` says which, in one
   sentence; the supervisor releases the claim for you.

   `handoff` is the opposite of this line's usual job: with it, you are saying the ticket is *not*
   finished and which phase takes it next. Phase F never sets it — this is the ticket's last process.

   **This is not optional and there is no fallback.** A session that exits without it is recorded as
   an error, and its ticket's row carries `no LOOP-RESULT` as the reason. Everything the supervisor
   would otherwise have to infer — which ticket, which branch, which pull request, how far you got
   — it infers from side effects step 4 has just been told to delete, and an inference is what
   writes a merged ticket down as a park. Emit it even when the news is bad: a stood-down ticket, a
   phase you never reached, a pull request you never pushed are all facts, and all of them are
   worth more stated than guessed at.

6. **Exit.** One ticket per process, by design: `tools/loop/queue-loop.mjs` starts the next ticket in a
   clean process, so there is nothing here to reset and nothing that can leak forward. Do not loop
   back to phase A in this session.

A run that cost forty minutes and stopped is the one whose record is worth having.

## Compaction

Context is kept flat by delegating: phase B and phase D run in subagents whose tool output never
enters this conversation, so a ticket costs roughly what its own diff costs.

When auto-compaction fires, the `SessionStart` hook runs `tools/loop/loop-status.mjs`, which recomputes
where the run stands from git and the tracker. Nothing depends on what survived the summary, and
nothing can be restored wrongly, because nothing was stored.

Preserve one thing through a compaction that the tools cannot give back: **failing test output**.
Everything else is derivable; that is not.

## Halt

Queue empty · route `handoff` · preflight red · three failed CI rounds on the same
failure · a decision only the owner can make **that parking cannot carry**. `queue-loop.mjs` checks
for an empty queue before it even starts a process; this list is the fallback for a `/queue` run
started by hand.

Release the claim, run teardown, declare it (`stoodDown`, phase F step 5), and say on the issue: the
phase reached, what is committed and on which branch, the exact failure, and the one decision
needed. Then five lines to the user. The issue is the handoff — it is where the owner is already
looking, and it cannot be lost with the session.

`.loop-stop` on disk drains the loop, but it is read only between tickets and during a wait, never
mid-session. A stop dropped while you are building takes effect when you exit; it is not an
instruction to abandon this ticket.

## Output

Phase F step 5's `LOOP-RESULT` line is the last thing you emit, and it is the only summary you
write. The supervisor renders the human-readable board from that JSON. Exactly one section of this
file may claim the final line, and it is that one — a second summary here competes for the same
position, and the one the supervisor actually reads is the one that loses.

If you catch yourself narrating, invoke `caveman`.
