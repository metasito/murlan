# Match Replay (Q17) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a player step back through any online hand they took part in, seeing every
card that was played, from a control on their profile.

**Architecture:** The server keeps an in-memory move log per live hand and writes it once,
at game over, to a new `match_replays` table. A pure reducer folds that log into a
`GameState` for any move index; the replay screen feeds it to the existing `GameTable` in
the `spectating` mode Q18 already added, so no new table rendering exists.

**Tech Stack:** Drizzle ORM + Postgres, Express, Socket.io (read only — no new events),
Expo Router, React Native, `node --test`.

**Spec:** `docs/superpowers/specs/2026-08-16-murlan-features-design.md` §4

## Global Constraints

- Replit must keep working: no new build step, no change to how the server starts.
- Storage order of preference: derive → existing jsonb → **new table** → new column.
  A new column on a hot table is forbidden; this feature uses a new table, whose write
  is wrapped so its failure cannot fail a game.
- Every user-facing string goes through `t()` with keys in `it`, `en` and `sq`.
  Italian is the source of truth for `TranslationKey`.
- No hardcoded colours, spacing, radii, font sizes or timings — `lib/theme.ts` only.
- No new runtime dependency.
- Server authority: nothing a client sends decides what a replay contains.
- Listener registration precedes every `await` in the socket connection handler
  (this plan adds no socket listeners, so it must not move any either).
- `npm run verify` (typecheck + `node --test` + jest) and `npm run lint` must pass
  before every commit.

### Decisions that differ from the spec, and why

- **The live log is not persisted.** The spec put `moveLog` in the `game_state`
  envelope beside `handFlags` so a restart could not lose it. That envelope is
  rewritten after *every move*; a few hundred `Card` objects per hand would be
  re-serialised on each write for the sole benefit of surviving a restart that
  happens mid-hand — a hand which has no replay yet anyway. The log lives in
  memory, like `spectators`. A restart mid-hand costs that hand's replay and
  nothing else, and the write is skipped rather than writing a truncated log.
- **A replay is one manche, not one match.** `handleGameOver` and therefore
  `match_history` already run per hand, so this is the unit the profile already
  lists and the unit a player asks to see again.
- **No `startCounts` field.** Every move carries the hand counts *after* it, and
  the opening position is `move[0].handCounts` with move 0's cards added back to
  its own seat. The reducer derives it; the row does not store it.
- **Replays are their own list, not a link from a match-history row.** Linking
  would need a new column on `match_history` (forbidden) or a fragile
  timestamp join. A replay row instead carries `player_ids`, and the profile
  gets its own replays card.
- **Retention is by age, not per user.** A replay row belongs to up to four
  users, so "keep each user's newest N" cannot delete a row without checking
  the other three. `REPLAY_RETENTION_DAYS = 14` is one indexed statement and
  bounds the table by games-per-day, not by users.

---

## File Structure

| File | Responsibility |
|---|---|
| `shared/schema.ts` | The `match_replays` table and its `Replay` / `NewReplay` types |
| `lib/replay.ts` | Pure: the `ReplayMove` / `ReplaySeat` / `ReplayDto` shapes and the fold of a move log into a `GameState`. No react-native import, so `node --test` and the server load it directly |
| `server/replays.ts` | Storage: write, list-for-user, read-one, prune. Owns `REPLAY_RETENTION_DAYS` |
| `server/socket.ts` | Accumulate the log (`logMove`), write it at game over |
| `server/routes.ts` | `GET /api/replays`, `GET /api/replays/:id` |
| `app/(online)/replay.tsx` | The playback screen: `GameTable` + transport controls |
| `app/(online)/profile.tsx` | The replays card that opens one |
| `locales/{it,en,sq}.ts` | `replay.*` keys |
| `tests/replay.test.ts` | The reducer and the log's shape |

---

## Task 1: The move log's shared types and the pure reducer

**Files:**
- Create: `lib/replay.ts`
- Test: `tests/replay.test.ts`

**Interfaces:**
- Consumes: `Card`, `Combination`, `GameState`, `GameMode`, `Player` from `lib/gameEngine.ts`
- Produces:
  ```ts
  // shared/replayTypes.ts
  export interface ReplaySeat { seatIndex: number; userId: string | null; name: string }
  export interface ReplayMove {
    seat: number;
    /** The combination played, or null for a pass. */
    combo: Combination | null;
    /** Cards left in every seat's hand immediately after this move. */
    handCounts: number[];
  }
  export interface ReplayDto {
    id: string;
    finishedAt: string;
    gameMode: GameMode;
    seats: ReplaySeat[];
    moves: ReplayMove[];
    rankings: string[];
  }
  export const MAX_REPLAY_MOVES = 1000;

  // lib/replay.ts
  export function replayStateAt(replay: ReplayDto, index: number): GameState;
  export function replayMoveCount(replay: ReplayDto): number;
  ```
  `index` is `-1` for the opening position and `0…moves.length-1` for the state
  immediately after that move.

