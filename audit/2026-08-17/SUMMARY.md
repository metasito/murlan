# SUMMARY — Murlan full repository audit

**Date:** 2026-08-17 · **Commit:** `b894af461550cd1a184a6a6f1694baf10d27b70c` · **Branch:** `main`
**Method:** ten parallel specialist agents over a shared recon map, read-only, every finding
self-scored 0–100 and deleted below 80; all 20 Critical/High findings then re-verified by the
orchestrator against the cited lines.

---

## Counts

| Severity | Count | | Category | Filed | Tracked |
|---|---|---|---|---|---|
| **Critical** | 3 | | Security (SEC) | 8 | 8 |
| **High** | 17 | | Rules (RULE) | 10 | 10 |
| Medium | 60 | | Netcode (NET) | 11 | 9 |
| Low | 42 | | Resilience (RES) | 11 | 12 |
| **Total** | **122** | | Performance (PERF) | 10 | 10 |
| | | | UI visual (UI) | 12 | 11 |
| Filed by the ten agents | 120 | | UX / game feel (UX) | 12 | 12 |
| Merged away (still traceable) | 7 | | Accessibility (A11Y) | 13 | 13 |
| Promoted from Opinions / enumerations | 9 | | Architecture (ARCH) | 16 | 16 |
| Self-dropped before filing | 31 | | Testing/build (TEST) | 17 | 21 |
| Killed by orchestrator | 2 | | | | |

**Nothing was dropped for being low-priority.** The 7 merged IDs resolve through the
merged-ID index in `BACKLOG.md`; a further **9 items were promoted out of the reports'
`Opinions` sections and A2's untested-rule enumeration** after the orchestrator verified each
one (Appendix A). Two of those nine had been raised independently by two different agents,
which is what flagged them as substance rather than taste.

---

## The five things that matter

### 1 · A player who is losing can quit and never be scored — SEC-02, Critical

The cheapest exploit in the repository, and it needs no modified client, no DevTools, no
protocol knowledge. Watch your hand; when it is clearly going to place last, close the tab.

`vacateSeat` deletes your seat from `playerMap` (`server/socket.ts:656`), after which your
seat scores under `bot:<seat>` — and `server/stats.ts:61` and `server/ratings.ts:84` both
filter every `bot:` key out. Nothing is recorded. Heads-up it is worse: `remaining <= 1` at
`:679` disposes the table at `:689` **without ever calling `handleGameOver`**, so the player
who beat you gets nothing either.

**A ladder rating that can only ever go up is not a ladder**, and
`GET /api/ratings/leaderboard` publishes exactly that number. Fix this before the ladder has
users worth defending.

### 2 · Every authenticated request writes a live session cookie to the log — RES-02, Critical

`server/logger.ts` sets no `redact` and no `serializers`; `server/testApp.ts:200` mounts
`pinoHttp` with defaults, and pino-http 11 serializes the whole `headers` object. Confirmed by
running the repo's own installed copy under its exact config — the `cookie` header comes out
in plaintext.

Session cookies are `httpOnly` with a 30-day lifetime. Anyone with log-read access replays one
and holds the account for a month; the user cannot see it happen or revoke it. **The fix is
one `redact` list.** Cheapest Critical in the audit, and the one to ship first in Batch 2.

### 3 · The most common online flow in the app is broken three different ways

`handleGameOver` sets `room.status = "finished"` after **every manche**
(`server/socket.ts:841`), so `"finished"` means both *"between hands of a live partita"* and
*"this room is over"*. Five handlers branch on that one flag and no two agree:

- **NET-01** — `handleLeaveRoom:2171` has `waiting` and `in_progress` branches and **no
  `finished` branch**, so leaving at the results screen never releases your seat. The rematch
  gate at `:1545` counts `Object.keys(playerMap).length`, so **one player tapping "Torna alla
  lobby" permanently blocks the next manche for everyone still sitting there.**
- **RULE-01 / NET-02** — the rematch handler rebuilds the roster from `room_players`, a table
  holding only humans. So the **default solo online flow** (1 human + `fillWithBots`) can never
  deal manche 2 at all, and a bot-filled 4-seat table silently shrinks to 2 seats mid-match
  with the wrong exchange winner. Found independently by the rules and netcode specialists.
- **SEC-01** — `room:start` *accepts* `finished`, so the host can unilaterally re-deal,
  bypassing the vote entirely, skipping the exchange penalty (it calls `initializeGame`, not
  `initializeRematch`), and flipping `matchLength` mid-partita from a client-supplied payload.

SEC-01 is very likely the workaround players discovered for the NET-01 deadlock. All four are
one batch and one design doc.

### 4 · CI cannot fail a test — TEST-01, High, and the reason it is Batch 1

