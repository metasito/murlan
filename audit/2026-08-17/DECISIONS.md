# DECISIONS — owner answers to the audit's open questions

**Recorded 2026-08-17. These are settled. A session implementing any batch should read this
file and proceed without asking.**

Answered by the repository owner except where marked *(delegated)* — those were explicitly
handed to Claude to decide, and the reasoning is given so the owner can override cheaply.

**Six of the eight open questions are answered here, and every question that blocks
implementation is closed.** No batch in this plan is waiting on a decision. The two that remain
(Q7, Q8) block nothing and are listed at the bottom.

---

## D1 — Abandoning a hand records a last-place finish · answers Q1 · unblocks SEC-02

**Decision: option (a).** A seat abandoned mid-hand is recorded as a **last-place finish** for
the player who left. They lose rating and they lose their streak. No additional penalty beyond
that.

**What this means concretely for SEC-02:**

- `vacateSeat` (`server/socket.ts:643-709`) records the departing userId — the finding proposes
  an `abandonedSeats: Map<number, string>` on `OnlineGameState`, populated alongside the
  existing `delete game.playerMap[seat]` at `:656`. **Keep it in memory only** — do not persist
  it into the `game_state` envelope, because that changes a persisted shape and forces a
  `GAME_SCHEMA_VERSION` bump, which disposes every live game.
- `handleGameOver` builds a `gameResults` entry for those seats with
  `placement = state.players.length` (last).
- `recordRatedResult` (`server/ratings.ts:84`) must treat an abandoned seat as **a real
  last-place finisher, not a bot.** The `bot:` sentinel and "a human who left" are two
  different things and must stop sharing one key — that shared key is the whole bug.
- A new `abandoned: true` flag on `GameResult` (`lib/achievements.ts`) so
  `evaluateAchievements` refuses to award anything for an abandoned seat.
- The `remaining <= 1` branch (`server/socket.ts:679-691`) must **run the scoring path before
  `disposeGame`**: award the surviving player the win for that hand — they are the only seat
  left holding cards — then call `handleGameOver`, then dispose.

**Accepted consequence, stated explicitly so nobody re-litigates it mid-implementation:** a
genuine network drop is now punished identically to a rage-quit. The owner accepts this. Do
not add a "was it a real disconnect?" heuristic — there is no reliable signal, and a guess
here would be a new class of unfairness rather than a fix.

---

## D2 — One human plus bots is a full online match · answers Q3 · shapes RULE-01

