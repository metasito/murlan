// Every way the table refuses a play, a pass or a giveback, as the asking socket
// sees it: the code it is acked with, and whether it is told (and in what words)
// or refused silently. A refused move leaves the table as it was.
import { test, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { GameSocket } from "../../server/socket/socketTypes.ts";
import { recordingRuntime } from "../helpers/recordingRuntime.ts";
import { activeGames, socketRoomMap } from "../../server/game/gameRoom.ts";
import { clearRoomTimers } from "../../server/game/gameTimers.ts";
import { registerGameplayHandlers } from "../../server/socket/socketGameplay.ts";
import { __resetRateLimits } from "../../server/socket/socketSafety.ts";
import { payload } from "../../server/shared/payload.ts";
import type { ServerCode } from "../../server/shared/payload.ts";
import { onlineTable } from "../helpers/onlineTable.ts";
import { buildCombination, type GameState } from "../../lib/game/gameEngine.ts";
import { card as c, seat, state as makeState } from "../support/game.ts";

const ROOM = "move-refusals-room";
const SOCKET_ID = "move-refusals-socket";

beforeEach(() => __resetRateLimits());

afterEach(() => {
  clearRoomTimers(ROOM);
  activeGames.delete(ROOM);
  socketRoomMap.delete(SOCKET_ID);
});

const midTrick = (over: Partial<GameState> = {}): GameState =>
  makeState({
    players: [
      seat(0, [c("5", "spades"), c("5", "hearts"), c("9", "clubs"), c("K", "hearts")]),
      seat(1, [c("4", "clubs"), c("J", "diamonds")]),
    ],
    currentTurnIndex: 0,
    lastPlayedCombination: buildCombination([c("7", "diamonds")]),
    lastPlayedBy: 1,
    firstPlayMade: true,
    playedRanks: new Array(15).fill(0),
    ...over,
  });

const exchangeOpen = (over: Partial<GameState> = {}): GameState =>
  midTrick({
    players: [
      seat(0, [c("A", "hearts"), c("5", "spades"), c("2", "clubs")]),
      seat(1, [c("4", "clubs"), c("J", "diamonds")]),
    ],
    lastPlayedCombination: null,
    exchangePhase: {
      active: true,
      winnerIdx: 0,
      loserIdx: 1,
      cardFromLoser: c("2", "clubs"),
      twoJokerException: false,
    },
    ...over,
  });

const opening = midTrick({
  lastPlayedCombination: null,
  firstPlayMade: false,
  startCard: c("5", "spades"),
});

type Send = { event: "game:play"; body: { cardIds: string[] } } | { event: "game:pass" } | { event: "game:exchange_give_card"; body: { cardId: string } };
const play = (...cardIds: string[]): Send => ({ event: "game:play", body: { cardIds } });
const pass: Send = { event: "game:pass" };
const giveback = (cardId: string): Send => ({ event: "game:exchange_give_card", body: { cardId } });

interface Case {
  name: string;
  state: GameState;
  user?: string;
  send: Send;
  code: ServerCode;
  /** Absent: refused silently, with the ack alone. */
  told?: Record<string, string>;
}

const CASES: Case[] = [
  { name: "a play after the round is over", state: midTrick({ roundOver: true }), send: play("9_clubs"), code: "NO_LIVE_GAME" },
  { name: "a play while the exchange is open", state: exchangeOpen(), send: play("5_spades"), code: "EXCHANGE_PENDING", told: {} },
  { name: "a play off turn", state: midTrick({ currentTurnIndex: 1 }), send: play("9_clubs"), code: "NOT_YOUR_TURN" },
  { name: "a play by an unseated user", state: midTrick(), user: "u9", send: play("9_clubs"), code: "NOT_YOUR_TURN" },
  { name: "a play of a card not held", state: midTrick(), send: play("A_spades"), code: "INVALID_CARD", told: {} },
  { name: "a play that is no combination", state: midTrick(), send: play("5_spades", "9_clubs"), code: "INVALID_COMBINATION", told: {} },
  { name: "an opening play without the start card", state: opening, send: play("9_clubs"), code: "MUST_PLAY_START_CARD", told: { rank: "5" } },
  { name: "a play too low to beat the table", state: midTrick(), send: play("5_spades"), code: "INVALID_MOVE", told: {} },
  { name: "a play of the wrong shape", state: midTrick(), send: play("5_spades", "5_hearts"), code: "INVALID_MOVE", told: {} },
  { name: "a pass after the round is over", state: midTrick({ roundOver: true }), send: pass, code: "NO_LIVE_GAME" },
  { name: "a pass while the exchange is open", state: exchangeOpen(), send: pass, code: "EXCHANGE_PENDING", told: {} },
  { name: "a pass off turn", state: midTrick({ currentTurnIndex: 1 }), send: pass, code: "NOT_YOUR_TURN" },
  { name: "a pass by an unseated user", state: midTrick(), user: "u9", send: pass, code: "NOT_YOUR_TURN" },
  { name: "a pass on a new trick", state: midTrick({ lastPlayedCombination: null }), send: pass, code: "CANNOT_PASS", told: {} },
  { name: "a giveback with no exchange open", state: midTrick(), send: giveback("5_spades"), code: "NO_EXCHANGE" },
  { name: "a giveback by the loser", state: exchangeOpen(), user: "u2", send: giveback("4_clubs"), code: "NOT_YOUR_EXCHANGE" },
  { name: "a giveback by an unseated user", state: exchangeOpen(), user: "u9", send: giveback("5_spades"), code: "NOT_YOUR_EXCHANGE" },
  { name: "a giveback of a card not held", state: exchangeOpen(), send: giveback("9_hearts"), code: "INVALID_CARD", told: {} },
  { name: "a giveback outside 3-10", state: exchangeOpen(), send: giveback("A_hearts"), code: "INVALID_CARD", told: {} },
  { name: "a giveback of the card just handed over", state: exchangeOpen(), send: giveback("2_clubs"), code: "INVALID_CARD", told: {} },
];

function fakeSocket(userId: string) {
  const handlers = new Map<string, (...args: unknown[]) => void>();
  const emitted: { event: string; payload: unknown }[] = [];
  const socket = {
    id: SOCKET_ID,
    data: { userId },
    on: (event: string, cb: (...args: unknown[]) => void) => handlers.set(event, cb),
    emit: (event: string, body: unknown) => emitted.push({ event, payload: body }),
  };
  const send = (s: Send) =>
    new Promise<unknown>((resolve) => handlers.get(s.event)!("body" in s ? s.body : undefined, resolve));
  return { socket: socket as unknown as GameSocket, emitted, send };
}

for (const { name, state, user = "u1", send, code, told } of CASES) {
  test(`${name}: ${code}, ${told ? "told" : "silent"}`, async () => {
    const { rt, sent } = recordingRuntime();
    activeGames.set(ROOM, onlineTable({ roomId: ROOM, playerMap: { 0: "u1", 1: "u2" }, gameState: state }));
    const before = structuredClone(state);
    const { socket, emitted, send: emit } = fakeSocket(user);
    socketRoomMap.set(SOCKET_ID, ROOM);
    registerGameplayHandlers({ rt, socket, userId: user });

    assert.deepEqual(await emit(send), { ok: false, code });
    assert.deepEqual(emitted, told ? [{ event: "game:error", payload: payload(code, told) }] : []);
    assert.deepEqual(sent, [], "a refused move reached the table");
    assert.deepEqual(activeGames.get(ROOM)!.gameState, before, "a refused move changed the state");
  });
}
