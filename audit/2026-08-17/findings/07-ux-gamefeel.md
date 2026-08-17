# B3 — UX & game feel

Audit of `C:\Users\roton\murlan` at `b894af4`. Read-only; every claim below comes from
reading source, not from running the app (see `Coverage gaps`).

Two people frame everything here: **a first-time player who does not know Murlan**, and **an
experienced player mid-hand**. The repo is unusually well built for both in places — the
tutorial is engine-backed and names the exact rule you broke; the table has a real press
model, a flight/impact split, and a reduced-motion path everywhere. The findings are where
the feedback loop is broken, silent, or fires for the wrong event.

**Correction carried in from the coordinator, and independently confirmed:** the start-card
rule *is* re-checked on the client (`components/GameTable.tsx:476-481`), so there is no
lit-button-then-silent-rejection on the opening turn. No finding below rests on that premise.
`components/gameTableModel.ts:171` ("both screens now explain themselves") is still
overstated — see UX-06.

---

### [UX-01] Send the validated cards, not the raw selection — and clear the selection when the server moves for you
- **Severity:** High
- **Confidence:** High (read the code)
- **Effort:** S
- **Location:** `components/GameTable.tsx:468-471`, `components/GameTable.tsx:815-821`, `app/(online)/game.tsx:77`, `app/(online)/game.tsx:98-107`, `app/(online)/game.tsx:178-183`, `app/(online)/game.tsx:218-221`, `server/socket.ts:1419-1421`, `server/socket.ts:503-514`
- **Problem:** The table validates a *filtered* selection but sends an *unfiltered* one.
  `selectedObjs` (`GameTable.tsx:468-471`) is `sortedHand.filter(c => selectedIds.includes(c.id))`
  — only ids still in the hand. `isValidPlay` and therefore `playBtnValid` are computed from
  that. But `handlePlay` emits `onPlay(selectedIds)` (`:820`) — the raw id list. When the two
  disagree, the server takes the strict view: `unique = new Set(cardIds)`, `cards =
  player.hand.filter(...)`, `if (cards.length !== unique.length) return;`
  (`server/socket.ts:1419-1421`) — a bare `return`, with no `game:error`. Nothing is emitted,
  so `pendingPlayRef` (`app/(online)/game.tsx:181`) is never cleared and `selectedIds` is
  never cleared.
  The two lists diverge because online `selectedIds` is only ever cleared on a server
  *acknowledgement* (`:98-107`) or on the player's own pass (`:220`). It is **not** cleared
  when the server moves for the player: `autoMoveForSeat` with `useAi=false` plays the seat's
  lowest single when it is leading a new round (`server/socket.ts:503-514`), and passes
  otherwise. Either way a card can leave the hand while its id sits in `selectedIds`.
  It is also not cleared when the next manche is dealt, and card ids are deterministic
  (`lib/gameEngine.ts:185`, `` id: `${rank}_${suit}` ``), so a leftover id can match a card in
  the *new* hand.
  The offline path does not have this defect: `context/GameContext.tsx:337` filters against
  the hand and ignores the argument entirely, and `:218`/`:245` clear the selection on every
  deal. The asymmetry is what marks this as an oversight rather than a decision.
- **Impact:** Two user-visible failures, both online only.
  (a) **A lit GIOCA that does nothing, with no message.** The player is on the clock, the
  button glows gold and pulses (`GameTable.tsx:697-718`), they tap it, and nothing happens —
  no toast, no sound, no haptic, no state change. Repeated taps do nothing. The only escape is
  to guess that deselecting and reselecting helps. If the 30 s AFK window then expires, the
  server plays for them.
  (b) **Phantom pre-selected cards at the start of a manche.** Cards the player never touched
  render lifted and glowing (`GameShared.tsx:649-660`), and the GIOCA sub-label shows a count
  (`GameTable.tsx:1110-1112`) that does not match what is lifted.
- **Repro / proof:** Online, 4 players. On your turn to lead, select two cards that form a pair
  (one of them your lowest card) and let the 30 s clock run out. Server:
  `handleAutoPass` → `autoMoveForSeat(game, seat, false)` → `isNewRound` true →
  `sortHand([...player.hand])[0]` is played (`server/socket.ts:509-514`). Your lowest card is
  now gone; `selectedIds` still holds both ids. When the turn returns to you, `selectedObjs`
  is the one remaining card, `buildCombination` makes a single, `canPlay(single, …)` passes,
  `playBtnValid` is true, the button lights. Tap it: `onPlay(["7_hearts","7_clubs"])` →
  server sees `unique.length === 2`, `cards.length === 1` → `return` at `:1421`. Nothing is
  emitted to any client.
- **Proposed fix:** In `components/GameTable.tsx:815-821`, send the validated set:
  `onPlay(selectedObjs.map(c => c.id))`. Additionally, in `app/(online)/game.tsx`, prune the
  selection whenever the hand changes — add an effect keyed on `me?.hand` that drops any
  `selectedIds` entry no longer present in the hand (the same effect at `:98-107` can do it),
  and clear it outright when `gameState.gameOver` goes false→true→false across a manche
  boundary. Separately, `server/socket.ts:1419-1421` should emit
  `socket.emit("game:error", { message: "Invalid card", code: "INVALID_CARD" })` before
  returning — that code already exists and is already translated (`locales/it.ts:72`), so no
  new copy is needed.
- **Acceptance criteria:**
  1. A test drives `GameTable`'s `onPlay` with a `selectedIds` array containing an id absent
     from the hand and asserts the emitted array contains only ids present in the hand.
  2. An integration test in `tests/integration/gameplay.test.ts`: arm the AFK timer low
     (`MURLAN_AFK_TIMEOUT_MS`), let the server auto-play a leading seat, then have that client
     send a `game:play` containing the consumed id — assert a `game:error` with code
     `INVALID_CARD` reaches that socket.
  3. Manually: after a server-forced move, no card in the hand renders selected.
- **Fix risk:** Filtering in `handlePlay` changes what the server receives on the happy path
  too (it becomes a subset, never a superset), which is strictly safer. Pruning the selection
  on hand change could clear a selection mid-thought if a hand ever changes for a benign
  reason — the only such case is the exchange giveback, which already clears elsewhere.
