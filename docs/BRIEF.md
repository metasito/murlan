# Murlan — Production & App Store Readiness Brief

> This document is a rewrite of an informal request ("make it perfect and App Store ready")
> into an actionable engineering and product brief. It is the source of truth for scope.

---

## 1. Product vision

**Murlan** is a traditional Albanian shedding-type card game. The app is the definitive
digital version of it: fast, beautiful, fair, and playable both solo against credible AI
and online against friends and strangers.

Today it is a competent Replit prototype with a working game engine, real-time multiplayer,
friends, and a coherent visual identity. It is **not** production software: its trust
boundaries are broken, its failure modes are unhandled, it has no tests, and it carries
store-rejection risks.

The goal is not "more features". The goal is: **a player can install this from the App Store,
understand it in 60 seconds, play a full game without a single desync, disconnect, or
exploit — and want to come back tomorrow.**

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

## 2. Current state

> **Resolved.** This section was a list of 21 defects headed *"verified assessment"*,
> present tense, every one of which is now closed. It is deleted rather than rewritten:
> git holds it, and a defect list that outlives its defects sends the next reader to
> fix something that was fixed. The audit of 2026-08-17 replaced it —
> `audit/2026-08-17/SUMMARY.md` is the current assessment, and `PROGRESS.md` records
> what each batch closed. Kept as the record of why this heading is empty.

## 3. Decisions taken

| Decision | Choice |
|---|---|
| Scope | Harden and re-architect the broken parts. Not a rewrite — the animation and layout work is real and worth preserving. |
| Deployment | Replit stays the backend, unchanged. Add EAS Cloud for iOS/Android binaries pointing at the Replit API. |
| Socket auth | Short-lived single-use signed ticket, minted by an authenticated REST endpoint, consumed in the handshake. No new dependencies. |
| Game rules | Research Murlan rules from real sources, consolidate into one documented specification, reconcile code and UI against it. Escalate genuine ambiguities rather than guessing. |

### 3.1 Rule decisions (taken after research — the sources are cited in `docs/RULES.md`)

Research consulted 18 sources including pagat.com, catsatcards.com, visixplay.com (IT/EN/AL),
murlanarena.com, murlan.app, and the App Store / Play Store listings of the two largest
existing Murlan apps.

| Rule | Decision | Rationale |
|---|---|---|
| **The deal** | **Deal the entire 54-card deck.** 4p = 14/14/13/13, 3p = 18 each, 2p = 27 each. | Every source says the whole deck is dealt. The current 13-per-player deal discards 2 random cards, so ~7% of games contain no Joker and ~4% no 3♠. This is the root cause of the fake "lowest spade" opening fallback, which can then be deleted. |
| **Royal straight** | **Keep as core, beating bombs. No engine change.** | Traditional Albanian sources have no flush at all, but both major modern implementations (murlanarena, murlan.app) have it and rank it above bombs — which is exactly what the engine already does. Only the documentation changes. |
| **Royal straight comparison** | Beating royal straight must have the **same card count**, consistent with normal straights. | Matches existing engine behaviour; `app/rules.tsx` currently implies otherwise. |
| **Teams win condition** | **Play the hand out and sum both partners' placement points.** | Matches current engine behaviour and the only source covering team play. `app/rules.tsx` is wrong and changes. |
| **Match target** | **Add it: 3/2/1/0 per hand, first to 21, escalating 31 → 41 → 51 on ties.** | The most consistently attested rule across every source, and completely absent from the app today. Turns loose repeated hands into an actual match. |
| **2 in straights** | **Keep — the engine is already correct.** `A-2-3-4-5` and `2-3-4-5-6` are legal; the 2 is low *only* inside a sequence. | Confirmed canonical by catsatcards and visixplay. No change. |
| **Suit tiebreaks** | **None. The engine is correct; `CLAUDE.md` is wrong** and must be corrected. | No source assigns any suit order. Equal ranks are equal strength, so a same-rank answer is simply illegal. |
| **Passing** | Passing does **not** lock a player out of the round (consecutive-pass counting). Engine is correct; state it explicitly on the rules screen. | Players arriving from Tien Len assume the opposite. |
| **Straight length** | 5 to 13 cards, each rank at most once, Ace picks one end. **Remove the arbitrary 9-card cap.** | No source imposes a maximum. |
| **Abandoning a hand** | **A seat abandoned mid-hand is recorded as a last-place finish.** The player loses rating and loses their streak. No penalty beyond that, and no achievement is awarded for an abandoned seat. | Leaving before the hand ended used to produce no record at all, which made closing the browser tab a complete defence against ever losing rating. A genuine network drop is punished identically to a rage-quit: there is no reliable signal separating them, and guessing would be a new class of unfairness rather than a fix. |
| **Match target by seat count** | **The 4-player ladder 21 → 31 → 41 → 51 scales by (N−1)/3**: **7 → 10 → 14 → 17** at two seats, **14 → 21 → 27 → 34** at three, four unchanged. | `scoreHand` was generalised to N−1…0 but the target stayed flat, so a manche fell from 6 points to 3 to 1 while the finish line did not move: measured over 60 full matches per configuration, a 1-v-1 took **26.7 manches** and a 3-player match 15.1, against 10.4 at four seats. Nobody finished a 1-v-1, so nobody in that format ever earned `match_champion` or `iron_will`. Scaling lands every count in the 8-12 manche band a match should take, and leaves the only values `docs/RULES.md` §12 actually sources untouched. |
| **Rotating the deal** | **The seat the deal starts from advances by one every manche**, so the two extra cards of a 54-card deal move round the table instead of landing on seats 0 and 1 forever. It resets to seat 0 when a new match is dealt. | `docs/RULES.md` §3 has a dealer who rotates; the engine dealt from index 0 every time. Measured over 4,000 four-seat hands with four identical AI personalities, seats 0 and 1 won 25.9%/26.3% of manches against 23.4%/24.4% for seats 2 and 3 — a ~2.2-point gap at ≈4.5σ, which a rotating deal collapses to noise. Online, seat 0 is always the host, so the rated ladder was recording that bias as skill. |
| **Starting a new match** | **While a match is still running, `room:start` is refused** — the next manche belongs to the rematch vote. **After a match has genuinely ended, a new one needs unanimous ready among the connected seated humans,** not the host alone. Vacated and bot seats abstain rather than voting no. | A finished match releases every player's commitment, and every ladder-based card game treats a new match as a new agreement. Host-only start is how players get ground into matches they wanted to leave, and a rated ladder makes an unwanted match a rating risk rather than an annoyance. Abstention is what keeps the unanimity gate from deadlocking on a seat that cannot answer. |
| **Naming the winner of a single manche** | **An abandoned seat can never be announced as the winner.** When a `single`-length game ends and the leading seat has been vacated, the announced winner is the best-placed seat still held by a human. If no human seat finished, the manche is announced with no winner. | The seat keeps the departed player's name when the engine takes it over, so the game was crediting the person who walked out, by name, in front of the people who stayed. Scoring already excluded abandoned seats from the running total — this is the same rule applied to the announcement, which was the one place it had never been carried through. |
| **Who votes on a rematch** | **Only seats held by a human vote, offline and online alike.** Bot seats and vacated seats abstain from both the count and the total. | Online already worked this way and the row above already says vacated and bot seats abstain; offline let AI seats vote *and* counted them toward the majority, so "most players agreed" meant two different things depending on where you were sitting. A computer has no preference to record, and a table of one human plus bots should restart when that human says so. |

