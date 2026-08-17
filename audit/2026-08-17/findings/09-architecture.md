# C1 — Architecture & maintainability

Repo: `C:\Users\roton\murlan` @ `b894af4`, branch `main`. Read-only pass.
Prefix: `ARCH`. 16 findings: Critical 0 / High 0 / Medium 6 / Low 10.

Everything below was read in source. Where a claim came from a document I checked it
against the code; where it came from another specialist's report I say so and only add
what they did not have.

---

### [ARCH-01] Send one payload shape for `game:player_reconnected` — the second one renders as "an unexpected error occurred"

- **Severity:** Medium
- **Confidence:** High (read the code end to end)
- **Effort:** S (<1h)
- **Location:** `server/socket.ts:1868` (malformed emit), `server/socket.ts:1642-1648` (the well-formed one), `context/OnlineGameContext.tsx:400-412` (`onPlayerReconnected`), `lib/i18n.ts:166-174` (`translateServerPayload`), `app/(online)/game.tsx:266-272` (the banner), `locales/it.ts:28`
- **Problem:** The server puts a reconnecting player back at their table in **two** places, and the two emit different payloads for the same event.
  - `game:rejoin` (`:1642-1648`) emits `{ userId, username, code: "PLAYER_RECONNECTED", message, params }`.
  - The connection handler's grace-timer block (`:1868`) emits `{ userId, username }` — no `code`, no `message`.

  The client runs every `game:player_reconnected` through `translateServerPayload` (`context/OnlineGameContext.tsx:406`). With no `code` and no `message` that function falls through to `payload.message ?? payload.error ?? t("common.unknownError")` (`lib/i18n.ts:173`) and returns `"Si è verificato un errore imprevisto."` (`locales/it.ts:28`). That string is then set as `reconnectNotice` and rendered in the wifi banner at `app/(online)/game.tsx:266-272` for 3.5 s.
