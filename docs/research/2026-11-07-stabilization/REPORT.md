# Stabilization: why nothing holds, and what makes it hold

Read against `main` at `fe9de691`, 2026-11-07. The owner's brief: no new features. Make what
exists work, stop the same defects coming back, and set up a way of working that keeps it that
way. Three read-only investigations fed this report; their evidence is kept beside it:

- [recurrence.md](recurrence.md): 921 closed issues and the git history, on why fixed defects come back.
- [performance.md](performance.md): the table's render pipeline, on why a 2D table drops frames.
- [ci-reliability.md](ci-reliability.md): every failed `ci.yml` job in the last 300 runs, classified.

A label says how each claim is known: **measured** (run in this session), **read** (seen in the
code), **inferred** (reasoned, not reproduced).

## Verdict

The game does not lack effort, tests or rules. It lacks a gate on what the player sees. Since
August the repository has taken about 4,750 commits (**measured**, `git log`), about 50 a day.
For every line of product code there are about three lines of tests, tooling and process (**measured**:
product ~64k lines, tests ~149k, `tools/` ~33k, `.claude/` ~12k). In October more commits changed
process than product (663 against 519). Yet no check that can block a merge looks at the table as
it is played:

- the pixel and motion parity specs run nightly, report-only, and route to no one;
- the review that does block a merge reads text, and a visual defect there is a Nit;
- the perf check runs a renderer real players never get, under reduced motion;
- the mockups the parity specs compare against are edited in the same commits as the code they judge.

So every visual or performance fix lands green whether or not it works, and the next change undoes
it unseen. That is the windmill: high velocity, no ratchet.

## What was red, and why (fixed in this change)