---

## 4. Workstreams

> This section is the original plan, kept as the record of how the work was cut.
> It is **not** current status — `docs/BACKLOG.md` and `audit/2026-08-17/PROGRESS.md`
> carry that, and most of W1–W5 has since shipped.

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
colour constants, migrate off `expo-av`, and remove the unused dependencies.

**W5 — Test & CI.** Engine unit tests, rules property tests, server integration tests over
a real socket, and a CI pipeline that runs typecheck, lint, and tests on every push.

**W6 — Store readiness.** `eas.json`, versioning, privacy policy, App Privacy answers,
store copy and screenshots, account deletion verified working, offline play verified
ungated.

**W7 — Product & design.** Onboarding, localization, accessibility, and the retention
features selected in §5.

**W8 — Documentation coherence.** Every `.md` file in the repo states the truth, states it
once, and does not contradict any other. See §8.

---

---

## 5. Proposed features

> This section is a record of what was proposed and why. It is **not** the work
> queue — `docs/BACKLOG.md` is, and it carries current status for every item
> below. Several have since shipped: the interactive tutorial, localization,
> achievements, daily streaks, match history, rejoin-in-progress UX, match
> replay, spectator mode, bot personalities, the ranked ladder, cosmetics, push
> notifications (respecified — see the entry below), and colourblind-safe suit
> differentiation (measured: the existing palette already passes). Do not read
> an entry here as outstanding.

Ordered by estimated impact per unit of work.

### Tier 1 — I would build these regardless

- **Interactive tutorial.** Murlan is niche. A guided first game that teaches combinations,
  bombs, and the exchange phase is simultaneously the biggest retention lever and the thing
  that makes the app reviewable by someone who has never heard of it.
- **Localization: Italian, Albanian, English.** The player base is Italian, the game is
  Albanian, and the App Store is global. Currently every string is hardcoded Italian.
- **"Your turn" push notifications.** Proposed on the assumption that online play could
  become asynchronous. It cannot: a player who does not act within 30s is auto-passed and
  one still absent at 60s loses the seat to a bot, so a notification cannot arrive in time
  to matter. Shipped instead as a notification for a **friend's invite that arrived while
  the player was away**, which nothing expires against — see `docs/BACKLOG.md` Q23.
- **Rejoin-in-progress UX.** Right now a disconnect is a cliff. It should be a speed bump.

### Tier 2 — strong candidates

- **Ranked ladder with a visible rating.** Gives skilled players a reason to return.
  Requires the fairness work in W1/W2 to be honest.
- **Match history and hand replay.** Post-game review of what everyone held. Cheap to build
  on top of the persistence layer that already exists; disproportionately loved by card players.