- **Impact:** On the most common reconnect path — a player drops and returns inside the 60 s grace window — every seated player at the table is shown an *error* banner saying an unexpected error occurred, at the exact moment the correct message ("X è rientrato.") exists and is already translated in all three locales (`server.PLAYER_RECONNECTED`, `locales/it.ts:75`). Both emits fire (the client emits `game:rejoin` from its own `connect` handler at `context/OnlineGameContext.tsx:210-213`, and the server's `:1854` block runs whenever a disconnect timer was pending), so whichever lands last owns the 3.5 s notice.
- **Repro / proof:** Two clients in a live game. Kill client A's network for 5 s and restore it. Server: `disconnectTimers` holds A's timer → the connection handler enters `:1855` → `:1868` emits `{userId, username}` to the room. Client B: `onPlayerReconnected` → `translateServerPayload({userId, username})` → no `code` branch, no `message`, no `error` → `t("common.unknownError")` → banner. A3 observed the double emit (`03-netcode.md:210`) and called it cosmetic; it is not — the second payload is not renderable.
- **Proposed fix:** In `server/socket.ts:1868`, emit the same shape as `:1642-1648`:
  ```ts
  io.to(roomId).emit("game:player_reconnected", {
    userId, username, code: "PLAYER_RECONNECTED",
    message: `${username} è rientrato.`, params: { username },
  });
  ```
  Better, and the fix that stops it recurring: extract the six lines both paths share (`socket.join`, `socketRoomMap.set`, `emitRoomStateTo`, `game:state`, `game:player_reconnected`, `armTurn`) into one `rejoinSocketToTable(io, socket, userId, username, roomId, game)` helper and call it from both `:1611-1651` and `:1859-1875`.
- **Acceptance criteria:** A test (integration, `tests/integration/gameplay.test.ts` style) that drops a socket, reconnects inside the grace window, and asserts every `game:player_reconnected` payload received by the other seat has `code === "PLAYER_RECONNECTED"`. `grep -c 'emit("game:player_reconnected"' server/socket.ts` returns 1.
- **Fix risk:** `:1868` currently fires inside the connection handler after an `await`; folding it into a shared helper must not move any listener registration after an `await` (CLAUDE.md invariant, `server/socket.ts:1057-1066`). The helper is called from inside handlers, not at registration time, so this is safe — but verify `tests/socketEvents.test.ts` still passes.
- **Depends on:** None

---

### [ARCH-02] Card dimensions exist in four places, not one — the CLAUDE.md invariant that says otherwise is false

- **Severity:** Medium
- **Confidence:** High (read every definition and the pinning test)
- **Effort:** M (a few hours)
- **Location:** `components/handLayout.ts:10` (`CARD_W = 58`), `components/gameTableModel.ts:20` (`CARD_H = 84`), `components/cardFaceModel.ts:11-12` (`CARD_W = 58`, `CARD_H = 84`), `components/ExchangeAnnouncement.tsx:24-29` (private `CARD_W = 58`, `CARD_H = 84`), `tests/gameTableModel.test.ts:6-7,43-56`, `CLAUDE.md` §Invariants
- **Problem:** CLAUDE.md states: *"Layout constants (`CARD_W`, `CARD_H`, `SIDE_BTN_W`, `TABLE_M`, `HAND_SECTION_H`) live once in `components/gameTableModel.ts` and are pinned by a test. **There is no second copy.**"* Every clause of that is wrong for the two constants that matter most:
  1. `CARD_W` is **not defined in `gameTableModel.ts` at all**. It lives in `components/handLayout.ts:10` and is re-exported through `components/GameShared.tsx:40`.
  2. `components/cardFaceModel.ts:11-12` declares its own independent `CARD_W = 58` / `CARD_H = 84` literals. `components/CardView.tsx:27-30,630-635` imports **those** and uses them for the card's actual rendered `width`/`height`. So the card's own geometry and the table's layout maths read two different constants that merely happen to be equal.
  3. `components/ExchangeAnnouncement.tsx:28-29` declares a third private pair. Its comment claims it *"Mirrors the private CARD_W/CARD_H in components/CardView.tsx (not exported, and that file is owned elsewhere)"* — that comment is also false: `CardView.tsx` does not define them, it imports them from `cardFaceModel.ts`, where they **are** exported.
  4. The pinning test (`tests/gameTableModel.test.ts:47-48`) imports `CARD_W` from `handLayout.ts` and `CARD_H` from `gameTableModel.ts`. It never touches `cardFaceModel.ts` or `ExchangeAnnouncement.tsx`.
- **Impact:** Changing the card width — the thing the invariant exists to make safe — requires four edits. The pinning test catches exactly one of them, and then only by failing on the *pinned* value, which tells the implementer to update the assertion, not to hunt for the other three. Miss `cardFaceModel.ts` and the pip grid, corner index column and court-art box (`components/cardFaceModel.ts:81-91,171`) are computed against the old width while the card renders at the new one — misaligned pips and a clipped rank glyph, exactly the two defects BACKLOG Q12b records as having already shipped in `CardView.tsx`. Miss `ExchangeAnnouncement.tsx` and the exchange preview card is the wrong size. The invariant is worse than absent: it tells a future implementer to stop looking after one file.
- **Repro / proof:** `grep -rn "CARD_W\s*=\|CARD_H\s*=" components/` returns four independent literal definitions across `handLayout.ts`, `cardFaceModel.ts`, `gameTableModel.ts` and `ExchangeAnnouncement.tsx`. `tests/gameTableModel.test.ts:6-7` shows the test reaches only the first two.
- **Proposed fix:** Make `components/cardFaceModel.ts` the single owner of `CARD_W`/`CARD_H` (it already owns `CARD_W_SMALL`/`CARD_H_SMALL` and the fractional geometry that depends on them, so it is the natural home). Then:
  - `components/handLayout.ts:10` → `export { CARD_W } from "./cardFaceModel.ts";`
  - `components/gameTableModel.ts:20` → import `CARD_H` from `cardFaceModel.ts` rather than redeclaring it (it is a type-only-import file today; `cardFaceModel.ts` has only a type-only import itself, so this keeps it `node --test`-loadable).
  - `components/ExchangeAnnouncement.tsx:24-29` → delete the private pair and import from `@/components/cardFaceModel`; delete the false comment.
  - Extend `tests/gameTableModel.test.ts:43-56` with a case that imports `CARD_W`/`CARD_H` from **every** module that exposes them and asserts they are identity-equal, so a future fork fails the test rather than the screen.
  - Correct the CLAUDE.md invariant to name the real owner.
- **Acceptance criteria:** `grep -rn "CARD_W = \|CARD_H = " components/` returns exactly one definition of each. The new test fails if any module re-declares them. `npm run test:native` and `npx jest` still pass (`tests/native/` renders `CardView`).
- **Fix risk:** `components/gameTableModel.ts:3-8` documents that it must stay free of *runtime* imports so Node's TS loader can strip it — `cardFaceModel.ts` satisfies that (its only import is `import type { Rank }`), but the change must be re-verified with `node --test "tests/gameTableModel.test.ts"`.
- **Depends on:** None

---

### [ARCH-03] Retire `docs/BRIEF.md` §2 and correct the four documents that describe code that no longer exists

- **Severity:** Medium
- **Confidence:** High (every claim checked against source)
- **Effort:** M (a few hours)
- **Location:** `docs/BRIEF.md:36-91` (§2), `docs/ARCHITECTURE.md:44-46,58,132,186-187`, `CLAUDE.md` §Invariants / §Architecture Rules / §Design System, `replit.md:49`
- **Problem:** Four documents that a future agent session is directed to read describe a codebase that no longer exists. These are not stale wording — they name identifiers and file:line locations that resolve to unrelated code today.

  **`docs/BRIEF.md` §2 is the worst.** It is headed *"Current state — verified assessment"* and subtitled *"Read directly from source, not inferred"*, present tense, with no historical framing. All 15 of its defect rows (B1–B6, C1–C9) are fixed, and their citations now point at unrelated lines:
  - B1 `server/socket.ts:225` — *"Socket auth falls back to `handshake.auth.userId`… Any client can connect as any user."* That branch is gone (`server/socket.ts:1030-1049` accepts only a session or a ticket); `:225` today is inside the `__testables` block. A session that reads §2 as current believes the app ships a live full-impersonation vector.
  - B4 `server/socket.ts:942-981`, B5 `:807`, C4 `:174`, C5 `:629`, C6 `:520,539`, C7 `:128`, C9 `:349` — all fixed; every one of those line numbers now lands on a comment or on unrelated code.
  - §2 "Structural debt" claims **"Zero tests"** (672 node tests + 230 jest tests exist), **"One live TypeScript error (`server/index.ts:47`)"** (the file is 44 lines; `npx tsc --noEmit` is clean), **"`constants/colors.ts` (legacy)"** (`constants/` does not exist), **"`expo-av` is deprecated… migration to `expo-audio` is pending"** (`expo-av` is not in `package.json`), and **"No `eas.json`"** (`eas.json` exists).
  - The same document's §8 *does* know how to mark a superseded section — its "Contradictions between documents" table carries an explicit *"**Resolved.** Kept as the record"* stamp (`docs/BRIEF.md:262-265`). §2 never got that treatment. And §8's "Standing rule" (`:281-284`) reads *"A change to behaviour is not complete until every document that describes that behaviour has been updated in the same change."* §2 is that rule's own largest violation.

  **`docs/ARCHITECTURE.md`** names three identifiers that do not exist and carries four stale sizes:
  - `:58` lists `game:play_result` as a socket event the client receives. `grep -rn "play_result"` over the whole tree: zero hits.
  - `:132` describes the AFK timer as re-armed *"through a single `advanceTurn` epilogue"*. There is no `advanceTurn`; the function is `armTurn` (`server/socket.ts:526`).
  - `:86` states rejected handshakes get `next(new Error('unauthorized'))`. The actual string is `"Not authenticated"` (`server/socket.ts:1037,1040,1047`).
  - `:44-46` and `:186-187`: `GameTable.tsx` "925 lines" (actual **1388**), `gameTableModel.ts` "305 lines" (actual **439**), `app/game.tsx` "131 lines" (actual **156**), `app/(online)/game.tsx` "361 lines" (actual **423**).
  - It never mentions `components/GameShared.tsx` (1329 lines — the other half of the table, see ARCH-09) or `server/testApp.ts` (the app factory, see ARCH-10).

  **`replit.md:49`** places `app.set("trust proxy", 1)` in `server/index.ts`. It is in `server/testApp.ts:186-188`.

  **`CLAUDE.md`.** I checked **36** discrete, source-checkable claims. **29 hold, 7 are false.** Four were already found by the recon (§14): the `graphify-out/wiki/` path, `shared/schema.ts` containing `Card`/`GameState`, and the two "self-defeating safeguard" examples given as live when both are fixed. Three are new:
  - *"Layout constants … live once … There is no second copy."* — false, four copies (ARCH-02).
  - *"**Friends FlatList:** Must have `extraData={onlineIds}`"* (§Architecture Rules) and *"the `FlatList` needs `extraData={onlineIds}`"* (§Invariants) — `app/(online)/friends.tsx` contains **no `FlatList` and no `extraData`**; it renders with `friends.map(...)` at `:290` inside a scroll view. `grep -rn extraData app/ components/` → zero hits. Two separate CLAUDE.md entries pin a prop on a component that no longer exists.
  - *"Two screens are exempt [from MenuLayout] and both are deliberate: the game tables, and `app/index.tsx`."* — `app/result.tsx` (692 lines) is a third non-exempt screen that does not use `MenuLayout`. Verified by checking every file in `app/` and `app/(online)/`.

  Verified-true and worth recording so they are not re-checked: ticket-only auth, listener-before-await, `schemaDdl` as sole table creator, `session` excluded from push, socket singleton map, AFK 30 s / grace 60 s, `active_games` written every move, replay write not awaited, `moveLog` memory-only, `REPLAY_RETENTION_DAYS` single home, `lib/cosmetics.ts` module store, React Compiler enabled (via `app.json:57-60` `experiments.reactCompiler`, not `babel.config.js`), `NotificationBanner` never returns null, `OfflineBanner`'s `=== false` check, `pendingInvite` set before the banner, full-deck deal, 2–4 players.
- **Impact:** `CLAUDE.md` is loaded into every future session's context and points at `docs/BRIEF.md` §3.1 as the authority for rule decisions, so §2 is read on the way past. An agent acting on §2 will "fix" a security hole that was closed six weeks ago, or will trust "Zero tests" and skip `npm test`. An agent acting on the FlatList invariant will look for a component that is not there. An agent acting on the layout-constant invariant will edit one of four files. The cost is not confusion — it is wasted work and, in the FlatList case, a real invariant silently unenforced.
- **Repro / proof:** `sed -n '36,91p' docs/BRIEF.md` against the current files; `grep -rn "play_result\|advanceTurn" .` (zero hits); `grep -rn "extraData" app components` (zero hits); `wc -l components/GameTable.tsx components/gameTableModel.ts app/game.tsx "app/(online)/game.tsx"`.
- **Proposed fix:**
  1. Delete `docs/BRIEF.md` §2 (`:36-91`) outright. It is a defect list where every defect is closed; git holds it. If a record is wanted, replace it with a two-line pointer to the commits that closed it, stamped like §8's "Resolved" block. Do **not** rewrite it as a fresh assessment — that is this audit's job and it lives here.
  2. `docs/ARCHITECTURE.md`: delete `game:play_result` from `:58`; rename `advanceTurn` → `armTurn` at `:132`; correct the error string at `:86`; delete all four parenthesised line counts rather than updating them (they will rot again — say "the one presentational table" without a number); add one row for `components/GameShared.tsx` and one for `server/testApp.ts` to §1.
  3. `replit.md:49`: change `server/index.ts` → `server/testApp.ts`.
  4. `CLAUDE.md`: correct the layout-constant invariant to name the real owner (after ARCH-02 lands); replace both FlatList entries with what the friends screen actually does, or delete them; add `app/result.tsx` to the MenuLayout exemption list or convert it; delete the two already-fixed self-defeating-safeguard examples and the `graphify-out/wiki/` line; correct the `shared/schema.ts` row.
- **Acceptance criteria:** `grep -rn "play_result\|advanceTurn\|constants/colors" docs/ *.md` returns nothing. No `docs/*.md` or `*.md` at root contains a line count for a source file. Every `file.ts:NNN` citation left in `docs/` and `CLAUDE.md` resolves to code that supports the sentence around it — check by opening each.
- **Fix risk:** None to running code. The risk is doing it by rewrite instead of deletion and re-introducing claims that will rot; prefer deleting a claim over updating it whenever the claim is a number.
- **Depends on:** ARCH-02 (for the corrected wording of the layout-constant invariant)

---

### [ARCH-04] Split `server/socket.ts` so `handleGameOver` can be unit-tested

- **Severity:** Medium
- **Confidence:** High
- **Effort:** L (a day+)
- **Location:** `server/socket.ts` (whole file, 2272 lines), esp. `:125-138` (module-global state), `:193` (`let _io`), `:732-945` (`handleGameOver`), `:212-238` (`__testables`), `tests/serverLoadable.test.ts`
- **Problem:** `server/socket.ts` is the largest file in the repo, the third-hottest by churn (23 changes in 8 weeks), and has **no unit test file**. The reason is structural, not neglect: the module holds all five in-memory state maps (`activeGames`, `socketRoomMap`, `spectatorRoomMap`, `userSocketMap`, `publicRoomIds` — `:125-132`), the three timer maps (`:136-138`) and the server handle (`let _io`, `:193`) as module globals, and every function reads them directly. Importing the module also drags `storage` → `db` → `pg` and `session`, which is why `tests/serverLoadable.test.ts` covers 11 server modules and pointedly excludes this one. The escape hatch is `__testables` (`:212-238`), which reaches five functions by casting three-field object literals to `OnlineGameState` (`:216`, `:227`).

  The concrete casualty is `handleGameOver` (`:732-945`, **213 lines**), which does six unrelated things in sequence: seat↔engine-id remapping, hand scoring, match resolution (single / teams / free-for-all, with target escalation), the `game:over` + `game:match_over` broadcast, room-status and persistence, and the stats / ratings / replay / achievement writes. None of it has a unit test; it is reached only through `tests/integration/stats.test.ts` and `tests/integration/ladderAndReplay.test.ts`, both of which need a live Postgres and both of which self-skip locally.
- **Impact:** The single function that decides who won a match, what the next target is, whether a draw escalates, and what gets written to five tables is exercised only on CI, only end-to-end, and only for the paths those two suites happen to walk. Every future change to match resolution is verified by running a whole game against a database. That is also why the two roster-construction paths (`:1320-1347` vs `:1554-1572`) drifted apart unnoticed — nothing can assert their outputs side by side.
- **Repro / proof:** `tests/serverLoadable.test.ts` lists 11 modules; `socket.ts` is absent. `grep -rln "server/socket" tests/*.test.ts` returns only `socketEvents.test.ts` and `socketHandFlags.test.ts`, both of which reach it via `__testables` or by reading the file as text. `handleGameOver` has zero direct callers in `tests/`.
- **Proposed fix:** Six modules, split at seams the file's own `─── section ───` banners already mark. Step 0, which everything else depends on: **stop reading `_io` and `activeGames` as module globals inside the functions being moved** — pass them in.
  1. `server/gameRoom.ts` — the `OnlineGameState` interface (`:76-123`) and the five in-memory maps (`:125-132`) with narrow accessors. Owning the maps here means a test can seed one.
  2. `server/gameTimers.ts` — `timeoutFromEnv` (`:146-151`), the four timing constants (`:153-159`), the three timer maps (`:136-138`) and the six clear helpers (`:272-324`). No DB, no socket — loadable by `node --test` today.
  3. `server/gameTurn.ts` — `actingSeat` (`:405`), `resolveStuckExchange` (`:425`), `recordPlayFlags` (`:441`), `autoMoveForSeat` (`:454-518`), `armTurn` / `runBotTurn` / `handleAutoPass` / `startAfkTimer` (`:526-632`), `vacateSeat` (`:643-709`), with `io` and the game passed as arguments.
  4. **`server/gameOver.ts`** — `teamKeyMap` (`:719`), `handleGameOver` (`:732-945`), `rollMatchForward` (`:947`), `countRematchAnswers` (`:961`), `scoresByName` (`:980`), `tableWantsRematch` (`:988`), `broadcastRematchIntents` (`:993`). ~240 lines. This is the extraction that pays: with `recordGameResult` / `saveReplay` / `recordRatedResult` injected rather than imported, `handleGameOver` becomes callable from `node --test` with a hand-built `OnlineGameState` and a stub `io`.
  5. `server/gamePersistence.ts` — `sanitizeStateForPlayer` (`:240-267`), `disposeGame` (`:327-340`), `persistGameState` (`:344-386`), `broadcastGameState` (`:388-400`), `pruneAbandonedGames` (`:2062`), `pruneStaleRooms` (`:2085`), `startSweeper` (`:2115`).
  6. `server/socket.ts` keeps `setupSocket`, the two `io.use` middlewares, the 18 `onEvent` registrations, the disconnect handler and the leave helpers — roughly 900 lines of wiring.

  Then add `gameTimers`, `gameOver` and `gamePersistence` to `tests/serverLoadable.test.ts`'s list, and write `tests/gameOver.test.ts` covering at minimum: a single-manche game names the manche winner as match winner; a free-for-all crossing 21 ends the match; a tie at the target escalates to 31; a teams game resolves on the summed pair total; a vacated (`bot:<seat>`) seat is excluded from `cumulativeScores` but present in the per-hand breakdown.
- **Acceptance criteria:** `tests/gameOver.test.ts` exists, runs under plain `node --test` with no `DATABASE_URL`, and covers the five cases above. `tests/serverLoadable.test.ts` lists the three new modules. `server/socket.ts` is under 1000 lines. `__testables` shrinks to only what genuinely has no other home.
- **Fix risk:** High-blast-radius refactor of the file the whole online mode runs through. Mitigations: the 11 integration suites all boot the real `createApp()`, so a green CI run after the split is meaningful coverage; `tests/socketEvents.test.ts` scans `server/socket.ts` **as text** for `socket.on(` / `onEvent(` registrations and will need its file list widened if any registration moves (none should — keep all 18 in `socket.ts`). Do the split in the order above, one module per commit, `npm run verify` between each.
- **Depends on:** None

---

### [ARCH-05] Make `game:rejoin_failed` follow the `{code, message, params}` error contract — four translated reasons are being thrown away

- **Severity:** Medium
- **Confidence:** High
- **Effort:** S (<1h)
- **Location:** `server/socket.ts:1615,1658,1672,1683,1744`, `context/OnlineGameContext.tsx:414-434`, `app/(online)/game.tsx:156-160`, `locales/it.ts:68-71` (and the `en`/`sq` equivalents)
- **Problem:** The codebase has one error contract on the wire: `{ code, message, params? }`, rendered by `translateServerPayload` (`lib/i18n.ts:166-174`), which looks up `server.<CODE>` in the active locale and falls back to the server's Italian text. `room:error`, `game:error`, `friend:error`, `socket:error` and `game:notification` all follow it. `game:rejoin_failed` does not: it ships `{ reason, code, roomCode }` — `reason`, not `message`. `translateServerPayload` reads `payload.message ?? payload.error`, so `reason` is invisible to it.

  Worse, the client never calls the translator at all. `onRejoinFailed` (`context/OnlineGameContext.tsx:414-434`) destructures `{ reason, roomCode }`, uses `roomCode` for the stale-reply guard, **discards `reason` and `code` entirely**, and sets a bare boolean `rejoinFailed`. `app/(online)/game.tsx:156-160` responds to that boolean by calling `leaveRoom()` with no message.

  The server distinguishes five failure reasons across four codes — `UNAUTHORIZED` (`:1615`, `:1683`), `GAME_NOT_FOUND` (`:1658`), `GAME_NO_LONGER_VALID` (`:1672`), `SERVER_ERROR` (`:1744`) — and all four have translations in **all three locales** (`locales/it.ts:68-71`).
- **Impact:** A player whose rejoin fails is silently teleported out of the game screen with no explanation, in every case. "The server restarted and your hand is gone", "you were never seated here" and "an internal error occurred" are indistinguishable to them. Four translation keys × three locales = twelve maintained strings that can never render. `tests/i18n.test.ts` will keep enforcing key parity on them forever.
- **Repro / proof:** Join a room, force the server to drop the `active_games` row (or restart it), reconnect. Server emits `{reason: "Game not found", code: "GAME_NOT_FOUND", roomCode}` (`:1658`). Client: `onRejoinFailed` sets `rejoinFailed = true` and nothing else; `app/(online)/game.tsx:157` calls `leaveRoom()`. No banner, no toast, no text. `grep -n "translateServerPayload" context/OnlineGameContext.tsx` — `onRejoinFailed` is the only server-payload handler in the file that does not call it.
- **Proposed fix:**
  1. `server/socket.ts`: rename the field `reason` → `message` at all five emit sites so the payload matches every other error event.
  2. `context/OnlineGameContext.tsx:414-434`: add `setError(translateServerPayload(data))` alongside `setRejoinFailed(true)` (the `error` state and `clearError` already exist and are already consumed as a toast — `app/(online)/game.tsx:57`).
  3. Optionally add a `ServerPayload` type annotation to `onRejoinFailed`'s parameter so the next drift is a type error.
- **Acceptance criteria:** Each of the four codes, when emitted, shows its own localised text to the player before they are returned to the lobby. `grep -n '"game:rejoin_failed"' server/socket.ts` shows five sites, all with `message:` and none with `reason:`. `tests/i18n.test.ts` still passes.
- **Fix risk:** The `roomCode` field must stay — `context/OnlineGameContext.tsx:419` uses it for the stale-reply guard, which exists to stop a late failure wiping a room the player has since joined. Do not fold it into `params`.
- **Depends on:** None

---

### [ARCH-06] Bring the whole `active_games` row under `GAME_SCHEMA_VERSION`, and drop the derivable `player_ids` column

- **Severity:** Medium
- **Confidence:** High
- **Effort:** M (a few hours)
- **Location:** `shared/schema.ts:71-88`, `server/socket.ts:344-386` (`persistGameState`), `server/socket.ts:1662-1713` (the rehydrate path), `server/onlineGameLogic.ts:16-37,156-197`
- **Problem:** `active_games` stores one game as four jsonb columns (`game_state`, `player_ids`, `player_map`, `scores`) plus five scalars (`is_public`, `max_players`, `game_mode`, `match_target`, `match_length`). Versioning covers **one** of the nine.

  `packPersistedState` (`server/onlineGameLogic.ts:178-183`) stamps `schemaVersion` into `game_state` only; `isStaleSchema` (`:159-163`) checks `game_state` only. On rehydrate (`server/socket.ts:1662-1713`) the other eight are read like this:
  - `row.playerMap` / `row.playerIds` → `readPersistedPlayerMap` (`:1681`) — the **only** field with real runtime validation.
  - `row.scores` → `(row.scores as Record<string, number>) ?? {}` (`:1690`), a bare cast, then fed straight into `resolveMatch(restoredScores, restoredTarget)` at `:1692` and into `game.cumulativeScores` at `:1699`.
  - `row.gameMode` / `row.matchLength` → narrowed by ternary (`:1700`, `:1703`), which turns any unexpected value into the default rather than rejecting the row.
  - `row.maxPlayers`, `row.matchTarget`, `row.isPublic` → used as-is.

  The write side is equally unchecked: `persistGameState` casts all four jsonb values with `as any` (`server/socket.ts:352-355`).

  Separately, `player_ids` is **derivable**: `persistGameState:345` computes it as `Object.values(game.playerMap)` and writes it beside `player_map`. Its one reader (`:1681`) uses it only as the legacy positional fallback inside `readPersistedPlayerMap` (`server/onlineGameLogic.ts:31-35`), and the schema comment at `shared/schema.ts:75-77` already says the fallback is the wrong answer ("player_ids loses the seat association … can hand a rejoining player someone else's hand"). Since the column is written from `player_map`, the fallback can never produce a map the primary path would not have produced. It is a legacy read path kept alive by a write that reconstructs its own input.
- **Impact:** CLAUDE.md states the design preference *"derive from existing rows → ride an existing jsonb column → a new table → a new column"*. The newest field, `handFlags`, obeys it (it rides `game_state`). The eight older fields predate it and defeat the mechanism the schema version exists to provide: a `GAME_SCHEMA_VERSION` bump rejects a stale `game_state` but happily rehydrates a stale `scores` or `player_map` alongside the fresh one it just refused. A malformed `scores` value — from an older build, or from the unchecked `as any` write — reaches `resolveMatch` unvalidated and produces a `NaN` comparison rather than a rejected row, which is exactly the "silently corrupt hand" outcome the version stamp was added to prevent (`server/onlineGameLogic.ts:149-156`).
- **Repro / proof:** Read `server/onlineGameLogic.ts:159-163` — `isStaleSchema` takes `{schemaVersion?: number}` and nothing else is ever passed to it. Read `server/socket.ts:1690` — the only guard on `scores` is `?? {}`, which catches `null` and nothing else. Read `server/socket.ts:345` against `shared/schema.ts:74` — `player_ids` is `Object.values(player_map)` by construction.
- **Proposed fix:** Two independent changes, smallest first.
  1. **Drop `player_ids`.** Delete the column from `shared/schema.ts:74`, the two write sites (`server/socket.ts:353,372`), the `storedIds` parameter and the positional fallback in `readPersistedPlayerMap` (`server/onlineGameLogic.ts:16-37`), and the corresponding assertions in `tests/onlineGameLogic.test.ts`. `server/schemaDdl.ts` is additive-only and will not drop the column — that is fine, and CLAUDE.md's "the database is not precious" rule permits a `drizzle-kit push` if the dead column is worth removing physically. `match_replays.player_ids` (`shared/schema.ts:127`) is a **different** column with a real containment query behind it (`server/storage.ts:110`) — do not touch it.
  2. **Extend the envelope.** Move `playerMap`, `scores`, `matchTarget`, `matchLength`, `gameMode`, `maxPlayers` and `isPublic` into the versioned `game_state` envelope alongside `handFlags` (`packPersistedState` / `unpackPersistedState`), leaving `room_code` and `updated_at` as the only real columns — `updated_at` must stay a column because `pruneAbandonedGames` (`server/socket.ts:2062-2072`) filters on it in SQL. Bump `GAME_SCHEMA_VERSION` to 2 in the same commit, so every pre-existing row is refused rather than half-read, which is the whole point of the constant. Give `unpackPersistedState` a shape check for `scores` (`Object.values(...).every(Number.isFinite)`) and return a rejection rather than a cast.
- **Acceptance criteria:** `grep -n "as any" server/socket.ts` no longer matches inside `persistGameState`. `tests/persistedEnvelope.test.ts` gains cases: a row with a non-numeric score is refused, not restored; a row at version 1 is refused after the bump; a round-trip preserves seats, scores, target and length. `tests/integration/abandonedGames.test.ts:48` inserts a raw row and will need its column list updated.
- **Fix risk:** Change (2) invalidates every live `active_games` row on deploy — acceptable per CLAUDE.md ("there are no real users"), but it means any game in progress across the deploy is lost, and `game:rejoin` will answer `GAME_NO_LONGER_VALID`. Change (1) is safe on its own and can ship first.
- **Depends on:** None

---

### [ARCH-07] Fold `handleLeaveRoom` and `handleLeaveRoom_lobby` into one function and give it an honest name

- **Severity:** Low
- **Confidence:** High
- **Effort:** M (a few hours)
- **Location:** `server/socket.ts:2153-2194` (`handleLeaveRoom`), `server/socket.ts:2196-2232` (`handleLeaveRoom_lobby`), call sites `:1192` and `:1925`
- **Problem:** Two functions, 42 and 37 lines, whose `waiting` branches (`:2171-2187` and `:2207-2223`) are **seventeen identical lines** — remove the row, promote the lowest remaining seat to host if the leaver was host, re-broadcast `room:state`. Around that identical core they diverge, and neither is a superset of the other:

  | | `handleLeaveRoom` (`:2153`) | `handleLeaveRoom_lobby` (`:2196`) |
  |---|---|---|
  | called from | `room:leave` (`:1192`) | `disconnect` (`:1925`) |
  | clears the user's timers | yes (`:2163`) | **no** |
  | `removeRoomPlayer` | awaited, unguarded (`:2165`) | `.catch(() => {})` (`:2202`) |
  | `status === "waiting"` | 17 lines | the same 17 lines |
  | `status === "in_progress"` | `vacateSeat` (`:2192`) | **absent** |
  | `status === "finished"` | **absent** | re-checks emptiness (`:2225-2231`) |
  | emits `room:player_left` | **no** | yes (`:2224`) |

  The `_lobby` suffix does not describe the difference. `handleLeaveRoom_lobby` is called from the disconnect handler whenever `!game || game.gameState.gameOver` (`server/socket.ts:1924`) — which includes a **finished** game's results screen, not only a lobby. The axis that actually separates the two is *socket-initiated leave* vs *connection loss*, and the name says nothing about it.
- **Impact:** A3's NET-01 (`03-netcode.md:15-25`) is a difference of **omission** between these two near-identical bodies: `handleLeaveRoom` has no `finished` branch, so leaving at the results screen never calls `vacateSeat`, and the remaining players' rematch vote can never complete. A3 records the duplication as a passing remark (`03-netcode.md:256`); it is the cause. `room:player_left` being emitted by one and not the other (see ARCH-08) is a second symptom of the same split. Every future change to leave handling has to be made twice, and the two are already 17 lines of copy apart.
- **Repro / proof:** `sed -n '2171,2187p;2207,2223p' server/socket.ts` — the two blocks are character-identical apart from the trailing `room:player_left` emit.
- **Proposed fix:** One function in `server/socket.ts`:
  ```ts
  async function handleSeatRelease(
    io: SocketServer,
    roomId: string,
    userId: string,
    username: string,
    opts: { socket?: { id: string; leave: (r: string) => void }; source: "leave" | "disconnect" }
  )
  ```
  Body: clear timers for the user unconditionally (the disconnect path currently skips this for no stated reason); `await storage.removeRoomPlayer(...).catch(() => {})`; `socket?.leave(roomId)`; read the room; then **one** `waiting` branch (the shared 17 lines) and **one** "the game may still be live" branch that runs `vacateSeat` whenever `activeGames.has(roomId)` regardless of `rooms.status` — which is exactly the fix NET-01 asks for, and which then covers `in_progress` and `finished` in one place. Delete `room:player_left` per ARCH-08. Keep `room:leave`'s `publicRoomIds` cleanup at its current call site (`:1193-1196`) — it needs the post-removal player count.
- **Acceptance criteria:** `grep -c "handleLeaveRoom" server/socket.ts` shows one definition and two call sites. The 17-line host-migration block appears once. NET-01's repro (two players, one leaves at the results screen, the other's rematch vote completes) passes.
- **Fix risk:** This function is on the disconnect path, which runs inside a `void (async () => …)` with its own try/catch (`server/socket.ts:1893,1971`); an unguarded throw introduced here becomes a logged failure, not a crash, but it would silently strand the room. Keep every `storage.*` call `.catch`-guarded. Land NET-01's behavioural change and this refactor as one commit — separating them means writing the missing branch twice.
- **Depends on:** NET-01 (same code, same fix — coordinate)

