// The order a table's state leaves in: every seat is served before the row is
// written, an exchange closes before anyone is served, and a table is disposed
// only after its last write. The production writers run here, over the memory
// store, and the journal holds rows as they land.
import { test, afterEach, mock, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { recordingRuntime, type JournalEntry } from "../helpers/recordingRuntime.ts";
import { publishState, tableWriters } from "../../server/game/gamePersistence.ts";
import { installClock } from "../../server/http/clock.ts";
import { fakeClock } from "../helpers/fakeClock.ts";
import type { TableStore } from "../../server/game/tableRuntime.ts";
import { state as aState } from "../support/game.ts";
import { applyOrForward } from "../../server/game/tableRouter.ts";
import { activeGames, type OnlineGameState } from "../../server/game/gameRoom.ts";
import { clearRoomTimers } from "../../server/game/gameTimers.ts";
import { onlineTable } from "../helpers/onlineTable.ts";
import { useMemoryTableStores } from "../helpers/memoryTableStores.ts";
import { createDeck, startRound, type GameState } from "../../lib/game/gameEngine.ts";
import type { WireGameState } from "../../shared/protocol.ts";
import { turnOf } from "../../lib/game/moves.ts";
import { activeGameStore } from "../../server/store/activeGameStore.ts";
import { eventually } from "../helpers/client.ts";

const ROOM = "publish-order-room";
const SEATS = ["Ana", "B1", "B2", "B3"].map((name, i) => ({
  name,
  type: i === 0 ? ("human" as const) : ("bot" as const),
  id: `player_${i}`,
}));

const settle = () => new Promise((resolve) => setImmediate(resolve));

afterEach(() => {
  clearRoomTimers(ROOM);
  activeGames.delete(ROOM);
  mock.restoreAll();
});

function useAnaTable(t: TestContext, gameState: GameState, overrides: Partial<OnlineGameState> = {}) {
  useMemoryTableStores(t, {
    rooms: [[ROOM, { code: "AAAAAA", gameMode: "free_for_all", maxPlayers: 4, status: "in_progress" }]],
    seats: [[ROOM, [{ userId: "ana", seatIndex: 0, user: { id: "ana", username: "Ana" } as never }]]],
  });
  const game = onlineTable({
    roomId: ROOM,
    playerMap: { [gameState.currentTurnIndex]: "ana" },
    botSeatsAtStart: new Set([0, 1, 2, 3].filter((s) => s !== gameState.currentTurnIndex)),
    spectators: new Set(["sam"]),
    gameState,
    ...overrides,
  });
  activeGames.set(ROOM, game);
  return game;
}

const index = (journal: JournalEntry[], pick: (e: JournalEntry) => boolean) => journal.findIndex(pick);
const lastIndex = (journal: JournalEntry[], pick: (e: JournalEntry) => boolean) => journal.findLastIndex(pick);
const isState = (e: JournalEntry) => e.kind === "send" && e.event === "game:state";
const isPersist = (e: JournalEntry) => e.kind === "store" && e.name === "write";
const isRemove = (e: JournalEntry) => e.kind === "store" && e.name === "remove";

function assertServedThenPersisted(journal: JournalEntry[]) {
  const viewers = journal.filter(isState).map((e) => (e.kind === "send" && "user" in e.to ? e.to.user : null));
  assert.deepEqual(new Set(viewers), new Set(["ana", "sam"]), "a viewer was not served, or a state went to a room");
  const persisted = index(journal, isPersist);
  assert.ok(persisted !== -1, "the state was never persisted");
  assert.ok(lastIndex(journal, isState) < persisted, "the row was written before every viewer was served");
}

test("a play serves every viewer, then persists", async (t) => {
  const state = startRound(SEATS, "free_for_all");
  useAnaTable(t, state);
  const { rt, journal } = recordingRuntime({ persist: "real" });
  const outcome = await applyOrForward(rt, {
    kind: "move",
    roomId: ROOM,
    userId: "ana",
    move: { kind: "play", cardIds: [state.openingCard!.id] },
    turn: turnOf(state),
  });
  assert.deepEqual(outcome, { ok: true });
  await settle();
  assertServedThenPersisted(journal);
});

test("the state that closes an exchange shows every viewer the ceremony", async (t) => {
  const deck = createDeck();
  const hands = SEATS.map((_, s) => deck.filter((_, i) => i % SEATS.length === s));
  const state = startRound(SEATS, "free_for_all", {
    opening: { kind: "exchange", winnerSeat: 0, loserSeat: 3 },
    dealt: hands,
  });
  const phase = state.exchangePhase;
  assert.ok(phase?.kind === "open");
  const give = state.players[0].hand.find((c) => c.id !== phase.cardFromLoser.id)!;
  useAnaTable(t, { ...state, currentTurnIndex: 0 });
  const { rt, journal } = recordingRuntime({ persist: "real" });
  assert.deepEqual(await applyOrForward(rt, { kind: "move", roomId: ROOM, userId: "ana", move: { kind: "giveback", cardId: give.id }, turn: turnOf(state) }), {
    ok: true,
  });
  await settle();
  const states = journal.filter(isState);
  assert.ok(states.length >= 2);
  for (const e of states) {
    const sent = (e as Extract<JournalEntry, { kind: "send" }>).args[0] as WireGameState;
    assert.ok(sent.exchangePhase?.kind === "settled" && sent.exchangePhase.cardToLoser, "a viewer was served before the exchange settled");
  }
  assertServedThenPersisted(journal);
});

test("a deal serves every viewer, then persists", async (t) => {
  const state = { ...startRound(SEATS, "free_for_all"), roundOver: true, finishingOrder: ["player_0"] };
  useAnaTable(t, state, { roundsPlayed: 1 });
  const { rt, journal } = recordingRuntime({ persist: "real" });
  assert.deepEqual(await applyOrForward(rt, { kind: "rematchVote", roomId: ROOM, userId: "ana" }), { ok: true });
  await settle();
  assert.ok(journal.some((e) => e.kind === "send" && e.event === "game:started"), "the vote dealt nothing");
  assertServedThenPersisted(journal);
});

test("the last player leaving mid-match is written before the table is disposed", async (t) => {
  const state = startRound(SEATS, "free_for_all");
  useAnaTable(t, state, { roundsPlayed: 1 });
  const { rt, journal } = recordingRuntime({ persist: "real" });
  await applyOrForward(rt, { kind: "vacate", roomId: ROOM, userId: "ana" });
  await settle();
  await settle();
  assert.equal(activeGames.has(ROOM), false, "the table outlived its last player");
  assert.ok(journal.some((e) => e.kind === "send" && e.event === "game:round_over"), "the round was never scored");
  const removed = index(journal, isRemove);
  const lastWrite = lastIndex(journal, isPersist);
  assert.ok(removed !== -1, "the row was never deleted");
  assert.ok(lastWrite !== -1, "the round's result was never written");
  assert.ok(lastWrite < removed, "the row was deleted before its last write landed");
});

test("a row write still in flight lands before the last leaver's delete", async (t) => {
  const state = { ...startRound(SEATS, "free_for_all"), roundOver: true, finishingOrder: ["player_0"] };
  useAnaTable(t, state, { roundsPlayed: 1, playerMap: { 0: "ana", 1: "besi" } });
  const landWrite = activeGameStore.write;
  t.mock.method(activeGameStore, "write", async (...args: Parameters<typeof landWrite>) => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    return landWrite(...args);
  });
  const { rt, journal } = recordingRuntime({ persist: "real" });

  await applyOrForward(rt, { kind: "vacate", roomId: ROOM, userId: "besi" });
  await applyOrForward(rt, { kind: "vacate", roomId: ROOM, userId: "ana" });
  assert.equal(activeGames.has(ROOM), false, "the table outlived its last player");
  await eventually(() => journal.some(isRemove), "the last leaver's delete");

  assert.deepEqual(
    journal.filter((e) => isPersist(e) || isRemove(e)).map((e) => (e as { name: string }).name),
    ["write", "remove"],
    "the delete landed under a write still in flight, which resurrects the row"
  );
});

