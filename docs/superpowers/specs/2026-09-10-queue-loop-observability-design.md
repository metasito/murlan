# queue-loop: what it shows, and what it does when a ticket goes wrong

`npm run queue:loop` (`scripts/queue-loop.mjs`) spawns one `claude -p "/queue"` per ticket and
starts the next when that process exits. It works, and it is nearly silent about what it is doing:
the child inherits stdio, so the whole session transcript scrolls past, and the loop's own
contribution is one line per ticket that can name the wrong ticket.

This redesign changes three things: what the loop prints, how it detects a run that has stopped
making progress, and how it recovers from one. The picker, the gate, the verdict binding and the
derive-don't-store principle are untouched.

Research that constrains the design: `docs/research/2026-09-10-claude-headless-observability.md`.

## 1. Defects this closes

Each was found by reading `scripts/queue-loop.mjs` and `scripts/loop-derive.mjs`, and each is
reachable today.

**Infinite resume.** `runOneTicket()` treats exit 0 as success. A session that exits 0 without
landing — parked, out of turns, or stopped by its own halt clause — leaves the worktree and the
`in-progress` label in place. The next iteration's `liveRoute()` sees a live ticket and resumes it.
Nothing compares one iteration's progress against the last, so the loop can resume the same ticket
with the same head forever, spending a full session each time.

**The header can name the wrong ticket.** `nextRoute()` runs `scripts/next-ticket.mjs` and prints
`starting #N`; the spawned session then runs the picker again, independently, and may claim a
different ticket — a peer claimed it in between, or a blocker closed. The comment at
`queue-loop.mjs:48` already worries about this for the resume path. It applies to the fresh path
too, and a log that names the wrong ticket is worse than no log.

**No stall detection.** A session wedged on an unanswerable prompt, a hung network call, or a rate
limit blocks the loop indefinitely. There is no timeout, and Claude Code publishes no flag that
bounds a `-p` run's wall clock (research §7), so nothing will end it but a human.

## 2. What the loop prints

`--output-format stream-json` is exclusive and requires `--verbose` (research §1). There is no tee:
taking the machine-readable stream means the human-readable one is ours to render. So the
supervisor parses the stream and prints its own board.

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 ⚙️  #953 · Rate limiter factory                     size:S
    github.com/metasito/murlan/issues/953   queue: 7 · 2 · 1
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ✓ [1/6] A  claim     agent/953-rate-limiter-factory   0:12
  ✓ [2/6] B  scope     6 files · reuses lib/rateLimit   1:44
  ✓ [3/6] C  build     3 commits · 4 files              8:31
  ✓ [4/6] D  review    LAND 6863af4 · round 2          12:03
  ✓ [5/6] E  land      PR #1204 · CI green · merged    22:55
  ✓ [6/6] F  close     worktree removed                23:40

  ✅ #953 landed · 4 files · 41 turns · 23m40s · $1.82
```

The header prints **after** the session has claimed a ticket, not before it starts — which is what
makes it truthful. Until then the loop prints one provisional line (`picking… 7 takeable`).

Its facts come from three places, none of them the session's word for it. The number is the ticket
in `derive()`'s branch name, once a claim marker has been seen in the stream. The title and the
`size:` label are one `gh issue view <n> --json title,labels,url` call at that moment, which also
covers the resume path, where no picker output exists. `queue: 7 · 2 · 1` is the implement, triage
and wayfinder bucket depths from the `STATUS` line `next-ticket.mjs` already emits. Elapsed times
are `m:ss` under an hour and `h:mm:ss` over it, measured from the spawn.

**Append-only.** One line is printed as each phase closes, carrying its elapsed time at that
moment. No cursor control and no ANSI redraw, so the output is identical in a terminal, in a pipe,
and in a file. In a TTY only, a single `\r`-rewritten heartbeat shows the current phase and elapsed
time during a long build; the phase's real line overwrites it and it never scrolls. When stdout is
not a TTY the heartbeat is not printed at all.

Failure and interruption get their own closing lines, in the same shape:

```
  ⚠️  #953 stalled — no output for 30m in phase C
     killed · claim released · ready-for-human · worktree removed
     log .loop-logs/953.jsonl

  ⏸  rate limited — resets 04:10, waiting