`.github/workflows/ci.yml:62` is `npm test | tee test-output.txt`. GitHub Actions' default
shell is `bash -e {0}` — `errexit` without `pipefail` — so the step reports `tee`'s exit code.
**No test failure in this repository can turn CI red.**

The irony is on the next line: the step at `:67` exists specifically to stop CI going silently
green, and its comment says so — but it greps for a *skip*, and cannot see a *failure*. The
`tee` is there **because** that guard needs the output in a file. Adding the guard opened the
hole the guard was meant to close.

**I checked the exposure rather than assuming it.** `git log -S` returns exactly one commit:
`f485f48`, dated **2026-08-16 — yesterday** — titled "Run the integration suites in CI against
a real Postgres". This is a one-day-old regression that rode in on a genuine improvement, not
months of unverified merges. Practical risk to date is near zero.

It is still Batch 1, on dependency grounds rather than severity: every other finding's
acceptance criteria say "a test proves it", and until this line is fixed no test gates
anything.

### 5 · The game has never played its win or lose sound — UX-03, Medium

`components/GameTable.tsx:688` looks up `viewer.name` — a username — inside
`gameState.rankings`, which `lib/gameEngine.ts:750` fills with engine ids (`player_0`).
`indexOf` never matches, `myRank` is always `-1`, and both `playGameWin()` and
`playGameLose()` are unreachable. Every hand ever played has ended in silence. The
`hapticSuccess()` on the line above fires unconditionally, so the *loser* gets the success
haptic.

Graded Medium by the rubric, and correctly — but it is one line, it has been broken since it
shipped, and it is the emotional payoff of the game. Best impact-to-effort ratio in the audit.

---

## What surprised me

**The rules engine is genuinely correct, and that is the most reassuring result here.** A2
executed **360 complete matches** (2/3/4 seats × free-for-all and teams × 60 seeds) with every
move independently re-validated against `buildCombination` + `canPlay` and card conservation
checked after every play, plus a 20,000-call probe over all five AI personalities. Result:
zero illegal plays, zero mis-typed combinations, zero card leaks, zero freezes, zero incomplete
rankings, zero AI nulls. Card ranking, joker handling, straights, bombs, royal precedence and
pass/trick-clearing are all correct. `lib/gameEngine.ts` is not where the risk lives.

**The server authority holds.** A1 set out to break hand secrecy, ticket auth, the
card-ownership filter, per-seat authority on all eighteen events, replay/friend IDOR, SQL
injection and CORS divergence — and could not build a single one. All five `game:state` emit
sites go through `sanitizeStateForPlayer`; there is no `io.to(room).emit("game:state", …)`
anywhere. The two holes it did find are *scope* problems in one handler, not missing checks.

**The repo is unusually clean, which changed what the audit had to look for.** Zero
TODO/FIXME/HACK/XXX markers, zero commented-out code blocks, zero merge-conflict artifacts,
zero unmerged branches, zero stashes, zero `continue-on-error`. Typecheck 0 errors, lint 0
problems, 670/672 unit tests and 230/230 native tests pass. There was no residue to report, so
every finding had to come from structure, coverage, or a design decision.

**The specialists deleted a fifth of what they found.** 31 candidates were self-scored below
80 and dropped with a recorded score and reason — including three of the recon's own leads
(`DELETE /api/users/me`'s missing rate limiter: 40, self-limiting; `test-renderer` as a
suspicious dependency: 10, it is a legitimate RNTL peer dependency;
`EXPO_PUBLIC_E2E_FAST` leaking into a production bundle: traced every path, not a finding).
Several drops are results in their own right — B1 *measured* the per-move DB upsert at ~324 KB
and the broadcast clone at 6.2 KB and dropped both as "nobody notices at this scale".

---

## The theme: a rule the team wrote down, and did not generalise

`CLAUDE.md` contains this, and it is exactly right:

> **No self-defeating safeguards.** If you write a guard, do not also ship the thing that gets
> past it. **The tell is the justifying comment.** … A check that cannot fail is worse than no
> check: it costs the same and buys false confidence.

It gives two examples — `db:reset` supplying its own `--yes`, and CI lint with
`continue-on-error: true`. **Recon verified both are already fixed.** The rule was applied
where it was written down. It was not treated as a shape to look for, and the audit found
three live instances in domains the examples never covered:

1. **CI** (TEST-01) — the test step cannot fail, and the guard added directly below it can see
   a skip but not a failure. Justifying comment at `ci.yml:64-66`.
2. **Accessibility** (A11Y-01) — `describeTableForA11y` is 95 lines with **11 dedicated tests**
   and strings in three locales, attached at `GameTable.tsx:932` to a `<View>` with no
   `accessible` and no role. iOS ignores it; react-native-web renders `<div aria-label>` where
   role `generic` is name-prohibited in ARIA. **It reaches no screen reader on any platform.**
   Justifying comment at `:929-931` — and its reasoning is *correct*, which is what makes it
   dangerous: adding `accessible` really would collapse the subtree. The right fix is a
   separate node, not the obvious one.