/** A store whose row writes and deletes each wait for the test to let them land, recording their order. */
function gatedStore() {
  const landed: string[] = [];
  const gates: (() => void)[] = [];
  const gated = (label: (arg: unknown) => string) => (_roomId: string, arg?: unknown) =>
    new Promise<void>((resolve, reject) => {
      const tag = label(arg);
      gates.push(() => {
        if (tag.startsWith("fail")) reject(new Error("connection terminated"));
        else resolve();
      });
      landed.push(tag);
    });
  const store = {
    games: {
      write: gated((row) => `round${(row as { match: { roundsPlayed: number } }).match.roundsPlayed}`),
      remove: gated(() => "remove"),
    },
    rooms: { updateRoomStatus: async () => {} },
  } as unknown as TableStore;
  return { store, started: landed, land: (i: number) => gates[i]() };
}

function tableAtRound(roundsPlayed: number) {
  const game = onlineTable({ roomId: ROOM, gameState: startRound(SEATS, "free_for_all"), roundsPlayed });
  activeGames.set(ROOM, game);
  return game;
}

function playRound(game: OnlineGameState, roundsPlayed: number) {
  (game as { roundsPlayed: number }).roundsPlayed = roundsPlayed;
}

const flush = async () => {
  for (let i = 0; i < 20; i++) await settle();
};

