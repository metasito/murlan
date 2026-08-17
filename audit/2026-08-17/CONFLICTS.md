# CONFLICTS — contradictions resolved by the orchestrator

Ten specialists ran independently over the same tree. Where two of them proposed opposite
things, or where a finding contradicts something the repository asserts about itself, the
decision and its reasoning are recorded here. Every resolution below was made after opening
the cited file.

---

## C1 · A finding contradicts a *passing test* and a stated invariant — ARCH-02

**The contradiction.** `CLAUDE.md` §Invariants states:

> "**Layout constants** (`CARD_W`, `CARD_H`, `SIDE_BTN_W`, `TABLE_M`, `HAND_SECTION_H`) live
> once in `components/gameTableModel.ts` and are pinned by a test. There is no second copy."

`tests/gameTableModel.test.ts` passes. C1 filed ARCH-02 saying the constants live in four
places.

**Resolution: the finding wins. The invariant is false and the test cannot detect the thing
it is credited with detecting.** Verified by grep and by reading each file:

| Location | Defines |
|---|---|
| `components/cardFaceModel.ts:11-12` | `CARD_W = 58`, `CARD_H = 84` — **exported**; this is the real source, and what `CardView.tsx` imports |
| `components/handLayout.ts:10` | `CARD_W = 58` |
| `components/gameTableModel.ts:20` | `CARD_H = 84` — and **`CARD_W` is not in this file at all** |
| `components/ExchangeAnnouncement.tsx:28-29` | `CARD_W = 58`, `CARD_H = 84` as bare literals |

Three compounding facts:

1. `gameTableModel.ts:14-18` carries a comment asserting the constants "are defined here …
   so tests/gameTableModel.test.ts can pin their values". `CARD_W` is not defined there.
2. `tests/gameTableModel.test.ts:7` reads
   `import { CARD_W } from "../components/handLayout.ts";` — the test reaches into the second
   copy to get the constant, then asserts it equals 58 at `:47`.
3. **The test's shape cannot detect duplication.** It asserts each constant equals a literal.
   Every duplicate is also 58 / 84, so every duplicate passes. A test credited with
   guaranteeing single-sourcing is blind to a second copy by construction.

**Therefore the fix has three parts, and shipping only the first is worse than nothing:**
delete the duplicates and re-export from one module; **change the test's shape** so it
asserts the modules resolve to one source (or source-scan for a second definition, the way
`tests/tokenRoles.test.ts` scans); and correct the invariant's wording in `CLAUDE.md`.

**Merged into ARCH-02:** UI-08 (`WEB_TOP_PAD` / `WEB_BOTTOM_PAD` re-typed as bare `67` / `34`
in five files) is the same root cause on different constants and shares the fix surface.

---

## C2 · Severity rubric has no category for account takeover — RES-02 upgraded to Critical

**The contradiction.** A4 filed RES-02 (session cookie written to the production log on every
request) as **High**. The brief's severity definitions are:

> **Critical** — exploitable cheat, data loss, or the game becomes unplayable/unwinnable

Account takeover is none of those three, so by a literal reading A4 graded it correctly.

**Resolution: the rubric is incomplete, not the finding. Upgraded to Critical.** The
definitions were written for game defects and have no security category; applying them
literally would rank "a stranger can log in as any player who made a request" below "a player
can re-deal a hand". That is the wrong ordering for the implementer.

**Confirmed by execution**, not by reading. `server/logger.ts` sets no `redact` and no
`serializers` (grepped: zero hits) and `server/testApp.ts:200-205` mounts `pinoHttp` with
defaults. Running the repo's own installed pino-http 11.0.0 under that exact config:

```
"req":{"headers":{"cookie":"murlan.sid=s%3ASECRET-SESSION-VALUE.abc123",
                  "authorization":"Bearer TOKEN123","host":"murlan.example"}}
session cookie in log?  YES — LEAKED
```

