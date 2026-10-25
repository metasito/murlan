// `game.firstMoveMade` is the funnel's "made a move after sitting down": it fires on the opening
// card's play, and not on a later move of that round or on the lead of a round dealt from an exchange.
import { test, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { GameSocket } from "../../server/socket/socketTypes.ts";
import { recordingRuntime } from "../helpers/recordingRuntime.ts";
import { activeGames, socketRoomMap } from "../../server/game/gameRoom.ts";
import { clearRoomTimers } from "../../server/game/gameTimers.ts";
import { registerGameplayHandlers } from "../../server/socket/socketGameplay.ts";
import { __resetRateLimits } from "../../server/socket/socketSafety.ts";
import { db, openDatabase } from "../../server/store/db.ts";
import { onlineTable } from "../helpers/onlineTable.ts";
import { actingSeat, startRound, type GameState } from "../../lib/game/gameEngine.ts";
import { chooseMove } from "../../lib/game/autoMove.ts";
import { intentSeq } from "../../lib/game/moves.ts";

openDatabase();

const ROOM = "first-move-room";
const SEATS = [0, 1, 2].map((i) => ({ name: `p${i}`, type: "human" as const }));
const USERS = { 0: "u0", 1: "u1", 2: "u2" };

beforeEach(() => __resetRateLimits());

afterEach(() => {
  clearRoomTimers(ROOM);
  activeGames.delete(ROOM);
  for (const id of Object.values(USERS)) socketRoomMap.delete(id);
});

/** Each seat's own socket, plus the `name`s of every event the table recorded. */
function seatedTable(t: { mock: typeof import("node:test").mock }, gameState: GameState) {
  const recorded: string[] = [];
  t.mock.method(db(), "insert", () => ({
    values: async (row: { name: string }) => {
      recorded.push(row.name);
    },
  }));
  const { rt } = recordingRuntime();
  activeGames.set(ROOM, onlineTable({ roomId: ROOM, playerMap: USERS, maxPlayers: 3, gameState }));
  const sockets = Object.entries(USERS).map(([, userId]) => {
    const handlers = new Map<string, (...args: unknown[]) => void>();
    const socket = { id: userId, data: { userId }, on: (n: string, cb: (...a: unknown[]) => void) => handlers.set(n, cb), emit: () => {} };
    socketRoomMap.set(userId, ROOM);
    registerGameplayHandlers({ rt, socket: socket as unknown as GameSocket, userId });
    return handlers;
  });
  async function move(): Promise<void> {
    const state = activeGames.get(ROOM)!.gameState;
    const seat = actingSeat(state);
    const chosen = chooseMove(state, seat, "floor")!;
    const seq = intentSeq(state);
    const [event, body] =
      chosen.kind === "play" ? ["game:play", { cardIds: chosen.cardIds, seq }] : chosen.kind === "pass" ? ["game:pass", { seq }] : ["game:exchange_give_card", { cardId: chosen.cardId, seq }];
    const reply = await new Promise((resolve) => sockets[seat].get(event as string)!(body, resolve));
    assert.deepEqual(reply, { ok: true });
  }
  const firstMoves = () => recorded.filter((name) => name === "game.firstMoveMade").length;
  return { move, firstMoves };
}

test("the match's opening play records game.firstMoveMade, and no later move does", async (t) => {
  const table = seatedTable(t, startRound(SEATS, "free_for_all"));
  assert.ok(activeGames.get(ROOM)!.gameState.openingCard, "a match's first deal opens on a card");
  await table.move();
  assert.equal(activeGames.get(ROOM)!.gameState.openingCard, null);
  await new Promise((r) => setImmediate(r));
  assert.equal(table.firstMoves(), 1);
  for (let i = 0; i < 8; i++) await table.move();
  await new Promise((r) => setImmediate(r));
  assert.equal(table.firstMoves(), 1);
});

test("a later round's lead, dealt from an exchange, records nothing", async (t) => {
  const table = seatedTable(t, startRound(SEATS, "free_for_all", { opening: { kind: "exchange", winnerSeat: 0, loserSeat: 2 } }));
  for (let i = 0; i < 6; i++) await table.move();
  await new Promise((r) => setImmediate(r));
  assert.equal(table.firstMoves(), 0);
});
