# Backlog

The single collection point for outstanding work. Items previously scattered across
`docs/BRIEF.md` §5, `docs/TESTING.md` §5 and code comments have been
folded in here; those documents keep their own topics and no longer carry open items.

Four sections:

- **§1 Work queue** — ready to build, ordered cheapest-first. One item = one commit.
- **§2 Owner-blocked** — cannot be closed from inside the repo.
- **§3 Analysis** — questions already answered, kept so they are not re-asked.
- **§4 Rejected** — with reasons, so they are not re-proposed.

## How this queue is worked

Standing instruction from the owner, so it is not re-asked:

- **This queue is never empty and never finished.** Work it unattended, one item
  at a time, one commit per item. When §1 runs dry, run
  `superpowers:brainstorming` and add new features and improvements to it —
  idling is not an outcome. Closing the last item is a prompt to find the next
  ones, not to stop.
- **Do not ask which item, which approach, or whether to proceed.** A choice that
  is genuinely the owner's — an account, a device, a credential, a business call
  — goes to §2 and the next item is taken.
- **No workarounds.** If the correct fix is bigger, do the correct fix. When the
  best practice is not known, look it up rather than guessing.
- **Leave no residue.** An implemented design doc, a superseded plan, a scratch
  script or a dead-end folder is deleted, not archived, and a doc claim that no
  longer holds is removed the moment it is found.

The full agreement, including the storage rules, is in `CLAUDE.md` §"Standing
working agreement".

---

## 1. Work queue

Ordered so the cheap, high-certainty items land first and the queue stays shippable at
every point. `Src` gives the item's original home.

