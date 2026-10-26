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
import { turnOf } from "../../lib/game/moves.ts";

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
    openingCard: null,
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
    exchangePhase: { kind: "open", winnerIdx: 0, loserIdx: 1, cardFromLoser: c("2", "clubs") },
    ...over,
  });

/** The table holds `last`, and seat 0, on move, holds `hand`. */
const against = (last: ReturnType<typeof c>[], hand: ReturnType<typeof c>[]) =>
  midTrick({ players: [seat(0, hand), seat(1, [c("4", "clubs")])], lastPlayedCombination: buildCombination(last) });
const hearts = (...ranks: Parameters<typeof c>[0][]) => ranks.map((r) => c(r, "hearts"));

const opening = midTrick({
  lastPlayedCombination: null,
  openingCard: c("5", "spades"),
});

/** Every `Send` below names the turn of a freshly dealt table; a table past it holds each of them stale. */
const DEALT = turnOf(midTrick());
const movedOn = { lastMove: { seq: 3, kind: "pass", seat: 1, closedTrick: false } } as const;

type Send =
  | { event: "game:play"; body: { cardIds: string[]; turn: string } }
  | { event: "game:pass"; body: { turn: string } }
  | { event: "game:exchange_give_card"; body: { cardId: string; turn: string } };
const play = (...cardIds: string[]): Send => ({ event: "game:play", body: { cardIds, turn: DEALT } });
const pass: Send = { event: "game:pass", body: { turn: DEALT } };
const giveback = (cardId: string): Send => ({ event: "game:exchange_give_card", body: { cardId, turn: DEALT } });

/** `told` absent: refused silently, with the ack alone. */
type Case = { name: string; state: GameState; user?: string; send: Send } & (
  | { code: ServerCode; told: Record<string, string> }
  | { code: string; told?: undefined }
);