---

### [ARCH-08] Delete the four dead socket-protocol surfaces, including a fully unreachable server handler

- **Severity:** Low
- **Confidence:** High
- **Effort:** S (<1h)
- **Location:** `server/socket.ts:1266-1291`, `:832-839`, `:2224`, `:1372`, `:1588`; `server/socketSchemas.ts:44-46`; `server/storage.ts:30,216-219`; `context/OnlineGameContext.tsx:443,465,543-545,555-557`; `locales/it.ts:61` + `en`/`sq`
- **Problem:** Four places where the socket protocol has drifted apart from both ends. The recon (§7) found two; the other two are new.

  1. **`room:set_game_mode` is unreachable from the app.** The server registers a full handler (`server/socket.ts:1266-1291`, 26 lines: host check, `status !== "waiting"` guard with its own error code, `updateRoomGameMode`, two re-reads, a `room:state` broadcast). The client's only emitter is `OnlineGameContext.setRoomGameMode` (`:543-545`) — **zero consumers**: `grep -rn "setRoomGameMode" app/ components/` returns nothing, and `app/(online)/room.tsx` only *reads* `room.gameMode` (`:401-402`, `:516`, `:632`). No screen offers changing the mode after creation; it is chosen at `room:create`/`room:quickmatch`. The dead chain spans five files: the handler, `RoomSetGameModeSchema` (`server/socketSchemas.ts:44-46`), `IStorage.updateRoomGameMode` + its implementation (`server/storage.ts:30,216-219`), the context method, and `server.CANNOT_CHANGE_MODE_IN_PROGRESS` in all three locales (`locales/it.ts:61`).
  2. **`game:started` has a no-op listener.** The server emits it twice (`:1372`, `:1588`); the client registers `socket.on("game:started", () => {})` (`context/OnlineGameContext.tsx:443`) and removes it with a bare `socket.off("game:started")` (`:465`) — which, on a singleton socket shared app-wide, strips *all* listeners for that event, not just this one. Navigation into the game screen is driven by `room` + `gameState` becoming non-null (`app/(online)/room.tsx`), not by this event.
  3. **`game:match_over`** (`:832-839`) — no client listener anywhere. A3 concluded the `game:over` payload at `:820-830` already carries all four fields (`matchTarget`, `isDraw`, `matchWinners`, `matchContinues`); I confirmed by reading both payloads.
  4. **`room:player_left`** (`:2224`) — no client listener, **and** emitted by only one of the two leave paths (`handleLeaveRoom_lobby`, not `handleLeaveRoom`), immediately after a `room:state` that has already removed the player from the roster. Both halves of that make it vestigial.