| # | Item | Size | Src |
|---|---|---|---|
| **Correctness and accessibility** |
| Q1 ✅ | **Modals force portrait on iOS** — RN's `<Modal>` defaults `supportedOrientations={['portrait']}`, so opening one in landscape snaps the app to portrait and leaves the parent's layout stale; taps then land nowhere. Both `components/SettingsModal.tsx` and `components/ErrorFallback.tsx` are affected. **Rule to enforce everywhere: a user in landscape is never forced to portrait. Portrait is forced to landscape only for the game table, which needs the width.** Audit every screen and overlay for the same shape, not just these two. | S | owner |
| Q2 ✅ | **`ExchangeModal`'s `SelectableCard` has no `accessibilityLabel`** (`components/ExchangeModal.tsx`). It sets `accessibilityRole="button"` but the only nearby label belongs to the *disabled* inner `CardView` it wraps, so a screen-reader user gets an unnamed button. Fixing this also closes Q3. | S | A18 |
| Q3 ✅ | **E2E exchange giveback click is ~1-in-5 flaky** (`tests/e2e/helpers/bot.ts`, `giveExchangeCard`). Because of Q2 the harness must find the inner label and dispatch `pointerdown`/`pointerup`/`click` on its `<button>` ancestor, and RNW's gesture responder for that shape does not always react. Each attempt is verified against the offered-card count dropping, so a miss surfaces as a real stall, never a false pass. Q2 is the proper fix. | S | A19 |
| Q4 ✅ | **`tutorial.tsx` header buttons do not collapse into one accessible node** (`~505-507`, same shape on the back chevron). Two matchable nodes carry the text "Salta": the correctly-labelled `Pressable` and an inner `Text`. Screen readers see the same ambiguity Maestro does, and a tap on either never fires the RN `onPress`. | S | TESTING §5 |
| Q5 ✅ | **`app/result.tsx` labels exchange cards as raw `` `${card.rank} ${card.suit}` ``** instead of the localized card name every other surface uses. Wrong for screen readers in all three locales, and it blocks E2E coverage of the result screen's own exchange overlay. | S | A21 |
| Q6 ✅ | **A lint rule for the "invisible colour" bug class.** Four instances found: a stringified `"Colors.success"`, a singular/plural theme-key mismatch that made every card colourless, and a translucent *fill* token used as a *text* colour. React Native renders an invalid colour as nothing, silently. A custom ESLint rule catches all four shapes. | M | A17 |
| **Test durability** |
| Q7 ✅ | **Exchange-phase integration test retries up to 6×** (~0.02% residual flake by design — reaching a non-both-jokers exchange is probabilistic). Made deterministic by stacking the loser's hand. | S | A16 |
| Q8 ✅ | **`handFlags` (bomb/joker played this hand) live in memory only.** A mid-hand server restart loses them, under-counting two achievements. | S | A14 |
| Q9 ✅ | **E2E coverage gaps** — all three closed. *The result screen's rematch exchange*: not reachable by Playwright without winning a hand first, so `CardExchangeOverlay` moved to `components/ResultExchangeOverlay.tsx` and is driven directly by `tests/native/resultExchange.test.tsx`. *Teams-mode coordination*: `tests/integration/teamsOnline.test.ts` drives four humans through a real 2v2 — partners seated opposite, the table finishing, history recording `teams`, the hand replayable, and no rating written. *Disconnect/reconnect*: `tests/e2e/reconnect.spec.ts` drops a real browser's network mid-game and asserts the notice appears, the table stays, and both clear on return; verified able to fail. The E2E disconnect grace was 5s, shorter than socket.io's own reconnect backoff, so the path was untestable rather than fast — now 30s. AFK auto-pass stays covered server-side by `gameplay.test.ts`. | M | A21 |
| Q10 ✅ | **The online E2E stall, classified.** The AFK hypothesis is **wrong**: six full two-browser runs fired `PLAYER_AFK_AUTO_PASS` exactly zero times, so the 5s timeout was never a participant. The real defect was in the harness. When the viewer plays their last card the hand empties, and the table's own `aria-label` — derived purely from `currentTurnIndex`, with no notion of `gameOver` — still reads "your turn" for a tick. `playOrPass` then found no cards, saw PASSA correctly disabled, and threw its "the rules guarantee one of those always holds" invariant. That invariant is about a hand that still holds cards; an empty one means the player has finished. It now returns null so the caller's `isFinished` check sees the game-over overlay. Reproduced 3/3, fixed, 3/3 green. | M | A20 |
| Q10b ✅ | **The two-joker exception stranded the player on the result screen.** Root cause: `exchangePhase.bothJokersException` is set when a hand is *dealt* and is never cleared, so it was still true when that same hand ended — and `app/result.tsx` showed the overlay on the flag alone. The two-joker notice therefore reappeared, stale, over the finished hand's scoreboard, and its button left for `/game`, where there was nothing left to play. The condition is now the pure, tested `shouldShowResultExchange()`: an exchange belongs to a hand about to start, never to one that has just ended. Fixed a second, separate defect found on the way — the overlay's button and its 2500ms timer both called `router.replace("/game")`, and navigation is not synchronous, so pressing the button still let the timer fire a second one. Reproduced 1-in-2, fixed, 3/3 green. Unblocking this needed `expo-router` to be mockable in jest at all: the factory must build its own mock rather than close over a module-scope `const`, which jest's hoisting leaves uninitialised. | M | owner |
| Q11 (blocked, see O11) | **Maestro flows and CI.** ✅ *Portability, which was the real blocker*: both flows hardcoded one machine's LAN IP, and that address had since changed — so they could not reach a dev server even on the machine they were written on. They now default to `exp://10.0.2.2:8081`, the emulator's alias for the host loopback, overridable per-device with `-e MURLAN_PACKAGER_URL=`. Verified on the emulator both ways: cold start against the default passes, against a wrong port fails. ✅ *A CI job* (`.github/workflows/maestro.yml`) with KVM enabled, Metro started on the runner, and debug artefacts uploaded on failure. **It is `workflow_dispatch` only and has never run** — firing it on every push before it has ever gone green would make every push red for reasons nobody could act on. Promoting it to `on: push` after one green manual run is the one line that closes this item. **Still open:** flows for the exchange phase and the rematch prompt. Both need to sit on the animated game table for a whole hand, which is the exact thing this machine's emulator cannot hold (§3) — writing them here would mean shipping test code that was never run. They are worth writing against the CI runner once it is proven. | M | B2 |
| Q12 (blocked, see O11) | **iOS automation via an EAS Workflows `maestro` job.** EAS runs Maestro flows against an iOS simulator on Expo's own infrastructure — no Mac, no macOS CI runner. Reuses Q11's flows. Free tier covers 15 iOS builds/month. | M | B3 |
| **Feel and presentation** |
| Q12b ✅ | **The card faces are wrong.** `components/CardView.tsx` draws all 54 faces procedurally. Two separate defects: (a) the court figures and jokers are built from ~20 hand-written `<Path d="…">` strings (`CourtPanel`, `:222-298`) and read as abstract shapes rather than a J/Q/K; (b) the pip field is a hand-written `PIP_LAYOUTS` table over a 3-column grid (`:53-78`) whose counts do not all match the rank, and whose top row (`PIP_TOP = 0.16`) collides with the corner index suit at `INDEX_SUIT_Y = 0.25`. **Planned split — the two halves want opposite treatments.** Pips stay procedural: a correct grid is cheap, scales crisply to any card size, and inherits the suit colour token for free; the fix is deriving the layout from the canonical pip grid and moving the field clear of the index, then pinning every rank's pip count with a test. Court cards and jokers get real vector art from a public-domain deck, licence recorded, subsetted to the 14 faces actually needed so the bundle cost stays measured against `docs/BUNDLE.md`. Verify by rendering all 54 faces to one sheet and looking at it. | L | owner |
| Q13 ✅ | **The sound effects sound bad.** They are synthesized by `scripts/build-sounds.mjs` and it shows. Source genuinely good audio — real recorded card handling, a proper win sting — rather than tuning the synthesizer. **There is no size budget here: quality is the only bar.** Keep the same file names so `lib/sounds.ts` is untouched, and record each asset's licence. | M | owner |
| Q13b ✅ | **The settings menu is thin for a game.** It carries sounds on/off, haptics on/off, language, logout and delete-account. What players expect and it lacks: a **volume level** rather than a binary mute (and separate music vs. effects levels once there is music), animation-speed or a reduce-motion toggle that does not depend on reading the OS setting, card-sort preference, left-/right-handed hand layout, and a table/card-back picker once Q25 exists. Depends on Q13 for anything volume-shaped to be worth hearing. Settle the full list against what shipped card games offer during Q27's research rather than guessing it here. | M | owner |
| Q14 ✅ | **Haptic and sound choreography.** The assets exist; the choreography does not. Which event fires what, layered against the animation rather than alongside it. | M | BRIEF T3 |
| Q15 ✅ | **Colourblind-safe suit differentiation.** Measured, and the premise was wrong: the traditional two-ink deck already separates by ΔE 27.4 under protanopia (its worst case) and 59–87 elsewhere, and the pip glyph differs per suit regardless. The obvious "fix" — a four-colour deck with a green club — is a **regression**: red against green is ΔE 13.2 under deuteranopia. `tests/suitColours.test.ts` pins both facts so it is not changed on intuition later. Nothing to build. | S | BRIEF T3 |
| Q16 ✅ | **Rejoin-in-progress UX.** A disconnect is currently a cliff; it should be a speed bump. The server-side grace timer and rehydration already exist — this is the client's presentation of them. | M | BRIEF T1 |
| **Features** |
| Q17 ✅ | **Match replay.** A replay is one *manche*, the unit `handleGameOver` and `match_history` already work in. The server keeps the move log in memory and writes it once, at game over, to `match_replays` — no hand is ever stored, only what was played and the counts that followed. `lib/replay.ts` folds it back into a `GameState`; `app/(online)/replay.tsx` feeds that to the same `GameTable` in the `spectating` mode Q18 added, so no second table renderer exists. Retention is by age rather than per user, because a row belongs to up to four players at once. | L | A11 |
| Q18 ✅ | **Spectator mode.** Watch a friend's table. Nearly free given the existing broadcast architecture: join without a seat, receive the same sanitized state every non-acting player already receives. | M | A10 |
| Q19 ✅ | **Match history pruned to the last 50 rows per user.** Kept at 50, deliberately: it is the profile's *recent matches* list, not an archive, and the property that matters is that the table cannot grow without bound per user. Prune and read already shared one constant, so there was no defect — `tests/historyBound.test.ts` now pins that they keep sharing it, and that the prune stays inside the insert's transaction. Replay (Q17) stores its own data and must bound it separately; it does not belong in this list. | S | A15 |
| Q20 ✅ | **Bot personalities.** Five named opponents (`lib/botPersonalities.ts`) replace the easy/medium/hard picker everywhere — offline lobby, online room, the rules FAQ. A personality is one of the engine's three strategy tiers plus two knobs, `aggression` and `unpredictability`, which only re-rank candidates `getAllValidPlays` already returned; `Player.difficulty` is gone, so there is one concept, not two. Randomness enters through an injected `rng` parameter, so the engine stays deterministic under test. | M | BRIEF T2 |
| Q21 ✅ | **Daily streaks.** Standard, effective, low risk. Achievements already ship; this is the returning-player half. | S | BRIEF T2 |
| Q22 ✅ | **Ranked ladder with a visible rating.** The season question is settled: a season is a calendar month, UTC, **derived from the finish time rather than scheduled**, so the reset cannot be missed on a host that sleeps. A new season seeds from half the previous one's distance to the mean. Rating is pairwise Elo over placement, normalised so it reduces to textbook Elo at two seats; free-for-all only, bots dropped and the humans renumbered among themselves. Conservation is exact on one K and bounded on mixed records — both pinned, because assuming the first was unconditional was wrong. Anti-farming needed no mechanism: a fixed pair asymptotes and stops paying entirely. | L | A7 |
| Q23 ✅ (respecified) | **Push notifications — for invites, not turns.** The queued premise does not survive contact with the code: online Murlan is real-time, not correspondence. `AFK_TIMEOUT_MS` auto-passes an idle player after 30s and `DISCONNECT_GRACE_MS` hands the seat to a bot after 60s, so a turn push has to be delivered, noticed and acted on inside half a minute or it announces a turn already passed. Shortening those clocks would hold three players hostage to a fourth's phone call. The same plumbing has a real use next door: `server/socket.ts` drops `friend:invite` on the floor for a friend who is not connected (`if (!friendSocket) return`), and nothing expires while an invite waits — the room stays `waiting` until the host starts it. Built as: a `push_tokens` table, a `server/push.ts` that POSTs to Expo directly rather than adding `expo-server-sdk`, permission asked on the Friends screen rather than at launch, and no in-app toggle because the OS permission already is one. Ships inert until O7 supplies credentials — every layer below delivery runs, and `tests/integration/pushTokens.test.ts` exercises all of it against a real database and a local stand-in for Expo: a device re-registering upserts rather than duplicates, logout withdraws one device and not the other, a malformed token is refused, deleting an account takes its devices with it, an invite to a *connected* friend sends no push (they already saw it), one to a disconnected friend reaches both his devices with the room code attached, and a stranger cannot make the server send anything. Verified able to fail. | M | BRIEF T2 |
| Q24 ✅ | **Error reporting.** Wanted, but every third-party crash SDK is a data processor and changes the App Store privacy answers. Build the in-house version first: a single authenticated endpoint the existing `ErrorFallback` posts to. No new dependency, no new processor. | M | A9 |
| Q25 ✅ | **Cosmetics: card backs and table felts.** Four backs and four felts, picked in Settings beside sound and language. **No `user_cosmetics` table, against the spec:** nothing here is visible to anyone else — every card back on a table is drawn the same way for the player looking at it — so there is no server state to be authoritative about. It is a display preference like volume and language, and it lives where those do. If cosmetics ever become unlockable, the *entitlement* is what needs a table; the choice still would not. A back is an ink, a felt palette, a lattice spacing and a star count — the only four things that survive at card size — so no new artwork and no bundle cost. `tests/cosmetics.test.ts` pins that no alternate felt is lighter than the green at any stop, which is what keeps `tests/contrast.test.ts`'s ratios a floor for all four. | L | BRIEF T3 |
| Q26 | **Tournaments.** Bracketed multi-table events. Significant work, high ceiling. Last in the queue deliberately. | XL | BRIEF T3 |
| **Found by reading the code, 2026-08-17** |
| N1 ✅ | **`room:unspectate` bypassed the safety wrapper.** It was the one inbound event of sixteen registered with a bare `socket.on`, so it had no rate limit, no per-event error context, and no client-visible failure. Now through `onEvent` with `NoPayloadSchema` and the same 10/minute allowance as `room:spectate` — leaving must not be cheaper to spam than joining. Severity was smaller than it first looked: `installProcessGuards()` already catches an escaped throw, so this was never "takes the server down". `tests/socketEvents.test.ts` pins that no inbound event bypasses the wrapper again, and is verified able to fail. | S | code read |
| N2 ✅ | **The ladder showed its season as `2026-08`.** Now "Stagione Agosto 2026", in the reader's language, from twelve `month.*` keys per locale. The stored key is untouched: it is half the `user_ratings` primary key and it sorts lexicographically, which is what makes "the season before this one" a plain descending order — so `formatSeason()` is presentation only, pure, and tested. A key that is not `YYYY-MM` is shown raw rather than guessed at; the only way to get one is a future change to `seasonKey`, and an odd label beats a confidently wrong month. Verified rendered, not just unit-tested. | S | code read |
| N3 ✅ | **The home screen's local `MenuButton` shadowed the shared one.** Renamed `HomeMenuRow`, which is what it is: a destination row with a chevron and a staggered entrance, not the pill CTA twelve other screens import. They were never the same component, so merging them would have pushed chevrons and entrance delays into a shared CTA for one caller. The design-system rule in `CLAUDE.md` was doubly wrong and now is not: home uses neither `MenuLayout` nor `MenuCard` either, so it is a second deliberate exemption alongside the game tables — a full-bleed title screen, not a stack of cards — and the rule says so, along with why the name must stay distinct. **No structural test added, on purpose.** A shadow scan finds zero collisions now, but the invariant is softer than the ones the other structural tests protect, and as `components/` grows the odds of a benign name match rise — a check that fires on something harmless gets suppressed, which is worse than not having it. Same call as the padding shorthand: one occurrence does not earn a rule. | S | Q27 pass 2 |
| N4 ✅ | **`active_games` rows orphaned by a restart were never removed.** Confirmed, not assumed: there *is* a periodic sweeper, but it walks the in-memory `activeGames` map — as does every other path that deletes a row — and a restart is precisely what empties that map. A game live when the process went down, that nobody rejoins, was invisible to all of them. On Replit, which sleeps, that is every sleep with a game open. The sweeper now also prunes rows untouched for 24h; `persistGameState` refreshes `updated_at` on every move, so a live game is never a candidate, and the margin protects a row a player could still legitimately rejoin. `tests/integration/abandonedGames.test.ts` covers it against a real database, verified able to fail. | S | code read |
| N5 ✅ | **An offline game is lost the moment the app goes away.** `context/GameContext.tsx` holds the whole match in memory and writes nothing; `docs/ARCHITECTURE.md` §2 says so outright. Online games survive a restart through `active_games`, so the weaker guarantee is on the mode played without a network — on a phone, where a call or a background kill mid-hand is ordinary. AsyncStorage is already a dependency and already carries settings and locale, so this needs no new storage and no server. What had to be persisted turned out to be five things, not one: the engine state, the match scoreboard, the rematch answers, and the player setup and mode that deal the next manche. `lib/offlineSave.ts` holds the encode/decode and the decision to trust a stored blob, version-gated and discarded rather than migrated on a mismatch — the call `active_games` already makes. `GameContext` writes on every change and clears the save when the match ends or the player leaves deliberately; the home screen offers **Riprendi partita** above the offline row. Covered by `tests/offlineSave.test.ts` and `tests/native/offlineResume.test.tsx`, verified able to fail. | M | code read |
| N7 ✅ | **The offline E2E suite cost more wall clock than it needed to.** Runtime is set by the deal: `tests/e2e/helpers/bot.ts` deliberately models no card legality and instead selects a candidate combination and reads the real GIOCA button to learn whether it was legal — which is the right check, and the reason a move costs as many clicks as the deal makes it cost. Measured across runs with nothing else on the machine, the same 3-player hand ranged from 49s to over 4 minutes, and the whole suite takes 11 minutes. Verified **not** a regression: the same test fails the same way at `04ec62d`, in a worktree built from that commit. The budget now sits far above the median deliberately (see the comment there) because `stallMs` is what catches a broken game. Fixed by ordering the search rather than shortening it: answering a single, every card at or below the table's rank is two wasted clicks, because a beating play must be *strictly* higher and suit never breaks a tie. GIOCA still decides; this only decides what to offer it. Leading stays exhaustive — the opening play must contain the dealt start card, so skipping a candidate there could skip the only legal move. **Suite runtime 11.0m → 3.6m**, and the 3-player hand that had been failing at 4.9m now finishes in 34s. Sleeps untouched: the 80ms after a click is what stops a select racing its own deselect. | M | measured |
| N8 ✅ | **A finished room was never deleted, and neither were its players.** `disposeGame` removes the `active_games` row and the sweeper prunes the ones a restart orphaned (N4), but nothing ever touches `rooms` or `room_players` — `updateRoomStatus(roomId, "finished")` is the end of a table's life, and the row outlives it. The only deletion anywhere is `storage.deleteUser`, and it only removes rooms the departing player *hosted*. So every online game ever played leaves one `rooms` row and one `room_players` row per seat, permanently. Same class as N4 and the same fix shape: prune finished rooms past a window in the sweeper, with the window comfortably longer than any legitimate rejoin. The sweeper now prunes rooms older than 24h, seats first — `room_players` has no cascade, and the test proves that order is load-bearing by failing on the foreign key without it. Age is derived from `created_at` rather than a new "finished at" column, because `rooms` is written every time anyone opens a table and that is the write a missing column breaks; no game lasts a day, so age alone separates a live room from a dead one, and it collects the rooms a restart stranded in `waiting` too. A room still in the in-memory map is never a candidate whatever its age, and each sweep takes at most 500. Still open, minor: `room:join` reports a finished room as "Partita già iniziata", which is wrong for a game that is over. | M | code read |
| N9 ✅ | **The room-code retry could insert a code it had just seen taken.** `DrizzleStorage.createRoom` loops ten times: check the code, break if free, otherwise generate another. If the tenth check finds a collision it generates a replacement and leaves the loop **without checking it**, so the insert runs on an unverified code and fails on the unique constraint rather than retrying. At 36^6 this is vanishingly unlikely today and gets likelier as N8 accumulates rows. The defect was not the odds, it was that the loop looked like it guaranteed a free code and did not — and a check-then-insert cannot guarantee one anyway, since another caller can take the code in between. `createRoom` now inserts and retries on the unique violation, which is what `createUser` five lines above already did for friend codes: the constraint is the only thing that can settle it, so the insert asks it. | S | code read |
| N10 | **Every confirmation and error dialog was a no-op on web.** `react-native-web` implements `Alert` as `class Alert { static alert() {} }` — an empty function — and web is what Replit serves, so on the platform the game is actually played on you could not quit a game, leave a room, or delete an account, and errors on the online lobby and room were invisible. Found behaviourally first — an E2E test quit a game, reloaded, and the interrupted-match offer was still there. `components/ConfirmDialog.tsx` is the one cross-platform confirmation; the informational alerts go through the notification banner that already existed. The quit half of `tests/e2e/offlineResume.spec.ts` is back. | M | done |
| N6 | **The aesthetics half of the UI audit.** Q27's sweep proved every control is reachable at three sizes; it says nothing about whether the game *reads* well — motion that overshoots or jitters, spacing rhythm, whether the table is legible at a glance, whether the hand is comfortable at fourteen cards on a small phone. That needs judgement against how shipped card games feel, not a DOM probe, and it is the half Q27 originally asked for. **In progress.** Two defects found by rendering the table and measuring it, both fixed: the side seats' fans centred their overflow so half of each hung off the screen with the avatar and name, at every viewport; and the vignette's four corner squares drew a visible grid across the felt, because a linear gradient over a box inset on both axes still carries ink along its inner edges. `tests/e2e/tableFit.spec.ts` and `tests/vignette.test.ts` pin both. Motion has since been gone through too, and it held three more: `pickup`, documented as arriving "with no visible wobble", sat at a damping ratio of 0.43 and overshot 22%, while `land` wanted one bounce and had the same ratio, so it gave three — both are now specified to the feel their comments claim, and `tests/motion.test.ts` pins the ratios. Four springs written inline bypassed the tokens entirely, two of them verbatim copies, which is why that tuning would have missed them. And the home, result and rules screens never read `usePrefersReducedMotion` at all — twenty-eight animation calls including two endless `withRepeat` loops; `tests/reducedMotion.test.ts` now fails on any animating file that does not consult it. Still open, and all of it a matter of taste rather than a defect: the spacing rhythm, the large amount of empty felt on a tablet, and how the result screen reads. | L | Q27 |
| **The polish pass** |
| Q27 ✅ (first sweep complete) | **UI/UX audit.** Every screen the app has is now swept for controls a player can see but cannot press: home, the offline lobby, the game table, the online lobby, the waiting room, the profile and the ladder, each at three viewport sizes (`tests/e2e/tapTargets.spec.ts`). The sweep also asserts it examined a minimum number of controls, so a screen that failed to render cannot pass by finding nothing — floors set from measured counts after the first three guesses came out too high. **Fixed across the passes:** the home accent button's fill (a `padding: 0` shorthand that RN's longhand resolution ignored); the online room's format picker rendered twice in landscape and not at all in portrait, plus its left column overflowing under the start bar; and the create-room button being completely unpressable on a phone in portrait, buried under the "oppure" divider. **What the audit taught, and what to keep doing:** a screenshot raises a suspicion but never settles one. Pass 1 produced four false positives from screenshots of scroll areas and cost two speculative fixes, both reverted. Every real defect since was pinned by something else — `git log -S`, a duplicated JSX line, `elementFromPoint`. **Left for a later pass:** this covers *reachability*, not aesthetics. Motion, spacing rhythm, and how the table reads at a glance are still only eyeballed. | XL | owner |

