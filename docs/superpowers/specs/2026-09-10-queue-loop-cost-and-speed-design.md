# queue-loop: what the supervisor should do instead of the model

Companion to `2026-09-10-queue-loop-observability-design.md`, which covers what the loop *shows*.
This one covers what it *costs* — wall clock and tokens — and moves work out of the model's context
that never needed to be there.

Research: `docs/research/2026-09-10-claude-headless-observability.md` and
`docs/research/2026-09-10-headless-cost-and-speed.md`.

## 0. The measurement that decided this

The overlap question below turns on one number nobody had: how often does CI go red on a ticket
that already passed `npm run agent:check`? Measured across the eleven most recent merged `agent/*`
branches, via `gh run list --workflow ci.yml` per branch:

**13 `ci.yml` runs, 11 branches, 2 branches needing a second run — 18% red.** Nine of eleven tickets
had exactly one CI run and it was green. Checked for survivor bias too: of the last forty pull
requests, exactly one `agent/*` branch never merged, and not for CI.

Eighty-two per cent of tickets need no model at all after the push. That is what makes the rest of
this worth building, and it is a floor to re-measure once the loop is recording it itself (§3).

## 1. The supervisor owns everything after the push

Today the session pushes, then blocks inside `lib/loop/ciVerdict.ts` for ten to twenty minutes,
then reads the verdict, merges, and closes out. Nothing in that stretch is a judgement. `ciVerdict`
already returns `{pass, runId, failedStep, output, infrastructure}`; `decideLanding()` in
`lib/loop/land.ts` is already a pure function over the PR's merge state. A model reading a CI log to
decide "green means merge" is a model spending turns on a switch statement.

So phase E ends at the push. The session writes nothing more and exits. The supervisor then:

1. `ciVerdict` on the pushed head.
2. `pass: true` → `land.ts`. `update-branch` if it says so, re-read the verdict, merge, remove
   `in-progress`.
3. `pass: false` → the ticket goes back in the loop's hands (§2).
4. `infrastructure: true` → ask once more, as `queue.md` already says; a job that ran zero steps
   says nothing about the diff.

`queue.md`'s phase E loses its CI-reading and merge steps and gains one line: push, then exit. Phase
F's close-out — the definition-of-done comment and the plain-language line — stays with the model,
because that *is* judgement. Teardown moves to the supervisor with the merge.

This is a strict reduction: fewer model turns, fewer tool outputs in context, and one fewer place
where a green line can stand for a suite nobody ran.

## 2. Overlapping the CI wait

With the post-push stretch mechanical, the wait no longer needs a session sitting in it. The
supervisor starts the next ticket while the previous one's CI runs, and merges the pushed branches
in the order they were pushed.

```
#953  A B C D E push ─┐
#961          A B C D E push ─┐
        supervisor: CI #953 ──┘ merge
                        supervisor: CI #961 ── merge
```

Four invariants, and together they are what keeps this from becoming two-tickets-at-once:

- **Never two sessions at once.** Exactly one `claude -p` runs at any moment. What overlaps is a
  session and a CI wait, never two models building.
- **The supervisor merges in push order, one at a time.** GitHub runs CI on both branches the moment
  each is pushed, and that costs nothing to allow; what must be serialised is the *merge*, because
  each one moves main under whatever is still open.
- **A red ticket blocks the queue.** The moment a pending ticket's CI fails, no new ticket starts —
  the next session is the one that fixes it. There is only ever one session, so a red ticket and a
  new ticket cannot both have one.
- **No overlap across a dependency change.** If the pending ticket's diff touches `package.json` or
  `package-lock.json`, the supervisor drains it fully before starting the next ticket. Worktrees
  isolate branches and indexes; they do not isolate `node_modules`, which is one shared install
  behind a junction, and a dependency change mid-build is how a peer session gets a green
  typecheck against phantom modules.

So at most two tickets exist at once, in exactly one shape: one being built, one waiting to merge.

**The red path.** When CI fails on a ticket whose session has already exited, the supervisor lets
the current session finish its push, then spawns a fresh `claude -p "/queue"` for the red ticket
rather than for a new one. That session finds it through `derive()` exactly as it finds any live run
— the branch exists, `in-progress` is still set, the PR is open — reads the failure from the PR,
fixes it, gets a fresh review of the new head (the verdict is sha-bound, so the fix cannot ride the
old one), and pushes again. Three attempts on the same failure, then park, which is what `queue.md`
already says.

The ticket that pushed while the red one was being fixed simply waits its turn to merge; its CI has
been running the whole time, so the wait is usually already spent.

That path costs one fresh initial context per red CI. At the measured 18% that is roughly one extra
session for every five and a half tickets, against ten to twenty minutes of idle machine on every
single one.

**The cost of being behind.** The second branch was cut from `origin/main` before the first merged,
so its PR comes up `BEHIND` and needs `gh pr update-branch` plus one more CI run.
`decideLanding()`'s own comment already reasons about this: updating costs one run instead of the
two that merging-behind causes. On a public repository standard-runner minutes are free, so this
trades CI wall clock — which overlaps — for local wall clock, which does not.