const CASES: Case[] = [
  { name: "a play after the round is over", state: midTrick({ roundOver: true }), send: play("9_clubs"), code: "NO_LIVE_GAME" },
  { name: "a play while the exchange is open", state: exchangeOpen(), send: play("5_spades"), code: "EXCHANGE_PENDING", told: {} },
  { name: "a play off turn", state: midTrick({ currentTurnIndex: 1 }), send: play("9_clubs"), code: "NOT_YOUR_TURN" },
  { name: "a play by an unseated user", state: midTrick(), user: "u9", send: play("9_clubs"), code: "NOT_YOUR_TURN" },
  { name: "a play of a card not held", state: midTrick(), send: play("A_spades"), code: "INVALID_CARD", told: {} },
  { name: "a play that is no combination", state: midTrick(), send: play("5_spades", "9_clubs"), code: "INVALID_MOVE", told: { refusal: "notACombination" } },
  { name: "an opening play without the start card", state: opening, send: play("9_clubs"), code: "INVALID_MOVE", told: { refusal: "needsStartCard" } },
  { name: "a play too low to beat the table", state: midTrick(), send: play("5_spades"), code: "INVALID_MOVE", told: { refusal: "tooLow" } },
  { name: "a play of the wrong shape", state: midTrick(), send: play("5_spades", "5_hearts"), code: "INVALID_MOVE", told: { refusal: "wrongType" } },
  {
    name: "a play by an unseated user while another seat is on move and could play it",
    state: midTrick({ currentTurnIndex: 1 }),
    user: "u9",
    send: { event: "game:play", body: { cardIds: ["J_diamonds"], turn: turnOf(midTrick({ currentTurnIndex: 1 })) } },
    code: "NOT_YOUR_TURN",
  },
  {
    name: "a play onto a royal straight",
    state: against(hearts("5", "6", "7", "8", "9"), [c("9", "clubs")]),
    send: play("9_clubs"),
    code: "INVALID_MOVE",
    told: { refusal: "royalUnbeatable" },
  },
  {
    name: "a play onto a bomb",
    state: against([c("7", "spades"), c("7", "hearts"), c("7", "clubs"), c("7", "diamonds")], [c("K", "clubs")]),
    send: play("K_clubs"),
    code: "INVALID_MOVE",
    told: { refusal: "bombOnly" },
  },
  {
    name: "a straight of another length",
    state: against(
      [c("5", "spades"), c("6", "hearts"), c("7", "clubs"), c("8", "diamonds"), c("9", "spades")],
      [c("6", "spades"), c("7", "hearts"), c("8", "clubs"), c("9", "diamonds"), c("10", "spades"), c("J", "clubs")]
    ),
    send: play("6_spades", "7_hearts", "8_clubs", "9_diamonds", "10_spades", "J_clubs"),
    code: "INVALID_MOVE",
    told: { refusal: "wrongLength" },
  },
  { name: "a pass after the round is over", state: midTrick({ roundOver: true }), send: pass, code: "NO_LIVE_GAME" },
  { name: "a pass while the exchange is open", state: exchangeOpen(), send: pass, code: "EXCHANGE_PENDING", told: {} },
  { name: "a pass off turn", state: midTrick({ currentTurnIndex: 1 }), send: pass, code: "NOT_YOUR_TURN" },
  { name: "a pass by an unseated user", state: midTrick(), user: "u9", send: pass, code: "NOT_YOUR_TURN" },
  { name: "a pass on a new trick", state: midTrick({ lastPlayedCombination: null }), send: pass, code: "CANNOT_PASS", told: {} },
  { name: "a giveback after the round is over", state: exchangeOpen({ roundOver: true }), send: giveback("5_spades"), code: "NO_LIVE_GAME" },
  { name: "a play on turn at a seat with no player", state: midTrick({ players: midTrick().players.slice(0, 1), currentTurnIndex: 1 }), user: "u2", send: play("4_clubs"), code: "NO_LIVE_GAME" },
  { name: "a giveback with no exchange open", state: midTrick(), send: giveback("5_spades"), code: "NO_EXCHANGE" },
  { name: "a giveback by the loser", state: exchangeOpen(), user: "u2", send: giveback("4_clubs"), code: "NOT_YOUR_EXCHANGE" },
  { name: "a giveback by an unseated user", state: exchangeOpen(), user: "u9", send: giveback("5_spades"), code: "NOT_YOUR_EXCHANGE" },
  { name: "a giveback of a card not held", state: exchangeOpen(), send: giveback("9_hearts"), code: "INVALID_CARD", told: {} },
  { name: "a giveback outside 3-10", state: exchangeOpen(), send: giveback("A_hearts"), code: "INVALID_CARD", told: {} },
  { name: "a giveback of the card just handed over", state: exchangeOpen(), send: giveback("2_clubs"), code: "INVALID_CARD", told: {} },
  { name: "a legal play made against an earlier turn", state: midTrick(movedOn), send: play("9_clubs"), code: "NOT_YOUR_TURN" },
  { name: "a legal pass made against an earlier turn", state: midTrick(movedOn), send: pass, code: "NOT_YOUR_TURN" },
  { name: "a legal giveback made against an earlier turn", state: exchangeOpen(movedOn), send: giveback("5_spades"), code: "NOT_YOUR_TURN" },
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
    new Promise<unknown>((resolve) => handlers.get(s.event)!(s.body, resolve));
  return { socket: socket as unknown as GameSocket, emitted, send };
}

for (const testCase of CASES) {
  const { name, state, user = "u1", send, code, told } = testCase;
  test(`${name}: ${code}, ${told ? "told" : "silent"}`, async () => {
    const { rt, sent } = recordingRuntime();
    activeGames.set(ROOM, onlineTable({ roomId: ROOM, playerMap: { 0: "u1", 1: "u2" }, gameState: state }));
    const before = structuredClone(state);
    const { socket, emitted, send: emit } = fakeSocket(user);
    socketRoomMap.set(SOCKET_ID, ROOM);
    registerGameplayHandlers({ rt, socket, userId: user });

    assert.deepEqual(await emit(send), { ok: false, code });
    assert.deepEqual(emitted, testCase.told ? [{ event: "game:error", payload: payload(testCase.code, testCase.told) }] : []);
    assert.deepEqual(sent, [], "a refused move reached the table");
    assert.deepEqual(activeGames.get(ROOM)!.gameState, before, "a refused move changed the state");
  });
}