```

### Logs on disk

- `.loop-logs/<n>.jsonl` — every stream line, verbatim, appended. This is the fallback for anything
  the board does not show, and the reason no `--raw` flag is needed.
- `.loop-logs/run-<YYYY-MM-DD>.md` — one line appended per ticket as it finishes, plus a closing
  total. It is written as each ticket ends, not at exit, so it survives a crash or a closed
  terminal.

```
# queue-loop 2026-09-10

✅ #953 Rate limiter factory      landed  PR #1204   23m40s  $1.82
✅ #961 Seat vacate race          landed  PR #1205   41m02s  $3.10
⚠️ #970 Reconnect backoff         parked  no review after 4 rounds  —  $1.48

3 tickets · 2 landed · 1 parked · 3h12m · $6.40
```

`.loop-logs/` is gitignored. `.jsonl` files older than 7 days are deleted at loop start.

Both files are written UTF-8 without BOM, and every `gh` body the loop writes goes through
`--body-file` (CLAUDE.md's encoding rule — the park comment is prose with em-dashes in it).

## 3. Where the phase comes from

The phase is **derived, never announced.** A marker the session emits is a fact it can forget to
emit, and a fact nobody checks.

`scripts/loop-derive.mjs` already computes C, D and E from git and the tracker, and that stays the
authority: `commits === 0` is C, a head with no verdict is D, a `LAND` for this head is E. The
supervisor calls `derive()` when the stream shows a command that could have moved the phase, not on
a timer — a handful of calls per ticket rather than a poll.

A, B and F are not in `derive()`'s answer, and come from the tool calls in the stream: the claim
write, a `Task` dispatch, the worktree removal. That table is a premise about `queue.md`'s
commands, and a premise in prose decays, so it is pinned: **every marker pattern must match a
command that actually appears in `.claude/commands/queue.md`**, asserted in
`tests/loopDocsAreExecutable.test.ts`, which exists for exactly this class of claim. When `queue.md`
changes a command the test goes red rather than the board going quietly wrong.

A missed marker degrades to a phase line that has not printed yet. It never produces a wrong one,
and it never gates an action — nothing the loop *does* depends on the marker table, only what it
shows.

## 4. Resilience

**Stall watchdog.** No stream line for 30 minutes ends the run: `SIGTERM`, which per the docs kills
the child's Bash process tree and runs its `SessionEnd` hooks, then a hard kill after 10 seconds.
Thirty minutes is set by the longest legitimate silence: `lib/loop/ciVerdict.ts` blocks in phase E
waiting for a CI run, which regularly takes twenty. That ceiling is stated in a comment at the
constant, because the number is meaningless without it.

A stalled ticket is **parked, never resumed.** The docs are explicit that a tool call killed
mid-flight neither finishes nor runs again on resume — Claude continues without its output — so a
resumed session would be reasoning from a half-applied action.

**Park.** In order:

1. Commit anything uncommitted on the ticket's branch. An unstaged edit is the only work this loop
   can lose, and parking must not be the thing that loses it. This stages the worktree's own tree,
   which is that worktree's own index — rule 11's hazard is the *shared* checkout, and no peer is
   ever inside a ticket worktree (rule 40). A worktree with nothing committed and nothing changed
   parks the same way; the branch is simply empty, and the comment says so.
2. `gh issue edit <n> --remove-label in-progress --add-label ready-for-human`.
3. `gh issue comment <n> --body-file <file>` naming the phase reached, what is committed and on
   which branch, why it stopped, and the log path.
4. `npm run worktrees:remove -- .worktrees/agent-<n>` (rule 39 — never a recursive delete; the
   `node_modules` junction).

If any step fails, the loop halts rather than continuing with a ticket in an unknown state.

**No-progress guard.** The supervisor holds the previous iteration's `{ticket, head, commits}` for
the duration of its own process. A ticket resumed with none of them changed is parked. Nothing is
written to disk: the supervisor is alive across iterations, so this is memory, not state, and there
is no third copy of the truth to disagree with git and the tracker.

**Circuit breaker.** Three consecutive tickets that do not land halts the loop. One bad ticket is a
ticket; three in a row is the loop or the machine, and continuing spends a night proving it.

**Spend ceiling.** `--max-budget-usd 15` per ticket. The run ends with `is_error` and the ticket is
parked. Fifteen is generous for a `size:M` carrying four review rounds and a couple of CI fix
rounds; only a runaway reaches it.

**Rate limits.** The stream carries `rate_limit_event` unprompted, with `resetsAt`. The board shows
it, so the loop being throttled is legible instead of looking like a hang, and the watchdog's clock
is not the thing that reports it.

**Failure kind** is read from the final `result` event — `is_error`, `subtype`, `terminal_reason`
— not from the exit code. The research found no documented exit-code taxonomy beyond zero /
non-zero, plus 143 for SIGTERM specifically, and one live case where `is_error: true` arrived
alongside `subtype: "success"`. The exit code decides only whether the process ended; the result
event says what happened.

## 5. Stopping it

`.loop-stop` in the repo root: the loop reads it at the top of each iteration, deletes it, and
exits cleanly after the current ticket finishes. Creating it from another terminal is the only
interface. It cannot go stale, because reading it removes it.

This exists because Ctrl-C does not do the job: the terminal signals the whole process group, so
the child dies mid-ticket and leaves a claimed worktree behind — the exact state the park path
exists to avoid, arrived at by the one gesture a person reaches for first.

## 6. Files

| file | job |
|---|---|
| `scripts/loop-render.mjs` | *new.* State → strings: header, phase line, closing line, morning-report row. No IO, so every format is a unit test. |
| `scripts/loop-stream.mjs` | *new.* One JSONL line → a loop-level fact (`tool`, `result`, `rate_limit`, `ignore`), plus the phase-marker table. Pure; driven by fixture lines. |
| `scripts/queue-loop.mjs` | Spawn, watchdog, park, circuit breaker, `.loop-stop`, `main()`. `main()` becomes async — a streamed child is `spawn`, not `spawnSync`. |
| `scripts/loop-derive.mjs` | Unchanged. Still the authority on C/D/E. |
| `scripts/next-ticket.mjs` | Unchanged. |
| `.gitignore` | `+ .loop-logs/` |

The child's stdout is piped and parsed; **stderr stays inherited**, so a crash still prints itself
without the loop having to reproduce it.

## 7. Tests

- `tests/loopRender.test.ts` — *new.* Every rendered line against a fixed state: a landed ticket, a
  parked one, a stall, a rate limit, the morning-report row, the closing total. Pure strings.
- `tests/loopStream.test.ts` — *new.* Fixture JSONL lines (captured shapes from the research file)
  → the facts they should produce, including a `result` carrying `is_error`, and a line that is not
  JSON at all.
- `tests/queueLoop.test.ts` — extended: the no-progress guard parks rather than resuming; the
  circuit breaker halts on the third consecutive failure; `.loop-stop` drains; the watchdog fires
  on silence and not on a slow-but-talking child.
- `tests/loopDocsAreExecutable.test.ts` — extended: every phase-marker pattern matches a command
  present in `queue.md`.

Each new check is watched failing first, for the reason claimed (rule 6). The watchdog and the
circuit breaker are driven by injected clocks and fake spawns; nothing in this suite spawns
`claude`.

## 8. Deliberately not doing

- **Retries.** A failed ticket parks. A retry that resumes a killed mid-flight tool call is
  reasoning from a half-applied action, and one that starts over spends a second session to reach
  the same place.
- **A `--raw` flag.** `.loop-logs/<n>.jsonl` is the raw transcript, and a flag is a second way to
  get what a file already holds.
- **`--include-partial-messages`.** Token-level deltas, multiplying line volume, for a board that
  renders nothing per-token.
- **`--include-hook-events`.** The `assistant` event's `tool_use` blocks already carry which command
  ran; hook pairs add volume and no fact the board uses.
- **Passing the picked ticket number to the session** (`/queue 953`). It would halve the picker's
  API calls and remove the two-pickers disagreement, but it changes `next-ticket.mjs`'s `explicit`
  route and `queue.md`'s phase A. Printing the header after the claim fixes the truthfulness
  problem, which is the part that mattered; the duplicated picker costs about three seconds against
  a twenty-minute ticket.
- **Parallel tickets, CI-speed work.** Out of scope by standing decision.