- **Impact:** Small individually; together they are 40-odd lines of server code with authorization logic and a rate limit that nothing can invoke, a zod schema and a storage method kept in sync for it, three locale strings maintained by `tests/i18n.test.ts` forever, and a `socket.off` with a wider blast radius than intended. The real cost is that a future reader trying to answer "can the host change the mode mid-lobby?" reads a complete, guarded, plausible implementation and concludes yes.
- **Repro / proof:** `grep -rn "setRoomGameMode\|set_game_mode" app/ components/` → zero. `grep -rn "game:match_over\|room:player_left" app/ components/ context/ lib/` → zero. `grep -n 'socket.on("game:started"' context/OnlineGameContext.tsx:443` → `() => {}`.
- **Proposed fix:** Delete all four, ends first so nothing is left half-wired:
  - `room:set_game_mode`: remove `context/OnlineGameContext.tsx:543-545` and its interface/memo/deps entries; `server/socket.ts:38` (import) and `:1266-1291`; `server/socketSchemas.ts:44-46`; `server/storage.ts:30` and `:216-219`; the `server.CANNOT_CHANGE_MODE_IN_PROGRESS` key in `locales/it.ts`, `en.ts`, `sq.ts`. If mid-lobby mode switching is *wanted*, the fix is the opposite — wire a control in `app/(online)/room.tsx` — but that is a product decision, so record it in BACKLOG §2 rather than leaving the code as a placeholder.
  - `game:started`: remove the listener (`:443`) and the `off` (`:465`), and the two server emits (`:1372`, `:1588`).
  - `game:match_over`: remove `server/socket.ts:832-839`.
  - `room:player_left`: remove `server/socket.ts:2224` (or, if ARCH-07 lands first, it disappears with the merge).
- **Acceptance criteria:** `tests/socketEvents.test.ts`'s expected inbound-event set is updated to 17 and passes. `tests/i18n.test.ts` passes after the key is removed from all three locales. `grep -rn "match_over\|player_left\|set_game_mode\|game:started" server/ context/` returns only `game:player_left` (which is live).
- **Fix risk:** `tests/socketEvents.test.ts` asserts the registered inbound set matches an expected list — removing `room:set_game_mode` without updating that list fails the suite, which is the correct behaviour and the confirmation the deletion was complete.
- **Depends on:** None (ARCH-07 overlaps on `room:player_left`)

---

### [ARCH-09] `components/GameShared.tsx` has exactly one consumer — the name promises a boundary that does not exist

- **Severity:** Low
- **Confidence:** High
- **Effort:** M (a few hours)
- **Location:** `components/GameShared.tsx` (1329 lines), `components/GameTable.tsx:76-89` (the only import), `components/GameTable.tsx:383-1205` (the `GameTable` function), `tests/vignette.test.ts:20`, `docs/ARCHITECTURE.md` §1/§6
- **Problem:** `GameShared.tsx` is named for a state that ended with commit `b90adb9` ("Unify the two game screens"). Before that unification, `app/game.tsx` and `app/(online)/game.tsx` each imported it — hence "Shared". Today `grep -rn "GameShared" app components context lib` returns **one** import site: `components/GameTable.tsx:89`. It is `GameTable`'s private implementation, split across a second file for no boundary reason. The parts that genuinely needed to be reachable from `node --test` were already extracted elsewhere — `gameTableModel.ts`, `handLayout.ts`, `cardFaceModel.ts` — and each of those files says so in its own header.

  The result is one 2717-line component divided at an arbitrary point:
  - `GameTable.tsx` (1388 L): `GameTable` itself is a single 822-line function (`:383-1205`) holding **11 `useEffect`s, 6 `useSharedValue`s, 3 `useState`s and 4 `useRef`s**, plus 173 lines of `StyleSheet` and two small local components (`TurnTimer` `:267-312`, `RematchPromptPanel` `:319-380`).
  - `GameShared.tsx` (1329 L): 14 exported components and **four separate `StyleSheet`s** (`vignetteStyles` `:120`, `portraitOverlayStyles` `:879`, `sharedTableStyles` `:910`, `sharedStyles` `:1033`, `billboardStyles` `:1289`). `sharedStyles` (175 lines) and `FLY_OFFSETS` are `export`ed but used only inside the file.
  - `docs/ARCHITECTURE.md` §1 and §6 describe the table as `GameTable.tsx` + `gameTableModel.ts` and never mention `GameShared.tsx` at all — so the architecture doc accounts for 1827 of the table's 3156 lines.
