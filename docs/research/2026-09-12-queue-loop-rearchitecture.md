# Re-architecting the queue loop

Research, 2026-09-12. Prompted by two `npm run queue:loop` runs on 2026-09-11/12 that reported 5
landed and 7 parked, spent $161.20, stopped twice on their own circuit breaker, and left three pull
requests unmerged — against a reality of 7 merged pull requests, 5 of the 7 parks false, and one
ticket reported as landed that was never touched.

Evidence base: `.loop-logs/*.jsonl` (25 MB of stream transcripts from 12 sessions),
`.loop-logs/tickets.jsonl`, issues #70 #955 #956 #969 #980 #981 #982 #983 #987 #992 #993 #995, pull
requests #984–#997, live GitHub API reads, live `gh`/`git`/`claude` command output on this machine,
and first-party documentation for GitHub, the `gh` CLI, Claude Code and git.

Prior research this builds on rather than repeats:
[`2026-09-10-claude-headless-observability.md`](2026-09-10-claude-headless-observability.md) (stream
shapes, exit codes, SIGTERM, Windows spawning) and
[`2026-09-10-headless-cost-and-speed.md`](2026-09-10-headless-cost-and-speed.md) (per-tool token
cost, prompt-cache warmth across processes).

---

## 1. The six facts that decide the design

Everything below follows from these. Each is measured, and each contradicts something the loop
currently assumes.

**1. A merged pull request reports `mergeStateStatus: UNKNOWN`.** Measured on PRs #985, #986, #994,
#996 — all `MERGED`, all answering `mergeable=UNKNOWN, mergeStateStatus=UNKNOWN`.
`decideLanding` ([`lib/loop/land.ts:36`](../../lib/loop/land.ts)) has no `MERGED` case and no
`UNKNOWN` case, so it falls through to `stop: unrecognised mergeStateStatus UNKNOWN` — the exact
string in five of the six `.loop-logs/park-*.md` files. `settle()` gives `stop` zero retries. **This
one fall-through is the whole of the night's false parks and therefore the whole of the label mess.**