- [ ] **Step 1: Write the failing test**

```ts
// tests/replay.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { replayStateAt, replayMoveCount } from "../lib/replay.ts";
import { buildCombination } from "../lib/gameEngine.ts";
import { c } from "./helpers.ts";
import type { ReplayDto } from "../lib/replay.ts";

const single = (rank: Parameters<typeof c>[0], suit: Parameters<typeof c>[1]) =>
  buildCombination([c(rank, suit)])!;

const REPLAY: ReplayDto = {
  id: "r1",
  finishedAt: "2026-08-16T10:00:00.000Z",
  gameMode: "free_for_all",
  seats: [
    { seatIndex: 0, userId: "u1", name: "Ana" },
    { seatIndex: 1, userId: null, name: "Gent" },
  ],
  rankings: ["player_0", "player_1"],
  moves: [
    { seat: 0, combo: single("3", "spades"), handCounts: [2, 3] },
    { seat: 1, combo: single("5", "hearts"), handCounts: [2, 2] },
    { seat: 0, combo: null, handCounts: [2, 2] },
  ],
};

test("the opening position adds the first move's cards back to its own seat", () => {
  const state = replayStateAt(REPLAY, -1);
  assert.deepEqual(state.players.map((p) => (p as { handCount: number }).handCount), [3, 3]);
  assert.equal(state.lastPlayedCombination, null);
  assert.equal(state.currentTurnIndex, 0);
  assert.equal(state.gameOver, false);
});

test("a state carries the pile and the counts of the move it names", () => {
  const state = replayStateAt(REPLAY, 0);
  assert.deepEqual(state.lastPlayedCombination?.cards.map((x) => x.id), ["3_spades"]);
  assert.equal(state.lastPlayedBy, 0);
  assert.deepEqual(state.players.map((p) => (p as { handCount: number }).handCount), [2, 3]);
  assert.equal(state.currentTurnIndex, 1, "the turn shows whoever moved next");
});

test("a pass leaves the pile alone and counts nothing off the hand", () => {
  const state = replayStateAt(REPLAY, 2);
  assert.deepEqual(state.lastPlayedCombination?.cards.map((x) => x.id), ["5_hearts"]);
  assert.equal(state.lastPlayedBy, 1);
  assert.deepEqual(state.players.map((p) => (p as { handCount: number }).handCount), [2, 2]);
});

test("the last index is the finished hand", () => {
  const state = replayStateAt(REPLAY, replayMoveCount(REPLAY) - 1);
  assert.equal(state.gameOver, true);
  assert.deepEqual(state.rankings, ["player_0", "player_1"]);
});

test("an index outside the log is clamped, never thrown", () => {
  assert.equal(replayStateAt(REPLAY, -99).lastPlayedCombination, null);
  assert.equal(replayStateAt(REPLAY, 99).gameOver, true);
});

test("every hand is empty — a replay never reveals what anyone held", () => {
  for (let i = -1; i < replayMoveCount(REPLAY); i++) {
    for (const p of replayStateAt(REPLAY, i).players) assert.deepEqual(p.hand, []);
  }
});

test("an empty log still renders an opening position", () => {
  const empty: ReplayDto = { ...REPLAY, moves: [] };
  const state = replayStateAt(empty, -1);
  assert.equal(state.players.length, 2);
  assert.equal(replayMoveCount(empty), 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/replay.test.ts`
Expected: FAIL — `Cannot find module '../lib/replay.ts'`

- [ ] **Step 3: Write the shapes and the reducer in `lib/replay.ts`**

```ts
// The wire and storage shape of a replay. Shared by server/replays.ts,
// server/socket.ts and the client, so the three cannot drift.
import type { Combination, GameMode } from "../lib/gameEngine.ts";

export interface ReplaySeat {
  seatIndex: number;
  /** null for a bot seat. */
  userId: string | null;
  name: string;
}

export interface ReplayMove {
  seat: number;
  /** The combination played, or null for a pass. */
  combo: Combination | null;
  /** Cards left in every seat's hand immediately after this move. */
  handCounts: number[];
}

export interface ReplayDto {
  id: string;
  finishedAt: string;
  gameMode: GameMode;
  seats: ReplaySeat[];
  moves: ReplayMove[];
  /** Engine player ids in finishing order, as the hand ended. */
  rankings: string[];
}

/**
 * A hand cannot legally exceed a few hundred moves — 54 cards, and a round of
 * passes ends the round. The cap is a server-memory bound against a hand that
 * loops, not a game rule: past it the log stops growing and no replay is written.
 */
export const MAX_REPLAY_MOVES = 1000;
```