- **Impact:** Anyone asked to change a card's press behaviour has to know which of two files by size alone. The `export` keyword on 14 symbols implies an external contract that does not exist, so nothing can be moved or renamed without checking. `sharedStyles`' 175 lines sit between `useTurnPulse` and `getComboLabel` with no relation to either. And the misleading name has form here: CLAUDE.md already records one naming collision in this area (`MenuButton` in `app/index.tsx`) that "cost real time".
- **Repro / proof:** `grep -rn "GameShared" app components context lib tests --include='*.ts' --include='*.tsx' | grep -v "^components/GameShared"` — one import (`components/GameTable.tsx:89`), plus prose comments and `tests/vignette.test.ts:20` which reads the file as text.
- **Proposed fix:** Regroup by concern into `components/table/`, keeping every symbol's implementation byte-identical (a pure move):
  - `components/table/seats.tsx` — `AvatarCircle` (`:173-282`), `CardFan` (`:129-170`), `TopOppSlot` (`:285-317`), `SideOppSlot` (`:320-361`), and the avatar/count rules out of `sharedStyles`. Drop `export` from `AvatarCircle` and `CardFan` (used only by the two slots).
  - `components/table/pile.tsx` — `FlyingCards` (`:364-468`), `PlayedPile` (`:471-592`), `PileComboCards` (`:492-513`), the flight constants `FLY_OFFSETS`/`FLY_ROTS`/`FLY_LANDING_ROTS`/`ARC_PEAK`/`LAND_DIP` (`:60-76`), `getComboLabel` (`:1210-1220`), `COMBO_LABEL_KEYS`, `POWER_COMBOS`.
  - `components/table/hand.tsx` — `CardItem` (`:610-709`), `StraightHand` (`:712-807`).
  - `components/table/chrome.tsx` — `TableVignette` (`:84-119`), `StartReasonBanner` (`:810-876`), `GameBillboard` (`:1223-1288`), `useTurnPulse` (`:968-1030`), `portraitOverlayStyles`, `sharedTableStyles`.
  - `components/useTableFeedback.ts` — lift the sound/haptic/animation reaction cluster out of `GameTable` (`:574-756`: the 11 effects and 6 shared values, which are one concern — "react to a state change with a noise, a buzz or a wobble") into a hook returning the five animated styles. That takes the `GameTable` function from 822 lines to roughly 590 and gives the flight/impact timing a single home.

  Delete `components/GameShared.tsx`. Add the new files to `docs/ARCHITECTURE.md` §1.
- **Acceptance criteria:** `components/GameShared.tsx` no longer exists. No file under `components/table/` exceeds 500 lines. Each exported symbol has at least one importer outside its own file. `npx jest` (230 native tests) and `npx tsc --noEmit` pass unchanged.
- **Fix risk:** **`tests/vignette.test.ts:20` reads `components/GameShared.tsx` as a text file** (`readFileSync`) and will throw `ENOENT` the moment it moves — update its path to `components/table/chrome.tsx` in the same commit. `tests/reducedMotion.test.ts` and `tests/motion.test.ts` are also source-scanners over the component tree; re-run `npm test` and check their file globs still reach the new paths. This is a pure move: do not "tidy" anything while moving it, or the diff stops being reviewable.
- **Depends on:** None

---

### [ARCH-10] Rename `server/testApp.ts` — it is the production app factory, not a test helper

- **Severity:** Low
- **Confidence:** High
- **Effort:** S (<1h)
- **Location:** `server/testApp.ts` (241 lines), `server/index.ts:9,15`, `tests/helpers/testServer.ts`, `tests/serverLoadable.test.ts`, `replit.md:49`, `CLAUDE.md` §Key Files
- **Problem:** `server/testApp.ts` contains `createApp()` — the function that wires helmet, pino-http, CORS, body parsing, `ensureSchema`, the session middleware, `/health`, the static/SPA handler, `registerRoutes`, `setupSocket` and the 5xx-sanitising error handler. It is the entire production Express + Socket.io application. `server/index.ts:9`, the file the Replit run command executes, imports it:
  ```ts
  import { createApp } from "./testApp.ts";
  ```
  The name records how the file came to be split (so the integration harness could boot the same app on an ephemeral port), not what it is. The file's own docblock (`:171-179`) explains the split correctly and never justifies the name.

  Two concrete consequences already visible in the repo:
  - `tests/serverLoadable.test.ts` — which exists to prove server modules load under plain Node type-stripping — lists 11 modules and **excludes `testApp.ts`**, the one that boots everything.
  - `replit.md:49` places `app.set("trust proxy", 1)` in `server/index.ts`; it is in `server/testApp.ts:186-188`. The documentation writer looked in the file whose name says "production".
  - `CLAUDE.md`'s Key Files table lists `server/index.ts` as "Express entry point" and does not mention `testApp.ts` at all — so the file holding all the middleware wiring is invisible to every future session's loaded context.
- **Impact:** Any tool, glob or human filter that treats `*test*` as non-production skips the file that configures helmet, CORS and the error handler. Specialist A1 cited it eight times in the security report — under a name that says it is a test fixture. This is the same class of defect CLAUDE.md records for the local `MenuButton`: a name that sends a reader to the wrong mental model.
- **Repro / proof:** `grep -n "createApp" server/index.ts` → `import { createApp } from "./testApp.ts";` at `:9`. `.replit` `run = ["npm","run","server:prod"]` → `node server_dist/index.js` → bundled from `server/index.ts`.
- **Proposed fix:** `git mv server/testApp.ts server/app.ts`; update the three importers (`server/index.ts:9`, `tests/helpers/testServer.ts`, and the comment at `server/index.ts:15`); add `app` to `tests/serverLoadable.test.ts`'s module list; add a `server/app.ts` row to CLAUDE.md's Key Files table ("Builds the full Express + Socket.io app; `server/index.ts` only binds the port"); fix `replit.md:49`.
- **Acceptance criteria:** No file under `server/` has "test" in its name. `npm run verify` passes. `npm run server:build` produces `server_dist/index.js` (run this once manually — CI never does, see the recon §12).
- **Fix risk:** `esbuild` bundles from `server/index.ts` with `--bundle`, so the rename is resolved at build time and needs no config change. `tests/helpers/testServer.ts` is the integration harness — a missed import there fails all 11 integration suites on CI, loudly.
- **Depends on:** None

---

### [ARCH-11] `getSocket()` silently constructs a socket, which makes the documented singleton-ownership invariant unenforceable

- **Severity:** Low
- **Confidence:** High (on the naming and ownership); Medium on the failure path
- **Effort:** M (a few hours)
- **Location:** `lib/socket.ts:68-74` (`getSocket`), `lib/socket.ts:45-66` (`connectSocket`), `context/OnlineGameContext.tsx:168`, `context/SocketContext.tsx:92,99-108`, `CLAUDE.md` §Architecture Rules, `docs/ARCHITECTURE.md:74-76`
- **Problem:** CLAUDE.md states *"`SocketContext` is the only place to manage socket lifecycle. Never create sockets outside this pattern."* `docs/ARCHITECTURE.md:75-76` states it more strongly: *"Nothing else is allowed to call `io()`."* Neither is enforceable, because the accessor is a constructor:
  ```ts
  export function getSocket(userId: string): Socket {
    const s = socketMap.get(userId);
    if (!s) { return connectSocket(userId); }   // lib/socket.ts:70-72
    return s;
  }
  ```
  `context/OnlineGameContext.tsx:168` calls `getSocket(userId)` **on every render**, unconditionally, at the top of the provider body. If the map entry is absent at that moment, `OnlineGameProvider` creates the socket — calling `io()` from outside `SocketContext`, exactly what both documents forbid.

  There is also a second way to obtain the socket: `SocketContext` already exposes it (`context/SocketContext.tsx:28,261`) and `app/(online)/friends.tsx:71` and `app/(online)/room.tsx` use `useSocket().socket` — which is typed `Socket | null` and therefore forces `if (socket)` guards at `app/(online)/friends.tsx:221` and `app/(online)/room.tsx:214`. `OnlineGameContext` bypasses that and goes to the module directly.
- **Impact:** The invariant is documented, believed, and not true. The concrete failure path is `SocketContext.onAuthFailure` (`:99-108`): on a 401 from the ticket endpoint it calls `socket.io.reconnection(false); socket.disconnect(); void logout().finally(...)`. It does **not** call `disconnectSocket`, so the map entry survives with reconnection permanently disabled — cleanup depends on `logout()` reaching `setUser(null)` (`context/AuthContext.tsx:63`) so that `SocketProvider`'s `!user` branch runs `disconnectSocket`. `logout()` awaits two network calls first (`:61-62`); if either rejects, `setUser(null)` never runs, the teardown never fires, and the map keeps a disconnected socket with `reconnection(false)`. Any later `connectSocket`/`getSocket` returns that dead socket and nothing ever calls `.connect()` on it — `onConnectError` cannot fire because no attempt is made. The user is signed in with a socket that will never reconnect until the app restarts.
- **Repro / proof:** Read `lib/socket.ts:68-74` and `context/OnlineGameContext.tsx:168`. The failure path is inferred from `context/SocketContext.tsx:99-108` + `context/AuthContext.tsx:58-65` — **what would confirm it:** mock `apiRequest("POST", "/api/auth/logout")` to reject, trigger a 401 from `/api/auth/socket-ticket`, and assert `socketMap` still holds an entry with `io.reconnection === false`.
- **Proposed fix:**
  1. `lib/socket.ts`: change `getSocket` to `export function getSocket(userId: string): Socket | null { return socketMap.get(userId) ?? null; }` — a getter that gets. `connectSocket` stays the only constructor and stays called only from `context/SocketContext.tsx:92`.
  2. `context/OnlineGameContext.tsx`: take the socket from `useSocket()` instead of the module, and return early (render children with a null-socket context, or gate on `connected`) when it is null. `app/(online)/_layout.tsx:18` already guarantees a `user`, and `SocketProvider` is an ancestor, so the null window is only the first render after login.
  3. `context/SocketContext.tsx:99-108`: call `disconnectSocket(user.id)` in `onAuthFailure` before `logout()`, so the map is cleared whether or not `logout()` resolves.
- **Acceptance criteria:** `grep -rn "connectSocket" --include='*.ts*' app components context lib` shows exactly one call site, in `context/SocketContext.tsx`. `getSocket`'s return type is `Socket | null`. `npx tsc --noEmit` clean (the null return will surface every unguarded use).
- **Fix risk:** `OnlineGameContext`'s 18 listener registrations (`:436-453`) currently run in an effect that assumes a non-null socket; making it nullable adds a guard to that effect and to 12 `useCallback` emitters. Get this wrong and the reconnect listeners never attach — cover it with `tests/e2e/reconnect.spec.ts` before and after.
- **Depends on:** None