The nightly mockup-parity run (#1985) failed the same 7 tests three nights in a row, on the same
commit (**measured**: CI logs of runs 42017337705, 42208479210, 42364128786). It was a regression
on `main`, not a flake. A local bisect over the 9 merges between the last green night (`e2d0eee9`)
and the first red one names two causes (**measured**):

1. **#1974 (`952d3045`) letterboxed the felt.** It replaced the live cloth shader with a cloth baked
   to an image, sized `DESIGN × (dpr·sx, dpr·sy)`. React-native-skia draws an `<Image>` with
   `fit="contain"` unless told otherwise, so wherever the window's shape differs from the
   874×402 design (`sx ≠ sy`), the cloth was shrunk and centred inside the felt. On a tablet that is
   black bands either side of the cloth and the lamp's light pulled to the middle. That is the
   "weave 0.0" failure: the sample patches sat on black. On the iPhone SE the side seats went
   dark: on-move ratio 1.90 against a floor of 3.8, where it was 7.67 before. An iPad player saw a
   broken table for three days. **Fix:** the felt's images stretch to the design rect
   (`fit="fill"`), and a new lint guard, `skia-image-fit` in `eslint.guards.cjs`, refuses a Skia
   `<Image>` that leaves its fit implicit. That closes the class, not just the instance. After the
   fix the SE reads 7.23 and the tablet cloth fills the felt (**measured**).
2. **#1977 centred the table on the window**, so symmetric insets no longer move the pile. The
   lampSeats spec proved "the insets took effect" by asserting the pile moved, which became false
   by design. **Fix:** its floor now asserts what the insets must change, the rail's width
   (`railWidth` grows from 58 to 74 under a 62pt inset), and the light-over-pile check keeps its
   meaning.

Every PR in that window was green. Each was checked by the checks that block a merge, and those checks
cannot see this class of defect.

## The structural causes, ranked

### 1. No check that blocks a merge looks at the table

**Evidence.** On 2026-10-11 the parity specs left pull-request CI to meet rule 46's five-minute
target. A red nightly then became report-only: never routed to an agent, and its issue closed itself on the next green run
(see [recurrence.md](recurrence.md) §1.8 and §5). Since then the nightly has been red for 5 nights
(#1645), 6 (#1867), then #1951 and #1985. The loop's reviewer has no way to look at pixels, and a visual
defect there is a Nit ("Nits go in the PR body, unfixed").

**Remedy.**

- A pull request that touches what the parity specs cover must have a green parity run on its own head
  before it merges. Most PRs never touch the table, so they pay nothing.
- A red nightly is bisected to the PR that caused it, that PR's ticket is reopened, and
  `components/` is closed to other merges until the nightly is green again.

This is the single change that would have stopped every regression in this report. It reverses
the 2026-10-11 ruling, so it is the owner's decision (see *Decisions for the owner*).

### 2. The target moves with the code

**Evidence.** Since the lantern mockup was made (09-24), 101 commits edited the parity harness or the
mockup HTML, and 43 of them changed product code in the same commit ([recurrence.md](recurrence.md) §2).
Per-moment exemptions sit exactly where app and mockup disagree. The app captures and
`tests/fixtures/handRow.json` were re-recorded in the commits that changed what they measure.

**Remedy.** Mockups, exemptions, captures and thresholds change only in a commit that changes
nothing under `app/`, `components/` or `lib/`. A CI check refuses the mixed diff, and CODEOWNERS
makes the owner the reviewer of the target. A target that moves with the code holds nothing.

### 3. The table is never at rest, and the perf check measures the wrong renderer

**Evidence.**

- **The table never rests.** The lamp sways forever (`components/table/lampRig.ts`), so up to three
  full-screen canvases repaint at device resolution every frame. These are the felt, the hand shade
  and the particles.
- **Every card is layered.** Each card carries 12–20 DOM nodes and 5–8 animated values. The 39
  opponent backs alone hold about 230 mappers.
- **Shadows are drawn twice.** Card shadows are a second rendering of every card, rebuilt whenever
  any card moves.
- **The cloth cache misses.** In a 4-player game it misses on every turn (**measured**: 2.00 bakes a
  turn, a 100% miss rate).
- **The perf check runs the wrong path.** `perf:web` runs software WebGL, so the Skia felt and the
  hand shade never mount (**read**). Every baseline since #1968 measured a renderer real players
  don't use.

Full detail in [performance.md](performance.md).

**Remedy, in this order.**

1. The felt becomes one static bake per layout, with the lamp as one small light texture moved by a
   transform.
2. Shadows are baked into the card sprite, which deletes the shadow registry and the hand-shade canvas.
3. Cards are drawn from an atlas, with no per-card gloss or foil on backs.
4. A resting table has no frame callbacks, no canvas redraws and no mappers, and a test asserts zero
   paints over a settled two seconds.
5. The perf check runs on the Skia path, with motion on and at 4x throttle, as rule 51 already demands.

This is a rebuild of the table's renderer, not a tweak. It is the only way the frame drops end,
because each past perf ticket made one layer cheaper and the next feature added another.

### 4. CI is red one PR run in three, and half of that is not the PR's fault

**Evidence.** 49 of 166 pull-request runs failed (29.5%). Of 65 failed attempts, 32 were not
caused by the PR under test ([ci-reliability.md](ci-reliability.md)). The causes:

- the secret scan reads all ~159 branches, so one branch's false positive reds everyone;
- each of 17 browser shards pulls its own Postgres and Valkey image from a registry;
- the browser-report job never installs its dependencies, so the timings check cannot pass;
- integration servers probe a port, release it and bind it later, with `reusePort` hiding the clash;
- signing out closes a socket mid-handshake, and Chrome's warning fails strict specs;
- a new `npm audit` advisory reds unrelated PRs.

Every red run costs an agent a round trip and teaches everyone to rerun.

**Remedy.** Fix each cause at its source (this change takes the first five). A flake is a P0:
the first agent to see it fixes or quarantines-with-ticket that day, never reruns.

### 5. Process has become the product

**Evidence.** A visual ticket reads about 29k tokens of mandatory process before any code
([recurrence.md](recurrence.md) §3). `docs/agents/checks.md` alone is 52 KB. `tools/loop` is 31.6k
lines with 768 commits, more than double `GameTable.tsx`'s 364. `RULES.md` has 80 commits, `checks.md` 174
and `queue.md` 120, and rule 46 alone was edited 9 times. Rules are numerous but mostly prose. The ones
that hold are the ones a machine enforces (the lint guards, the doc-reference test).

**Remedy.**

- Freeze edits to the loop and process docs for a month.
- Cut `checks.md` to its routing table.
- Every rule that matters becomes a check that fails; a rule that cannot be checked is advice and
  moves out of the always-read set.

### 6. No module owns the table's layout

**Evidence.** The HUD chip overlap (#1981) went round three fixes and a label shortened to hide the
overlap within a day. The hand fan was fixed off-screen, then for four copies of its geometry, then three
resize fixes, then #1829, then #1653 ([recurrence.md](recurrence.md) §1.2, §1.7).

**Remedy.** A pure layout solver returns every rect on the table. A property test over 5 viewports ×
3 locales × the captured states asserts no overlap and nothing off-screen. This is rule 47 applied to
layout.

## The system of work: rules that cannot be bent

A rule holds only when a machine refuses its breach. Each item below is a mechanism, not a sentence.

| # | Rule | Mechanism | State |
|---|---|---|---|
| S1 | A change the player can see is checked by looking. | A PR touching `components/`, `lib/tokens.ts`, `lib/theme.ts` or the table's assets needs a green parity run on its head (dispatched `parity-nightly.yml`) before `CI gate` passes. | declined by the owner, 2026-11-07 |
| S2 | A red nightly stops visual merges. | While a `parity` issue is open, `CI gate` refuses a PR touching those paths unless that PR's own parity run is green. The nightly is bisected and the culprit PR's ticket reopened. No auto-close. | declined by the owner, 2026-11-07 |
| S3 | The target never moves with the code. | CI refuses a diff touching both the parity targets (`tests/e2e/fixtures/`, mockup exemptions, captures, thresholds) and `app/`, `components/` or `lib/`; CODEOWNERS on the targets. | built: `Target freeze` in `ci.yml`, run from base's copy; `TARGETS` in `tools/ci/target-freeze.mjs`; rule 52. The captures are left out: they are a reading of the app, never compared. CODEOWNERS (`@rotonmeta`) is routing only, since the owner authors the pull requests |
| S4 | The table costs nothing at rest. | A blocking spec counts paints and frame callbacks over a settled 2 s window and fails on any. | proposed: needs the renderer rebuild first |
| S5 | Speed is measured on the renderer players get. | `perf:web` on the Skia path, motion on, 4x throttle, with owner-held budgets, blocking on table changes. | proposed |
| S6 | A flake is fixed at its source the day it is seen. | No reruns (already rule-backed for device jobs); a flaky test is fixed or quarantined with a ticket by the agent who saw it. | partly: this change fixes the five known causes |
| S7 | Every invisible default is named. | Lint guards for defaults that change meaning with the window (`skia-image-fit`, added here); one per class found. | started |
| S8 | No feature work until S1–S3 hold and the renderer rebuild lands. | The queue takes only `bug`, `ci`, `perf` tickets. | undecided |

## Everything noticed, to repair

Grouped by area. *fixed here* means this change fixes it; everything else is open.

**Visual and table**

- Felt cloth letterboxed on any window not shaped 874×402 (iPad: black bands, side seats dark). *fixed here*.
- lampSeats floor asserted a pile move the centring design removed. *fixed here*.
- The baked-cloth cache (3 targets) misses every turn in a 4-player game: two full-resolution bakes
  with GPU readback, synchronous in render, each turn ([performance.md](performance.md) §1).
- The felt runs the live procedural shader during every lamp glide (~2 s), which is most of play.
- The hand-shade canvas is a second full-screen WebGL context on web.
- The particle canvas redraws at 30 Hz forever while motes exist.
- The opponent backs carry per-card gloss, foil glint and level shade: ~230 mappers for cards that never change.
- The fallback felt's shadow context changes on every lamp aim, re-rendering ~55 cards each turn.
- The 120 Hz unlock doubles the cost of every continuous redraw.
- `perf:web` never mounts the Skia felt (software WebGL), so its baselines measure the fallback.
- Layout has no owner; the chip row and hand fan have each been re-fixed many times.
- #1977 moved the app and only part of the lantern mockup: the mockup kept the cards' lit lip and face
  gloss, the standings board's old centre and the old felt base fill. Each surfaced as a red nightly
  moment. *fixed here*, in commits that change the mockup alone. The class stays open until S3 holds. Run over the 389 merges since 2026-09-24, S3's guard refuses 55, #1977 and #1986 among them.
- The online room at phone landscape pushed its format controls below the fold for any name over
  about 12 characters (names may be 30): the status line wrapped. *fixed here*. The tap-target sweep
  had used 12-character names, so the fixture's gentleness hid it; the sweep now uses the longest name.
- At the round's end (`plose`, t=1440) the app draws a bright sweep down the felt's right edge that the
  mockup has no counterpart for; it lies outside every measured region, so no check sees it.
- #1977 mixed a straight's display order (`lib/game/gameEngine.ts`, `buildCombination`) into a
  visual PR. It changes no strength and no rule, but an engine change belongs in its own reviewed diff.

**CI and tests** ([ci-reliability.md](ci-reliability.md))

- The secret scan read every branch, so two branch-only findings reddened main and unrelated PRs. *fixed here*: a PR scans its own commits, main its own history, and the script refuses any other range.
- The browser test report job never runs `npm ci`; `tests/e2e/timings.json` stale since 2026-10-21. *fixed here*.
- The integration servers' port probe-then-bind race with `reusePort`, and their child stderr silenced. *fixed here*: servers boot on `PORT=0` and report the port they bound; `reusePort` is gone from `server/index.ts`, so a clash is `EADDRINUSE`, not a silent share.
- `tools/ci/e2ePort.mjs` still probes a free port and binds it later: the same window, now loud rather than silent.
- `tests/integration/ownerKilledRejoin.test.ts` passes in 4 s, then holds the file open about 60 s: a handle left open.
- `boot()` in `tests/helpers/instance.ts` waits a fixed 600 ms after the serving line for the Redis adapter; it wants a readiness signal, not a sleep.
- `tests/integration/redisDegraded.test.ts` passes a `LOG_LEVEL` the logger never reads.
- Sign-out closes a socket mid-handshake; Chrome's warning fails strict specs. *fixed here* (`lib/socket.ts`, `tests/native/socketTeardown.test.tsx`).
- Riprova calls `socket?.disconnect().connect()` (`context/OnlineGameContext.tsx`); pressed while an attempt is still opening it closes a connecting websocket the same way.
- `halt` in `context/SocketContext.tsx` calls `socket.disconnect()` directly; it normally runs once the engine has settled, but nothing guarantees it.
- `tests/e2e/tapTargets.spec.ts` builds usernames inline, the collision-prone way. *fixed here*.
- 17 browser shards each pull database images from a registry; use job `services:` or one cached image.
- `npm audit` as a PR gate reds unrelated PRs on a new advisory; gate only on the lockfile diff, audit on the schedule.
- Main pushes skip the suite when the tree passed on its PR, so main's 0% failure rate measures the skip.
- Committed outputs of other checks (`online-table.txt`, `storedShapes.json`, `protocolHashes.json`,
  the timings) cost a PR a round trip; generate them in CI instead.
- TypeScript under `docs/research/` is typechecked and scanned like app code.

**Process**

- About 29k tokens of mandatory reading per visual ticket; `checks.md` is 52 KB.
- The loop's reviewer cannot see pixels; review rounds may not fix a Blocking finding's siblings.
- A symptom fix can close while its root-cause issue (e.g. #870, the real disconnect cause, open
  since 09-03) stays parked.

## Decisions for the owner

Asked 2026-11-07; the answers stand until the owner changes them.

1. **S1 and S2, parity specs blocking visual PRs: declined.** The 2026-10-11 ruling stands. A PR
   that changes the table therefore carries its own evidence instead: the full nightly parity suite
   run on its head, before and after captures, and its frame numbers, in the PR body.
2. **S8, a freeze on features and process edits: undecided.**
3. **The renderer rebuild (cause 3): approved, on the condition that the table stays as good to look
   at as it is.** It lands as a sequence of small PRs, each held to the parity suite and the captures
   above, and each reviewed before it merges, green CI or not.
4. **The felt's resolution: capped at 2.5 device pixels per design point, as the mockup caps it
   (`V.K`).** The felt renders at the cap and is scaled up to the screen. On 3x screens the weave
   reads as the mockup's, about half today's strength, and the felt draws about 30% fewer pixels.
   It lands with the deferred cloth, with captures of today against the cap at 3x in that PR.