---

## 2. Owner-blocked

Cannot be closed from inside the repo — each needs an account, a device, or a person.

| # | Item | What is needed |
|---|---|---|
| O1 | `eas.json` submit credentials are placeholders (`appleId`, `ascAppId`, `serviceAccountKeyPath`) | Apple Developer + Google Play accounts. `eas build` works; `eas submit` cannot run. |
| O2 | `assets/images/android-icon-monochrome.png` is 432×432; the other adaptive layers are 512×512 | The asset regenerated. Re-encoding an icon by guesswork is worse than leaving it. |
| O3 | `locales/sq.ts` needs a native-speaker pass | Grammar and terminology are consistent (`dorë` properly declined, `manche` removed). What remains is idiom and register, which needs a speaker, not a rule. The four `server.PLAYER_*` strings for AFK auto-pass/exchange, disconnect grace and reconnect were reworded genderless by construction (*nuk përgjigjet*, *humbi lidhjen*, *është sërish në lojë*) to stop them misgendering a player; the phrasing is grammatically reasonable but, like the rest of the file, not a native read. |
| O4 | VoiceOver / TalkBack flow unverified | A physical device. The pure description logic is unit-tested; the *flow* cannot be. |
| O5 ✅ | Replit boot — verified 2026-08-19. | Deployed from `origin/main`: `db:push` renamed both `room_code` columns, the built server was polled healthy before Deploy was pressed, and the live URL's `/health` reported the database connected with `/` carrying the CSP header. The `reusePort` fix needed no attention — `process.platform === "linux"` gated, a no-op on Replit as expected. Sequence in `docs/DEPLOY-RUNBOOK.md`. |
| O6 | `icon.png` 1.2 MB, `splash-icon.png` 1.37 MB | A WebP re-encode measures real headroom (icon.png to 105.5 KB, splash-icon.png to 136.6 KB at quality 0.9), but Expo's own prebuild pipeline (`@expo/image-utils` → `jimp-compact`) cannot decode WebP — confirmed by feeding it the encoded output. Shrinking the pixels instead needs a device pass: `icon.png` is pinned at 1024×1024 by the iOS App Store marketing-icon requirement, and `splash-icon.png` is scaled to screen size by `expo-splash-screen`'s CONTAIN mode, so whether 1024px has slack depends on the widest real screens. Measured, deliberately deferred. |
| O7 | Push credentials for Q23 | An FCM service account (Android) and an APNs key (iOS), uploaded to EAS, plus a privacy-policy entry covering push tokens. |
| O8 | Whether the app monetizes at all | A business call. Murlan Pro charges $0.99/month to remove ads. **No ad SDK will be added without an explicit instruction** — it is a data processor, it changes the store privacy answers, and `docs/BRIEF.md` puts ads out of scope. Q25's cosmetics are the non-invasive surface if one is ever wanted. |
| O10 | Account friction, before the ladder is worth defending | Elo makes a *fixed* pair of farming accounts asymptote on its own (`tests/rating.test.ts`), so no rating mechanism is needed for that. What it cannot answer is one player creating many sacrificial accounts. That needs email verification or rate-limited registration — a signup decision, not a rating one. The ladder is honest for the player base that exists; this is what "public and tamper-resistant" would additionally require. |
| O11 | Q11 and Q12 cannot progress: the Maestro job has never actually run | Not a push anymore — `origin/main` and local `main` are even, and `.github/workflows/maestro.yml` is on the remote and registered (`gh workflow list` shows it active). What is still missing is the one manual run: `gh run list --workflow=maestro.yml` comes back empty. It stays `workflow_dispatch` only by design until a run is watched green — firing `gh workflow run maestro.yml` and confirming that is what promotes the trigger to `on: push` and closes this out. |
| O12 | `context/GameContext.tsx` is the one screen-facing provider the React Compiler still skips | An owner ruling on the latest-ref pattern. **Measured:** `node .superpowers/…/compiler-probe.mjs context/GameContext.tsx` → `BAILS — line 151 Cannot access refs during render`. The site is `gameStateRef.current = gameState` at :171, a ref written during render, which the compiler reads as a Rules-of-React violation and which costs `GameProvider` the optimisation the build pays for. **Blast radius is nil today:** that ref is read only inside `answerRematch` (:246) and `chooseExchangeCard` (:254), both `useCallback` handlers a player triggers, so there is no window in which a consumer sees a stale value — this is a correctness tidy-up, not a live bug. The compiler-safe move is to write it in an effect, which changes *when* the value becomes visible; that is a design decision about the pattern, not a dependency-array correction, which is why it is here and not fixed. Everything under `app/` and `components/` compiles clean and `tests/reactCompiler.test.ts` holds that line; `context/` is deliberately outside that assertion. |
| O9 | 30 npm vulnerabilities remain (0 critical) | **Do not run `npm audit fix --force`.** Checked: it would bump `expo` 54 → 57 (three major SDK versions, breaking the React 19.1.0 pin and Expo Go) and *downgrade* `drizzle-kit` 0.31 → 0.18, breaking `db:push`. **One advisory reached production and is now fixed:** `drizzle-orm` — the ORM every route and socket handler queries through — carried GHSA-gpj5-g38j-94v9 up to 0.45.2, and SEC-06 bumped it. It was never exploitable here (the advisory needs an attacker-controlled SQL *identifier*; `sql.identifier`/`sql.raw` appear nowhere in the repo), but O9 had claimed no advisory touched the server at all. Every remaining one does run in build, dev or test tooling only — metro, @expo/cli, @expo/config, @esbuild-kit, drizzle-kit. Plain `npm audit fix` is exhausted. Revisit at the next Expo SDK upgrade. |
| O14 | **Real account recovery, and third-party sign-in.** There is no password reset — no email is stored — and `scripts/reset-password.mjs` is an owner-run stopgap that does not scale past people you know personally. | The full answer is its own plan: an email (or phone) on the account, a reset-token table and a sender, an in-app change-password screen, and **Sign in with Apple** and **Sign in with Google**. Apple's guideline 4.8 makes Sign in with Apple mandatory once any other third-party sign-in is offered, so the two arrive together. Touches `shared/schema.ts`, `server/routes.ts`, the auth screens and the store listing. |
| O15 | The database has no backup | `pg_dump` before a deploy is written into `replit.md` § Rolling back a deploy, but nothing takes one on a schedule. A `scripts/backup-db.mjs` plus somewhere to keep the output. Wanted before the beta user count is large enough that losing it matters. |
| O16 | There is no way to see what beta users are doing | Client crash reports go to the server log (`POST /api/client-errors`) and nowhere else, and nothing answers "how many people played today" or "did anyone get stuck". An owner-only authenticated view over signups, games played and recent client errors. |
| O17 | Login is rate-limited per IP, 20 attempts per 15 minutes (`server/routes.ts` `authLimiter`) | Beta testers on one home or office network share that budget and can lock each other out — a confusing first impression that looks like a broken app. Either raise it, or key it per-username with a separate per-IP ceiling. |
| O18 | The twelve sound effects have never been played on real iOS or Android hardware | Asserted, not heard. AVFoundation has decoded MP3 for as long as it has existed, so the risk is small — but a simulator is not the check. Ten minutes with a phone; the list is in `docs/BETA-PLAYTEST.md`. |
| O19 | No unit test can see a layout bug | `@testing-library/react-native` runs on `react-test-renderer`, which never runs flexbox, so no native test can assert which side of a seat a card fan renders on. The word `CardFan` (`components/table/seats.tsx`) appears nowhere under `tests/`. The only tier that can catch this class is Playwright (`tests/e2e/tableFit.spec.ts`) — which is why the card fan rendered off-screen for months against a green suite. |
| O20 | `noUncheckedIndexedAccess` is off | **Measured:** `npx tsc --noEmit --noUncheckedIndexedAccess` finds 649 errors, 75 of them in `lib/` (70 in `lib/gameEngine.ts` alone) and 14 in `server/`. In a game built on indexing hands and seats by position, it is the strict-family flag with the most to say about this codebase specifically. Worth scoping to `lib/gameEngine.ts` and `server/` first rather than the whole repo at once. |
| O21 | A dead `jokers` filter in `getAllValidPlays` (`lib/gameEngine.ts`) | `const jokers = hand.filter((c) => c.isJoker);` is assigned and never read, allocating a discarded array on every AI move search. Verified genuinely dead — no other reference in the function — against `docs/RULES.md` §5, "Jokers form no combination": pairs, triples and bombs are natural-only by rule, so nothing should ever consume it. |