3. **Layout constants** (ARCH-02) — the invariant says "There is no second copy"; there are
   four. `tests/gameTableModel.test.ts:7` imports `CARD_W` from the second copy and asserts it
   equals 58 — and every duplicate is also 58, so **every duplicate passes.** A fourth
   justifying comment, at `ExchangeAnnouncement.tsx:25`, claims the constants are "not
   exported" to excuse a hardcoded copy. They are exported, from the file `CardView.tsx`
   imports them from.

A fourth near-instance corroborates it: C2 filed the source-scanning tests' blind spots
(TEST-07, TEST-08) as *theoretical*, and B4 independently found **three live animations**
(A11Y-10) that ignore the motion preference while `tests/reducedMotion.test.ts` passes. The
blind spot is already hiding defects.

**Recommendation:** replace `CLAUDE.md`'s two examples with these three live ones. The
originals now read as false claims about the current code (see below), and the live ones teach
the shape rather than a fixed bug list.

---

## Honest assessment of repo health

**This is a well-built codebase with a soft middle.**

What is genuinely strong: the rules engine (executed-verified), the server's authorisation
model, the schema-DDL discipline (`server/schemaDdl.ts` as the single additive, idempotent
creator, pinned by tests), the test suite's *design* — 45 unit files, 11 DB-gated integration
suites covering hand secrecy and impersonation, meta-tests that scan source text and each
carry a self-check case. The commit hygiene is high, the comments state invariants without
narrating history, and A1 specifically noted that `server/ticket.ts`, `server/session.ts` and
`server/onlineGameLogic.ts` "made this audit materially faster".

What is soft, and it is one thing wearing several hats: **`server/socket.ts` is 2272 lines
holding all in-memory game state, the entire event surface, the turn/timer machinery, a
213-line `handleGameOver`, and the sweeper — with no unit test, because nothing in it is
importable in isolation.** Nine of the twenty Critical/High findings live in that file. A1 said
it directly: SEC-01 could hide because `room:start`'s guard "reads perfectly sensibly in
isolation and is only wrong in the context of what `handleGameOver` does 460 lines away".
ARCH-04 (split it) and TEST-11 (give `handleGameOver` a seam) are the structural answer, and
they are deliberately placed late — after the bugs are fixed, not before.

The second soft spot is **the gap between what the tests appear to guarantee and what they
do.** Three separate cases: CI cannot fail (TEST-01), `reducedMotion.test.ts` is a no-op for
all 118 call sites it nominally covers (TEST-07), and the layout-constant test cannot detect a
second copy (ARCH-02). None of these is negligence — each is a reasonable test written without
an adversarial pass over its own blind spot.

**Docs drift is real and measurable.** C1 checked every claim in `CLAUDE.md`: **29 of 36 are
true.** Seven are false, including two that the file itself presents as live examples of a bug
(both fixed), one named **Invariant** describing a `FlatList` in `app/(online)/friends.tsx`
that does not exist (all four lists are plain `.map()` — verified), and the layout-constant
invariant above. `docs/ARCHITECTURE.md` names three identifiers that do not exist. `docs/BRIEF.md`
§2 is headed "Current state — verified assessment" while all 15 of its defect citations point
at unrelated code — including one claiming a live impersonation vector that
`tests/integration/auth.test.ts` disproves. `docs/BACKLOG.md` O11 is stale, which silently
unblocks Q11 and Q12. **This matters more here than in most repos, because `CLAUDE.md` is
loaded into every future session's context** — a false invariant actively instructs the next
implementer to preserve something that is not there.

**Nothing found is unshippable.** There are no data-loss bugs, no way to see another player's
hand, no impersonation vector, and no wrong game outcome in the engine itself. The three
Criticals are: an exploit that needs the ladder to matter before it bites, a logging default
that needs log access to exploit, and a host-only handler-scope bug. All three are fixable in
Batches 2 and 3.

---

## What the audit could not determine

Stated plainly, because silent partial coverage is the worst outcome:

1. **No integration suite ran.** No `DATABASE_URL` and no reachable Postgres on this machine,
   so all 11 files in `tests/integration/` self-skipped. Their assertions were read in full and
   are load-bearing for several "refuted" conclusions — particularly A1's hand-secrecy and
   impersonation results. CI does run them and makes a skip fatal, so they are *presumed* green
   at `b894af4` — **but that is inference from CI configuration, and TEST-01 means CI could not
   have failed them anyway.** This is the single largest gap in the audit.
2. **The production build was never run**, by us or by CI. `expo:web:build`, `expo:static:build`
   and `server:build` write into gitignored directories, which the read-only rule forbids. So
   "does the production build pass?" is **unanswered** — and TEST-04 exists because CI never
   answers it either.