---

### [ARCH-12] Name and pin the server-safe subset of `lib/` — six modules cross the boundary with nothing guarding them

- **Severity:** Low
- **Confidence:** High
- **Effort:** S (<1h)
- **Location:** `lib/gameEngine.ts`, `lib/replay.ts`, `lib/botPersonalities.ts`, `lib/achievements.ts`, `lib/rating.ts`, `lib/streak.ts`; `tests/serverLoadable.test.ts`; `.github/workflows/ci.yml`
- **Problem:** Boundaries are clean in the direction that matters — **nothing** in `app/`, `components/`, `context/`, `lib/` or `shared/` imports from `server/`, and `shared/schema.ts` imports only third-party packages. Verified by grep.

  The unmarked boundary is inside `lib/`. Of its 18 modules, exactly six are imported by the server: `gameEngine.ts` (5 server importers), `replay.ts` (6), `botPersonalities.ts` (4), `achievements.ts` (3), `rating.ts` (1), `streak.ts` (1). The other twelve import `react-native`, `expo-audio`, `expo-haptics` or `AsyncStorage` and would break the server build if pulled in. Nothing marks the difference: no directory, no naming convention, no lint rule, no test. It is discoverable only by grepping the server for `../lib/`.

  Two other files in the repo *do* declare this exact constraint for themselves, in prose: `server/onlineGameLogic.ts:1-7` ("This module imports nothing beyond an equally pure sibling, so it can be") and `server/replayShape.ts:1-3`. `components/gameTableModel.ts:3-8` and `components/handLayout.ts:3-7` declare the same rule for the test loader. So the project understands the constraint and enforces it four times by comment.
- **Impact:** Adding a value import from, say, `lib/sounds.ts` to `lib/achievements.ts` — a plausible change ("play a sting when an achievement unlocks") — pulls `expo-audio` into `server/stats.ts` and breaks `npm run server:build`. Nothing catches it: `tests/serverLoadable.test.ts` covers 11 server modules and **none of the six that import `lib/`** (`stats.ts`, `ratings.ts`, `replays.ts`, `replayShape.ts`, `push.ts`, `socket.ts` are all absent from its list), and CI never runs `server:build` at all (recon §12). The first signal would be a failed Replit deploy.
- **Repro / proof:** `grep -rho '"\.\./lib/[a-z]*\.ts"' server/ | sort -u` returns exactly those six. `tests/serverLoadable.test.ts` lists `logger, db, session, cors, validate, schemas, socketSchemas, socketSafety, ticket, storage, onlineGameLogic` — `socketSchemas` and `onlineGameLogic` reach `botPersonalities`, and that is the entire accidental coverage.
- **Proposed fix:** Cheapest first, and the first one alone closes most of the gap.
  1. Add the six modules directly to `tests/serverLoadable.test.ts`'s import list, plus the four uncovered server modules that depend on them (`stats.ts`, `ratings.ts`, `replays.ts`, `replayShape.ts`). They already load under Node's type stripper today, so this is a pin, not a fix — and it fails loudly the day someone adds a client-only import.
  2. Add a one-paragraph section to `CLAUDE.md` §Key Files or `docs/ARCHITECTURE.md` §1 naming the six and stating the rule: *a module in this list may import only other modules in this list and third-party packages with no React Native dependency.*
  3. Consider (do not do reflexively) moving the six under `shared/`, which currently holds one file and already means "used by both sides". That makes the boundary a directory rather than a list, but it touches ~40 import statements and the four "pure sibling" comments; it is only worth it if step 1 proves the list needs maintaining.
- **Acceptance criteria:** `npm test` fails if any of the six gains a `react-native`, `expo-*` or `@react-native-*` value import. `tests/serverLoadable.test.ts` covers every module under `server/` except `socket.ts` (which is blocked until ARCH-04 lands) — currently it covers 11 of 22.
- **Fix risk:** Step 1 is additive and cannot break anything. If a module unexpectedly fails to load, that is the finding, not a regression.
- **Depends on:** None (ARCH-04 extends the same test list)

---

### [ARCH-13] Match progression is implemented twice, once per authority

- **Severity:** Low
- **Confidence:** High
- **Effort:** L (a day+)
- **Location:** `context/GameContext.tsx:98-135` (`applyHandToMatch`), `server/socket.ts:749-792` (inside `handleGameOver`), `context/GameContext.tsx:480-484` vs `server/socket.ts:961-974`, `lib/sharedGameFlow.ts`
- **Problem:** Folding a finished manche into its match is written twice, by different rules, in different files:

  | Step | Offline (`GameContext.tsx:98-135`) | Online (`socket.ts:749-792`) |
  |---|---|---|
  | score the hand | `scoreHand(rankings, players.length)` `:99` | `scoreHand(...)` `:749` then remapped engine-id → seat → `scoreKeyForSeat` `:750-755` |
  | exclude bots | n/a (offline AI seats do score) | `excludeBotSeats(handByKey)` `:761` |
  | accumulate | `addHandScores(match.scores, points)` `:100` | `addHandScores(game.cumulativeScores, …)` `:763` |
  | `single` | `over: true`, winner `rankings[0]` `:103-112` | `matchOver = true`, winner `rankings[0]` `:768-772` |
  | teams vs ffa | `resolveTeamMatch` / `resolveMatch` `:118-121` | `resolveTeamMatch` / `resolveMatch` `:778-782` |
  | escalate / end | `:123-134` | `:783-791` |
  | keyed by | engine player id (`player_0`) | userId, or `bot:<seat>` |

  The engine primitives are shared (`scoreHand`, `addHandScores`, `resolveMatch`, `resolveTeamMatch`, `MATCH_TARGETS` — all from `lib/gameEngine.ts`), so no arithmetic can diverge. The **orchestration** is duplicated: the order of the steps, the single-manche special case, and the decision of what happens on `newTarget !== null`. A rule change — a different tie-break, a fourth escalation step, a change to who counts as a match winner — has to be made in both, and only the online one has any test coverage (and that only through two DB-gated integration suites).

  The same shape repeats for the rematch tally: `GameContext.tableWantsRematch` (`:480-484`) counts truthy entries in a `Record` over `players.length` seats, while `countRematchAnswers` (`server/socket.ts:961-974`) walks seats and resolves bot seats through `botWantsRematch`. Both end in `isMajority`, by two different routes.

  `lib/sharedGameFlow.ts` — the file whose name promises exactly this — holds 13 lines: one interface and two constants, **both constants unused anywhere in the repo** (`EXCHANGE_ANNOUNCE_DURATION_MS`, `BOTH_JOKERS_DISMISS_DURATION_MS`; `components/ExchangeAnnouncement.tsx:34-35` defines its own `DISMISS_MS`/`FLIGHT_DURATION` instead). The abstraction was started, superseded locally, and never finished or removed.
- **Impact:** The offline path has no server and therefore no integration coverage by construction (recon §6), so the copy with zero end-to-end tests is the one a rule change is most likely to be applied to incorrectly. This is the highest-value structural duplication remaining after the roster case that A2/A3 found.
- **Repro / proof:** Read the two blocks side by side. Both call `resolveTeamMatch(scores, teamOf, target)` when `gameMode === "teams" && Object.keys(teamOf).length > 0`, then branch identically on `resolution.newTarget !== null`. `grep -rn "EXCHANGE_ANNOUNCE_DURATION_MS\|BOTH_JOKERS_DISMISS_DURATION_MS" app components context lib server` returns only the two definitions.
- **Proposed fix:** Move the orchestration into `lib/gameEngine.ts` beside the primitives it calls (§"Match scoring", `:1087-1226`) as one pure function keyed by an opaque string, so both authorities supply their own key function:
  ```ts
  export function applyHandToMatch(args: {
    rankings: string[]; playerCount: number; length: MatchLength;
    target: number; cumulative: Record<string, number>;
    keyOf: (engineId: string) => string | null;   // null = do not accumulate (bot seat)
    teamOf?: Record<string, string>; gameMode: GameMode;
  }): { cumulative: Record<string, number>; handByKey: Record<string, number>;
        target: number; over: boolean; winners: string[]; isDraw: boolean };
  ```
  Offline passes `keyOf: (id) => id` and no exclusion; online passes `keyOf: (id) => { const seat = seatOfEngineId.get(id); return seat === undefined ? null : (playerMap[seat] ?? null); }`, which folds `scoreKeyForSeat` + `excludeBotSeats` into one place. Both call sites become ~10 lines. Do the same for the rematch tally: one `countRematchAnswers(seats, answerOf)` in `lib/gameEngine.ts`, where `answerOf(seat)` returns `boolean | "bot"`.

  Then either give `lib/sharedGameFlow.ts` real content (it is the natural home if `gameEngine.ts` is felt to be full) or reduce it to the one interface it actually provides and delete the two dead constants.
- **Acceptance criteria:** `tests/scoring.test.ts` and `tests/teams.test.ts` cover the new function directly, including the bot-exclusion case that today only `tests/integration/*` can reach. `grep -c "resolveTeamMatch" context/GameContext.tsx server/socket.ts` returns 0 for both (they call the new orchestrator instead). Existing `tests/scoring.test.ts`, `tests/teams.test.ts` and `tests/native/offlineResume.test.tsx` pass unchanged.
- **Fix risk:** This touches the two functions that decide who wins a match. `applyHandToMatch` is also the single write path for offline scoring (`context/GameContext.tsx:203-212` says so explicitly) and its output is serialised into the AsyncStorage save (`lib/offlineSave.ts`) — a shape change to `MatchState` invalidates saved games, which `tests/offlineSave.test.ts` covers ("a save from another version is discarded not migrated"), so keep `MatchState` byte-identical and change only how it is computed.
- **Depends on:** None. Best done after ARCH-04 extracts `server/gameOver.ts`, which makes the online half testable first.

---

### [ARCH-14] Delete the dead exports and the dead context surface

