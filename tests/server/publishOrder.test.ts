// The order a table's state leaves in: every seat is served before the row is
// written, an exchange closes before anyone is served, and a table is disposed
// only after its last write. The production writers run here, over the memory
// store, and the journal holds rows as they land.
import { test, afterEach, mock, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { recordingRuntime, type JournalEntry } from "../helpers/recordingRuntime.ts";
import { applyOrForward } from "../../server/game/tableRouter.ts";
import { activeGames, type OnlineGameState } from "../../server/game/gameRoom.ts";
import { clearRoomTimers } from "../../server/game/gameTimers.ts";
import { onlineTable } from "../helpers/onlineTable.ts";
import { useMemoryTableStores } from "../helpers/memoryTableStores.ts";
import { createDeck, startRound, type GameState } from "../../lib/game/gameEngine.ts";
import type { WireGameState } from "../../shared/protocol.ts";
import { activeGameStore } from "../../server/store/activeGameStore.ts";

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
  assert.deepEqual(await applyOrForward(rt, { kind: "move", roomId: ROOM, userId: "ana", move: { kind: "giveback", cardId: give.id } }), {
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
  await new Promise((resolve) => setTimeout(resolve, 60));

  assert.deepEqual(
    journal.filter((e) => isPersist(e) || isRemove(e)).map((e) => (e as { name: string }).name),
    ["write", "remove"],
    "the delete landed under a write still in flight, which resurrects the row"
  );
});