**2. `gh pr merge` is not a CI gate and cannot be made into one.** `UNSTABLE` is in `gh`'s
`isImmediatelyMergeable` set ([merge.go:828](https://github.com/cli/cli/blob/trunk/pkg/cmd/pr/merge/merge.go)),
and GitHub's own description of `UNSTABLE` is "mergeable with non-passing commit status" — which
includes *queued*. A pull request whose entire suite has not started reports `UNSTABLE` and
`gh pr merge` will merge it on the spot. `--auto` does not change this: the decision is client-side,
`autoMerge: opts.AutoMergeEnable && !isImmediatelyMergeable(...)` (merge.go:593), so on a
CLEAN/UNSTABLE pull request `--auto` merges immediately and is never consulted. The loop must read
`statusCheckRollup` and make its own verdict; no flag will do it for us.

**3. `--max-budget-usd` is not a budget, and at $15 it does not stop the session — it kills the
session's subagents.** The documented behaviour is that "spawning another subagent fails with
`Budget limit reached`, and Claude Code stops background subagents that are still running"
([CLI reference](https://code.claude.com/docs/en/cli-reference)). #969's first attempt hit the cap
**inside phase D**, which is defined as two `opus` review subagents (`queue.md:169-176`). The cap
silently removed the review and let the session carry on. The message arrives on **stderr**, which
`runTicket` inherits and never captures (`queue-loop.mjs:618`); grepping all 25 MB of stream logs for
`Budget limit reached`, `budget_exhausted` or `error_max_budget_usd` returns nothing, and every
`result` event in that session still says `subtype: "success"`. Separately measured at small caps:
the cap is checked *after* a turn settles (spent $0.0424 against a $0.001 cap, 42× over) and it
**resets on `--resume`**, so a retry-by-resume loop has no ceiling at all.

**4. `git worktree remove --force` destroys a junction's target on Windows.** Measured: a
`mklink /J` junction at `wt/node_modules` pointing at a sibling directory; `git worktree remove
--force` exited 0 and emptied the target. Root cause is in git's own source
([`compat/win32.h`](https://github.com/git/git/blob/master/compat/win32.h)): only
`IO_REPARSE_TAG_SYMLINK` maps to `S_IFLNK`, so a junction carrying `IO_REPARSE_TAG_MOUNT_POINT` is an
ordinary directory to every `S_ISLNK` guard git has. **So the fix for the release failure is not
`--force`.** Detach the junction first (`Directory.Delete(link, recursive: false)`), then plain
`remove` — measured, and `--force` was then not needed, which leaves git's own safety check armed.
Note `gh pr merge --delete-branch` calls `git worktree remove` itself when the branch lives in a
linked worktree, putting it in the same blast radius.

**5. This repo has no branch protection, no rulesets, and auto-merge is off.**

```
allow_auto_merge: false        branch protection on main: 404 (none)
delete_branch_on_merge: false  rulesets: []
owner.type: User               visibility: public
```

Three consequences. `--auto` is doubly inoperative — the repo setting gates it, and with no required
checks there is nothing for it to wait on. GitHub Merge Queue is unavailable: it requires "a public
repository owned by an **organization**", and this repo's owner is a User. And nothing requires
branches to be up to date, so **a `BEHIND` pull request is mergeable as-is and the loop's entire
`update-branch` machinery buys nothing**. (That last one is inference from the enum description plus
the branch-protection docs, not measurement — both live PRs were `behind_by: 0`, so the observation
proves nothing. Recorded as inferred. A related trap: a pull request's `baseRefOid` is *not* main's
head and cannot test whether a PR is behind; use `compare/main...branch` → `behind_by`.)

**6. The supervisor spawns the session with no ticket number.** `queueLoopArgs()`
(`queue-loop.mjs:106`) passes `-p /queue` bare, so the session runs `loop-status.mjs` and
`next-ticket.mjs` again and picks independently, seconds after the supervisor already picked
(`queue.md:46,61`). Two picks, no handoff. `landed = after.ticket !== route.number`
(`queue-loop.mjs:1035`) then compares against a number the session was never told. The wiring to pass
it already exists and is unused: `queue.md:69` documents `$ARGUMENTS` and `next-ticket.mjs:165-179`
already has the explicit-number branch.

---

## 2. Ground truth: what the night actually did

| Ticket | Loop reported | Reality |
|---|---|---|
| #956 | landed → merged | PR #984 merged |
| #70 | **landed, $14.69, 1 turn** | **never touched.** Open, no branch, no PR. The session resumed #955 |
| #955 | parked ×2, `ci pass:false` | PR #985 merged 16:45:13Z |
| #969 | parked, then landed → merged | PR #986 merged; first attempt lost its review to the $15 cap |
| #980 | landed → merged | PR #988 merged |
| #981 | parked | PR #989 — since rebased and merged |
| #982 | landed → merged | PR #990 merged |
| #983 | parked | PR #991 — since rebased, still open |
| #987 | **parked**, `ci pass:false` | PR #994 merged green, by the *#992 session* |
| #992 | **no ledger row at all** | self-parked, then the same process built #993; $12.12 unaccounted |
| #993 | **parked**, `ci pass:false` | PR #996 merged green, by the *#995 session* |
| #995 | CI failed → breaker | PR #997 — since merged; the red job was a flake (§5.3) |

The two run reports say "6 tickets · 3 landed · 3 parked" and "7 tickets · 2 landed · 4 parked".
Six of the twelve `tickets.jsonl` rows are factually wrong.

---

## 3. The defects

43 in total. Numbered for the plan; grouped by mechanism, not by file.

### A. The merge verdict (the root cause)

| # | Defect | Site |
|---|---|---|
| A1 | `decideLanding` has no `MERGED`/`CLOSED` case; a merged PR reads as `UNKNOWN` → `stop` → park | `land.ts:36`, `:61` |
| A2 | `decideLanding` has no `UNKNOWN` case; GitHub computes mergeability asynchronously and the read that asks is the read that starts the job | `land.ts:36` |
| A3 | `settle()` gives `stop` zero retries; its retry budget covers only `retry-verdict` | `queue-loop.mjs:848-866` |
| A4 | `SETTLE_PAUSE_MS` (15 s) exists for GitHub's async-ness but is never applied before the first `land.ts` read | `queue-loop.mjs:819` |
| A5 | `decideLanding` returns `merge` on `UNSTABLE`, which includes *pending* checks — a red-CI merge vector whenever anything calls it without checking CI first | `land.ts:34` |
| A6 | `settle()`'s give-up message always names `SETTLE_ROUNDS.update` even when `retry` was exhausted | `queue-loop.mjs:861-865` |
| A7 | **Nothing tests `land.ts`. Nothing tests `ciVerdict.ts`.** The two modules that decide whether work merges have no test file. `afterPush`'s tests feed hand-written outputs of the untested function | — |
| A8 | `ciVerdict`'s stepless filter excludes `success`/`skipped`/`cancelled` but not `null` — the value a cancelled *run* leaves on jobs that never started, and `ci.yml:25-27` cancels in-progress runs on every push | `ciVerdict.ts:63-69` |

### B. Identity: which ticket is this?

| # | Defect | Site |
|---|---|---|
| B1 | The session is spawned with no ticket number and picks again (fact 6) | `queue-loop.mjs:106` |
| B2 | `landed = !after \|\| after.ticket !== route.number` — "the routed ticket is no longer live" is treated as success | `queue-loop.mjs:1035` |
| B3 | `after === null` has three causes and all three read as landed: genuine landing, a session that **stood down on a lost claim race** (`queue.md:104-105`), and `derive()` returning **ambiguous** | `queue-loop.mjs:1035` |
| B4 | `liveRoute` returns `null` on `onTicket:false`, so `locateRun`'s deliberate two-worktree refusal (`loop-derive.mjs:101-110`) reads as *no run live* and the picker takes a third ticket. **The one function that detects the defect is wired to a caller that throws the answer away** | `queue-loop.mjs:77` |
| B5 | With `derive()` ambiguous, every ticket is recorded as landed, `failures` resets to 0, and the breaker never trips | `queue-loop.mjs:1035,1098` |
| B6 | `.loop-logs/<n>.jsonl` is named by the *routed* ticket, so #955's 144-turn session is filed in `70.jsonl` | `queue-loop.mjs:550` |
| B7 | `done: Boolean(pushed)` — `pushedPr` returns any open PR on the branch, so a PR opened by a *previous* session reads as this session having pushed | `queue-loop.mjs:781-801,1006` |

### C. Worktree release

| # | Defect | Site |
|---|---|---|
| C1 | `releaseWorktree` runs `npm run worktrees:remove` with no force against a post-push tree that is dirty; `removeOneWorktree` refuses; release fails with a warning line only | `queue-loop.mjs:404-411`, `prune-worktrees.mjs:340` |
| C2 | The surviving worktree makes `derive()` report a live run, so the next iteration resumes an already-pushed ticket | `loop-derive.mjs:88,93-97` |
| C3 | That resumed session commits nothing → `madeProgress()` false → a green pushed ticket is parked and counted as a failure | `queue-loop.mjs:280-283,1036` |
| C4 | The merge slot still holds the same ticket, so it is parked a second time and written to the ledger twice | `queue-loop.mjs:938` |
| C5 | The F row prints "worktree removed" unconditionally even after the release failed | `queue-loop.mjs:444` |
| C6 | `derive()` ignores a `.worktrees/fix-971` on a non-`agent/` branch while `prune-worktrees` treats it as first-class — invisible to the thing that decides whether a run is live, visible to the thing that deletes worktrees | `loop-derive.mjs:93`, `prune-worktrees.mjs:291-299` |

### D. Parking

| # | Defect | Site |
|---|---|---|
| D1 | `park()` adds `ready-for-human` and leaves `ready-for-agent`; `classify()`'s owner-wins rule then makes the park **absorbing**. Contradicts `queue.md:32` and RULES.md rule 28 | `queue-loop.mjs:372-380`, `next-ticket.mjs:48` |
| D2 | Nothing distinguishes "a human must decide" from "the loop broke". #969 already carries a comment from an earlier night saying exactly this | — |
| D3 | `park()`'s five `run()` calls are unguarded and it is reached from `drain()`, so a park failure turns an orderly `.loop-stop` drain into an unhandled rejection and loses the pending PR | `queue-loop.mjs:362,365,372,393,395` |
| D4 | `park()`'s `dirty` flag is up to `REDERIVE_MS` (20 s) stale; if the session committed in that window `git add -A` stages nothing and `git commit` exits 1, throwing out of `main()` | `queue-loop.mjs:358` |
| D5 | `ci: {pass:false}` is written for every non-merged outcome including `UNKNOWN`; PRs #994 and #996 are recorded as CI failures and both were green | `queue-loop.mjs:947` |

### E. One process, one ticket

| # | Defect | Site |
|---|---|---|
| E1 | The #992 session self-parked its ticket, then claimed and built #993 in the same process — claim comments four minutes apart. Nothing stops a session that has *released* its ticket from picking another | `queue.md:22-36` |
| E2 | Two sessions ran `gh pr merge` on a peer's pull request. `queue.md:265` forbids it in prose; `.claude/settings.local.json` allows `Bash(gh pr *)` unprompted and `guard-bash.mjs` does not block it | `queue.md:265-272` |
| E3 | Cause of E2: #987 → #993 → #995 all edit `scripts/comment-budget.mjs`, each branch cut from an `origin/main` that lacks its predecessor. `canStartNext` only blocks on `package.json`/`package-lock.json` | `queue-loop.mjs:321-333` |
| E4 | The rate-limit `retry` branch adds to `totals.cost` and `continue`s without recording a row — #992's $12.12 vanished | `queue-loop.mjs:1011-1027` |

### F. The picker

| # | Defect | Site |
|---|---|---|
| F1 | `classify()` sorts by `sizeRank` first, so every self-filed `size:S` follow-up jumps to the head of the frontier. The loop generates its own next ticket out of its own tooling and serves it first, forever — three consecutive sessions and ≈$30 went to one 102-line local-only check | `next-ticket.mjs:54` |
| F2 | `branchAlive()` has no try/catch, so an unreachable origin throws out of the picker and takes `main()` down — **the exact opposite of its own "fail open" comment** | `next-ticket.mjs:68-76` |
| F3 | A merged-but-undeleted branch satisfies "alive" and freezes its ticket forever. **Ten such branches on origin today**, six from merged PRs. `issue-tracker.md:86-90` documents this failure (#294) and the "no open pull request" half of its own test is not implemented | `next-ticket.mjs:96-100` |
| F4 | `takeable(frontier, 3)` fetches three candidates and uses one — 4 wasted `gh api` calls per pick; `printDetail` refetches the issue `takeable()` already read | `next-ticket.mjs:109,118` |
| F5 | #70 was picked ~1 minute before `ready-for-agent` was removed for the third time. The session's post-claim re-read (`queue.md:88-106`) protects the session but not the supervisor's accounting — a correct stand-down is recorded as a landed ticket (B3) | — |
| F6 | Nothing in the repo **creates** a dependency edge. `issue-tracker.md:216` names the command in a *wayfinding* section only; `next-ticket.mjs:80` reads. That is why #992→#983 exists and #993→#987 (same file, same week, a real dependency) does not | — |

### G. The budget and the board

| # | Defect | Site |
|---|---|---|
| G1 | `TICKET_BUDGET_USD = "15"` was added by an agent session on 2026-09-10 (`02b361d5`), has no relation to `size:*`, and has no test. Six of twelve sessions finished within 8% of it | `queue-loop.mjs:103` |
| G2 | The budget stop is invisible: the message is on inherited stderr, and the `result` event still says `subtype: "success"` (fact 3) | `queue-loop.mjs:618` |
| G3 | `state.result = fact` keeps the **last** `result` event. Measured: the real turn carries `origin: null`, every other carries `origin.kind === "task-notification"`. #70's "1 turns" was actually 144 | `queue-loop.mjs:632` |
| G4 | `terminal_reason: "api_error"` occurs in #956, #980, #992 and is never surfaced or recorded | — |
| G5 | `REDERIVE` is anchored `^`, but `queue.md:161` prescribes `git add -- <paths>` before committing and sessions chain `git add … && git commit …` or prefix `cd <repo> && …`. **Measured: 74 of 131 markers missed (56%)**; #982 0/8, #983 0/12, #993 0/11 | `loop-stream.mjs:34` |
| G6 | `shouldHalt`'s message reads `failures` after `drain()` reset it → "queue-loop: 0 tickets in a row did not land — stopping" | `queue-loop.mjs:1167` |
| G7 | `stalled()` is exported, unit-tested, and **never called** — the watchdog inlines the comparison | `queue-loop.mjs:188,701` |

### H. The shared checkout and waiting

| # | Defect | Site |
|---|---|---|
| H1 | `syncProtocol`'s dirty-`main` case (`branch === "main"`, `own === 0`) reaches `merge --ff-only`, which refuses over local changes → `return false` → `main()` returns 1. **This is the run that ended with the checkout dirty** | `queue-loop.mjs:156-170` |
| H2 | `PROTOCOL = ["CLAUDE.md", ".claude", "scripts"]` diffed against `origin/main` conflates "my checkout is stale" with "someone edited the protocol here". The loop's own tickets edit `scripts/`, so it reports drift every iteration | `queue-loop.mjs:138,144` |
| H3 | `syncProtocol` computes `drift()` three times; the logged file list is a different read from the one that decided | `queue-loop.mjs:146,149` |
| H4 | Unguarded `execFileSync` at lines 145, 153-155, 362, 363-369, 372-380, 393, 395, 735, 852, 868-874, 882 — every one ends the night through the top-level catch | `queue-loop.mjs` |
| H5 | `holdFor` honours `.loop-stop` but does not consume it, so a stop during a wait silently kills the **next** run too | `queue-loop.mjs:468-482` |
| H6 | `waits`/`waitsOn` are keyed per ticket, but a usage refusal is a property of the *account*. Twenty refusals across twenty tickets never trip the park; twenty on one park a ticket that did nothing wrong | `queue-loop.mjs:228` |
| H7 | `WAIT.CAP = 5.5 h` holds an un-suspended node process on a desktop through most of an unattended night, protecting no state — everything is derived from git and the tracker | `queue-loop.mjs:196` |
| H8 | `.loop-stop` is not gitignored, so it appears in every `preflight` untracked listing | `.gitignore:94` |
| H9 | `preflight` runs before the session and never after, so a session that dirties the shared checkout kills the run on the *next* ticket and the culprit is unidentifiable | `queue-pre.mjs:16-19` |
| H10 | `preflight` checks the primary worktree only; nothing checks the ticket worktree, which is where `park()`'s `git add -A` fires blind | `preflight.mjs:31-35,88` |

### I. CI

| # | Defect | Site |
|---|---|---|
| I1 | `ci.yml`'s `browser-report` pushes a regenerated `tests/e2e/timings.json` straight to `main` on every green main push — **9 commits on 2026-09-11 alone**, each rewriting the whole file because Playwright durations wobble. It makes every open PR `BEHIND`, defeats `scope`'s skip (turning a 1-minute main run into a 6-minute one, which produces another timings commit), and costs a full CI run per open PR per merge | `ci.yml:597-619` |
| I2 | **`main` is red and nothing watches it.** Run `34647545165` — the merge of PR #994 — failed `Typecheck and tests` on a cross-test race: `exchangeE2EHold.test.ts:62-65` reads every repo-root file while `checkStrictIndexed.test.ts:16-19` writes and deletes `scratch.strictIndexed.*.json` there. `ciVerdict.runListArgs` filters by `--branch`, so `main` is never read — invisible to the loop, to the next ticket (which cuts from a red tree), and to the morning report | `ciVerdict.ts:94-101` |
| I3 | `tests/e2e/playwright.config.ts` sets `retries: 0`, so a single unlucky AX snapshot is a red suite and a red suite is a stopped loop | `playwright.config.ts:54` |
| I4 | The CLAUDE.md / `land.ts:19` note "`ci.yml`'s scope job stops skipping the main push" is half-stale: the skip exists and fires; what stops it is a `main` that moved, i.e. I1. Fix I1 and the note becomes false | `land.ts:19` |

### J. comment-budget

| # | Defect | Site |
|---|---|---|
| J1 | The check measures a property that is not in its input. "Is line N of file F a comment?" is a lexical property of the **file**; a unified diff is a lossy window over pairs of files, rendered through the caller's git configuration. 54 original lines have absorbed +103/−52 across seven follow-ups, and every one of the seven is a diff-format bug: moved text, which header names the file, block state across hunk boundaries, and five ways `diff.external`/`color.ui`/`textconv`/`noprefix`/`-diff` change what a diff even is. #993's own body states the real fix and declines it as "a much larger change" | `comment-budget.mjs` |
| J2 | It is wired as `where: "local"` (`check-steps.mjs:10`), so it runs only inside `npm run agent:check`, in whatever tree that happens to be — **never in `ci.yml`**. It gates nothing the owner can rely on, and it has never once refused a real push | `check-steps.mjs:10` |

comment-budget is **not causally responsible** for any park — every one of those was A1. It is the
clearest *evidence* of F1: it occupied three of the last five queue slots because the picker serves
self-filed `size:S` follow-ups first.

---

## 4. What is load-bearing and what is not

`≈7,100` lines of loop machinery: `queue-loop.mjs` 1188, the seven `loop-*.mjs` 715, `lib/loop/*.ts`
299, `next-ticket.mjs`+`queue-pre.mjs` 244, `queue.md` 324, loop tests 2527, shared housekeeping
(`prune-worktrees` 521, `preflight` 123, `reap` 480) plus their tests 656.

**The parts that read the right fact, and should survive any rewrite:** `verdictFor`'s sha binding
(`loop-derive.mjs:140`) — the strongest guard in the design and the only one with genuinely
adversarial tests; `loop-gate.mjs`; `ciVerdict`'s `headSha` filter and its `gh pr checks --watch |
pipe` defence; `removeOneWorktree`'s junction detaching; `locateRun`'s ambiguity refusal; `holdFor`'s
real-process test; `loop-tools.mjs` (at ~876 tokens per tool definition, parsing the list from
queue.md is a genuine per-spawn saving).

**The phase board decides nothing.** `loop-render.mjs` (163, every line rendering), the phase half of
`loop-stream.mjs` (25), `advance`, and ~100 of `runTicket`'s 199 lines, plus ~605 lines of test.
**≈890 lines.** `run.phase` appears in exactly two park-reason strings; the phase `park()` actually
records comes from `derive()`, not from the board. `loop-stream.mjs:18` says so outright: *"Nothing
the loop does depends on this table."*

**What the board costs.** `derive()` shells out **8 times** (7 × git, 1 × gh) — not four, as its
caller's comment claims. It is called 70–160 times per ticket, almost all of them from the throttled
re-derive in the stdout handler. **≈560–1,280 subprocess spawns per ticket, ~90% of them to draw a
line.** A 27-minute ticket spends ~80 `gh issue view` calls on polling alone.

**Also scaffolding:** `heartbeat`/TTY (dead in the unattended mode it was built for — `isTTY` is
false), `detailOf`, `reportRow`, `run-<date>.md` (a second view of a file nothing reads),
`ticketFacts` (one `gh issue view`, called twice per ticket, feeding only the header), `parseStatus`,
`stalled` (G7), and four spellings of `isInvokedDirectly`. **≈1,050 lines of source and test that
change no branch the loop takes.**

**State the supervisor holds that git and the tracker do not** — `loop-derive.mjs:11` claims "nothing
is stored"; that is true of `derive()` and false end to end:

| held | lost on process death |
|---|---|
| `prev` | `madeProgress` returns `true` when `!prev`, so the anti-resume-forever guard is **disarmed for one iteration after every restart** |
| `failures`, `waits`, `waitsOn`, `totals` | a night that already burnt two tickets restarts at zero |
| **`slot.held`** | **the pushed pull request is orphaned.** Nothing merges it, nothing parks it, `in-progress` stays, and `classify()` skips an `in-progress` issue forever. The only in-memory hole with a permanent cost |

**Test coverage:** every exported function is unit-tested; **`main()` — the 278-line composition
where eight of the ten headline defects live — is tested nowhere.** The three tests that drive a real
process (`loopGate.test.ts`, `loopHoldSurvives.test.ts`, `worktreeRemoveCommand.test.ts`) are the
three that would have caught something, and none points at the supervisor.

Two self-defeating pairs are worth naming, because they are the pattern:

- `queueLoop.test.ts:782` asserts the loop calls `release` — against a **fake** release.
  `worktreeRemoveCommand.test.ts:177` asserts that removal refuses a dirty tree. **Both halves of C1
  are pinned and never composed.**
- `queueLoop.test.ts:560` asserts park's two label calls and never what is **absent**, while
  `nextTicket.test.ts:49` pins the exact consequence of the missing third. **Both halves of D1.**

And `loopStream.test.ts:160` asserts `REDERIVE.test("git commit -m 'feat: x'")` — a canonical form
invented by the test author — while `loopStream.test.ts:22` says of another fixture *"Captured from a
real run's `.loop-logs/962.jsonl`, not invented."* The suite knows the technique and applies it once
out of twenty.

---

## 5. Answers to the specific questions

### 5.1 Should the loop overlap a ticket with the previous one's CI wait?

**No. Serialise and delete `mergeSlot`.**

Measured: CI median **6m10s** for a pull-request run (25 samples; the three ~24-minute outliers are
branches touching `ci.yml`, which forces `native=true` and runs the device compiles). Ticket wall
clock median **27m38** across the nine rows that did real work. So serialising costs **+22%, about
74 minutes across a twelve-ticket night** — and that is an over-estimate, because overlapping
*creates* work: every merge moves `main` (I1), so the overlapped PR is `BEHIND` on settle, which
costs `update-branch` plus another full run. The overlap is also what produced the hand-merges (E2),
which produced the false parks (A1).

The three alternatives were considered and rejected. Blocking on file overlap requires knowing the
next ticket's diff before it is scoped, and a guess wrong in the unsafe direction is the failure we
already have. Cutting the new branch from the pending PR's head makes "what did this ticket change"
underivable and breaks `loop-gate.mjs`'s `origin/main` base. File-level ticket labels require triage
to predict the diff, which `issue-tracker.md:208` already says is not knowable.

Serialising deletes `mergeSlot`, `canStartNext`, `releaseWorktree`/`reattachWorktree`, the
`adopt`/`drain`/`account` split, and the "pushed but not landed" row-writing fork — ~150 lines of the
file's hardest reasoning, and the orphaned-pending-PR hole goes with it.

### 5.2 Should the loop wait out a rate limit, or exit?

**Drain and exit; let a scheduled task re-enter.** `WAIT.CAP` is 5.5 hours against a night. The hold
protects no state — everything is derived from git and the tracker, and a restarted process
re-derives it in one call. Windows Task Scheduler can start `queue-loop.mjs` hourly, and `.loop-stop`
already gives a kill switch that survives a restart (`takeStopFile` must then stop consuming it).
Deletes `holdFor`, `waitFor`, `WAIT`, `waits`, `waitsOn` and `afterRefusal`'s hold arithmetic — about
60 lines, and H5/H6/H7 go with them.

Worth noting for whatever replaces it: `rate_limit_info.status` has a third value,
**`allowed_warning`**, which is the only signal that arrives *before* work starts failing. The
documented fields are `status`, `resetsAt`, `utilization`, `errorCode`, `canUserPurchaseCredits`,
`hasChargeableSavedPaymentMethod` — there is **no `rateLimitType` and no `unifiedWindows`**, which
`loop-stream.mjs:63-64` currently reads and gets `undefined` from.

### 5.3 What should the loop do about a red CI job unrelated to the diff?

PR #997's red job was a **flake**. Four reasons, strongest first: the diff
(`scripts/comment-budget.mjs` + its test) cannot reach `tests/e2e/oneAccessibleNode.spec.ts`; the
failing assertion is the last of five and the four before it passed, including one proving the
caption **is** in the DOM — what came back empty was the *accessibility-tree* view of the same node,
the classic mid-transition read; `retries: 0`; and no prior red for that spec in 60 runs.

**The fix is `retries: 1` in `tests/e2e/playwright.config.ts` for CI, and it deletes the whole
question.** Playwright marks a retried-then-passed test `flaky` rather than `passed`, so the
information is preserved, the run goes green, and the loop needs no retry policy at all. A loop-side
rerun policy is the wrong shape: the loop has no way to decide "unrelated" that a model would not
have to make up, and "rerun until green" is the self-defeating safeguard CLAUDE.md names.

### 5.4 Should the session or the supervisor own the merge?

**The supervisor, polling.** Fact 2 rules out delegating to `gh`, fact 5 rules out `--auto` and Merge
Queue. The session must be *prevented* from merging, and `--disallowedTools` is explicitly **not a
security boundary** — Anthropic's own permissions documentation publishes a bypass table
(`git -C . push` defeats `Bash(git push *)`). **Only a `PreToolUse` hook is a boundary, and it fires
inside subagents too.** `scripts/guard-bash.mjs` is already registered for `Bash|PowerShell` and
already blocks six things; one more rule matching `gh\s+pr\s+merge\b` is the highest-value single
change in this document, because it is the rule whose absence caused §1 fact 1.

Two more first-party pieces make the merge crash-safe and idempotent:
`GET /repos/{o}/{r}/pulls/{n}/merge` returns 204 if merged and 404 if not — ask it first on resume,
and only merge on 404. And `gh pr update-branch` exists (with `--rebase`), separate from
`gh pr merge`, which has no update flag at all.

### 5.5 Does comment-budget earn its keep?

**Not as written.** Rewrite it to read files instead of a diff — `git show <base>:<f>` versus
`readFileSync(f)`, count each whole file, compare deltas. Block state over a whole file is
unambiguous; there are no hunk windows, no `pathOf`, no `side()`, no moved-comment credit pool (a
docstring moved from A to B nets zero across the pair automatically), and **no git-config surface at
all**, because both sides return bytes rather than a rendered diff. It deletes J1's entire class and
#987, #993 and #995 with it. Estimated: script 102 → ~45 lines, test 120 → ~50. Then move it into
`ci.yml`'s verify job, where it becomes a check that actually gates — a check only an agent can run,
in a tree it may have chosen wrongly, is the self-defeating shape it was built to police.

---

## 6. The recommended shape

Three options were costed. **Minimal repair** (+60/−20 lines) fixes eight of the ten headline defects
but touches neither the 890 lines of board nor the 560–1,280 subprocess spawns. **Redrawn split**
(supervisor owns spawn + merge only; the session owns claim → build → review → gate → push *and its
own worktree teardown*) takes `queue-loop.mjs` from 1188 to ≈420 and eliminates C1, B2, the orphaned
pending PR, G5 and G3 **by construction**. A third option — delegate the merge to GitHub — is ruled
out by facts 2 and 5.

**Take the redrawn split, and add the serialisation.** The shape:

```
for (;;) {
  if (stopFileExists()) return 0;              // do not consume it
  if (!syncCheckout()) return 1;               // dirtiness, not an origin/main diff
  if (queuePre() !== 0) return status;
  const n = pick();                            // one derive + one next-ticket; claims and re-reads
  if (!n) return 0;                            // handoff, or declined — both are routes, not nulls
  const run = await spawn(`/queue ${n}`);      // the number is passed
  const outcome = await settle(n);             // CI verdict, then poll mergeability, then merge
  record(n, outcome);
  if (breaker(outcome)) return 1;
}
```

Five properties that make the defects unreachable rather than fixed:

1. **The ticket number is an argument.** One pick, one answer. B1, B2, B3, B6, E1 and F5 have no
   premise left.
2. **The session removes its own worktree.** It is the only process that knows whether its tree is
   dirty. `queue.md:292`'s claim becomes true by construction instead of false by accident. C1–C5 go.
3. **`settle()` is the only thing that says "landed".** Not the absence of a worktree. B2 goes.
4. **No merge slot.** No in-memory pending PR to orphan, no `canStartNext`, no reattach.
5. **The session reports its own phase** on one line of stdout (`echo "PHASE C"`), or the board is
   deleted outright. Inferring a phase from outside by regexing the session's shell commands is
   precisely the architecture that produced G5. `derive()` then runs twice per ticket — 16
   subprocesses instead of 560–1,280.

Net: `queue-loop.mjs` 1188 → ≈250–420; loop machinery ≈7,100 → ≈2,600.

**Three repo-level changes that delete defect classes rather than fixing instances:**

- `delete_branch_on_merge: true` — one API call, removes F3 permanently.
- `ci.yml:598` gate from `github.event_name == 'push'` to `'schedule'` — the weekly cron already
  exists at `ci.yml:19-20`. `timings.json` has exactly one consumer (`e2e-shard.mjs`) and one
  correctness floor (`e2eShardSplit.test.ts`, which tolerates 10% unmeasured specs — about five new
  specs at the current count). Removes I1, most of the `update-branch` rounds, and the second full
  main run per merge.
- `retries: 1` in `playwright.config.ts` for CI — removes I3 and §5.3 entirely.

**And one label:** stop overloading `ready-for-human`. A mechanical park (anything `settle()`
decides) is not an owner decision. Either add `loop-stalled`, which `classify()` skips rather than
owner-buckets and which makes `gh issue list --label loop-stalled` a one-command morning report — or,
lazier and probably better, **do not park for a mechanical reason at all**: hold the ticket and
re-drain next iteration, up to the existing breaker. `park()` then only ever fires on a session-level
failure, which is what parking was for.

---

## 7. Current state and recovery

Re-derive before acting; this moved twice during the research.

As of `2026-09-12`, after someone rebased and merged most of the backlog: `main` is **25 commits
behind `origin/main`** locally; PR **#991** (`agent/983-jsx-free-rationale`) is the only open pull
request; `.worktrees/agent-983` is live at a **stale head** (`0fd06bb8` vs origin's tip); **10
`agent/*` branches** remain on origin, six of them from merged pull requests; `main`'s own CI is red
on I2.

Recovery, in order:

1. Fast-forward the primary checkout (`git merge --ff-only origin/main`) — 25 commits behind is why
   `syncProtocol` will report drift on the next start.
2. Land or close PR #991, then `npm run worktrees:remove -- .worktrees/agent-983` — **never**
   `git worktree remove` or `rm -rf` (RULES.md rule 39, and fact 4).
3. `git push origin --delete` the six merged-but-undeleted `agent/*` branches; read
   `agent/627-view-hierarchy` first (it has no PR) and `agent/955-storage-split` (it carries an
   unpushed `wip(#955): parked in phase E` commit `park()` made).
4. Strip `ready-for-human` from the four **closed** issues still carrying it (#955, #969, #987, #993)
   and post one correcting comment on each — their park comments say a landed ticket was parked, and
   those comments are the record the owner reads.
5. #992 needs nothing: the dependency graph is right and it unblocks when #983 closes.
6. File the two test defects: the `oneAccessibleNode.spec.ts:129` AX-snapshot flake (run
   `34662559313`) and the `exchangeE2EHold`/`checkStrictIndexed` repo-root race (run `34647545165`).
   `queue.md:246-248` already requires the first ("a check that turns green on a second run with no
   change is a flake to report on the issue, not a pass") and nobody made it.
7. Append a correction to `.loop-logs/run-2026-09-12.md` naming the five false parks; delete the six
   `park-*.md` files (already posted as issue comments, so nothing is lost). Do not hand-edit
   `tickets.jsonl` — the row is written from `outcome.action`, which is wrong for the reason in §1.

---

## Sources

Primary documentation:
[REST pulls](https://docs.github.com/en/rest/pulls/pulls?apiVersion=2022-11-28) ·
[GraphQL enums](https://docs.github.com/en/graphql/reference/enums) ·
[auto-merge](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-auto-merge-for-pull-requests-in-your-repository) ·
[merge queue](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue) ·
[protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches) ·
[cli/cli merge.go](https://github.com/cli/cli/blob/trunk/pkg/cmd/pr/merge/merge.go) ·
[cli/cli queries_pr.go](https://github.com/cli/cli/blob/trunk/api/queries_pr.go) ·
[Claude Code CLI reference](https://code.claude.com/docs/en/cli-reference) ·
[headless](https://code.claude.com/docs/en/headless) ·
[Agent SDK TypeScript](https://code.claude.com/docs/en/agent-sdk/typescript) ·
[cost tracking](https://code.claude.com/docs/en/agent-sdk/cost-tracking) ·
[hooks](https://code.claude.com/docs/en/hooks) ·
[permissions](https://code.claude.com/docs/en/permissions) ·
[git-worktree](https://git-scm.com/docs/git-worktree) ·
[git compat/win32.h](https://github.com/git/git/blob/master/compat/win32.h)

Measured on this machine (`gh 2.93.0`, `git 2.53.0.windows.1`, `claude 2.1.269`): GraphQL enum
introspection, `gh pr view` polling on live pull requests, `gh api repos/metasito/murlan`,
`gh run list --workflow ci.yml --limit 60`, `claude -p --max-budget-usd` runs at $0.001 and $0.005
with and without `--resume`, `claude --help` flag contrast, two `mklink /J` junction experiments
against `git worktree remove`, and the repo's own `.loop-logs/*.jsonl`.
