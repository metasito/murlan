// The move each of the three inbound move events delivers to the table: which seat
// it is played for and what it does there.
import { test, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { GameSocket } from "../../server/socket/socketTypes.ts";
import { recordingRuntime } from "../helpers/recordingRuntime.ts";
import { activeGames, socketRoomMap } from "../../server/game/gameRoom.ts";
import { clearRoomTimers } from "../../server/game/gameTimers.ts";
import { registerGameplayHandlers } from "../../server/socket/socketGameplay.ts";
import { __resetRateLimits } from "../../server/socket/socketSafety.ts";
import { onlineTable } from "../helpers/onlineTable.ts";
import { buildCombination, type GameState } from "../../lib/game/gameEngine.ts";
import { card as c, seat, state as makeState } from "../support/game.ts";

const ROOM = "move-routing-room";
const SOCKET_ID = "move-routing-socket";

beforeEach(() => __resetRateLimits());

afterEach(() => {
  clearRoomTimers(ROOM);
  activeGames.delete(ROOM);
  socketRoomMap.delete(SOCKET_ID);
});

const hands = () => [
  seat(0, [c("5", "spades"), c("9", "clubs"), c("K", "hearts")]),
  seat(1, [c("4", "clubs"), c("J", "diamonds")]),
  seat(2, [c("6", "clubs"), c("Q", "diamonds")]),
];

const table = (over: Partial<GameState>): GameState =>
  makeState({
    players: hands(),
    currentTurnIndex: 1,
    lastPlayedCombination: buildCombination([c("7", "diamonds")]),
    lastPlayedBy: 2,
    openingCard: null,
    playedRanks: new Array(15).fill(0),
    ...over,
  });

async function deliver(state: GameState, event: string, body?: unknown) {
  const { reply, sent } = await replyTo(state, event, body);
  assert.deepEqual(reply, { ok: true });
  assert.ok(sent.some((e) => e.event === "game:state"), "the move was not published");
  return activeGames.get(ROOM)!.gameState;
}

async function replyTo(state: GameState, event: string, body?: unknown) {
  const { rt, sent } = recordingRuntime();
  activeGames.set(ROOM, onlineTable({ roomId: ROOM, playerMap: { 1: "u1" }, gameState: state }));
  const handlers = new Map<string, (...args: unknown[]) => void>();
  const socket = {
    id: SOCKET_ID,
    data: { userId: "u1" },
    on: (name: string, cb: (...args: unknown[]) => void) => handlers.set(name, cb),
    emit: () => {},
  };
  socketRoomMap.set(SOCKET_ID, ROOM);
  registerGameplayHandlers({ rt, socket: socket as unknown as GameSocket, userId: "u1" });
  const reply = await new Promise((resolve) => handlers.get(event)!(body, resolve));
  return { reply, sent };
}

test("a move naming no seq is refused before it reaches the table, for each of the three events", async () => {
  const exchange = table({
    lastPlayedCombination: null,
    exchangePhase: { kind: "open", winnerIdx: 1, loserIdx: 2, cardFromLoser: c("J", "diamonds") },
  });
  const moves: [GameState, string, unknown][] = [
    [table({}), "game:play", { cardIds: ["J_diamonds"] }],
    [table({}), "game:pass", undefined],
    [exchange, "game:exchange_give_card", { cardId: "4_clubs" }],
  ];
  for (const [state, event, body] of moves) {
    const { reply, sent } = await replyTo(state, event, body);
    assert.deepEqual(reply, { ok: false, code: "INVALID_PAYLOAD" }, event);
    assert.deepEqual(sent, [], `${event} reached the table`);
  }
});

test("game:play delivers a play of exactly the cards named, for the sender's seat", async () => {
  const next = await deliver(table({}), "game:play", { cardIds: ["J_diamonds"], seq: 0 });
  assert.equal(next.lastPlayedBy, 1);
  assert.deepEqual(next.lastPlayedCombination?.cards.map((x) => x.id), ["J_diamonds"]);
  assert.deepEqual(next.players[1].hand.map((x) => x.id), ["4_clubs"]);
  assert.equal(next.currentTurnIndex, 0);
});

test("game:pass delivers a pass for the sender's seat", async () => {
  const next = await deliver(table({}), "game:pass", { seq: 0 });
  assert.equal(next.passCount, 1);
  assert.equal(next.lastPlayedBy, 2);
  assert.deepEqual(next.players[1].hand.map((x) => x.id), ["4_clubs", "J_diamonds"]);
  assert.equal(next.currentTurnIndex, 0);
});

test("game:exchange_give_card delivers a giveback of the card named, from the sender's seat", async () => {
  const state = table({
    lastPlayedCombination: null,
    exchangePhase: { kind: "open", winnerIdx: 1, loserIdx: 2, cardFromLoser: c("J", "diamonds") },
  });
  const next = await deliver(state, "game:exchange_give_card", { cardId: "4_clubs", seq: 0 });
  assert.equal(next.exchangePhase?.kind, "settled");
  assert.equal(next.exchangePhase.cardToLoser.id, "4_clubs");
  assert.deepEqual(next.players[1].hand.map((x) => x.id), ["J_diamonds"]);
  assert.ok(next.players[2].hand.some((x) => x.id === "4_clubs"));
  assert.equal(next.currentTurnIndex, 2);
});