- **Depends on:** None

---

### [UX-02] Make a pass visible — right now half of every hand happens in silence
- **Severity:** High
- **Confidence:** High (read the code)
- **Effort:** M
- **Location:** `components/GameTable.tsx:822-827`, `components/GameTable.tsx:845`, `components/GameShared.tsx:285-360`, `lib/gameEngine.ts:809-849`, `server/socket.ts:1495-1501`
- **Problem:** When *another* seat passes, the client produces no feedback of any kind.
  `playCardPass()` has exactly one caller — `handlePass` (`GameTable.tsx:822-827`), which only
  runs for the local player's own tap on PASSA. The pile does not change on a pass
  (`lib/gameEngine.ts:809-849` touches `passCount`, `currentTurnIndex` and, on close,
  `roundWinner`/`lastPlayedCombination`, and nothing else). `gameState.passCount` is read in
  exactly one place in the whole UI — `GameTable.tsx:845`, as part of the turn-timer reset
  token. `TopOppSlot`/`SideOppSlot` (`GameShared.tsx:285-360`) render an avatar, a name, a
  card-count bubble and a turn ring; there is no pass state among them. Grep for
  `passCount|passed|didPass` across `app/ components/ context/ lib/` returns no rendering site.
  The only exception is the online *AFK-forced* pass, which the server announces separately
  (`server/socket.ts:622-629` → `context/OnlineGameContext.tsx:291-301` → the notification
  banner). A deliberate pass by a human or a bot is announced by nothing.
- **Impact:** In a 4-player hand, a pass is roughly as common as a play. From the viewer's
  seat, three consecutive passes look like the active ring hopping across the table for 3–4
  seconds (bot pacing `BOT_MOVE_DELAY_MS = 1.2 s`, `server/socket.ts:158`) with nothing
  happening, then the winner tag appearing over a table that suddenly clears. A first-time
  player cannot work out why the turn skipped them or why the pile vanished. An experienced
  player loses the single most important tactical fact after card counts — **who is still
  live in this round** — and has to reconstruct it from memory.
- **Repro / proof:** Offline, 4 players, any hand. Lead a single. The three AI seats each call
  `runAITurn` → `processPass` (`context/GameContext.tsx:395-400`). The only DOM change per
  pass is which avatar carries `isActive` (`GameShared.tsx:198-208`). No sound fires — `play`
  in `lib/sounds.ts:132` is never reached for the `pass` key from any path other than the
  local PASSA button.
- **Proposed fix:** Two parts, both in the presentational layer.
  1. **Per-seat pass marker.** Add an optional `passed?: boolean` to `TopOppSlot`/`SideOppSlot`
     (`components/GameShared.tsx:285-360`) that renders a short "PASSA" chip next to the
     avatar, styled like the existing `comboChip` (`GameShared.tsx:1156-1163`). Derive it in
     `GameTable.tsx` from a small pure helper added to `components/gameTableModel.ts`:
     given `currentTurnIndex`, `lastPlayedBy`, `passCount` and the seat order, the seats
     between `lastPlayedBy` and `currentTurnIndex` that still hold cards are the ones that
     have passed this round. Put the helper's cases in `tests/gameTableModel.test.ts`.
     Clear the markers whenever `lastPlayedCombination` changes identity — the same effect at
     `GameTable.tsx:602-647` already runs there.
  2. **Sound for every pass, not just yours.** Add an effect on `gameState.passCount` in
     `GameTable.tsx` that calls `playCardPass()` when it increases, and remove the call from
     `handlePass` (`:825`) so a local pass is not doubled. Follow the file's own convention
     and pair it with `hapticLight()` only for the viewer's own pass.
- **Acceptance criteria:**
  - In a 4-player hand, after an opponent passes, that opponent's slot shows a pass marker
    until someone plays, and the pass sound fires once (not twice for your own pass).
  - `tests/gameTableModel.test.ts` covers: nobody passed; one seat passed; the last seat's
    pass closing the round (no markers survive); a seat that has already gone out is never
    marked.
- **Fix risk:** The derived-passed-seats helper must not mark a seat that went out this round
  (`finishPosition !== undefined`) or a seat that never got a turn. Getting it wrong shows a
  false "passed" chip, which is worse than none — hence the pure helper plus tests rather
  than inline logic.
- **Depends on:** None

---