- **Severity:** Low
- **Confidence:** High (each verified by repo-wide grep including the defining file)
- **Effort:** S (<1h)
- **Location:** listed below
- **Problem:** Symbol-level dead code the recon's module-level orphan scan could not see. Each of these has **zero references anywhere in the repo, including its own file**:

  | Symbol | Location | Note |
  |---|---|---|
  | `pendingTicketNonces()` | `server/ticket.ts:72-76` | Its own docblock says *"Test/diagnostic helper"* — no test calls it. A justifying comment for a function nothing uses. |
  | `generateSchemaDdl()` | `server/schemaDdl.ts:325-327` | *"for callers that apply DDL in bulk"* — there are none. `ensureSchema` uses `schemaStatements()`; so does `tests/schemaDdl.test.ts:9`. |
  | `ExchangeCardSchema` | `server/schemas.ts:21-23` | Worse than dead: it validates `{ cardIndex: number }`, while the live exchange event validates `{ cardId: string }` (`server/socketSchemas.ts`, `server/socket.ts:1777`). A stale schema for a protocol that changed — a decoy for anyone grepping for exchange validation. |
  | `isRedSuit()` | `lib/gameEngine.ts:892-894` | Suit ink is decided in `lib/tokens.ts` / `CardView.tsx` instead. |
  | `export { sessionMiddleware }` | `server/index.ts:11` (+ its import at `:8`) | Re-exported from the process entry point, which nothing can import. |
  | `EXCHANGE_ANNOUNCE_DURATION_MS`, `BOTH_JOKERS_DISMISS_DURATION_MS` | `lib/sharedGameFlow.ts:3-4` | Superseded by `DISMISS_MS`/`FLIGHT_DURATION` in `components/ExchangeAnnouncement.tsx:34-35`. |
  | `requestPlayAgain` | `context/OnlineGameContext.tsx:555-557` (+ interface `:109`, memo `:631`, deps `:642`) | Emits `room:start` from the results screen. Zero consumers — `app/(online)/game.tsx:323` uses `voteRematch`. A second, unused client route into the game-start handler. |
  | `setRoomGameMode` | `context/OnlineGameContext.tsx:543-545` | Covered by ARCH-08. |
  | `lastRoundWinner` | `context/GameContext.tsx:184` (state), `:219,246,354,365,393,398,423,439` (setters), `:153` (interface), `:490,513` (memo) | Exposed on the context and set on eight code paths; **zero readers** outside the file. |

  A larger class exists but is benign: ~70 symbols carry `export` while being used only inside their defining file (e.g. `AvatarCircle`, `CardItem`, `sharedStyles` in `GameShared.tsx`; most of `cardFaceModel.ts`'s constants; the `Reaction`/`RematchVoteState`/`OnlineMatchState` interfaces in `OnlineGameContext.tsx`). Those are live code with an over-broad modifier, not dead code — they are covered by ARCH-09's regrouping where it applies and are otherwise not worth a commit of their own.
- **Impact:** `ExchangeCardSchema` actively misleads (wrong field, wrong type, plausible name). `pendingTicketNonces` and `generateSchemaDdl` each ship with a comment explaining who uses them; nobody does, which is the pattern CLAUDE.md flags as "the tell is the justifying comment". `lastRoundWinner` is eight write sites maintained for no reader.
- **Repro / proof:** For each row: `grep -rn "\bSYMBOL\b" --include='*.ts' --include='*.tsx' app components context lib server shared tests scripts` returns only the definition (and, for `lastRoundWinner`, only writes).
- **Proposed fix:** Delete each, ends first. For `lastRoundWinner`, remove the `useState`, the eight `setLastRoundWinner(...)` calls, the interface member and the two memo entries. For `requestPlayAgain` and `setRoomGameMode`, remove the method, the interface member, the memo entry and the dependency-array entry. For `server/index.ts`, remove both `:8` and `:11`.
- **Acceptance criteria:** `npx tsc --noEmit` clean, `npm run lint` clean, `npm test` and `npx jest` pass. Re-running the grep for each symbol returns nothing.
- **Fix risk:** None beyond a missed reference, which the typechecker catches. `sessionMiddleware` must remain imported and used in `server/testApp.ts:213` — only the re-export from `index.ts` goes.
- **Depends on:** ARCH-08 (overlaps on `setRoomGameMode`)

---

### [ARCH-15] Type the `active_games` round-trip instead of casting both ends with `as any`

- **Severity:** Low
- **Confidence:** High
- **Effort:** M (a few hours)
- **Location:** `server/socket.ts:352-355`, `:1022`, `:1032`, `:1662`, `:1690`, `:1695`, `:216`, `:227`, `:254-257`, `:2150`; `shared/schema.ts:165-177`
- **Problem:** Typecheck is clean at 0 errors, so every remaining `any` / `as` / `!` is a place the type system was explicitly told to stop looking. Ranked by whether the value crossed a trust boundary:

  **Crosses a boundary (matters):**
  - `server/socket.ts:352-355` — four `as any` on the values written into `active_games`' jsonb columns (`gameState`, `playerIds`, `playerMap`, `scores`). Nothing checks their shape on the way in.
  - `server/socket.ts:1690` — `(row.scores as Record<string, number>) ?? {}`, a bare cast on a DB blob, fed directly into `resolveMatch` at `:1692`. See ARCH-06.
  - `server/socket.ts:1662`, `:1695` — `row.gameState as PersistedEnvelope<GameState> | null` and `restoredState as GameState`. The `isStaleSchema` version check is the only guard, and it only inspects one field.
  - `server/socket.ts:1022,1032` — `socket.request as any` and `req.session?.userId as string | undefined` at the **auth boundary**. There is no module augmentation declaring `session.userId`, so the session shape is asserted rather than declared.

  **Local, harmless, do not spend time on:** `sanitizeStateForPlayer`'s `as GameState["exchangePhase"]` (`:254-257` — re-asserts a shape `visibleExchangePhase` deliberately does not guarantee, but the client reads the field optionally); `(sweeper as unknown as { unref?: () => void }).unref?.()` (`:2150` — a genuine Node/DOM typing gap); the five `as any` in components on style props (`components/GameShared.tsx:850,1016`, `GameTable.tsx:795`, `MenuCard.tsx:18`, `ReactionLayer.tsx:63` — react-native-web style holes); every `@ts-ignore` in `tests/` (all annotated `see tests/helpers.ts`, all about Node's `.ts`-extension requirement).

  **A quiet one worth naming:** `server/socket.ts:216` and `:227` cast three-field object literals to the 14-field `OnlineGameState` inside `__testables`. The tests exercising `autoMoveForSeat` therefore run against an object that is missing eleven fields production always has; if the function ever reads a twelfth, the test passes on `undefined` while production behaves differently.

  Separately, `shared/schema.ts` under-uses drizzle's inference: it exports `$inferSelect` types for 7 of 12 tables and none for `activeGames`, `matchReplays`, `userRatings`, `pushTokens` or `friends`' companions — which is why `server/socket.ts` reaches for `as` casts on every `active_games` field.
- **Impact:** The `as any` write path and the unvalidated read path meet in the middle: a value can be written with any shape and read back with any shape, and the version stamp that exists to catch exactly that covers only one of the four columns. The auth-boundary casts mean adding a field to the session (or renaming `userId`) is a silent runtime change, not a compile error.
- **Repro / proof:** `grep -n "as any\|as unknown as" server/socket.ts` — ten hits, four of them in `persistGameState`. `grep -n "\$inferSelect" shared/schema.ts` — 7 exports for 12 tables; `ActiveGame` is not among them.
- **Proposed fix:**
  1. `shared/schema.ts`: add `export type ActiveGame = typeof activeGames.$inferSelect;` (and the four other missing tables) and declare the jsonb columns with drizzle's generic form so they carry a type: `jsonb("player_map").$type<Record<number, string>>().notNull().default({})`, likewise for `scores` (`Record<string, number>`) and `game_state` (`PersistedEnvelope<GameState>`). That alone removes all four `as any` at `:352-355` and both casts at `:1662`/`:1690`.
  2. `server/session.ts` (or a `server/types.d.ts`): add the express-session module augmentation —
     ```ts
     declare module "express-session" { interface SessionData { userId?: string } }
     ```
     — then drop the two `as any` at `server/socket.ts:1022,1032`.
  3. `server/socket.ts:212-238`: give `__testables` a real fixture — a `makeTestGame(state: GameState): OnlineGameState` helper that fills all 14 fields with defaults — instead of casting a partial literal. This is largely obsoleted by ARCH-04, which makes the functions importable directly.
  4. Leave the component-level style casts and the test `@ts-ignore`s alone; each is a documented platform gap, not a silenced bug.
- **Acceptance criteria:** `grep -c "as any" server/socket.ts` drops from 6 to 0. `npx tsc --noEmit` clean. `tests/persistedEnvelope.test.ts` and `tests/onlineGameLogic.test.ts` pass unchanged.
- **Fix risk:** `$type<>()` on a jsonb column changes only the compile-time type, never the emitted DDL — verify against `tests/schemaDdl.test.ts`, which asserts every statement stays additive and idempotent, and check that `server/schemaDdl.ts`'s column-default introspection (`:37-75`) still recognises the defaults.
- **Depends on:** ARCH-06 (same columns; do them together)

---

### [ARCH-16] Give the seven contexts one shape — three throw when used outside their provider, three silently no-op

- **Severity:** Low
- **Confidence:** High
- **Effort:** S (<1h)
- **Location:** `context/AuthContext.tsx:19,79-83`, `context/GameContext.tsx:179,540-544`, `context/OnlineGameContext.tsx:121,652-656`, `context/SocketContext.tsx:37-49`, `context/SettingsContext.tsx:45-53,148`, `context/NotificationContext.tsx:33-41`, `context/InviteContext.tsx`
- **Problem:** Seven contexts, three different shapes for the same problem:
  - **Throwing** — `AuthContext`, `GameContext`, `OnlineGameContext`: `createContext<T | null>(null)` and a hook that throws `"useX must be used within XProvider"`.
  - **Silently defaulting** — `SocketContext`, `SettingsContext`, `NotificationContext`: `createContext<T>({ …no-op defaults })` and a hook that is a bare `useContext`. Used outside its provider, each returns a working-looking object that does nothing: `showNotification: () => {}`, `setSoundsEnabled: () => {}`, `socket: null`.
  - **A dead re-export shim** — `context/InviteContext.tsx`, two lines aliasing `useSocket as useInvite`, imported by nothing (recon §14).

  The silent-default shape has a visible cost already: because `SocketContext`'s default is `socket: null`, the type is `Socket | null` for every consumer, forcing `if (socket)` guards at `app/(online)/friends.tsx:221` and `app/(online)/room.tsx:214` that exist only to satisfy a default value no real code path produces.