*(delegated — Claude's call, reasoning below so it is cheap to reverse)*

**Decision: a full match.** `room:start` with `fillWithBots` and a single seated human plays a
complete partita to the match target, exactly as a human table does.

**Why:** the room screen already promises it — it offers "Riempi con bot" and the
match-length picker together (`app/(online)/room.tsx:321`, `:407`), and
`server/socket.ts:1311` deliberately permits a one-human start with the comment "With bots
filling every empty seat, one seated human is enough". Making it a one-manche demo would mean
*removing* a promise the UI currently makes, which is a bigger change than honouring it. A
4-seat bot-filled match at target 21 measures ~10.4 manches (A2's simulation), which is a
reasonable session — this is not the 26.7-manche problem that RULE-06 describes for 1-v-1.

**Therefore RULE-01 is implemented as written:** rebuild the next manche's roster from the
in-memory game (`game.gameState.players` + `game.playerMap`), never from `room_players`. Do
**not** take the alternative the finding mentions of hiding the match-length picker when
bot-fill is on.

---

## D3 — A vacated seat keeps playing as a bot, and the table can see that it is a bot · answers Q4 · shapes NET-01

**Decision: the table continues with a bot in the seat** — matching the existing mid-game rule
— **and the substitution must be visible for the rest of the match, not just announced once.**

**Half of this already exists.** `vacateSeat` emits `game:seat_bot_takeover`
(`server/socket.ts:697-704`) carrying `PLAYER_LEFT_BOT_TAKEOVER` and the message
"*X ha lasciato la partita — il computer gioca al suo posto.*" That is the correct event and
NET-01's fix must route through it.

**What is missing is persistence of the signal.** The takeover arrives as a
`game:notification`, which the banner shows for 4 seconds and then discards. After that the
seat is visually indistinguishable from a human. **Add a persistent marker on the seat itself**
— see UX-13 in `BACKLOG.md` Appendix B, which was created by this decision and is scheduled in
Batch 3.

**The hazard this decision does NOT change** — `CONFLICTS.md` C5 still applies in full:
NET-01's fix routes the results-screen leave through `vacateSeat`, which also emits
**`game:player_left`**, and that event drives the client's blocking "Partita interrotta"
teardown (`context/OnlineGameContext.tsx:368`, `app/(online)/game.tsx:137-154`). The remaining
players must see **an updated vote tally and a bot marker**, not a teardown alert. Adjust the
emit at `server/socket.ts:667` — do not change the client.

---

## D4 — Starting a new match needs everyone's consent, not just the host's · answers Q6 · shapes SEC-01

*(delegated — Claude's call after the owner asked for standard card-game practice)*

**Decision: two separate rules, one per situation.**

1. **While a match is still running** (`matchOver === false`): `room:start` is **refused
   outright**. The next manche of a running match is `game:rematch_vote`'s job. This is
   SEC-01's core fix and is unchanged.
2. **After a match has genuinely ended** (`matchOver === true`) with players still seated:
   starting a new match requires **the same consent gate as a rematch** — unanimous ready among
   *connected seated humans*. The host alone is not sufficient.

**Why, in card-game terms:** a finished match releases every player's commitment. Board Game
Arena, online poker rooms and every ladder-based card game treat a new match as a new
agreement — everyone opts in, and anyone who does not is dropped from the table rather than
played on autopilot. Host-only start is how players get ground into matches they wanted to
leave, and this app has a rated ladder, which makes an unwanted match a rating risk rather
than just an annoyance.

**Composition note — this decision has a dependency and it matters.** A unanimity gate
deadlocks if it counts seats that cannot answer. It only works once **RULE-02** lands with its
option (b): *vacated and bot seats abstain — excluded from both `yes` and `total`, so the
verdict is the connected humans' majority.* Implement RULE-02 before wiring the new-match gate,
or you will rebuild the NET-01 deadlock in a new place.

**Also still true from SEC-01:** `matchLength` must be ignored whenever a previous game exists
and `previous.matchOver` is false. It may only be set when a genuinely new match is starting.

---

## D5 — One session per account; the older tab is evicted visibly · answers Q5 · unblocks NET-06

**Decision: single-session, enforced, with a clear message.** When a second connection arrives
for an account, the **older** socket receives a terminal error and is disconnected. The first
tab shows an explicit "this game was opened somewhere else" state instead of silently going
dark.

**Why this and not multi-session:** the bug NET-06 describes is not "two tabs don't work" —
it is that the first tab *appears* to work. It keeps rendering a live table with an enabled
GIOCA button while receiving nothing, and closing the second tab then makes the server announce
the first player as disconnected and hand their seat to a bot. Making the failure loud fixes the
harm. `isUserOnline`, the friends/online-status path and the push path all already assume one
socket per account, so this keeps one invariant instead of auditing three call sites for a new
one.

**Implementation notes — two of these are traps.**

1. `userSocketMap` keeps its current `Map<userId, socketId>` shape. **No structural change** —
   this is why the option is small.
2. The existing guards compose correctly and must not be "fixed". When the evicted socket's
   disconnect handler runs, `userSocketMap` already points at the *new* socket, so
   `server/socket.ts:1904` (`if (userSocketMap.get(userId) === socket.id)`) correctly declines
   to delete, and `:1919` (`if (userSocketMap.has(userId)) return;`) correctly returns without
   announcing a disconnect or arming the grace timer. Verify this rather than rewriting it.
3. **The trap: the evicted client will immediately reconnect and evict the other tab, forever.**
   `lib/socket.ts:60` sets `reconnectionAttempts: Infinity`. The client **must stop reconnecting
   on this specific error code** — call `socket.disconnect()` in the handler and render a
   terminal state with a manual "reconnect here" action. Without that you ship an infinite
   ping-pong between two tabs, which is worse than the bug being fixed.
4. New code (e.g. `SESSION_REPLACED`) emitted through the existing `socket:error` path
   (`server/socketSafety.ts:78`), with keys in `locales/it.ts`, `en.ts`, `sq.ts` —
   `tests/i18n.test.ts` pins parity.

**Acceptance criteria:** an integration test where one account opens two sockets — the first
receives `SESSION_REPLACED` and disconnects, the second plays normally, **no
`game:player_disconnected` is emitted**, and no seat is handed to a bot. A second case asserts
the evicted client does not automatically reconnect.

---

## D6 — The match target scales with the player count · answers Q2 · unblocks RULE-06

*(delegated — the owner asked for best-in-class practice rather than a specific number)*

**The principle, taken from how good card games are actually tuned:** a match should land in
roughly **8–12 hands**, at every player count. Long enough that one lucky hand cannot decide
it, short enough to finish in a sitting. Hearts is first-to-100 at ~8–12 hands; UNO is 500 at
~6–10; Scopa — which this player base will know — is 11 or 21 with per-hand scoring tuned to
land in about 4–8. None of them holds the target constant while the per-hand payout changes.

**Murlan's 4-player game is already tuned correctly** — measured at **10.4 manches**. The
defect is that `MATCH_TARGETS` stayed flat at `[21,31,41,51]` while `scoreHand` was generalised
to N players, so the per-manche payout collapsed from 6 points to 3 to 1 without the target
following. That is what produces a 26.7-manche 1-v-1.

**Decision: scale the existing ladder by `(playerCount − 1) / 3`.**

| Seats | Points per manche | Target ladder | Measured manches per match |
|---|---|---|---|
| 2 | 1 | **7 → 10 → 14 → 17** | ~8.9 |
| 3 | 3 | **14 → 21 → 27 → 34** | ~10.1 |
| 4 | 6 | 21 → 31 → 41 → 51 *(unchanged)* | 10.4 |

Derived from A2's executed measurements (60 full matches per configuration): 2p at target 21
took 26.7 manches, so 21 × (7/21) → ~8.9; 3p took 15.1, so 21 × (14/21) → ~10.1. All three
counts land inside the 8–12 band, which is the property that makes this fair rather than the
specific integers.

**Why scale the existing ladder rather than invent new numbers:** it leaves the 4-player values
`docs/RULES.md` §12 documents **completely untouched**, so the canonical written rules stay
literally true and only the undocumented counts change. That is the smallest possible change to
the specification.

**Implementation:** replace the `MATCH_TARGETS` constant with
`targetsFor(playerCount)` returning `MATCH_TARGETS.map(t => Math.round(t * (playerCount - 1) / 3))`,
and thread it through `server/socket.ts:1358` (`matchTarget: previous?.matchTarget ?? …`),
`nextMatchTarget` (`lib/gameEngine.ts:1140-1142`), `context/GameContext.tsx:81` (`freshMatch`)
and `matchIsClosing`'s `target` argument. Keep the 4-player output byte-identical to today's
constant — that is the regression test.

**Also update, or the app will state a rule it no longer follows:** `docs/RULES.md` §12,
`docs/BRIEF.md` §3.1 (record the decision), and `rules.faq.a8` in all three locales, which
currently states a flat 21 for every count.

**Watch for:** `matchIsClosing` (`lib/gameEngine.ts:1247-1260`) reads `target` to decide when
the rematch question opens. A smaller target opens it earlier — correct, but it changes timing
the E2E specs rely on (`tests/e2e/helpers/bot.ts:340-347`).

---

## D7 — English first, everywhere · settles ARCH-19

**Decision: `locales/en.ts` is the source of truth for UI copy, and `DEFAULT_LOCALE` is
`"en"`.** Not just the authoring language — what a player sees before choosing one, and what
any missing key falls back to. Italian and Albanian are translations.

**And: every key that exists in English must exist in every other locale. No exception.**

The code currently enforces the reverse. `en.ts` and `sq.ts` both `import { it }` and declare
`Record<keyof typeof it, string>`, so Italian *is* the canonical key set and an English string
cannot be added until an Italian one exists. `DEFAULT_LOCALE` is `"it"` and both missing-key
fallbacks (`lib/i18n.ts:129`, `:169`) resolve to Italian, while `lib/i18n.ts:15` claims an
English fallback that does not exist.

Inverting the type dependency is what makes the no-exception rule real: once `it.ts` and
`sq.ts` are `Record<keyof typeof en, string>`, a key present in English and missing elsewhere
is a **compile error**, not a convention someone has to remember.
`tests/i18n.test.ts` stays as the second net — it catches a *stray* key the types cannot see,
and it already pins placeholder parity and non-empty values. All three catalogues are at 523
keys today, so the flip should surface nothing; if it does, translate the key rather than
delete it.

Implemented by **ARCH-19**, Batch 14.

---

## Where these belong permanently

This file is authoritative **for the implementation**. But `CLAUDE.md` states that game-rule
decisions live in `docs/BRIEF.md` §3.1, and the audit dir is a dated artefact that should not
become a second home for project decisions.

**Batch 3 must copy D1 and D4 into `docs/BRIEF.md` §3.1** as part of its work — they change
how a match ends and how the next one starts, which is squarely a rule decision. D2 and D3 are
product/lifecycle calls rather than rule changes; record them in `docs/ARCHITECTURE.md`
alongside the room-lifecycle description, which Batch 14 (ARCH-03) is correcting anyway.

Do not delete this file when the batches are done — it is the record of *why*, and
`REJECTED.md` and `CONFLICTS.md` reference it. It travels with the audit.

---

## Still open — neither blocks any batch

| # | Question | Blocks | Default if you never answer |
|---|---|---|---|
| **Q7** | Is the Expo Go landing page still wanted? Deleting `server/templates/landing-page.html` and the `else` branch at `server/testApp.ts:128-137` closes SEC-07 outright and removes a third-party CDN dependency that has no `integrity` attribute. | SEC-07, Batch 14 | **Keep the page and fix it** — escape the Host header, add `integrity`, give helmet a real CSP. Batch 14 proceeds on that basis unless told otherwise. |
| **Q8** | Should the audit's severity rubric gain a security row? RES-02 had to be upgraded by hand because "exploitable cheat / data loss / unplayable" has no category for account takeover. | nothing — process only | Noted in `SUMMARY.md`; no action. |

Both have a stated default, so **no batch will stop to ask.** Q7's default is the conservative
one: fix rather than delete, because deleting is irreversible and the page costs nothing to
keep once escaped.
