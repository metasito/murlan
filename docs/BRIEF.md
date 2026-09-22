# Murlan — Product Brief

> States what Murlan is, what has been decided, and what is still open. Rules live in
> `docs/GAME-RULES.md`, architecture in `docs/ARCHITECTURE.md`, agent invariants in
> `docs/agents/RULES.md` and the three `CLAUDE.md` files — this file does not restate any of them.

---

## 1. Product vision

**Murlan** is a traditional Albanian shedding-type card game. The app is the definitive digital
version of it: fast, beautiful, fair, and playable both solo against credible AI and online
against friends and strangers.

The goal is not "more features". The goal is: **a player can install this from the App Store,
understand it in 60 seconds, play a full game without a single desync, disconnect, or exploit —
and want to come back tomorrow.**

Three pillars, in priority order:

1. **Trustworthy** — nobody can see another player's hand, act as another player, or
   deadlock a table. The server is the only authority. Bugs that lose a game in progress
   are treated as data loss.
2. **Legible** — a person who has never heard of Murlan can learn it inside the app.
   The rules are documented, consistent between code and UI, and researched against real
   sources rather than inferred from the existing implementation.
3. **Alive** — the app has a reason to be opened again tomorrow: progression, presence,
   and a reason to invite a friend.

---

## 2. Status

Hosting is mid-migration off Replit (`docs/adr/0006-the-host-is-no-longer-replit.md`); the
replacement is undecided (#1105) and `deploy/runtime.json` is the contract any host must meet.

**Shipped** — do not read any of these as outstanding: interactive tutorial (`app/tutorial.tsx`);
IT/EN/SQ localization (`locales/`); rejoin-in-progress UX; ranked ladder (`lib/game/rating.ts`);
a friends-filtered leaderboard (`app/(online)/leaderboard.tsx`); match history and hand replay
(`lib/game/replay.ts`, `app/(online)/replay.tsx`); achievements and daily streaks
(`lib/achievements.ts`, `lib/streak.ts`); bot personalities (`lib/game/botPersonalities.ts`);
spectator mode (`isSpectator`, `app/(online)/game.tsx`); free card-back/table-felt cosmetics
(`lib/cosmetics.ts` — a local preference, no entitlement table); colourblind-safe suit
differentiation (not a built feature — the existing four-colour deck already clears
deuteranopia/protanopia/tritanopia separation, pinned by `tests/ui-rules/suitColours.test.ts`);
and **"your turn" push notifications**, respecified: the 30s auto-pass / 60s bot-takeover clocks
mean such a push could never arrive in time to matter, so it shipped instead as a notification for
a friend's invite that arrived while the player was away (`server/socket/push.ts`); sound and
haptic choreography, every cue timed to the card's landing (`impactDelayMs()`, fired from
`components/table/pile.tsx`; bomb jolts, music ducking and the win/lose sting in
`components/useTableFeedback.ts`).

---

## 3. Decisions taken