- [ ] **Step 4: Write lib/replay.ts**

```ts
// Folds a stored move log back into the GameState the table renders.
//
// Pure and hand-free: a replay shows what was *played*, never what anyone
// held, so every player's `hand` stays empty and the table draws from
// `handCount` exactly as it does for a spectator.
import type { GameState, Player } from "./gameEngine.ts";
import type { ReplayDto } from "../lib/replay.ts";

/** Table seats carry a count instead of a hand, the same shape the server sanitises to. */
type ReplayPlayer = Player & { handCount: number };

export function replayMoveCount(replay: ReplayDto): number {
  return replay.moves.length;
}

/** Hand sizes before any move: the first move's counts, with its own cards back. */
function openingCounts(replay: ReplayDto): number[] {
  const seats = replay.seats.length;
  const first = replay.moves[0];
  if (!first) return Array.from({ length: seats }, () => 0);
  const counts = [...first.handCounts];
  counts[first.seat] += first.combo?.cards.length ?? 0;
  return counts;
}

/**
 * The table state after move `index`. `-1` is the opening position; anything
 * outside the log is clamped to one of the two ends rather than throwing,
 * because the scrubber is a user input.
 */
export function replayStateAt(replay: ReplayDto, index: number): GameState {
  const last = replay.moves.length - 1;
  const at = Math.max(-1, Math.min(index, last));

  const counts = at < 0 ? openingCounts(replay) : replay.moves[at].handCounts;

  // The pile is the newest play at or before `at`; a pass leaves it standing.
  let pile: GameState["lastPlayedCombination"] = null;
  let pileSeat = -1;
  for (let i = 0; i <= at; i++) {
    const move = replay.moves[i];
    if (move.combo) {
      pile = move.combo;
      pileSeat = move.seat;
    }
  }

  const finished = at === last && last >= 0;
  const players: ReplayPlayer[] = replay.seats.map((seat, i) => ({
    id: `player_${seat.seatIndex}`,
    name: seat.name,
    hand: [],
    handCount: counts[i] ?? 0,
    type: "human",
  }));

  return {
    players,
    // Who moved next, so the table highlights the seat about to act.
    currentTurnIndex: replay.moves[at + 1]?.seat ?? replay.moves[at]?.seat ?? 0,
    lastPlayedCombination: pile,
    lastPlayedBy: pileSeat,
    passCount: 0,
    gameMode: replay.gameMode,
    roundWinner: null,
    gameOver: finished,
    rankings: finished ? replay.rankings : [],
    firstPlayMade: at >= 0,
  };
}
```

- [ ] **Step 5: Run the tests**

Run: `node --test tests/replay.test.ts`
Expected: PASS, 7 tests

- [ ] **Step 6: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: no output from either

- [ ] **Step 7: Commit**

```bash
git add lib/replay.ts tests/replay.test.ts
git commit -m "Fold a stored move log back into a table state"
```

---

## Task 2: The `match_replays` table and its storage layer

**Files:**
- Modify: `shared/schema.ts` (append after `userAchievements`)
- Create: `server/replays.ts`
- Test: `tests/replayStorage.test.ts`

**Interfaces:**
- Consumes: `ReplayDto`, `ReplayMove`, `ReplaySeat` from Task 1; `db` from `server/db.ts`
- Produces:
  ```ts
  export const REPLAY_RETENTION_DAYS = 14;
  export const MAX_REPLAYS_LISTED = 20;
  export function saveReplay(input: {
    roomCode: string; gameMode: GameMode; seats: ReplaySeat[];
    moves: ReplayMove[]; rankings: string[];
  }): Promise<void>;
  export function listReplaysForUser(userId: string): Promise<ReplaySummary[]>;
  export function getReplayForUser(id: string, userId: string): Promise<ReplayDto | null>;
  export interface ReplaySummary {
    id: string; finishedAt: string; gameMode: GameMode;
    playerCount: number; moveCount: number; seats: ReplaySeat[];
  }
  ```

- [ ] **Step 1: Add the table to `shared/schema.ts`**