Session cookies are `httpOnly` with a 30-day `maxAge` (`server/session.ts:20`). Anyone with
log-read access replays one and holds the account for a month, no password involved. Fix is
one `redact` list — effort S, the cheapest Critical in the audit.

**Note for future audits of this repo:** the severity rubric should gain a security row.
Recorded in SUMMARY.md's open questions.

---

## C3 · SEC-02 upgraded to Critical, against its author's own grade

**The contradiction.** A1 filed SEC-02 (a player who quits mid-hand is never scored) as
**High** — but the same report's mandatory *"The cheapest cheat"* section opens with
"**Quit.** That is the whole exploit" and names SEC-02 as "the finding to fix first".

**Resolution: Critical.** The rubric's first Critical clause is *"exploitable cheat"*, and
this is the cheapest exploit in the repository: it needs no modified client, no DevTools and
no protocol knowledge — closing the browser tab is the entire attack. Verified at
`server/socket.ts:679-691`: when `remaining <= 1`, `vacateSeat` emits the abandonment notice,
sets the room `finished` and calls `disposeGame` **without ever calling `handleGameOver`**.
Heads-up, the quitter escapes the loss *and* the winner is denied the win. Four-handed, the
quitter's seat scores under `bot:<seat>`, which `server/stats.ts:61` and
`server/ratings.ts:84` both filter out.

A ladder rating that can only ever increase is a broken ladder, and
`GET /api/ratings/leaderboard` publishes exactly that number.

---

## C4 · UI-01 downgraded to Medium, against its author's grade

**The contradiction.** B2 filed UI-01 (`SettingsModal` has no `ScrollView` and no `maxHeight`,
so ~677pt of content is unreachable on a landscape phone) as **High**, framing it as "on any
phone in landscape".

**Resolution: Medium.** The code claim is correct — verified, the file is 499 lines with zero
hits for `ScrollView` or `maxHeight`, and it declares
`supportedOrientations={["portrait", "landscape"]}` at `:200`. But B2's framing omitted a fact
that changes the grade: **the modal mounts from exactly one place**, `app/index.tsx:393` and
`:458` — the title screen. Grepping all of `app/` and `components/` finds no other mount site.
It is not reachable from the game table.