| Decision | Choice |
|---|---|
| Scope | Harden and re-architect the broken parts. Not a rewrite — the animation and layout work is real and worth preserving. |
| Deployment | Superseded 2026-09-21 — see `docs/adr/0006-the-host-is-no-longer-replit.md`. Replit is no longer the host; the replacement is undecided (`wayfinder:map` #1105). EAS Cloud for iOS/Android binaries is unaffected, since it points at whichever API host is live. |
| Socket auth | Short-lived single-use signed ticket, minted by an authenticated REST endpoint, consumed in the handshake. No new dependencies. |
| Game rules | Research Murlan rules from real sources, consolidate into one documented specification, reconcile code and UI against it. Escalate genuine ambiguities rather than guessing. |
| Seating a friend in 2 v 2 | **A seat can be reserved, and the allocator knows about teams.** Invite a friend and their seat is held for them, on your own side; quick match fills what is left, seating each arrival on the side that needs a player. One rule at three reservation counts — one seat held for "bring one friend", three for "four friends", none for "four strangers". See below. |
| The hand's two sizes | The change between them is a cut, not a transition. The turn is already signalled continuously by the lamp, the seat's ring, the other seats dimming and the hand's own eased lift — the size is the fifth signal, and the one the platform will not let us ease. See below. |

### 3.1 Rule decisions

Moved to `docs/GAME-RULES.md` § Decisions.

---

### 3.2 Why the hand's size change is a cut

`HAND_SCALE` 1.08 off the viewer's turn and `HAND_SCALE_ON_TURN` 1.20 on it are both real
layout: the card's own width, height and type, and the air between cards, are all computed from
that number. Easing between them means either transforming the row or laying it out repeatedly,
and each was ruled out against something measured rather than argued.

**A `scale` transform is unusable.** Web rasterises text before transforming it, so a card under
a scale carries a distorted rank glyph for as long as the transform lasts.
`tests/e2e/a11yOverlays.spec.ts` measures a glyph's ink against the box that clips it and
reports clipping the glyph does not have. Two CI runs on #418: 32 glyphs clipped with an eased
size, 14 with a 2.5-second settle added before measuring. The settle could not fix it, because
in a four-player game the turn changes every few seconds and the animation is running whenever
anything looks.

**A cross-fade of two rows is not ruled out by measurement — it is ruled out on cost.** Opacity
does not affect the box model, so both rows would carry honest glyphs and the guard above would
stay green. That is an inference from how the browser lays out `opacity`, not a measurement:
nobody has implemented a cross-fade and run the suite against it, and `clippedGlyphs` never
exercises one.

What it would cost is concrete. It puts two hands in the DOM for the length of every transition,
and two specs query the hand by its cards: `tests/e2e/cardScale.spec.ts:24` takes the *first*
`[data-testid="card-box"]` in document order, and `tests/e2e/handBudget.spec.ts:26` takes *all*
of them and measures the row's span. With two rows, the first is whichever row React rendered
first, and the span is measured across both.

Be precise about how much of that is demonstrated: neither spec fails today, and `cardScale`
could not — it seeds `turn: 0`, the viewer's own seat, and never plays a card, so the size never
changes while it runs. `handBudget` does play a combination, which hands the turn away, so it is
genuinely exposed. So this is a real hazard in two specs that are not about the hand's size,
plus the cost of a doubled card count and the a11y and `testID` duplication that comes with it —
weighed against easing one of five turn signals. It is not worth it. It is not impossible.

**Easing only the fan's spread** — `translateX` per card, which the guard does tolerate, since
the deal already animates translate and rotate — was rejected on its own merits rather than on a
constraint: the cards would jump size and *then* slide apart, which reads as two events where
there is one.

What is not a cut: the hand's lift. `useHandLift` eases 500ms on the same turn change
(`components/table/chrome.tsx`), so the moment is animated even though the size within it is
not. Revisit if the glyph measurement ever moves off ink-versus-box, which is what makes a
transformed card unmeasurable.

### 3.3 The held seat, and the side it is on

The owner's answer to #679, and the three questions the letter itself did not settle.

**What was broken.** `claimRoomSeat` handed out the lowest free seat index, and `teamForSeat`
puts seats 0+2 against 1+3. Two friends who quick-matched into the same 2-v-2 room therefore
took seats 0 and 1 — opposite teams — and nothing in the room model could have seated them any
other way. All three cases the ticket lists (bring one friend; four friends; a stranger as a
partner) are the same question, *who sits where*, and a party object was declined because it is
the only answer that changes what quick match is matching.

**No new column, and no new table.** The reservation is not stored: it is *derived from the
`game_invites` row that already exists*. An invite younger than the hold means the seat on the
inviter's own side is spoken for; the row's `createdAt` is the clock, and `recordGameInvite`
deliberately never refreshes it (#840) — the hold is a cap on the room, not a renewable lease, so
re-inviting the same person updates who is asking and the 120 s still runs from the first invite.
That is the cheapest rung of the ladder in
`CLAUDE.md` — derive from existing rows — and it keeps the property `shared/schema.ts` states
about invites, that they carry no `expires_at` of their own: the *hold* lapses, the invite does
not, and a friend arriving three minutes late still joins, just not into a guaranteed seat.

**Two minutes, and where the number comes from.** Nothing in the codebase could supply it. Every
other grace here (`afkTimeoutMs` 30s, `lobbyGraceMs` 20s, `disconnectGraceMs` 60s) guards a seat
whose occupant was connected and then dropped, which is a different actor and a different risk
from a seat held for someone who has never arrived; the only other figure is
`STALE_ROOM_MAX_AGE_MS` at 24 hours. So it is a new constant beside them —
`seatHoldMs()` in `server/game/gameTimers.ts`, tunable by `MURLAN_SEAT_HOLD_MS` without a deploy. A
minute is hostile to the friend still on the bus, ten is hostile to the room; the room itself
survives 24 hours either way, so the exact value inside "minutes" is a tuning knob rather than a
safety property.

**"Only while someone is actually waiting" costs nothing to honour.** `room:quickmatch` is
synchronous request/response — it finds a waiting room, claims a seat in a row-locked
transaction, or opens one. There is no queue and no waiting state, so a held seat is only ever
contested at the instant a stranger's claim runs, which *is* "only while someone is waiting".
No flag, no bookkeeping.

**The hold is taken in 2-v-2 rooms only.** A free-for-all lobby has no sides, so a hold there
buys nothing but politeness while costing the room a seat for two minutes — and every case the
ticket describes is a teams case. The predicate is derived, not a mode string: a room whose
seats have no team has no side to hold you a seat on. Widening it to free-for-all is a one-line
change if the owner wants it.

---

## 4. Scope

Eight workstreams shape what is tracked in GitHub Issues:

**W1 — Trust & authority.** Kill the impersonation vector. Ticket-based socket auth.
Authorize every socket event against seat ownership and phase. Fix the IDOR routes.
Rate-limit socket events. Server-side CSPRNG shuffle.

**W2 — Game integrity.** Research and document the canonical rule set. Rewrite the
valid-play enumerator to be provably complete. Fix the exchange-phase gaps, the
persistence round-trip, and scoring identity. Property-based tests over the engine.

**W3 — Resilience.** Make disconnect, rejoin, seat vacancy, host migration, and server
restart survivable states rather than deadlocks. A vacated seat must be resolvable —
either bot takeover or forfeit — never a hang.

**W4 — Client architecture.** Collapse the offline/online game screen duplication into a
single presentational component driven by a common state interface. Delete the legacy
colour constants and remove unused dependencies.

**W5 — Test & CI.** Engine unit tests, rules property tests, server integration tests over
a real socket, and a CI pipeline that runs typecheck, lint, and tests on every push.

**W6 — Store readiness.** `eas.json`, versioning, privacy policy, App Privacy answers,
store copy and screenshots, account deletion verified working, offline play verified
ungated.

**W7 — Product & design.** Onboarding, localization, accessibility, and the retention
features in §5.

**W8 — Documentation coherence.** Every `.md` file in the repo states the truth, states it
once, and does not contradict any other.

---

## 5. Open

**Owner-blocked**, tracked in GitHub Issues, not re-litigated here:

| Item | Issue | Status |
|---|---|---|
| Whether the app monetizes at all | #33 | needs an owner decision |
| Cosmetics shop — IAP-gated animation packs, backs, tables | #694 | `deferred` |
| Tournaments — bracketed multi-table events | #58 | `deferred`, size:XL (design exists: `docs/specs/2026-08-16-tournaments-design.md`) |
| VoiceOver/TalkBack flow unverified | #30 | open |

**Explicitly out of scope unless you say otherwise:** real-money play, ads, social feeds,
chat with free text (moderation burden), cross-promotion.

---

## 6. Definition of done

The work is complete when all of the following hold:

1. `npx tsc --noEmit` is clean and `npm run lint` reports no errors.
2. The engine test suite covers every combination type, the exchange phase, joker rules,
   and the win condition — including property tests asserting that the enumerator finds
   every legal play in randomly generated hands.
3. A player cannot, by any client-side manipulation, act as another player, observe a hand
   that is not theirs, or place the table in an unrecoverable state.
4. Killing and restarting the server mid-game restores every table with correct seats,
   hands, mode, and scores.
5. Account deletion succeeds and removes every row referencing the user.
6. Offline single-player is reachable without an account.
7. `eas build` produces a submittable iOS and Android binary.
8. Superseded by `docs/adr/0006-the-host-is-no-longer-replit.md` — the app launches with no
   local setup from whatever the chosen host's own deploy step is (#1105).
9. Every rule enforced by the engine matches the documented rule set and the in-app rules screen.
10. Every `.md` file in the repo reflects the shipped state, owns its topic, and contradicts
    no other document. Verified by re-reading them against the code, not by assertion.

---

## 7. Working method

Parallel specialist agents, each owning one workstream, coordinated against this brief.
Every change is verified by running it — no claim of completion without evidence.
Findings that alter this brief are escalated rather than absorbed silently.