---

## 3. Analysis — already answered

### Replace the tech stack

> "Modernise and/or replace the whole tech stack to use best-in-class languages and
> frameworks used by mobile games, to reduce game size, improve game logic, improve
> testing and multiplatform building. This could remove Replit and Expo entirely if they
> are bottlenecks. Do not simply trust my word."

**The answer differs for the client and the server.**

#### What the app actually demands

A turn-based card game with at most 54 sprites on screen, no physics, no 3D, no real-time
simulation, and a rules engine whose heaviest operation was **measured at 0.96 ms per
move**. The computational requirement is close to zero. This matters, because most
"game engine" arguments assume a rendering or simulation problem this app does not have.

#### Client: keep React Native / Expo

| Option | Bundle (2D, minimal) | Verdict |
|---|---|---|
| **Expo / React Native** (current) | ~15–25 MB | Keep |
| Unity | ~20–30 MB | **Would increase size.** Built for problems this app does not have. |
| Godot | ~15–25 MB | No size win; loses the entire JS/TS ecosystem and every test written. |
| Flutter + Flame | ~8–15 MB | Genuine size win, but a full rewrite in Dart. |
| Native Swift + Kotlin | ~5–10 MB | Smallest and fastest — and two codebases to maintain forever. |

The premise worth challenging is that a game engine reduces size. **For a 2D card game it
increases it**, because you ship a renderer and physics you never use. Unity and Godot are
the wrong tool here, and would be even if starting from scratch.