```ts
// One finished manche, replayable by anyone who sat at it. Its own table, not
// a column on match_history: a write to a missing table fails alone, and a
// replay belongs to the table rather than to any one player's history row.
export const matchReplays = pgTable("match_replays", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  roomCode: text("room_code").notNull(),
  finishedAt: timestamp("finished_at").defaultNow().notNull(),
  gameMode: text("game_mode").notNull(),
  // Seated userIds, bots excluded — the containment index a player's own
  // list is read through.
  playerIds: jsonb("player_ids").notNull().default([]),
  seats: jsonb("seats").notNull().default([]),
  moves: jsonb("moves").notNull().default([]),
  rankings: jsonb("rankings").notNull().default([]),
}, (t) => [index("match_replays_finished_idx").on(t.finishedAt)]);
```

- [ ] **Step 2: Write the failing test**

```ts
// tests/replayStorage.test.ts — the pure shaping around the storage layer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { replaySeatsOf, replayPlayerIdsOf } from "../server/replayShape.ts";

const SEATS = [
  { seatIndex: 0, userId: "u1", name: "Ana" },
  { seatIndex: 1, userId: null, name: "Gent" },
  { seatIndex: 2, userId: "u2", name: "Drita" },
];

test("player ids exclude bot seats", () => {
  assert.deepEqual(replayPlayerIdsOf(SEATS), ["u1", "u2"]);
});

test("seats are derived from the engine state and the player map", () => {
  const seats = replaySeatsOf(
    [{ name: "Ana" }, { name: "Gent" }],
    { 0: "u1" }
  );
  assert.deepEqual(seats, [
    { seatIndex: 0, userId: "u1", name: "Ana" },
    { seatIndex: 1, userId: null, name: "Gent" },
  ]);
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `node --test tests/replayStorage.test.ts`
Expected: FAIL — `Cannot find module '../server/replayShape.ts'`

- [ ] **Step 4: Write `server/replayShape.ts`**

Pure, so `node --test` can load it without pulling in `server/db.ts`
(the same reason `server/onlineGameLogic.ts` exists).

```ts
// Pure shaping for a replay row. Separate from server/replays.ts so the plain
// `node --test` runner can load it without db/session/storage coming with it.
import type { ReplaySeat } from "../lib/replay.ts";

/** Seat list for a replay row: every seat, with its user id or null for a bot. */
export function replaySeatsOf(
  players: { name: string }[],
  playerMap: Record<number, string>
): ReplaySeat[] {
  return players.map((p, seatIndex) => ({
    seatIndex,
    userId: playerMap[seatIndex] ?? null,
    name: p.name,
  }));
}

/** The human seats, which are who may read the replay back. */
export function replayPlayerIdsOf(seats: ReplaySeat[]): string[] {
  return seats.map((s) => s.userId).filter((id): id is string => id !== null);
}
```

- [ ] **Step 5: Run the test**

Run: `node --test tests/replayStorage.test.ts`
Expected: PASS, 2 tests

- [ ] **Step 6: Write `server/replays.ts`**

```ts
import { and, desc, lt, sql } from "drizzle-orm";
import { db } from "./db.ts";
import { matchReplays } from "../shared/schema.ts";
import { replayPlayerIdsOf } from "./replayShape.ts";
import type { ReplayDto, ReplayMove, ReplaySeat } from "../lib/replay.ts";
import type { GameMode } from "../lib/gameEngine.ts";

/**
 * A replay belongs to up to four players, so "keep each player's newest N"
 * cannot delete a row without consulting the other three. Age bounds the
 * table by games-per-day instead, in one indexed statement.
 */
export const REPLAY_RETENTION_DAYS = 14;
export const MAX_REPLAYS_LISTED = 20;

export interface ReplaySummary {
  id: string;
  finishedAt: string;
  gameMode: GameMode;
  playerCount: number;
  moveCount: number;
  seats: ReplaySeat[];
}

export async function saveReplay(input: {
  roomCode: string;
  gameMode: GameMode;
  seats: ReplaySeat[];
  moves: ReplayMove[];
  rankings: string[];
}): Promise<void> {
  const playerIds = replayPlayerIdsOf(input.seats);
  if (playerIds.length === 0) return; // nobody can ever read it back

  await db.transaction(async (tx) => {
    await tx.insert(matchReplays).values({
      roomCode: input.roomCode,
      gameMode: input.gameMode,
      playerIds,
      seats: input.seats,
      moves: input.moves,
      rankings: input.rankings,
    });
    // Prune inside the insert's transaction, the way match_history does, so
    // the table cannot grow without bound if the prune is ever skipped.
    await tx
      .delete(matchReplays)
      .where(lt(matchReplays.finishedAt,
        sql`now() - ${`${REPLAY_RETENTION_DAYS} days`}::interval`));
  });
}

const ownedBy = (userId: string) =>
  sql`${matchReplays.playerIds} @> ${JSON.stringify([userId])}::jsonb`;