**What is deliberately not protected.** Two consecutive tickets editing the same file will conflict.
The supervisor cannot know a ticket's files before its session runs, and guessing would mean
holding tickets back on a prediction. The conflict surfaces where conflicts already surface:
`decideLanding()` returns `stop` on `CONFLICTING`, and the ticket parks with the branch intact.

## 3. Instrumenting what a ticket costs

The supervisor already parses the stream for the board. The same parse yields, per ticket, a row
appended to `.loop-logs/tickets.jsonl`:

```json
{"n":953,"size":"size:S","outcome":"landed","pr":1204,
 "phases":{"A":12,"B":92,"C":407,"D":212,"E":1375,"F":45},
 "cost":1.82,"turns":41,"models":{"opus":1.60,"sonnet":0.22},
 "subagent_cost_est":0.71,"subagents":{"spawned":3,"failed":0},
 "cache":{"created":26069,"read":15320},"ci":{"runs":1,"red":0},
 "review_rounds":2,"claude_version":"2.1.251",
 "started":"2026-09-10T22:14:03Z"}
```

Every field comes from something already in hand: phase timings from the board's own clock,
`cost`/`turns` from the final `result` event's `total_cost_usd` and `num_turns`, `ci` from
`ciVerdict`'s answers, `review_rounds` from the count of verdict comments.

`models` and `subagents` need one step more than reading a field. `modelUsage` pools by **model
name**, not by agent, so with this loop's shape — an opus main session, two opus reviewers, one
sonnet recon — the sonnet share separates cleanly and the three opus consumers do not.
`subagent_stats` carries counts only, no tokens, and appears in no documentation. The split that
answers "what do the reviewers cost" comes from bucketing the stream's messages by
`parent_tool_use_id`, which the supervisor is already reading every line of. That is a
reconstruction, not a reported figure, and the row says so by naming the field `subagent_cost_est`.

`cache_creation_input_tokens` and `cache_read_input_tokens` go in the row too, because §5 turns on
them.

One file, one line per ticket, append-only, never read by the loop. It exists so the next question
about the loop is answered with `jq` instead of an estimate — which is how §0's number was got, and
why §2 is in this spec rather than deferred.

## 4. Mechanical work out of phase A

Phase A currently spends model turns running `prune-worktrees.mjs`, `preflight.mjs` and
`loop-status.mjs` — loop-level housekeeping with nothing to do with the ticket, whose output lands
in every ticket's context. The supervisor already calls `derive()` before spawning; it should run
the rest there too, plus one thing nobody runs at all:

- `prune-worktrees.mjs` — a killed run never reached its own teardown.
- `preflight.mjs` — refuses to start on a peer's uncommitted work. A failure here is a loop-level
  halt, which is what it always was; the model was never the right thing to be deciding it.
- `reap.mjs --stale` — an unattended night leaks jest workers and orphaned node processes, and a
  starved machine reads exactly like a regression. `--stale` takes only what is orphaned *and* old,
  never anything a live session owns.

`queue.md`'s phase A then starts at `next-ticket.mjs`, with one line saying that a by-hand `/queue`
should run `npm run queue:pre` first — a new script wrapping the same three, so the human has one
command and the model has no conditional to evaluate.
`tests/loopDocsAreExecutable.test.ts` already pins that every `npm run` named in `queue.md` exists.

The token saving is small — three tool calls and their output. The latency saving is three
round-trips per ticket, and the real gain is that skipping preflight stops being something a model
can decide to do.

## 5. The prefix every ticket pays for twice

A fresh `claude -p` pays for its whole initial context — system prompt, tool definitions,
CLAUDE.md, the skills manifest. Measured in this worktree: **41,389 tokens**, of which 26,069 were
billed as cache *creation*. A second identical invocation seconds later paid **zero** — the cache
is server-side and warm across processes, with a one-hour TTL on this account.

So the loop should be getting that for free from the second ticket onward. It is not, and the
reason is specific: **the git status snapshot is part of the cached prefix, and the loop commits
and merges between tickets.** Every ticket changes branch and recent-commits, so every ticket's
session rebuilds the prefix from the top at full price.

Three changes, in descending order of what they are worth:

**`--exclude-dynamic-system-prompt-sections` on the spawn.** Documented as moving working
directory, environment info, memory paths and the git-repo flag out of the system prompt and into
the first user message, "to improve prompt-cache reuse across different users and machines running
the same task" — which is the same shape as our problem, one machine running the same task
repeatedly. This is doc-sourced and **not live-confirmed**: nobody has run two tickets with it on
and read the numbers. The implementation therefore treats it as a hypothesis with a test, not a
setting to add — §3's row already records `cache_creation_input_tokens`, so the first two tickets
after the change either show the second one near zero or they do not, and the answer goes in the
plan's notes either way.

**`DISABLE_AUTOUPDATER=1` for the batch.** A new Claude Code version updates the system prompt and
tool definitions, so the first session after an upgrade builds its cache from the top. Native
installs update in the background and apply on next launch — which, for a loop spawning a fresh
process per ticket, means an update landing at 2am silently converts every remaining ticket of the
night into a full-price cache miss, with nothing to see. The supervisor pins the version for the
run and reports it in the header. Whether to update is a decision for a person between runs, not
an event that happens to one.