test("row writes land one at a time in the order they were made, however many are waiting", async () => {
  const { store, started, land } = gatedStore();
  const writers = tableWriters(store);
  const game = tableAtRound(1);
  const first = writers.persistGameState(ROOM, game);
  playRound(game, 2);
  void writers.persistGameState(ROOM, game);
  playRound(game, 3);
  void writers.persistGameState(ROOM, game);
  await flush();
  assert.deepEqual(started, ["round1"], "a second write started before the first landed");

  land(0);
  await first;
  await flush();
  playRound(game, 4);
  void writers.persistGameState(ROOM, game);
  await flush();
  assert.deepEqual(started, ["round1", "round2"], "a write overtook one still waiting ahead of it");

  land(1);
  await flush();
  land(2);
  await flush();
  land(3);
  await flush();
  assert.deepEqual(started, ["round1", "round2", "round3", "round4"]);
});

test("a row write whose table was disposed while it waited is never made", async () => {
  const { store, started, land } = gatedStore();
  const writers = tableWriters(store);
  const game = tableAtRound(1);
  void writers.persistGameState(ROOM, game);
  playRound(game, 2);
  const second = writers.persistGameState(ROOM, game);
  await flush();

  activeGames.delete(ROOM);
  land(0);
  await second;
  assert.deepEqual(started, ["round1"], "a disposed table's row was written back");
});

test("a row write for a table since replaced under the same room is never made", async () => {
  const { store, started, land } = gatedStore();
  const writers = tableWriters(store);
  const game = tableAtRound(1);
  void writers.persistGameState(ROOM, game);
  const second = writers.persistGameState(ROOM, game);
  await flush();

  tableAtRound(7);
  land(0);
  await second;
  assert.deepEqual(started, ["round1"], "a stale game overwrote the row of the one that replaced it");
});

test("a row write or delete that fails does not reject, and the writes behind it still land", async () => {
  const { store, started, land } = gatedStore();
  const failing = {
    ...store,
    games: {
      ...store.games,
      remove: () => Promise.reject(new Error("connection terminated")),
    },
  } as unknown as TableStore;
  const writers = tableWriters(failing);
  const game = tableAtRound(1);

  await writers.discardGame(ROOM);
  const next = writers.persistGameState(ROOM, game);
  await flush();
  assert.deepEqual(started, ["round1"], "a failed delete stopped the writes behind it");
  land(0);
  await next;
});

test("a row write that fails does not reject, and the next one lands", async () => {
  const rows: number[] = [];
  let failNext = true;
  const store = {
    games: {
      write: async (_roomId: string, row: { match: { roundsPlayed: number } }) => {
        if (failNext) {
          failNext = false;
          throw new Error("connection terminated");
        }
        rows.push(row.match.roundsPlayed);
      },
      remove: async () => {},
    },
    rooms: { updateRoomStatus: async () => {} },
  } as unknown as TableStore;
  const writers = tableWriters(store);
  const game = tableAtRound(1);

  await writers.persistGameState(ROOM, game);
  playRound(game, 2);
  await writers.persistGameState(ROOM, game);
  assert.deepEqual(rows, [2]);
});

test("a deal is stamped with the time it was served, a play is not stamped, and a stamp already there is kept", (t) => {
  const clock = fakeClock(5_000_000);
  t.after(installClock(clock));
  const { rt } = recordingRuntime();

  const dealt = onlineTable({ roomId: ROOM, gameState: aState({ lastMove: { seq: 0, kind: "deal" } }) });
  void publishState(rt, dealt);
  assert.equal(dealt.gameState.dealtAt, 5_000_000);

  clock.advance(1_000);
  void publishState(rt, dealt);
  assert.equal(dealt.gameState.dealtAt, 5_000_000, "a later publish moved the time the deal was served");

  const played = onlineTable({ roomId: ROOM, gameState: aState({ lastMove: { seq: 3, kind: "play", seat: 1 } }) });
  void publishState(rt, played);
  assert.equal(played.gameState.dealtAt, undefined, "a play was stamped as a deal");
});