- **Achievements and daily streaks.** Standard, effective, low risk.
- **Bot personalities.** Named opponents with distinct play styles rather than
  easy/medium/hard. Makes offline play feel like a game rather than a practice mode.
- **Spectator mode.** Watch a friend's table. Nearly free given the existing broadcast
  architecture.

### Tier 3 — worth discussing

- **Cosmetics: card backs and table felts.** The natural monetization surface if you ever
  want one, and non-invasive. Does not require IAP to be useful.
- **Tournaments.** Bracketed multi-table events. Significant work; high ceiling.
- **Colourblind-safe suit differentiation.** Accessibility, and genuinely improves legibility
  for everyone at small card sizes.
- **Haptic and sound redesign.** The assets exist; the choreography does not.

### Explicitly out of scope unless you say otherwise

Real-money play, ads, social feeds, chat with free text (moderation burden), cross-promotion.

---

## 6. Definition of done

The work is complete when all of the following hold:

1. `npx tsc --noEmit` and `npx expo lint` are clean.
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
8. The Replit Run button still starts the app with no additional setup.
9. Every rule enforced by the engine matches the documented rule set and the in-app rules screen.
10. Every `.md` file in the repo reflects the shipped state, owns its topic per §8, and
    contradicts no other document. Verified by re-reading them against the code, not by assertion.

---

## 7. Working method

Parallel specialist agents, each owning one workstream, coordinated against this brief.
Every change is verified by running it — no claim of completion without evidence.
Findings that alter this brief are escalated rather than absorbed silently.


---

## 8. Documentation architecture

The repo currently carries four overlapping documents that repeat and contradict each other.
Each document gets exactly one responsibility, and cross-references instead of restating.

### Ownership map

| Document | Owns — and nothing else | Must not contain |
|---|---|---|
| `CLAUDE.md` | Agent operating instructions: invariants, how to work here, pointers to the docs below | Product description, architecture prose, rule text |
| `docs/ARCHITECTURE.md` *(new)* | How the system is built: layers, data flow, socket lifecycle, persistence, auth | Rules, scope, decisions |
| `docs/RULES.md` ✅ | The canonical rule specification and its sources — **the only place rules live** | Implementation detail, scope |
| `docs/BRIEF.md` (this file) | Scope, decisions and their rationale, workstreams, definition of done | Rule text, architecture prose |
| `docs/BACKLOG.md` | Everything outstanding, owner-blocked, already answered or rejected | Anything not actionable |
| `replit.md` ✅ | Replit-specific run/deploy notes only — how to start it, what env vars, what not to touch | Everything that duplicates `CLAUDE.md` |
| `docs/superpowers/specs/*` ✅ | Historical specs, each stamped with its outcome | Anything presented as pending when it has shipped |

✅ = done. `docs/ARCHITECTURE.md` exists and `CLAUDE.md` states plainly that suit does not
break ties, so both remaining items on this map are closed.

### Contradictions between documents

> **Resolved.** Every row below has been corrected in the document it names —
> checked against the current files, not assumed. Kept as the record of what
> the ownership map above was written to prevent.

| Where | Said | Reality |
|---|---|---|
| `replit.md:11` | "Implements all official Murlan rules" | The deal is wrong, the match target is absent, and the straight enumerator misses legal plays |
| `replit.md:15` | "12 bundled **WAV** sound effects" | They are `.mp3` files |
| `replit.md:88` | Lists `expo-crypto` as a dependency | Not in `package.json` |
| `replit.md:62` | "Server Authority … ensuring fair play" | The socket handshake accepts an unverified `userId`; there is no fair play until W1 lands |
| `replit.md` | "Existing screens still reference the legacy colour constants — do not retroactively replace" | That instruction preserved a bug: the legacy file's suit colours were the old red/black pair, so any screen importing it silently lost the colourblind-safe palette. The file was deleted; `lib/theme.ts` is the only palette. |
| `replit.md` vs the legacy colour constants vs the `app.json` splash | `#031008` / `#061410` / `#061410` | Three different background colours, so the launch seam was visible. One value now, from `lib/theme.ts`. |
| `replit.md:21-26` "MUST NOT CHANGE" | Game rules and exchange phase are frozen | Superseded by the decisions in §3.1, which change the deal and add a match target |
| `CLAUDE.md` ↔ `replit.md` | Both describe the tech stack, design system, disconnect handling, notification banner and friends list | Same content twice, already drifting apart |
| `docs/superpowers/specs/2026-06-04-…-visual-upgrade-design.md` | Reads as a pending design spec | Verified **already implemented** — the ornate SVG card back, gold selected-glow ring, `-14px` spring lift, face-card gold border and MP3 web audio via `decodeAudioData` are all in the code. To be stamped as shipped. |
| `docs/BRIEF.md` §3.1 ↔ `docs/RULES.md` | Both carry rule content | `BRIEF` keeps the *decisions*; `RULES.md` keeps the *rules*. |

### Standing rule

A change to behaviour is not complete until every document that describes that behaviour has
been updated in the same change. Docs are part of the diff, not a follow-up.