**`--tools` from `queue.md`'s own `allowed-tools`.** Tool definitions cost about 876 tokens each in
this build, measured: dropping ten took the prefix from 41,389 to 32,630. `queue.md`'s frontmatter
already declares the ten tools the loop uses; that declaration governs permission, not what is
loaded, so the session carries twenty-nine. Passing the same list as `--tools` makes the
declaration mean what it appears to mean. It is read from the frontmatter rather than repeated in
the supervisor, and `tests/loopDocsAreExecutable.test.ts` pins that the two agree — a second copy
of that list is exactly the kind of premise that decays.

One thing deliberately left alone: **subagent prompt caching**. Subagents get a five-minute TTL
regardless of the parent's plan, and phase B's recon and phase D's reviewers are more than five
minutes apart, so each starts cold. `CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL` could raise it, but the
three subagents have different prompts and different models, and no measurement here says what
share of a ticket's cost their prefixes actually are. §3's `subagent_cost_est` is what answers that;
until it has, changing the knob would be guessing.

## 6. What this does to the board

The companion spec's board has six phases ending at `F close`, with the merge inside `E land`. With
the post-push stretch owned by the supervisor, the ticket's own phases end at the push and the
supervisor's stretch is shown as its own row — which is more honest, because it is the row that
runs while the next ticket is already building:

```
  ✓ [1/6] A  claim     agent/953-rate-limiter-factory   0:12
  ✓ [2/6] B  scope     6 files · reuses lib/rateLimit   1:44
  ✓ [3/6] C  build     3 commits · 4 files              8:31
  ✓ [4/6] D  review    LAND 6863af4 · round 2          12:03
  ✓ [5/6] E  push      PR #1204                        13:20
  ✓ [6/6] F  close     DoD ticked                      13:52

  ⏳ #953 CI running · next ticket started
  ✅ #953 merged · 4 files · 41 turns · 22m10s · $1.82
```

The `⏳` and `✅` lines are the supervisor's, printed under whichever ticket's header they belong to
even when a later ticket's board has begun — each carries its own `#n`, so the two never read as
one ticket.

## 7. Files

| file | job |
|---|---|
| `scripts/queue-loop.mjs` | Gains the merge queue, the post-push mechanical path, the pre-checks, and the spawn flags of §5. |
| `scripts/loop-tools.mjs` | *new.* Reads `queue.md`'s `allowed-tools` frontmatter into the `--tools` list, so the declaration and the spawn cannot disagree. |
| `scripts/queue-pre.mjs` | *new.* prune + preflight + reap, one command. Called by the supervisor and by a by-hand `/queue`. |
| `scripts/loop-record.mjs` | *new.* Builds the `tickets.jsonl` row from a finished run's facts. Pure; unit-tested against a fixture `result` event. |
| `lib/loop/land.ts`, `lib/loop/ciVerdict.ts` | Unchanged. Called by the supervisor instead of by the model. |
| `.claude/commands/queue.md` | Phase E ends at the push. Phase A starts at the picker. Phase F keeps the close-out comment, loses teardown. |
| `package.json` | `+ queue:pre` |

## 8. Tests

- `tests/loopRecord.test.ts` — *new.* A fixture `result` event plus fixture phase timings produce
  the expected row, including a ticket with no `modelUsage` and one that parked.
- `tests/queueLoop.test.ts` — extended: merges happen in push order and one at a time; a dependency-touching diff
  drains the queue before the next ticket starts; a red CI queues a fix session rather than parking
  immediately; pushes merge in the order they were made.
- `tests/loopDocsAreExecutable.test.ts` — extended: `queue.md` no longer names the commands that
  moved to the supervisor, does name `npm run queue:pre`, and its `allowed-tools` frontmatter is
  what `--tools` is built from — parsed, not compared against a copy.

The merge queue is driven by a fake clock and fake `ciVerdict`/`land` results; nothing in the suite spawns
`claude` or touches GitHub.

**One check is not a unit test.** `--exclude-dynamic-system-prompt-sections` is a hypothesis about
a cache, and no fixture can falsify it. The plan carries it as a measurement: run two consecutive
tickets, read `cache.created` from both rows in `tickets.jsonl`, and record the answer. If the
second ticket still pays full creation, the flag does not do here what the docs say it does
elsewhere, and it comes back out.

## 9. Deliberately not doing

- **Two concurrent sessions.** The overlap is a session against a CI poll. Two models building at
  once share one `node_modules` and one machine's memory, and the memory starvation that causes
  reads as a red suite rather than as itself.
- **Predicting file collisions between consecutive tickets.** It would hold tickets back on a guess;
  the merge already refuses a conflict.
- **Splitting a ticket across models by phase.** Phase A and F are mechanical enough to want a
  cheaper model, but they share a session with the phases that are not, and splitting the session
  loses the context that makes F's close-out honest.
- **CI speed work.** A standing decision, and §0 says the suite is green 82% of the time anyway.