Flutter and native *are* genuinely smaller. The question is whether ~10 MB is worth what
it costs. Measured from this repository:

| Surface | Lines | Fate under a port |
|---|---|---|
| `app/` | 7,257 | Rewritten in Dart |
| `components/` | 6,552 | Rewritten, including the hand-drawn SVG card art |
| `context/` | 1,584 | Rewritten |
| `lib/` | 2,217 | Rewritten — engine, i18n, sounds, theme |
| `locales/` | 2,046 | Re-keyed (translations survive; plumbing does not) |
| `tests/` | 4,961 | Rewritten in Dart |
| `server/` + `shared/` | 4,025 | **Kept.** A client port does not touch the backend. |

Roughly **19,700 lines of client code plus 5,000 lines of tests** to reproduce, to reach
exactly the behaviour that exists today — and beyond the line count:

- The whole safety net, including the property test proving the straight enumerator is
  complete, has to be re-earned in Dart before the port can be trusted at all
- Every bug fixed here — impersonation, the permanently deadlocking table, the deal that
  removed a Joker from ~7% of games, three exchange-phase freezes, the AI lead deadlock,
  four separate invisible-colour bugs — would need to *not* be reintroduced. Rewrites do
  not carry fixes across; they re-earn them one incident at a time.
- Expo Go testing disappears. Flutter needs a real build for device testing, so the free
  path available today would close.