- **Impact:** A component mounted outside `SettingsProvider` gets a permanently muted, haptic-free app with the default card back, and no error anywhere. Outside `NotificationProvider`, every banner is swallowed. Both are exactly the kind of failure that survives a review and a test run and shows up as "sound doesn't work on that one screen". The throwing shape makes the same mistake a crash on first render — which is what the three contexts that own real state already chose.
- **Repro / proof:** Compare `context/AuthContext.tsx:79-83` with `context/SettingsContext.tsx:148` (`export const useSettings = () => useContext(SettingsContext);`). Compare `context/SocketContext.tsx:28` (`socket: Socket | null`) with its only two external consumers, both of which guard on it.
- **Proposed fix:** Move `SocketContext`, `SettingsContext` and `NotificationContext` to the throwing shape — `createContext<T | null>(null)` plus a hook that throws — matching the three that already use it. For `SocketContext`, that also lets `socket` become non-nullable inside the provider, removing the two `if (socket)` guards. Delete `context/InviteContext.tsx`.
- **Acceptance criteria:** All six live contexts use `createContext<T | null>(null)` and a throwing hook. `context/InviteContext.tsx` is gone. `npx jest` (which renders `NotificationBanner` and the settings surface) passes — if any native test renders a component outside its provider, that is the finding, not a regression.
- **Fix risk:** `app/_layout.tsx:80-96` mounts five of the six; `OnlineGameProvider` is mounted per-route-group at `app/(online)/_layout.tsx:21`. Any component that today renders above its provider and quietly gets defaults will start throwing — run `npx jest` and walk every screen once. The `SocketContext` non-null change touches `app/(online)/friends.tsx` and `app/(online)/room.tsx`.
- **Depends on:** None

---

## Over-engineering pass (ponytail lens)

Correctness and security are out of scope here; these are deletions only.

- `context/InviteContext.tsx:1-2: delete:` two-line re-export shim, imported by nothing. Nothing replaces it.
- `server/socket.ts:1266-1291 + socketSchemas.ts:44-46 + storage.ts:30,216-219 + OnlineGameContext.tsx:543-545 + locales/*.ts "server.CANNOT_CHANGE_MODE_IN_PROGRESS": delete:` the whole `room:set_game_mode` chain — no UI can emit it. Nothing replaces it.
- `server/socket.ts:832-839: delete:` `game:match_over` emit, no listener; `game:over` at `:820-830` already carries all four fields.
- `server/socket.ts:2224: delete:` `room:player_left` emit, no listener, and only one of the two leave paths sends it.
- `context/OnlineGameContext.tsx:443,465 + server/socket.ts:1372,1588: delete:` `game:started` — the client's listener is `() => {}` and navigation is driven by `room`/`gameState`.
- `context/OnlineGameContext.tsx:555-557: delete:` `requestPlayAgain`, zero consumers; `voteRematch` is the live path.
- `context/GameContext.tsx:184 + 8 setter calls + interface + memo: delete:` `lastRoundWinner` — eight write sites, zero readers.
- `server/ticket.ts:72-76: delete:` `pendingTicketNonces()`, described as a test helper, called by no test.
- `server/schemaDdl.ts:325-327: delete:` `generateSchemaDdl()`, "for callers that apply DDL in bulk" — there are none.
- `server/schemas.ts:21-23: delete:` `ExchangeCardSchema` validates `{cardIndex: number}`; the live event carries `{cardId: string}`.
- `lib/gameEngine.ts:892-894: delete:` `isRedSuit()`, zero references including in-file.
- `server/index.ts:8,11: delete:` `import { sessionMiddleware }` + its re-export from a process entry nothing can import.
- `lib/sharedGameFlow.ts:3-4: delete:` two exported duration constants with zero references; `ExchangeAnnouncement.tsx:34-35` defines its own.
- `server/storage.ts:8,18-51: yagni:` `IStorage`, 34 lines of interface with one implementation, one instance, and no external reference to the type. `class DrizzleStorage` alone; TypeScript already checks every call site.
- `shared/schema.ts:3-4,165-170: native:` `drizzle-zod` is a whole dependency imported once, to build a zod schema that is never used as a validator — only `z.infer`'d into a 2-field type. `type InsertUser = Pick<typeof users.$inferInsert, "username" | "password">`, 1 line, 0 deps. Registration is validated by `server/schemas.ts:3-9` `RegisterSchema` instead.
- `shared/schema.ts:74 + socket.ts:345,353,372 + onlineGameLogic.ts:31-35: delete:` `active_games.player_ids` is written as `Object.values(player_map)` and read only as a fallback to `player_map`. Derive it; drop the column and the fallback branch.
- `server/socket.ts:2025-2055: shrink:` `seatClaimMessage` and `seatClaimCode`, two 14-line switches over the same 4-member union. One `const SEAT_CLAIM: Record<Reason, {message: string; code: string}>` table, 6 lines.
- `server/socket.ts:2171-2187 ≡ :2207-2223: shrink:` seventeen identical lines of host migration in two functions. One function, one branch (ARCH-07).
- `server/replayShape.ts:25-28: shrink:` `startReplayLog()` returns `[]`. Inline `[]` at its two call sites (`socket.ts:1363,1582`).
- `components/ExchangeAnnouncement.tsx:24-29: shrink:` private `CARD_W`/`CARD_H` copies plus a comment that misstates where the originals live. `import { CARD_W, CARD_H } from "@/components/cardFaceModel";`, 1 line.
- `components/GameShared.tsx:129,173,610,1033,60: shrink:` `CardFan`, `AvatarCircle`, `CardItem`, `sharedStyles`, `FLY_OFFSETS` are `export`ed and used only in-file. Drop the keyword (or move them with ARCH-09).
- `context/OnlineGameContext.tsx:33,40,46,58: shrink:` `Reaction`, `RematchVoteState`, `OnlineMatchState`, `RematchIntentState` exported, used only in-file. Drop the keyword.

net: -190 lines possible.

(Excludes ARCH-04's and ARCH-09's splits, which move lines rather than remove them — those cut roughly 230 more once the `sharedStyles`/`GameShared` regroup lets the four StyleSheets shed their duplicated rules, but that is a rewrite estimate, not a deletion count.)

---

## Coverage gaps

1. **No unused-export tool was run.** `npx ts-prune` and `npx knip` both want to write a config file into the repo on first run, which the read-only rule forbids, so ARCH-14 was produced by a scripted grep (every `export const|function|class|interface|type|enum` symbol under `app/ components/ context/ lib/ server/ shared/`, cross-referenced against all source and test directories) and each hit was then verified individually by a targeted grep including the defining file. The method finds unreferenced *named* symbols; it would miss a symbol reachable only through `export *`, a dynamic `import()` string, or a name reconstructed at runtime. I found no `export *` and one dynamic import (`server/testApp.ts:234`, a literal path), so I believe the coverage is complete, but it is grep, not a resolver.
2. **`app/`, `locales/` and `scripts/` were read only where a finding led there.** My file list did not include `app/index.tsx` (676 L), `app/result.tsx` (692 L), `app/(online)/room.tsx` (977 L) or `scripts/build.js` (563 L). I checked `result.tsx` and `room.tsx` for specific claims (MenuLayout exemption, direct socket emits) and nothing more. There may be structural duplication inside `app/` I did not look for.
3. **`lib/gameEngine.ts` was outlined, not read line by line.** I read its section banners, its export list, `dealCards`, `sortHand` and the match-scoring section. A2 owns its correctness; my split proposal (Opinions, below) rests on the banner structure, not on having read all 1274 lines.
4. **No runtime observation.** I did not boot the server, run the app, or run the integration/e2e suites — no `DATABASE_URL` here, and Playwright writes into the repo. ARCH-01's failure path is read end to end in source but has not been watched happening; ARCH-11's dead-socket chain is explicitly marked as inferred with the confirming experiment named.
5. **CLAUDE.md claim count is a floor, not a census.** I checked 36 claims that were concretely falsifiable against source. CLAUDE.md contains more assertions than that (design-system taste rules, "reference design" claims, the graphify workflow), which are either unfalsifiable or would need a design judgement. 7 of the 36 are false; the true rate over the whole document could differ.
6. **`graphify` was not used.** `graphify-out/graph.json` exists but `graphify-out/wiki/` does not, and running `graphify update .` would write into the repo. Every fact here comes from reading source or from a grep run in this session.

## Opinions (non-findings)

- **`lib/gameEngine.ts` should probably stay one file.** The brief asked for a split proposal, so: the seams are already drawn by the file's own banners — `:1-385` cards/combinations, `:386-545` valid-play enumeration, `:546-724` AI, `:725-1086` state processing, `:1087-1226` match scoring, `:1227-1274` the rematch question — and the obvious cut is `lib/rules.ts` + `lib/gameAi.ts` at `:546`. **I do not think it earns its cost.** The usual justification would be a boundary (keep the AI out of the server, or out of a bundle), and there is none: `server/socket.ts:56` imports `aiChoosePlay` for `autoMoveForSeat`, so the server needs both halves, and the client is one bundle for both game modes. The file is well-sectioned, its rules are pinned by eight test files, and its churn is low (6 changes in 8 weeks — well below `socket.ts`'s 23). Splitting it would buy a shorter file and cost a rewrite of every import in `server/`. Leave it.
- **`OnlineGameContext`'s dependency arrays are inconsistent but not wrong.** Twelve `useCallback`s list `[userId]` while closing over `socket` (`context/OnlineGameContext.tsx:491,498,534,541,545,553,557,561,565,582,586,590,598`), and one — `spectateRoom` at `:505` — lists `[socket]`. Since `socket = getSocket(userId)` is derived from `userId`, both are correct; the inconsistency is cosmetic. I mention it only because the odd one out looks like the start of a fix that was not finished.
- **`server/onlineGameLogic.ts`, `server/replayShape.ts` and `server/pushShape.ts` are the best-designed files in the repo** and are the template the rest should follow: a pure half that `node --test` can load, split from a database half, with the reason stated in the header. ARCH-04's proposal is really just "do to `socket.ts` what was already done to `replays.ts`".
- **`components/gameTableModel.ts`'s 62-case test file is the strongest single piece of coverage here.** It is worth noting because ARCH-02 is a criticism of the invariant, not of that test — the test does exactly what it claims; the invariant claims more than the test does.

## Open questions for the human

1. **Should the host be able to change the game mode after creating a room?** The server implements it fully (`server/socket.ts:1266-1291`), the client has no UI for it, and the feature exists in three locales' error strings. ARCH-08 proposes deleting the whole chain. If it was meant to ship, the fix is the opposite — a control in `app/(online)/room.tsx` — and I would move this to BACKLOG §1 rather than delete.
2. **`docs/BRIEF.md` §2 — delete or stamp?** I recommend deleting it outright (git holds it, and §8 of the same document already demonstrates the "Resolved, kept as the record" pattern for a section worth preserving). Keeping it means keeping a defect list where every citation is wrong. Your call whether the historical record is worth a stamped block.
3. **Is the offline game a permanent mode or a bridge?** ARCH-13's cost is real and its benefit depends on the answer. If offline is permanent, one shared match-progression function is worth the refactor. If offline is expected to become "play against bots, online" (which the existing bot-fill in `room:start` already supports), the duplication resolves itself by deletion instead, and ARCH-13 should not be built.