### [UX-03] Fix the win/lose sting lookup — it searches an id list for a display name, so neither ever plays
- **Severity:** Medium
- **Confidence:** High (read the code)
- **Effort:** S
- **Location:** `components/GameTable.tsx:686-692`, `lib/gameEngine.ts:750`, `lib/gameEngine.ts:770`, `lib/gameEngine.ts:1060`, `components/GameOverOverlay.tsx:147-151`
- **Problem:** The end-of-hand sound picker is:
  ```ts
  const myName = viewer?.name;
  const myRank = myName ? gameState.rankings.indexOf(myName) : -1;
  if (myRank === 0) playGameWin();
  else if (myRank >= 0 && myRank === gameState.rankings.length - 1) playGameLose();
  ```
  `rankings` holds **engine player ids**, not names: `lib/gameEngine.ts:750` and `:770` both
  push `player.id`, and ids are `` `player_${i}` `` (`lib/gameEngine.ts:1060`). Two other
  files state this outright — `components/GameOverOverlay.tsx:147-148` ("`rankings` holds
  engine player ids (`player_0`)") and `server/socket.ts:743`. `viewer.name` is a username or
  a bot name and can never equal `player_0`, so `indexOf` returns `-1` on every path.
  `playGameWin()` and `playGameLose()` are therefore unreachable.
  `hapticSuccess()` on the line above (`:687`) is *not* gated on placement, so it fires for
  every seat including the one that came last.
- **Impact:** The two most emotionally loaded sounds in the game — `game_win.wav` and
  `game_lose.wav`, both shipped and both asserted present by `tests/soundAssets.test.ts` —
  never play, in either mode. Offline it is worse: `GameTable`'s unmount calls
  `unloadSounds()` (`GameTable.tsx:589`) and `app/result.tsx` plays no audio at all, so the
  offline end of a hand is completely silent. The loser also gets a *success* haptic.
- **Repro / proof:** Read `lib/gameEngine.ts:770` (`newState.rankings.push(player.id)`) against
  `components/GameTable.tsx:689` (`gameState.rankings.indexOf(myName)`). Confirmed against
  `components/GameOverOverlay.tsx:149-151`, which maps `rankings` through
  `nameOf = id => players.find(p => p.id === id)?.name` precisely because they are ids.
- **Proposed fix:** In `components/GameTable.tsx:686-692`, look up `viewer?.id`, not
  `viewer?.name`, and update the dependency array (`:692`) accordingly. While there, gate the
  haptic on the outcome: `hapticSuccess()` for first place, `hapticLight()` (or the already
  defined, currently unused `hapticWarn`, `lib/haptics.ts:46`) for last, and give the middle
  placements *some* sting rather than silence — `playRoundWin` is the closest existing asset.
- **Acceptance criteria:** A test (jest, alongside `tests/native/sounds.test.tsx`) renders
  `GameTable` with `gameOver: true` and `rankings: ["player_0","player_1"]`, asserts
  `playGameWin` is called for `viewerSeat` 0 and `playGameLose` for `viewerSeat` 1, and that
  a state whose `rankings` hold display names calls neither.
- **Fix risk:** None beyond sounds starting to play where they previously did not — verify the
  volume mix (`lib/sounds.ts:153-154`) is still balanced against `playRoundWin`, since nobody
  has heard these two in context.
- **Depends on:** None

---

### [UX-04] Do not wipe the winning cards at the moment the round is won — and stop playing the round-start sting before the round-win sting
- **Severity:** Medium
- **Confidence:** High (read the code)
- **Effort:** M
- **Location:** `lib/gameEngine.ts:830-833`, `components/GameTable.tsx:602-611`, `components/GameTable.tsx:650-666`
- **Problem:** `processPass` sets `lastPlayedCombination = null` and `roundWinner =
  lastPlayedBy` **in the same state transition** (`lib/gameEngine.ts:831-833`). On the client
  both effects fire on that one commit, in declaration order:
  - `GameTable.tsx:602-611` sees `combo === null`, calls `playRoundStart()`, sets
    `pileState` to `EMPTY_PILE` and clears `flyInfo`. The winning cards disappear.
  - `GameTable.tsx:650-666` then sets the winner tag and schedules `playRoundWin` for
    `impactDelayMs(reduceMotion) + ROUND_WIN_STING_GAP_MS` = 532 ms later.

  So the sequence a player gets is: cards vanish → "new round" sting → 532 ms of nothing →
  "you won the round" sting, floating over an empty felt for the remaining ~1.3 s of
  `ROUND_WINNER_MS`.
  The comment justifying the 532 ms delay (`GameTable.tsx:656-658`, "The winning card is
  still in the air") is false in the ordinary case: the winning combination was played at
  least one turn earlier — every other active seat has to pass in between
  (`lib/gameEngine.ts:822-828`) — so nothing is in flight when `roundWinner` changes.
- **Impact:** Winning a trick is the most frequent reward in the game and the payoff lands on
  a blank table with its two sounds inverted. A first-time player is given no chance to see
  *which* cards took the round, which is exactly the information that teaches the beat
  hierarchy.
- **Repro / proof:** Offline, 2 players. Play a K. Let the AI pass. `processPass` closes the
  round (`passesNeeded` = 1), setting both fields; `GameTable.tsx:604-610` clears the pile in
  the same commit that `:655` sets the winner name.
- **Proposed fix:** Hold the pile through the winner tag. In `GameTable.tsx:602-611`, when
  `combo` becomes `null` *and* `gameState.roundWinner` is non-null on the same render, keep
  `pileState.current` and defer `setPileState(EMPTY_PILE)` + `playRoundStart()` by
  `ROUND_WINNER_MS` (using the same cancellable-timer pattern already used for
  `impactTimerRef`, `:419` / `:595-600`). Then the order is: winning cards held → round-win
  sting → cards clear → round-start sting. Drop `ROUND_WIN_STING_GAP_MS`'s flight offset
  (`impactDelayMs(...) + …` at `:659`) since no card is in flight; fire the sting promptly.
  Delete the false comment at `:656-658`.
- **Acceptance criteria:**
  - After the pass that closes a round, the winning combination stays on the felt for the
    duration of the winner tag, then clears.
  - `playRoundWin` fires before `playRoundStart`, not after.
  - A pure test in `tests/gameTableModel.test.ts` for whatever helper carries the "round just
    closed with a winner" decision (a boolean derived from `lastPlayedCombination === null &&
    roundWinner !== null`), so the ordering is pinned rather than re-derived.
- **Fix risk:** Holding the pile delays the empty-table state that the next leader's play
  animates onto. Verify the flying-card effect for the new lead (`:641-645`) still lands on a
  cleared pile — the deferred clear must be cancelled when a new `lastPlayedCombination`
  arrives inside the window, exactly as `impactTimerRef` is cancelled at `:603`.
- **Depends on:** None

---

### [UX-05] The same seat winning two rounds in a row shows no winner tag and plays no round-win sound
- **Severity:** Medium
- **Confidence:** High (read the code)
- **Effort:** S
- **Location:** `components/GameTable.tsx:421`, `components/GameTable.tsx:650-666`, `lib/gameEngine.ts:833`, `lib/gameEngine.ts:845`
- **Problem:** The round-winner effect dedupes on a ref that is never reset:
  ```ts
  const winner = gameState.roundWinner;
  if (winner === null || winner === undefined) return;   // returns WITHOUT touching the ref
  if (winner === prevRoundWinnerRef.current) return;
  prevRoundWinnerRef.current = winner;
  ```
  `roundWinner` cycles `seat → null → seat` as rounds close and reopen (`lib/gameEngine.ts:833`
  sets it on close, `:845` clears it on a non-closing pass). The `null` leg returns at
  `GameTable.tsx:652` before updating `prevRoundWinnerRef`, so the ref stays pinned at the
  last winning seat. When that same seat wins the next round, `winner ===
  prevRoundWinnerRef.current` and the effect returns: no `setRoundWinner`, no winner tag, no
  `playRoundWin`. The ref also survives across manches, because a rematch never unmounts
  `GameTable` (as `:679-680` explicitly notes for the game-over sting).
- **Impact:** Winning a round hands you the lead (`lib/gameEngine.ts:836-837`), so winning two
  in a row is one of the most common patterns in Murlan — and every such second win is
  silently swallowed. The player who is doing best gets the least feedback.
- **Repro / proof:** Offline, 2 players. You play a K, AI passes → round closes with
  `roundWinner = yourSeat`; tag shows, ref := yourSeat. You lead again; the AI passes on a
  non-closing turn is impossible with 2 players, so take 3 players: you win round 1 (ref :=
  0), lead round 2, seat 1 passes (`roundWinner = null`, effect returns early, ref still 0),
  seat 2 passes and closes the round with `roundWinner = 0` again → `0 === 0` → return. No
  tag, no sound.
- **Proposed fix:** In `components/GameTable.tsx:650-655`, reset the ref on the null leg:
  ```ts
  if (winner === null || winner === undefined) { prevRoundWinnerRef.current = null; return; }
  ```
  Also reset it when a new manche is dealt — the simplest trigger is the same
  `!gameState.gameOver` reset the game-over effect already performs at `:681-683`.
- **Acceptance criteria:** A test that feeds `GameTable` the sequence
  `roundWinner: 0 → null → 0` and asserts the winner tag appears twice and `playRoundWin` is
  called twice.
- **Fix risk:** Low. Guard against the opposite failure — the tag re-firing on unrelated
  re-renders — by keeping the identity check on `[gameState.roundWinner,
  gameState.lastPlayedCombination]` as it is.
- **Depends on:** None

---

### [UX-06] "TROPPO BASSA" is shown for every rejection with a built combination, including ones that are not too low
- **Severity:** Medium
- **Confidence:** High (read the code)
- **Effort:** S
- **Location:** `components/gameTableModel.ts:173-184`, `components/GameTable.tsx:476-484`, `components/GameTable.tsx:851-856`, `components/GameTable.tsx:1114-1119`, `components/GameTable.tsx:1088-1094`, `locales/it.ts:244`, `locales/it.ts:246`
- **Problem:** `playButtonLabel` takes only `{ isMyTurn, isFinished, selectedCount, comboBuilt }`
  and collapses every "the selection is a real combination but still illegal" case to one
  label:
  ```ts
  if (!opts.comboBuilt) return "NON\nVALIDA";
  return "TROPPO\nBASSA";
  ```
  It is never told *why* `isValidPlay` (`GameTable.tsx:477-481`) came out false. Three
  distinct rejections land on the same words:
  1. genuinely lower than the pile — the label is correct;
  2. **wrong shape** — a pair against a single, a 5-card straight against a 6-card straight, a
     non-bomb against a bomb. `canPlay` refuses on type/length, not strength;
  3. **the opening play does not contain the 3♠** — `requiresStartCard` fails
     (`GameTable.tsx:476, 480-481`). On the very first turn of every hand, with an empty
     table, the player is told their card is *too low*.
  The screen-reader form is the same claim spoken: `"carta troppo bassa"` (`locales/it.ts:246`,
  used at `GameTable.tsx:1092`).
  `components/gameTableModel.ts:171` claims "both screens now explain themselves". They
  explain *that* it is refused; they misexplain *why* in two of three cases.
- **Impact:** For a player who does not know Murlan, this is the moment the game is supposed
  to teach a rule, and it teaches the wrong one — a beginner who tries a pair against a single
  learns "my pair is too weak" and goes hunting for a higher pair, which will also be refused.
  On the opening turn it is flatly contradicted by the banner sitting in the middle of the
  same screen ("Inizi tu! Hai il 3♠", `GameTable.tsx:975-980`).
  The project already has the right vocabulary: `app/tutorial.tsx:339-353` distinguishes
  `errRoyalBeatsAll`, `errOnlyHigherBomb`, `errSameType`, `errSameLength` and `errTooWeak`
  from exactly the same `canPlay` call.
- **Repro / proof:** Offline, your opening turn holding 3♠ plus a pair of 8s. Select the two
  8s. `buildCombination` returns a pair, `canPlay(pair, null)` is true (new round),
  `requiresStartCard` is true and the pair does not contain `3_spades`, so `isValidPlay` is
  false and `playBtnValid` is false. `playButtonLabel` sees `comboBuilt: true` and returns
  `"TROPPO\nBASSA"`, rendered at `GameTable.tsx:1116-1118`.
- **Proposed fix:** Widen `PlayButtonLabel` in `components/gameTableModel.ts` to the reason
  set the tutorial already uses, and give `playButtonLabel` the facts it needs
  (`requiresStartCard`, and the pile's `type`/`cards.length` versus the selection's). Add
  translation keys mirroring `tutorial.errSameType` / `tutorial.errSameLength` /
  `tutorial.errOnlyHigherBomb` / `tutorial.errRoyalBeatsAll` under `gameTable.*` in all three
  locales, keep `TROPPO BASSA` for the genuine case, and add a start-card case whose copy
  names the required card (the rank is already in `gameState.startCard`). Map them in
  `PLAY_LABEL_KEYS` / `PLAY_A11Y_SPOKEN_KEYS` (`GameTable.tsx:140-148`). The button is two
  short lines wide — keep each label to two words, and hang the longer explanation off the
  accessibility label only if it does not fit.
- **Acceptance criteria:**
  - `tests/gameTableModel.test.ts` covers each reason: no selection; unrecognised selection;
    right type but lower; wrong type; right type wrong length; opening play without the start
    card. One case per label, all pinned.
  - `tests/i18n.test.ts` still passes (all new keys present in it/en/sq).
  - Selecting a pair against a single no longer says "too low".
- **Fix risk:** `playButtonLabel`'s current three return values are pinned by
  `tests/gameTableModel.test.ts` as state identifiers; those cases have to be rewritten, not
  deleted. The label strings must stay short — `numberOfLines={2}` at
  `components/GameTable.tsx:1116` will silently truncate anything longer.
- **Depends on:** None

---

### [UX-07] The offline 20-second auto-pass fires with no sound, no haptic and no explanation
- **Severity:** Medium
- **Confidence:** High (read the code)
- **Effort:** S
- **Location:** `app/game.tsx:27`, `app/game.tsx:136-141`, `components/GameTable.tsx:283-311`, `context/GameContext.tsx:360-368`, `server/socket.ts:617-631`, `context/OnlineGameContext.tsx:291-301`
- **Problem:** Offline, the countdown expiring calls the context action directly:
  `onExpire: () => passTurnRef.current()` (`app/game.tsx:140`). That bypasses
  `GameTable.handlePass` (`:822-827`), which is where `hapticLight()` and `playCardPass()`
  live, and there is no notification path offline at all. The turn simply ends.
  The countdown itself is a bare number in the top bar (`GameTable.tsx:303-310`,
  `styles.timerNum` at `:1234-1237`) — no unit, no label, no ring, no icon — that appears
  only during the viewer's own turn (`turnTimerActive`, `gameTableModel.ts:191-203`) and only
  once a combination is on the table (`includeNewRound: false`, `app/game.tsx:139`). A player
  is never told a deadline exists before it takes their turn.
  Online is handled properly by contrast: the server announces the auto-pass
  (`server/socket.ts:622-629`, code `PLAYER_AFK_AUTO_PASS`) and the client raises a banner
  with a dedicated title (`context/OnlineGameContext.tsx:296-301`,
  `locales/it.ts:27` "Passaggio automatico").
- **Impact:** Offline is where a first-timer starts — `app/tutorial.tsx:444` sends them
  straight there. They look away for twenty seconds, look back, and their turn is gone with
  no trace of why. The offline window is also 10 s shorter than the online one
  (`HUMAN_TURN_SECONDS = 20` vs `SERVER_TURN_SECONDS = 30`,
  `app/(online)/game.tsx:35`), so it bites sooner in exactly the mode where the player is
  least practised.
- **Repro / proof:** Offline game, respond to an AI's lead, do nothing. `TurnTimer`'s interval
  (`GameTable.tsx:290-298`) ticks to 0, calls `onExpireRef.current()` → `app/game.tsx:140` →
  `context/GameContext.tsx:360-368` `passTurn`, which mutates state and clears the selection.
  No sound, no haptic, no message.
- **Proposed fix:** Route the offline expiry through the same feedback as a manual pass — in
  `app/game.tsx:140`, call a handler that fires `hapticWarn()` (`lib/haptics.ts:46`, currently
  unused) and `playCardPass()` before `passTurn()`, and raise a notification via
  `useNotification().showNotification` with the existing `afk` type and
  `t("online.autoPassTitle")` (rename the key to a mode-neutral `game.autoPassTitle` in all
  three locales). Give the countdown an affordance before it fires: add a unit or a small
  timer icon next to `styles.timerNum`, and start the urgent-red state earlier than 5 s
  (`URGENT_SECONDS`, `components/GameTable.tsx:120`) on the shorter offline clock.
- **Acceptance criteria:**
  - Letting the offline clock expire produces a visible message naming the auto-pass, plus the
    pass sound and a haptic.
  - The countdown is legible as a countdown before it has ever expired (it carries a unit or
    an icon).
- **Fix risk:** The notification banner covers the top bar (see UX-09), so raising a banner
  here without fixing UX-09 hides the very countdown it is explaining. Sequence the two.
- **Depends on:** UX-09

---

### [UX-08] Backing out of the first-run tutorial re-opens it on every return to the title screen, forever
- **Severity:** Medium
- **Confidence:** High (read the code)
- **Effort:** S
- **Location:** `app/index.tsx:302-309`, `app/tutorial.tsx:420-423`, `app/tutorial.tsx:425-429`, `app/tutorial.tsx:431-438`, `app/tutorial.tsx:440-449`, `app/tutorial.tsx:686-689`
- **Problem:** The home screen pushes the tutorial whenever the flag is unset:
  ```ts
  AsyncStorage.getItem("@murlan_tutorial_seen").then((seen) => { if (!seen) router.push("/tutorial"); });
  ```
  The comment above it (`app/index.tsx:302-304`) claims "the flag is set the moment they
  [skip or navigate away] (see app/tutorial.tsx)". It is not. `finish()`
  (`app/tutorial.tsx:420-423`) writes `SEEN_KEY`, and it has exactly two callers:
  `handleSkip` (`:427`) and `goNext` when `isLast` (`:443`). Every other exit leaves the flag
  unset — the header chevron at step 0 (`goBack` → `router.back()`, `:437`), the platform
  back gesture / Android hardware back, and the two rows on the final beat
  ("Rileggi le regole" → `router.push("/rules")` and "Torna alla home" →
  `router.replace("/")`, `:687-688`).
  The effect has an empty dependency array but runs on every *mount* of `HomeScreen`, and
  every `router.replace("/")` in the app remounts it (`app/game.tsx:131`,
  `app/result.tsx:288`, `app/tutorial.tsx:688`).
- **Impact:** A player who dismisses the tutorial with the back gesture gets it pushed on top
  of the title screen again on the next launch — and again every time they quit a game back
  to the title, mid-session. The one screen that is supposed to be welcoming becomes the one
  that will not go away. It is also a repo-wide instance of the pattern CLAUDE.md warns about:
  a comment that asserts the guard works, next to a guard that does not.
- **Repro / proof:** Fresh install → title screen → tutorial is pushed → press the back
  gesture → title screen. `SEEN_KEY` was never written. Tap "Gioca offline", play, quit
  (`app/game.tsx:131` `router.replace("/")`) → `HomeScreen` remounts → the effect at
  `app/index.tsx:305-309` runs again → the tutorial is pushed over the title screen.
- **Proposed fix:** Write the flag when the tutorial is *opened*, not when it is completed —
  move the `AsyncStorage.setItem(SEEN_KEY, "1")` into the mount effect at
  `app/tutorial.tsx:394-402`, and keep `PROGRESS_KEY` as the resume marker it already is
  (`:404-407`), so a player who backs out mid-way still resumes where they left off when they
  choose the tutorial from the menu. Delete the now-redundant `finish()` calls or reduce
  `finish()` to `removeItem(PROGRESS_KEY)`. Correct the comment at `app/index.tsx:302-304` to
  describe what the code does.
- **Acceptance criteria:**
  - Opening the tutorial once and leaving by any route (skip, back gesture, back chevron,
    "Torna alla home", completing it) means the title screen never auto-pushes it again.
  - Re-entering the tutorial from the menu resumes at the beat the player left.
  - A test asserts `@murlan_tutorial_seen` is set after `TutorialScreen` mounts.
- **Fix risk:** Setting the flag on open means a player whose app crashes on the very first
  frame of the tutorial never sees the auto-offer again; the menu entry
  (`app/index.tsx:338`) is the mitigation and already exists.
- **Depends on:** None

---

### [UX-09] The notification banner covers the game table's turn indicator and countdown
- **Severity:** Medium
- **Confidence:** High (read the code)
- **Effort:** M
- **Location:** `app/_layout.tsx:37-51`, `components/NotificationBanner.tsx:60`, `components/NotificationBanner.tsx:112-115`, `components/NotificationBanner.tsx:149-168`, `components/GameTable.tsx:865-901`, `components/gameTableModel.ts:24`
- **Problem:** `NotificationBanner` is a sibling of the whole navigator
  (`app/_layout.tsx:48`), absolutely positioned at `top: topOffset + 8` with
  `zIndex: 9999` and edge-to-edge width (`NotificationBanner.tsx:114`, `:150-155`). Its
  content is a 38 px icon circle plus `Spacing.sm + 4` padding top and bottom, so the opaque
  `Colors.bgSurface` card is roughly 60–65 px tall starting 8 px below the safe-area top.
  The game table's top bar is `TOP_BAR_H = 40` (`components/gameTableModel.ts:24`) positioned
  at exactly `frame.topPad` (`GameTable.tsx:865-869`) with `zIndex: 10`. The banner therefore
  covers all but the top 8 px of it — and that bar holds the `GameBillboard` (whose turn it
  is, what is on the table, `:881-886`), the `TurnTimer` countdown (`:888-893`), the hand
  count badge (`:895-898`), the quit button and the online reaction trigger. The online
  screen's own reconnect strip at `top: 2` (`app/(online)/game.tsx:346-347`) is covered too.
  Default visible duration is 4500 ms (`NotificationBanner.tsx:51`), plus two 320 ms slides.
- **Impact:** The banner fires at precisely the moments the HUD matters most: an AFK auto-pass
  (`server/socket.ts:622-629`), a seat handed to a bot mid-game
  (`context/OnlineGameContext.tsx:374-380`), a friend request or a game invite arriving during
  a hand (`context/SocketContext.tsx:162-200`). For ~5 s the player cannot see whose turn it
  is or how long they have left — and if it was *their* turn that was auto-passed, the message
  explaining it is the thing hiding the clock.
- **Repro / proof:** Read the two absolute positions against each other:
  `NotificationBanner.tsx:114` (`top: topOffset + 8`, `topOffset = insets.top` or 67 on web,
  `:60`) versus `GameTable.tsx:868` (`top: frame.topPad`, which is the same `insets.top` /
  67 via `computeScreenPads`, `gameTableModel.ts:244-251`). Same origin, banner offset 8 px
  down, banner taller than the 40 px bar, opaque, zIndex 9999 vs 10.
- **Proposed fix:** Give the banner a landscape/in-game placement. Simplest correct version:
  have `NotificationBanner` accept an offset (or read the same `computeScreenPads` +
  `TOP_BAR_H` the table uses) and, when the viewport is landscape, render below
  `topPad + TOP_BAR_H + TABLE_M` rather than over it — the table already reserves that band
  for `StartReasonBanner` (`components/GameTable.tsx:1150`) for exactly this reason. Cap the
  banner height in that mode and keep `numberOfLines={2}` (`NotificationBanner.tsx:133`).
- **Acceptance criteria:**
  - With a notification visible on the landscape game table, the turn billboard, the countdown
    and the hand-count badge are all still readable.
  - The portrait/menu placement is unchanged.
  - A Playwright case in `tests/e2e/tableFit.spec.ts` (which already parameterises viewport ×
    player count) asserts the two elements do not overlap.
- **Fix risk:** `tests/native/render.test.tsx` asserts `NotificationBanner` never unmounts —
  the fix must move it, not conditionally render it. The banner is also used on menu screens
  where the current placement is right, so the change must be conditional on orientation or
  on an explicit prop, not global.
- **Depends on:** None

---

### [UX-10] Cards cannot be touched outside your own turn, so every clock starts from a blank selection
- **Severity:** Medium
- **Confidence:** High (read the code)
- **Effort:** M
- **Location:** `components/GameTable.tsx:809-814`, `components/GameTable.tsx:1059-1067`, `context/GameContext.tsx:411`, `app/game.tsx:23`, `server/socket.ts:158`
- **Problem:** Selection is hard-gated on the turn in two places: `handleCardPress` returns
  immediately when `!isMyTurn || isFinished` (`GameTable.tsx:810`), and `StraightHand` is
  handed `disabled={!isMyTurn}` (`:1064`), which propagates to every `CardView`. Offline the
  selection is additionally wiped on every AI turn (`context/GameContext.tsx:411`,
  `setSelectedCards([])` at the end of `runAITurn`).
- **Impact:** With three opponents, the player spends 3.3 s per round offline
  (`AI_DELAY = 1100`, `app/game.tsx:23`) or 3.6 s online with bots
  (`BOT_MOVE_DELAY_MS = 1.2 s`, `server/socket.ts:158`) holding a hand they are not allowed to
  touch — then the turn arrives, a 20 s (offline) or 30 s (online) clock starts, and they
  begin choosing from zero. In a family where every comparable game (Big Two, Tien Len,
  Pusoy) lets you stage a play while waiting, this reads as unresponsiveness rather than as a
  rule. It is also the direct cause of the timer pressure UX-07 describes.
- **Repro / proof:** `components/GameTable.tsx:810` is an unconditional early return before
  `hapticSelection()`/`playCardSelect()`/`onSelectCard`. Tapping a card while an opponent is
  thinking produces no haptic, no sound and no state change.
- **Proposed fix:** Allow selection at any time and gate only the *submission*. Remove the
  `!isMyTurn` half of the guard at `GameTable.tsx:810` and pass `disabled={isFinished ||
  spectating}` at `:1064`; `playBtnValid` (`:484`) already requires `isMyTurn`, so GIOCA stays
  inert until the turn arrives — it should then light up on its own, which is a better turn
  signal than any of the current ones. Delete `setSelectedCards([])` from `runAITurn`
  (`context/GameContext.tsx:411`); it is not needed for correctness there
  (`playSelected` filters against the hand at `:337`) and it is what makes a staged selection
  impossible offline. This must land together with UX-01's "prune ids no longer in the hand",
  because a selection that survives an opponent's turn survives more state changes.
- **Acceptance criteria:**
  - Cards can be selected and deselected while an opponent is acting, with the usual haptic
    and select sound.
  - GIOCA stays dim until the turn arrives, then lights without the player re-tapping.
  - A staged selection is still valid when the turn arrives, and is dropped if any staged card
    left the hand.
- **Fix risk:** This widens the window in which `selectedIds` can go stale, which is the exact
  mechanism behind UX-01 — do not ship it before UX-01. It also changes what `spectating`
  means for the hand row; keep spectators disabled.
- **Depends on:** UX-01

---

### [UX-11] Nothing in the game gives failure feedback — the two failure haptics exist and are used only by the tutorial
- **Severity:** Low
- **Confidence:** High (read the code)
- **Effort:** S
- **Location:** `lib/haptics.ts:44-47`, `app/tutorial.tsx:471`, `app/tutorial.tsx:488`, `components/GameTable.tsx:1080-1085`, `app/(online)/game.tsx:308-313`, `context/OnlineGameContext.tsx` (`game:error` handling)
- **Problem:** `hapticError` and `hapticWarn` (`lib/haptics.ts:44-47`) are called from exactly
  two places in the entire app, both inside `app/tutorial.tsx` (`:471`, `:488`). Grep across
  `app/ components/ context/ lib/` confirms no other caller. On the live table:
  - Tapping a dim GIOCA does nothing at all — `onPress` is `undefined` and the Pressable is
    `disabled` (`components/GameTable.tsx:1082, 1085`), so there is no press travel, no
    haptic, no sound. The tap is indistinguishable from a missed tap.
  - A server rejection online renders a text toast (`app/(online)/game.tsx:308-313`) with no
    haptic and no sound, at `bottom: 100` — the opposite end of the screen from the button
    that was just pressed.
- **Impact:** Failure is the one interaction with no channel at all, in a game whose failures
  are the teaching moments. A player who taps a dim GIOCA cannot tell whether the app is busy,
  the tap missed, or the move is illegal.
- **Repro / proof:** `components/GameTable.tsx:1082` `onPress={playBtnValid ? handlePlay :
  undefined}` combined with `:1085` `disabled={!playBtnValid}` — React Native does not invoke
  `onPressIn`/`onPressOut` on a disabled Pressable, and `setGiocaPress` returns early anyway
  (`:761`). Nothing runs.
- **Proposed fix:** Keep the button enabled and reject inside `handlePlay` instead of gating
  the handler: when `!playBtnValid`, fire `hapticError()` and a short shake on the button
  (the file already has a `withSequence` shake at `:626-634` it can reuse at lower amplitude),
  and surface the reason from UX-06 as a brief toast. Keep `accessibilityState.disabled` true
  so assistive tech still reports it as unavailable. Add `hapticError()` to the online
  `game:error` path in `context/OnlineGameContext.tsx` alongside `setError`.
- **Acceptance criteria:** Tapping an unavailable GIOCA produces a distinct error haptic and a
  visible reaction on the button; a `game:error` from the server produces a haptic as well as
  the toast. `tests/native/haptics.test.tsx` gains a case for the new caller.
- **Fix risk:** `tests/native/a11yCollapse.test.tsx` pins one accessible node per labelled
  control — keeping the Pressable enabled while reporting `disabled` must not add a node.
  Do not remove `accessibilityState={{ disabled: !playBtnValid }}` (`:1095`).
- **Depends on:** UX-06

---

### [UX-12] Blocking, user-facing strings that never go through `t()`
- **Severity:** Low
- **Confidence:** High (read the code)
- **Effort:** S
- **Location:** `components/GameTable.tsx:1189-1199`, `context/SocketContext.tsx:164-165`, `context/SocketContext.tsx:177-178`, `context/SocketContext.tsx:191-192`, `context/OnlineGameContext.tsx:377-378`
- **Problem:** CLAUDE.md's invariant is that every user-facing string goes through `t()` with
  keys in all three locales, and `tests/i18n.test.ts` enforces key *parity* — it cannot see a
  bare literal in JSX. Five sites bypass it. The worst is the portrait-rotation overlay, which
  is a **full-screen blocking layer**:
  ```tsx
  <Text style={portraitOverlayStyles.title}>Ruota il dispositivo</Text>
  <Text style={portraitOverlayStyles.sub}>Il gioco richiede la modalità orizzontale</Text>
  ```
  (`components/GameTable.tsx:1193-1196`). The others are notification titles and fallback
  bodies: `"Richiesta di amicizia"`, `"Amicizia accettata!"`, `` `${from} ti invita a
  giocare!` ``, `` `Stanza: ${roomCode} — Tocca per unirti` `` (`context/SocketContext.tsx:164,
  165, 177, 178, 191, 192`) and `title: "Avviso"` plus its Italian message fallback
  (`context/OnlineGameContext.tsx:377-378`).
- **Impact:** An English- or Albanian-speaking player who picks up the phone in portrait gets
  an untranslated Italian instruction on a screen that blocks the game entirely, with no other
  affordance on it. The notification titles are less severe but appear on the app's most
  social moments (invites and friend requests). Note the neighbouring code is already correct —
  `onFriendError` and `onSocketError` (`context/SocketContext.tsx:207-222`) use `t()` and
  `translateServerPayload` — so this is drift, not a decision.
- **Repro / proof:** The literals are on the cited lines; neither
  `"Ruota il dispositivo"` nor `"Richiesta di amicizia"` appears as a value in
  `locales/en.ts` or `locales/sq.ts`.
- **Proposed fix:** Add keys (`gameTable.rotateTitle`, `gameTable.rotateBody`,
  `notifications.friendRequestTitle`, `notifications.friendAcceptedTitle`,
  `notifications.gameInviteTitle`, `notifications.gameInviteBody`, `common.notice`) to all
  three locales and route the five sites through `t()`. `context/OnlineGameContext.tsx:377`
  can reuse `t("common.notice")`, which already exists and is used at `:305`.
- **Acceptance criteria:** No bare Italian string literal remains in a `<Text>` or in a
  `showNotification` title/message across `components/GameTable.tsx`,
  `context/SocketContext.tsx` and `context/OnlineGameContext.tsx`; the rotate overlay renders
  in English under an `en` locale.
- **Fix risk:** None. Consider extending the source-scanning test pattern already used by
  `tests/tokenRoles.test.ts` to catch bare literals in `<Text>` children, so this cannot
  regress — but that is a larger job and belongs with the i18n owner.
- **Depends on:** None

---

## Coverage gaps

1. **Nothing was run.** The read-only rule forbids building the web bundle or running
   Playwright, so every timing, layering and animation claim here is derived from source.
   In particular UX-09's overlap is computed from the two absolute positions and the banner's
   padding/icon sizes, not observed on screen; the conclusion is robust to the exact height
   (the banner starts 8 px into a 40 px bar and is opaque), but the precise pixel figure is
   not measured.
2. **Sound *content* was not assessed.** `tests/soundAssets.test.ts` proves the 12 WAVs exist
   and have the expected shape. Whether they are distinguishable from each other, correctly
   levelled, or pleasant needs listening, which I could not do. Every sound in `ASSETS`
   (`lib/sounds.ts:99-112`) does have at least one caller, and the mute path
   (`lib/sounds.ts:132-134`) genuinely gates every call — but see UX-03 for two callers that
   are unreachable.
3. **Files I did not read, so questions about them are unanswered:**
   `components/ExchangeModal.tsx`, `components/ResultExchangeOverlay.tsx`,
   `components/ReactionLayer.tsx`, `components/CardView.tsx`, `app/rules.tsx`,
   `app/(online)/index.tsx`, `app/(online)/room.tsx`, and the second half of
   `app/result.tsx`. Consequently the brief's **tap-count question is only half answered**:
   offline is 2 taps (home → "Gioca offline" → "Inizia", `app/index.tsx:334` →
   `app/lobby.tsx:203-207`) and the online rematch is 1 tap
   (`components/GameOverOverlay.tsx:283-321`), but I did not count the online
   create-room-and-invite flow or the change-a-setting-mid-game flow, and I am not guessing.
4. **The exchange phase is only partly covered.** I traced its announcement
   (`components/ExchangeAnnouncement.tsx`) and the online waiting overlay
   (`app/(online)/game.tsx:291-306`), but not the modal a winner actually picks in, so
   "is the hand → exchange → next hand transition legible" is answered for the announcement
   and the wait, not for the choice itself.
5. **Bot-vs-human animation parity was traced through code, not observed.** All five play
   paths (human tap, `runBotTurn`, `handleAutoPass`, rejoin, offline `runAITurn`) converge on
   the same `gameState.lastPlayedCombination` identity change, which is the sole trigger for
   the flight and impact effect (`components/GameTable.tsx:602-647`) — so plays *do* animate
   identically across all five. Passes converge the same way and animate on none of them,
   which is UX-02. A rejoin that lands mid-combination will replay the flight for the last
   play in the state it receives; I could not confirm whether that reads as a stale
   re-animation without running it.

## Opinions (non-findings)

- **`app/tutorial.tsx` is the best-designed surface in the repo for a first-time player** —
  engine-backed validation, ten beats, resumable, skippable, and error copy that names the
  actual rule. The live table shares none of that vocabulary, which is why UX-06 exists. If
  one thing gets reused, it should be `evaluatePlay`'s reason ladder (`:339-353`).
- **The rematch question as a side panel rather than a modal** (`components/GameTable.tsx:313-379`)
  is a genuinely good call and the comment explaining it is accurate. Leave it alone.
- **`ExchangeAnnouncement`'s 5500 ms** (`components/ExchangeAnnouncement.tsx:34`) is a long
  full-screen block after every hand. It is dismissible by tapping anywhere, so it is not a
  finding, but it is the longest uninterruptible-by-default beat in the game and would be my
  first candidate if the between-hands rhythm ever feels slow.
- **The flight/impact split is right and worth defending.** `impactDelayMs`
  (`components/gameTableModel.ts:134-138`) reading the same `FLIGHT_MS`/`LANDING_FRACTION` the
  animation uses is exactly how this should be structured, and the reduced-motion collapse to
  0 is correct.
- **The offline 20 s / online 30 s clock asymmetry** (`app/game.tsx:27` vs
  `app/(online)/game.tsx:35`) reads as accidental rather than designed, but I have no evidence
  either way, so it is an open question below rather than a finding.

## Open questions for the human

1. Is the 20 s offline / 30 s online turn clock a deliberate difference? If not, the offline
   one should match, since offline is where beginners play.
2. Should the countdown be visible for *other* seats' turns, not just your own? Right now
   `turnTimerActive` (`components/gameTableModel.ts:199`) hides it entirely unless it is your
   turn, so you cannot tell whether a slow opponent is about to be auto-passed.
3. UX-10 changes a rule of interaction (pre-selecting out of turn). It is standard in the
   genre and I believe it is right, but it is a feel decision, not a defect — confirm before
   it is implemented.
4. UX-02's pass marker needs copy. Is "PASSA" the right word on an opponent's slot, or should
   it be a passive form? Italian source of truth needed before the keys are added to
   `locales/it.ts`.