export async function listReplaysForUser(userId: string): Promise<ReplaySummary[]> {
  const rows = await db
    .select()
    .from(matchReplays)
    .where(ownedBy(userId))
    .orderBy(desc(matchReplays.finishedAt))
    .limit(MAX_REPLAYS_LISTED);

  return rows.map((r) => ({
    id: r.id,
    finishedAt: r.finishedAt.toISOString(),
    gameMode: r.gameMode as GameMode,
    seats: r.seats as ReplaySeat[],
    playerCount: (r.seats as ReplaySeat[]).length,
    moveCount: (r.moves as ReplayMove[]).length,
  }));
}

/** Only a player who sat at the table may read the log back. */
export async function getReplayForUser(
  id: string,
  userId: string
): Promise<ReplayDto | null> {
  const [row] = await db
    .select()
    .from(matchReplays)
    .where(and(sql`${matchReplays.id} = ${id}`, ownedBy(userId)))
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    finishedAt: row.finishedAt.toISOString(),
    gameMode: row.gameMode as GameMode,
    seats: row.seats as ReplaySeat[],
    moves: row.moves as ReplayMove[],
    rankings: row.rankings as string[],
  };
}
```

- [ ] **Step 7: Typecheck, test, lint**

Run: `npm run verify && npm run lint`
Expected: all pass

- [ ] **Step 8: Commit**

```bash
git add shared/schema.ts server/replays.ts server/replayShape.ts tests/replayStorage.test.ts
git commit -m "Store a finished hand's move log in its own table"
```

---

## Task 3: Accumulate the log and write it at game over

**Files:**
- Modify: `server/socket.ts` — `OnlineGameState` (~line 87), `autoMoveForSeat` (~425),
  the `game:play` handler (~1354), the `game:pass` handler (~1396),
  `handleGameOver` (~794), `room:start` (~1251)
- Test: `tests/replayLog.test.ts`

**Interfaces:**
- Consumes: `ReplayMove`, `MAX_REPLAY_MOVES` from Task 1; `saveReplay`, `replaySeatsOf` from Task 2
- Produces: `OnlineGameState.moveLog: ReplayMove[] | null` — `null` means this hand's
  log is unusable (a restart rehydrated it, or the cap was hit) and no replay is written

- [ ] **Step 1: Write the failing test**

```ts
// tests/replayLog.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { appendReplayMove, startReplayLog } from "../server/replayShape.ts";
import { buildCombination } from "../lib/gameEngine.ts";
import { c } from "./helpers.ts";
import { MAX_REPLAY_MOVES } from "../lib/replay.ts";

const state = (counts: number[]) => ({ players: counts.map((n) => ({ hand: Array(n).fill(0) })) });

test("a play records its combination and the counts that followed", () => {
  const game = { moveLog: startReplayLog() };
  appendReplayMove(game, 0, buildCombination([c("3", "spades")])!, state([12, 13]) as never);
  assert.equal(game.moveLog!.length, 1);
  assert.deepEqual(game.moveLog![0].handCounts, [12, 13]);
  assert.equal(game.moveLog![0].seat, 0);
});

test("a pass records a null combination", () => {
  const game = { moveLog: startReplayLog() };
  appendReplayMove(game, 1, null, state([12, 13]) as never);
  assert.equal(game.moveLog![0].combo, null);
});

test("a log past the cap is abandoned rather than grown", () => {
  const game = { moveLog: startReplayLog() };
  for (let i = 0; i <= MAX_REPLAY_MOVES; i++) {
    appendReplayMove(game, 0, null, state([1, 1]) as never);
  }
  assert.equal(game.moveLog, null, "the log is dropped, not truncated silently");
});