- `expo-audio`, `expo-haptics`, `expo-screen-orientation`, `expo-localization` and the
  Reanimated animation work all need Flutter equivalents found, wired and re-verified.

**Verdict: no client rewrite.** Revisit only against a measured problem React Native
cannot solve — sustained frame drops during the deal animation on a low-end Android
device would be a real trigger. Bundle size alone is not, and the largest single win
available is 2.5 MB of icon and splash PNGs (O6), which needs no rewrite at all.

#### Expo specifically

Expo is not a bottleneck; it is the reason iOS and Android build at all from a Windows
machine without a Mac. Ejecting would cost the managed build pipeline, OTA updates and
Expo Go testing, and buy nothing this app needs.

The one real Expo constraint already bit and was resolved: `react-native-keyboard-controller`
was the sole thing blocking Expo Go, it was dead code, and removing it restored free
on-device testing.

#### What would actually make the game smaller

Measured, in order:

1. Icons and splash: **2.5 MB** of the assets (O6)
2. Audio: 872 KB of CC0 recordings at 44.1 kHz. Deliberately larger than the
   synthesized set it replaced — quality is the bar there, not size
3. Unused dependencies: 12 removed so far

The client bundle is not where the weight is. `docs/BUNDLE.md` has the numbers, and
`scripts/bundle-report.mjs` regenerates them.