3. **Playwright and Maestro were not run** (need a built bundle, a browser download, an Android
   emulator, and they write test artefacts).
4. **No load or concurrency testing.** SEC-05's pool-saturation magnitude, the `claimRoomSeat`
   race, SEC-08's registration race and NET-06's two-tab case all want concurrent clients.
   SEC-05 carries `Confidence: Medium` for exactly this reason.
5. **Replit runtime behaviour is unverified.** `.replit` was read; no deploy was observed.
   `docs/BACKLOG.md` O5 independently flags that Replit boot has not been verified since the
   `reusePort` fix.
6. **Runtime performance numbers are static-only.** B1 measured file sizes, bundle contents and
   compiler output — real numbers — but no frame timings, no `EXPLAIN` on the replay query
   (PERF-07 carries Medium confidence for its scan claim), and no mid-range-device profiling.
7. **Locale semantics.** `tests/i18n.test.ts` pins key and placeholder parity across it/en/sq,
   which is all a machine can check. Whether the Albanian reads correctly needs a native
   speaker — `docs/BACKLOG.md` O3 already says so.
8. **Mobile-web scroll behaviour** (`overscroll-behavior`, pull-to-refresh reloading a live
   game) — B4 flagged this as the one item in its scope it could not answer without a build.
9. **`npm audit` reachability was determined by reading the dependency graph**, not by tracing
   imports at runtime. A1 flagged the `react-native` high as the one it is least certain about.

---

## Open questions for the owner

These are decisions, not defects. **Four are now answered — see `DECISIONS.md`.**

### Answered 2026-08-17

| # | Question | Decision |
|---|---|---|
| **Q1** | Is quitting supposed to be free? (SEC-02) | **No.** An abandoned seat records a **last-place finish** — loses rating, loses the streak, no achievements. No extra penalty. A genuine network drop is punished identically; that is accepted, and no "was it real?" heuristic is to be added. → **D1** |
| **Q3** | Is one human plus bots a full online match? (RULE-01) | **A full match.** The room screen already promises it and `server/socket.ts:1311` deliberately permits a one-human start. A 4-seat bot-filled match measures ~10.4 manches. *(delegated to Claude)* → **D2** |
| **Q4** | Does the table continue against a bot when someone leaves? (NET-01) | **Yes — and the substitution must stay visible.** `game:seat_bot_takeover` already exists; what is missing is a **persistent** seat marker rather than a 4-second banner. Created **UX-13**, scheduled in Batch 3. → **D3** |
| **Q6** | Can the host alone start a new match? (SEC-01) | **No.** Two rules: `room:start` is refused outright while a match runs; after `matchOver`, a new match needs the same unanimous ready gate as a rematch, among *connected* seated humans. Standard card-platform practice — a finished match releases everyone's commitment. **Requires RULE-02's abstain rule first**, or the gate deadlocks. *(delegated to Claude)* → **D4** |

| **Q5** | Is more than one session per account supported? (NET-06) | **No — single-session, evicted visibly.** The bug is not that two tabs fail, it is that the first tab *appears* to work while receiving nothing. Making the failure loud fixes the harm, and `userSocketMap` keeps its shape. → **D5** |
| **Q2** | What should a 2- and 3-player partita be worth? (RULE-06) | **Scale the ladder by `(playerCount−1)/3`** → 7/10/14/17 at two seats, 14/21/27/34 at three, four seats unchanged. Best-in-class card games land a match in **8–12 hands** at any count; Murlan's 4-player game already does (10.4), and the scaled targets put 2- and 3-player at ~8.9 and ~10.1. `docs/RULES.md` §12 stays literally true. *(delegated to Claude)* → **D6** |

### Still open — neither blocks any batch, and both have a default

7. **Is the Expo Go landing page still wanted?** (SEC-07, Batch 14) Deleting it closes the
   finding outright and removes a third-party CDN dependency with no `integrity` attribute.
   **Default: keep and fix** — escaping is reversible, deleting is not.
8. **Should the severity rubric gain a security row?** Process only, blocks nothing. RES-02 had
   to be upgraded by hand because "exploitable cheat / data loss / unplayable" has no category
   for account takeover.

---

## One process note

The audit made an error and caught it. The recon map asserted that `components/GameTable.tsx`
does not re-check the 3♠ opening rule; I propagated that into two specialist briefs, one of
them with the instruction "a silent rejection is a High". It is false —
`GameTable.tsx:476-481` enforces it. **A2 caught it unprompted inside its own scope and put
the correction at the top of its report; B3 reached the same conclusion independently before
my correction message arrived, and wrote no finding.** The map is corrected in place and the
episode is logged in `REJECTED.md`.

Worth recording because it is the same failure the audit spent its day finding in the code: a
confident claim, written down, believed downstream, and only caught because something
independent went and looked.