test("appending to an abandoned log is a no-op", () => {
  const game: { moveLog: null } = { moveLog: null };
  appendReplayMove(game, 0, null, state([1, 1]) as never);
  assert.equal(game.moveLog, null);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/replayLog.test.ts`
Expected: FAIL — `appendReplayMove is not a function`

- [ ] **Step 3: Add the two helpers to `server/replayShape.ts`**

```ts
import { MAX_REPLAY_MOVES } from "../lib/replay.ts";
import type { Combination, GameState } from "../lib/gameEngine.ts";
import type { ReplayMove } from "../lib/replay.ts";

/** A fresh log for a hand about to be dealt. */
export function startReplayLog(): ReplayMove[] {
  return [];
}

/**
 * Records one move against the log, if the hand still has one. `null` means
 * the log was abandoned — a rehydrated hand, or one past MAX_REPLAY_MOVES —
 * and no replay will be written for it.
 */
export function appendReplayMove(
  game: { moveLog: ReplayMove[] | null },
  seat: number,
  combo: Combination | null,
  next: GameState
): void {
  if (!game.moveLog) return;
  if (game.moveLog.length >= MAX_REPLAY_MOVES) {
    game.moveLog = null;
    return;
  }
  game.moveLog.push({
    seat,
    combo,
    handCounts: next.players.map((p) => p.hand.length),
  });
}
```

- [ ] **Step 4: Run the test**

Run: `node --test tests/replayLog.test.ts`
Expected: PASS, 4 tests

- [ ] **Step 5: Wire it into `server/socket.ts`**

Add to the `OnlineGameState` interface, beside `handFlags`:

```ts
  /**
   * This hand's move log, or null when it cannot produce a replay — a hand
   * rehydrated from storage after a restart never has one, because the log is
   * memory-only by design (see docs/superpowers/plans/2026-08-16-murlan-replay.md).
   */
  moveLog: ReplayMove[] | null;
```

Set it where a hand is dealt. In the `room:start` handler's `newGame` literal, beside
`handFlags: {}`, add `moveLog: startReplayLog(),`. Anywhere an `OnlineGameState` is
built for a rehydrated row or as a throwaway (the two `as OnlineGameState` casts near
lines 164 and 175), use `moveLog: null`.

At each of the four points where `game.gameState` advances, record the move
*after* the next state exists:

- `autoMoveForSeat` — after `processPlay(state, combo)` and after `processPass(state)`
  and after the forced-minimum-play, record `appendReplayMove(game, seat, combo, next)`
  (`combo` is `null` for the pass).
- the `game:play` handler — after `const newState = processPlay(gameState, combo)`:
  `appendReplayMove(game, currentIdx, combo, newState);`
- the `game:pass` handler — capture the next state in a local first:
  ```ts
  const newState = processPass(gameState);
  appendReplayMove(game, currentIdx, null, newState);
  game.gameState = newState;
  ```

At the end of `handleGameOver`, inside the existing `try` that already guards the
stats block (so a replay write can no more fail a game than a stats write can),
after the `isContestedTable` branch:

```ts
    // A replay is written for any table with a human seat, including
    // bot-majority ones: it records what happened, it does not award anything.
    if (game.moveLog && game.moveLog.length > 0) {
      const seats = replaySeatsOf(state.players, game.playerMap);
      saveReplay({
        roomCode: roomId,
        gameMode: game.gameMode,
        seats,
        moves: game.moveLog,
        rankings: state.rankings,
      }).catch((err) => logger.error({ err, roomId }, "Failed to save replay"));
    }
    game.moveLog = startReplayLog();
```

- [ ] **Step 6: Verify**

Run: `npm run verify && npm run lint`
Expected: all pass

- [ ] **Step 7: Commit**

```bash
git add server/socket.ts server/replayShape.ts tests/replayLog.test.ts
git commit -m "Record every move of a hand, and keep the finished log"
```

---

## Task 4: The two read endpoints

**Files:**
- Modify: `server/routes.ts` — after the `/api/stats/history` route

**Interfaces:**
- Consumes: `listReplaysForUser`, `getReplayForUser` from Task 2
- Produces: `GET /api/replays` → `ReplaySummary[]`; `GET /api/replays/:id` → `ReplayDto` or 404

- [ ] **Step 1: Add the routes**

```ts
  // ── Replays ───────────────────────────────────────────────────────────────
  //
  // Both are scoped to the caller's own seats: `getReplayForUser` filters on
  // player_ids, so an id guessed from another table returns 404 rather than a
  // stranger's game.
  app.get("/api/replays", requireAuth, async (req, res) => {
    res.json(await listReplaysForUser(req.session.userId!));
  });

  app.get("/api/replays/:id", requireAuth, async (req, res) => {
    const replay = await getReplayForUser(req.params.id, req.session.userId!);
    if (!replay) {
      res.status(404).json({ message: "Replay non trovato", code: "REPLAY_NOT_FOUND" });
      return;
    }
    res.json(replay);
  });
```

- [ ] **Step 2: Verify**

Run: `npm run verify && npm run lint`
Expected: all pass

- [ ] **Step 3: Commit**

```bash
git add server/routes.ts
git commit -m "Serve a player their own replays"
```

---

## Task 5: The replay screen and the way in

**Files:**
- Create: `app/(online)/replay.tsx`
- Modify: `app/(online)/profile.tsx` — a replays card under the history card
- Modify: `locales/it.ts`, `locales/en.ts`, `locales/sq.ts`

**Interfaces:**
- Consumes: `replayStateAt`, `replayMoveCount` from Task 1; `ReplayDto`, `ReplaySummary`
- Produces: route `/(online)/replay?id=<uuid>`

**Copy (Italian is authoritative; every key exists in all three locales):**

| Key | it | en | sq |
|---|---|---|---|
| `replay.title` | Replay | Replay | Replay |
| `replay.cardTitle` | Rivedi le mani | Review your hands | Rishiko duart |
| `replay.emptyTitle` | Nessun replay | No replays yet | Asnjë replay |
| `replay.emptyBody` | I replay delle partite online restano disponibili per 14 giorni. | Online hands stay replayable for 14 days. | Duart online mbeten të rishikueshme për 14 ditë. |
| `replay.watch` | Rivedi | Watch | Rishiko |
| `replay.rowA11yLabel` | Replay: {{mode}}, {{players}}, {{time}} | Replay: {{mode}}, {{players}}, {{time}} | Replay: {{mode}}, {{players}}, {{time}} |
| `replay.moveOf` | Mossa {{n}} di {{total}} | Move {{n}} of {{total}} | Lëvizja {{n}} nga {{total}} |
| `replay.start` | Inizio | Start | Fillimi |
| `replay.prevA11yLabel` | Mossa precedente | Previous move | Lëvizja e mëparshme |
| `replay.nextA11yLabel` | Mossa successiva | Next move | Lëvizja tjetër |
| `replay.playA11yLabel` | Riproduci | Play | Luaj |
| `replay.pauseA11yLabel` | Pausa | Pause | Pauzë |
| `replay.restartA11yLabel` | Ricomincia | Restart | Rifillo |
| `replay.loadErrorTitle` | Replay non disponibile | Replay unavailable | Replay i padisponueshëm |
| `replay.loadErrorBody` | Questa mano non è più disponibile. | This hand is no longer available. | Kjo dorë nuk është më e disponueshme. |

- [ ] **Step 1: Add the locale keys**

Add a `// ---- replay.*` block to `locales/it.ts` before the `lobby.*` block, and the
same keys to `locales/en.ts` and `locales/sq.ts`. `npm run typecheck` fails until all
three carry every key, which is the check.

- [ ] **Step 2: Write `app/(online)/replay.tsx`**

The screen holds one number — the move index — and derives everything else.
Landscape-locked like the other game screens, and `GameTable` is given
`spectating` so the bottom seat draws as backs and no action buttons render.
Every hook runs before the null guard (an invariant of both game screens).

```tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { GameTable } from "@/components/GameTable";
import { replayMoveCount, replayStateAt } from "@/lib/replay";
import { Colors, Spacing, Radius, Type, Motion } from "@/lib/theme";
import { useTranslation } from "@/lib/i18n";
import { hapticSelection } from "@/lib/haptics";
import type { ReplayDto } from "@/lib/replay";

const NOOP = () => {};

export default function ReplayScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [index, setIndex] = useState(-1);
  const [playing, setPlaying] = useState(false);

  const { data: replay, isError } = useQuery<ReplayDto>({
    queryKey: [`/api/replays/${id}`],
    enabled: !!id,
  });

  const total = replay ? replayMoveCount(replay) : 0;
  const atEnd = index >= total - 1;

  useEffect(() => {
    if (!playing || atEnd) return;
    const timer = setTimeout(() => setIndex((i) => i + 1), Motion.replayStepMs);
    return () => clearTimeout(timer);
  }, [playing, atEnd, index]);

  useEffect(() => {
    if (atEnd) setPlaying(false);
  }, [atEnd]);

  const step = useCallback((delta: number) => {
    setPlaying(false);
    setIndex((i) => Math.max(-1, Math.min(i + delta, total - 1)));
    hapticSelection();
  }, [total]);

  const state = useMemo(
    () => (replay ? replayStateAt(replay, index) : null),
    [replay, index]
  );

  if (isError) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorTitle}>{t("replay.loadErrorTitle")}</Text>
        <Text style={styles.errorBody}>{t("replay.loadErrorBody")}</Text>
      </View>
    );
  }
  if (!state) return null;

  return (
    <GameTable
      gameState={state}
      viewerSeat={0}
      spectating
      selectedIds={[]}
      onSelectCard={NOOP}
      onPlay={NOOP}
      onPass={NOOP}
      onQuit={() => router.back()}
      onExchangeGive={NOOP}
      roundLabel={t("replay.title")}
      banners={
        <View style={styles.transport}>
          <TransportButton icon="play-skip-back" label={t("replay.restartA11yLabel")}
            onPress={() => { setPlaying(false); setIndex(-1); }} />
          <TransportButton icon="chevron-back" label={t("replay.prevA11yLabel")}
            onPress={() => step(-1)} />
          <TransportButton
            icon={playing ? "pause" : "play"}
            label={playing ? t("replay.pauseA11yLabel") : t("replay.playA11yLabel")}
            onPress={() => { setPlaying((p) => !p); hapticSelection(); }}
          />
          <TransportButton icon="chevron-forward" label={t("replay.nextA11yLabel")}
            onPress={() => step(1)} />
          <Text style={styles.counter}>
            {index < 0 ? t("replay.start") : t("replay.moveOf", { n: index + 1, total })}
          </Text>
        </View>
      }
    />
  );
}

function TransportButton({ icon, label, onPress }: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={styles.button}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {/* Decorative: the Pressable already carries the label, and a labelled
          control must expose exactly one accessible node. */}
      <Ionicons name={icon} size={18} color={Colors.gold} accessibilityElementsHidden
        importantForAccessibility="no" />
    </Pressable>
  );
}
```

Styles use tokens only; add `replayStepMs` to `Motion` in `lib/tokens.ts`
(`1200`, the pace a hand reads at) rather than a literal in the effect.

- [ ] **Step 3: Add the replays card to `app/(online)/profile.tsx`**

Directly under the existing history `MenuCard`, mirroring its loading / error /
empty / list structure. Each row is a `Pressable` that navigates to
`/(online)/replay?id=<id>` and carries `replay.rowA11yLabel`; the chevron inside it
is hidden from the accessibility tree.

```tsx
const replaysQuery = useQuery<ReplaySummary[]>({ queryKey: ["/api/replays"] });
```

- [ ] **Step 4: Register the route**

`app/(online)/_layout.tsx` already renders a `Stack`; confirm `replay` needs no
explicit `Stack.Screen` entry (the other screens do not have one). If the layout
enumerates screens, add `replay` alongside `game`.

- [ ] **Step 5: Verify**

Run: `npm run verify && npm run lint`
Expected: all pass — including the three-locale key check and `tests/tokenRoles.test.ts`

- [ ] **Step 6: Drive it**

Run the app, play an online hand against a bot fill to completion, open the profile,
and step through the replay. Confirm: the counts fall as cards are played, the pile
shows what was played, no hand is ever face-up, and the transport reaches both ends.

- [ ] **Step 7: Commit**

```bash
git add app/\(online\)/replay.tsx app/\(online\)/profile.tsx locales lib/tokens.ts
git commit -m "Step back through a finished hand"
```

---

## Task 6: Documentation

**Files:**
- Modify: `docs/BACKLOG.md` (Q17 → ✅ with what shipped)
- Modify: `CLAUDE.md` (key files: `lib/replay.ts`, `server/replays.ts`)
- Modify: `docs/ARCHITECTURE.md` (the replay path, and that `db:push` is required)
- Delete: nothing yet — `docs/superpowers/specs/2026-08-16-murlan-features-design.md`
  still covers Q22/Q23/Q25/Q26 and stays until they are built

- [ ] **Step 1: Update the docs**
- [ ] **Step 2: Run `graphify update .`**
- [ ] **Step 3: Commit**

```bash
git add docs CLAUDE.md graphify-out
git commit -m "Record what the replay path is"
```

---

## Self-review

**Spec coverage.** §4 of the spec asks for: a per-match move log (Task 3), a new
table rather than a column (Task 2), hands never stored (Task 1 — asserted by a
test), a bound on the table (Task 2, by age, with the reason recorded), reuse of
`GameTable` (Task 5, through the `spectating` prop Q18 added), and a degrade to
"no replay affordance" if the table is missing (Task 2's `.catch` at the write and
Task 4's 404 at the read, which renders `replay.loadErrorTitle`). The spec's
`hand_count` column is dropped: a replay is one hand, so it is always 1.

**Placeholders.** None: every step carries the code or the exact command.

**Type consistency.** `ReplayMove`, `ReplaySeat`, `ReplayDto`, `ReplaySummary`,
`replayStateAt`, `replayMoveCount`, `saveReplay`, `listReplaysForUser`,
`getReplayForUser`, `replaySeatsOf`, `replayPlayerIdsOf`, `startReplayLog`,
`appendReplayMove`, `MAX_REPLAY_MOVES`, `REPLAY_RETENTION_DAYS`,
`MAX_REPLAYS_LISTED` are each defined once and used under the same name after.

**What could make this wrong.** The `moves` jsonb holds full `Card` objects; a
long hand is a few tens of kilobytes. That is fine for a row written once, and
it is why the log is not in the per-move `game_state` write. If it ever needs to
shrink, card ids alone would round-trip through `createDeck()`.