### Server: Replit is a real bottleneck, and the app stays there anyway

**Decision: stay on Replit.** `CLAUDE.md` makes a working Replit environment binding, and
there are no players yet. The analysis below stands for the day that changes.

Replit is fine for developing and demoing, and a poor production host for a real-time
multiplayer game:

- **No horizontal scaling.** All game state lives in in-process `Map`s (`activeGames`,
  `userSocketMap`, `socketRoomMap`). A second instance would not share them, so scaling
  requires either sticky sessions plus a Redis adapter, or staying single-instance forever.
- **Cold starts drop websockets.** A sleeping Repl disconnects every player mid-game.
- **The proxy already caused a real bug** — `trust proxy` being unset meant the production
  session cookie was silently never set, which is *why* the forgeable `userId` fallback
  existed.
- No managed backups, no metrics, no log retention.

The move, when it happens, is small and should stay small: one always-on container on
Fly.io or Railway, managed Postgres from the same provider, the provider's own logs and
metrics. No Kubernetes, no Redis, no queue — none of that is warranted for one Express
process and a Postgres database, and the server uses no Replit-specific APIs, so only the
client's base URL changes. Defer horizontal scaling until player count demands it.

### Android UI automation — built, partially working

Android SDK, an AVD, and Maestro are installed and verified on this machine (`docs/TESTING.md`
§5 has exact versions; Maestro runs natively on Windows via Git Bash, so the documented
WSL2 route is unnecessary here). `.maestro/smoke.yaml` and `.maestro/offline-game.yaml` are
checked in.

