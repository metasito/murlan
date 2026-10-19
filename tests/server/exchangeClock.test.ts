// The exchange ceremony window is measured on the server's one clock: the
// broadcast that closes the phase stamps it, and the sanitizer that ends it
// reads it, from the same `now()` the turn clock runs on.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { broadcastGameState, sanitizeStateForPlayer } from "../../server/game/gamePersistence.ts";
import type { OnlineGameState } from "../../server/game/gameRoom.ts";
import type { SocketServer } from "../../server/socket/socketTypes.ts";
import { exchangeAnnounceMs } from "../../lib/exchangeCeremony.ts";
import type { GameState, Player } from "../../lib/game/gameEngine.ts";
import { installClock } from "../../server/clock.ts";
import { fakeClock } from "../helpers/fakeClock.ts";

const RETURNED = { id: "6_clubs", suit: "clubs", rank: "6", isJoker: false } as const;
const USERS = ["u0", "u1", "u2", "u3"];
const WINNER = 1;
const LOSER = 3;
const BYSTANDER = 0;

function player(i: number): Player {
  return { id: `player_${i}`, name: `P${i}`, hand: [], type: "human" };
}

function justClosedExchange(): OnlineGameState {
  const gameState = {
    players: USERS.map((_, i) => player(i)),
    currentTurnIndex: 0,
    lastPlayedCombination: null,
    lastPlayedBy: -1,
    passCount: 0,
    gameMode: "free_for_all",
    trickWinner: null,
    roundOver: false,
    finishingOrder: [],
    firstPlayMade: false,
    exchangePhase: { active: false, winnerIdx: WINNER, loserIdx: LOSER, twoJokerException: false, cardToLoser: RETURNED },
  } as unknown as GameState;
  return {
    roomId: "exchange-clock-room",
    gameState,
    playerMap: Object.fromEntries(USERS.map((u, i) => [i, u])),
    spectators: new Set<string>(),
    vacatedSeats: new Map(),
  } as unknown as OnlineGameState;
}

function recordingIo(sent: Map<string, unknown>): SocketServer {
  return {
    to: (room: string) => ({
      timeout: () => ({
        emit: (_event: string, state: unknown) => sent.set(room, state),
      }),
    }),
  } as unknown as SocketServer;
}

describe("the exchange ceremony runs on the server clock", () => {
  test("advancing the clock past the ceremony ends it for the table, and the loser keeps the card", (t) => {
    const clock = fakeClock();
    t.after(installClock(clock));
    const game = justClosedExchange();
    const sent = new Map<string, unknown>();

    broadcastGameState(recordingIo(sent), game);
    const during = [...sent.values()][BYSTANDER] as { exchangePhase?: { cardToLoser?: unknown } };
    assert.deepEqual(during.exchangePhase?.cardToLoser, RETURNED, "inside the window the table is shown the card");

    clock.advance(exchangeAnnounceMs(false) + 1);
    const view = (seat: number) =>
      sanitizeStateForPlayer(game.gameState, USERS[seat]!, game.playerMap).exchangePhase as { cardToLoser?: unknown } | undefined;
    assert.equal(view(BYSTANDER)?.cardToLoser, undefined, "the ceremony is over on the clock the turn runs on");
    assert.deepEqual(view(LOSER)?.cardToLoser, RETURNED, "a participant keeps the card either way");
  });
});