So the rubric's High ("players get stuck, or a broken core flow") does not apply: settings is
not a core flow, and rotating to portrait recovers every control. Medium ("degraded
experience, real but recoverable") is the honest grade.

It remains a genuine finding and the path is realistic rather than theoretical — the game
table is landscape-locked, so a player returning to the title screen is *likely* still holding
the phone sideways, and the unreachable controls include language selection and
delete-account.

---

## C5 · Two events one letter apart, one to keep and one to delete — NET-01 vs ARCH-08

**The hazard.** These two findings touch similarly-named events and a careless implementer
will delete the wrong one:

- **`game:player_left`** — emitted by `vacateSeat` at `server/socket.ts:667` and `:681`.
  **KEEP.** NET-01's fix routes the results-screen leave path through `vacateSeat`, which
  makes this event fire in a new situation.
- **`room:player_left`** — emitted only by `handleLeaveRoom_lobby` at `server/socket.ts:2224`.
  **DELETE.** No client listens for it, and the `room:state` broadcast two lines earlier has
  already corrected the roster.

**Resolution: they are different events with opposite dispositions, and NET-01 must land
before ARCH-08.** Recorded as an explicit ordering constraint in BACKLOG.md and called out
again in IMPLEMENTATION-PLAN.md.

There is a live interaction beyond the naming: NET-01's own Fix-risk field notes that
`game:player_left` drives the client's blocking "Partita interrotta" teardown
(`context/OnlineGameContext.tsx:368`, `app/(online)/game.tsx:137-154`). Wiring `vacateSeat`
into the game-over path will therefore fire that alert when a player leaves *between*
manches, which is not what the remaining players should see — they should see an updated vote
tally. **The fix must adjust the emit at `:667`, not the client.**

---

## C6 · The same defect filed by two specialists from opposite directions — RULE-01 / NET-02

**Not a contradiction — a corroboration, recorded because the merge is not obvious from
either report alone.** A2 (rules) and A3 (netcode) independently landed on
`server/socket.ts:1548-1583`. Merged into **RULE-01**, crediting both.

The merged consequence, verified line by line:

- `:1550` rebuilds the roster from `storage.getRoomPlayers(roomId)` — a table holding **only
  humans**; bot seats were never rows.
- `:1551` `if (players.length < 2) return;` — the **default online solo flow** (1 human +
  `fillWithBots`, which `room:start:1311` explicitly permits) can never deal manche 2. Votes
  were already cleared at `:1546`, so the vote cannot even be retried. No error is emitted.
- `:1554-1557` hardcodes `type: "human"` — a bot-filled 4-seat table silently becomes 2-seat
  mid-match, changing the points scale from 3/2/1/0 to 1/0.
- `:1570-1572` keys `playerMap` by array position, not `seatIndex` — seats renumber.
  `room:start:1325-1330` carries a comment explaining it deliberately avoids exactly this.

A2 additionally executed the engine half: manche 1 seated `[Alice, Bob, Luan(ai), Drita(ai)]`
and the rematch produced **2 seats** with `exchangePhase.winnerIdx = 0` — Alice, who actually
placed **3rd**.

**Two handlers build the same structure by two different rules.** That is the finding, and it
is why ARCH-04 (split `socket.ts` so this is testable) sits behind it in the same programme.

---

## C7 · Other merges made, with no disagreement to resolve

Recorded for traceability; none of these involved a contradiction.

| Merged | Into | Reason |
|---|---|---|
| NET-02 | **RULE-01** | C6 above |
| ARCH-05 | **NET-07** | Identical finding — `game:rejoin_failed` discards `code`/`reason`; NET-07 carries the five-reason table |
| NET-10 | **ARCH-08** | ARCH-08 is a superset (four dead surfaces incl. both of NET-10's events) |
| UI-05, A11Y-11 | **UX-12** | Three specialists found the same hardcoded-Italian overlay at `components/GameTable.tsx:1189-1199`; UX-12 has the broadest scope (5 locations) |
| UI-08 | **ARCH-02** | C1 above — same root cause, different constants |
| TEST-12 | **SEC-06** | Both are the `drizzle-orm` advisory + `docs/BACKLOG.md` O9; SEC-06 carries the full package-by-package reachability table, TEST-12 carries the upgrade plan |

**120 findings filed → 7 merged away → 113 surviving.**

---

## C8 · A cross-agent corroboration worth preserving

C2 filed TEST-07 ("`tests/reducedMotion.test.ts` is a no-op for all 13 animating files / 118
call sites") and TEST-08 ("the three other source-scanning tests miss 11 lint-clean forms") as
*theoretical* blind spots — it argued the scanners could miss violations.

B4 independently filed **A11Y-10**: three real `entering=` / `exiting=` animations
(`components/GameTable.tsx:336-338`, `components/GameOverOverlay.tsx:205-207`,
`components/GameShared.tsx:556-560`) that ignore the motion preference — and
`tests/reducedMotion.test.ts` passes.

**The blind spot is not theoretical. It is already hiding three live defects.** Neither agent
knew about the other's finding. This materially raises the priority of TEST-07/TEST-08: they
are not tidying, they are the reason A11Y-10 shipped. Both are batched together.

The same pattern appears once more: `tests/orientation.test.ts` pins that every `<Modal>`
declares `supportedOrientations`, and A11Y-02 found that `ExchangeModal`, `GameOverOverlay`
and `ResultExchangeOverlay` **are not `<Modal>`s at all** (grepped: no `<Modal>`, no
`accessibilityViewIsModal`, no `aria-modal` in any of the three) — so the scanner never looks
at them.