`smoke.yaml` passes reliably and repeatedly from a fully cleared app state, and was verified
able to fail (a swapped-in false assertion produced a real exit-1).

`offline-game.yaml`'s logic is verified correct step by step, but a full unattended run does
not yet reliably reach the result screen on this machine: around the landscape rotation into
the live, continuously-animated table, either Android force-kills the activity or the
emulator process dies. This reads as a software-rendering ceiling under sustained animated
load, not a flow defect. Remaining work is Q11 and Q12.

Two app findings came out of actually running it: Expo Go's dev-menu is two stacked layers
whose lower sheet silently swallows taps, and Q4.

---

## 4. Rejected, with reasons

| Item | Why not |
|---|---|
| Free-text in-game chat | All three competitors ship it. Moderation liability with minors in the audience, no gameplay gain. Emoji reactions cover the social signal. |
| Ads | Out of scope per `docs/BRIEF.md`, and an ad SDK is a third-party data processor that changes the store privacy answers. See O8. |
| `React.memo` on the card components | The React Compiler already covers those files, and `deepCloneState` gives every card a new reference per transition, so a shallow comparator can never hit. An incomplete custom one causes stale renders. |
| Replacing `deepCloneState` for performance | Measured at 0.96 ms/move. Not a bottleneck. |
| A generic achievements framework | A flat array with predicates is enough. |
| An `eslint-disable` sweep to clear lint | Cleared honestly instead: every dependency array is real and no `react-hooks` rule is switched off anywhere under `app/`, `components/` or `context/`. A suppression there costs the whole file its React Compiler pass, which `tests/reactCompiler.test.ts` fails on. |
| Real-money play, social feeds, cross-promotion | Out of scope per `docs/BRIEF.md` §5. |
