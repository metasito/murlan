// `botSeatsFromPersonality` (server/onlineGameLogic.ts) tells a born-bot seat
// apart from one a human vacated by reading `personality`, which is set once
// at roster-build time and must never be set by a departure. Nothing else
// checks that `vacateSeat` keeps its side of that contract — a personality
// set here would make a departed human's seat read back as a born bot and
// start accumulating points under the name they left behind.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Server as SocketServer } from "socket.io";
import { vacateSeat } from "../server/gameTurn.ts";
import { activeGames } from "../server/gameRoom.ts";
import type { OnlineGameState } from "../server/gameRoom.ts";
import type { GameState, Player } from "../lib/gameEngine.ts";

const ROOM = "vacate-personality-room";

function player(id: string, name: string): Player {
  return { id, name, hand: [], type: "human" };
}

/** A stub io that records nothing — vacateSeat's emits are not under test here. */
const io = { to: () => ({ emit: () => {} }) } as unknown as SocketServer;

test("vacateSeat never sets personality on the seat it hands to the AI", async () => {
  const gameState: GameState = {
    players: [player("p0", "rotonmeta"), player("p1", "drita")],
    currentTurnIndex: 0,
    lastPlayedCombination: null,
    lastPlayedBy: -1,
    passCount: 0,
    gameMode: "free_for_all",
    roundWinner: null,
    // Between hands: vacateSeat's simplest branch, no board- or DB-affecting
    // side effect once `remaining` stays above zero.
    gameOver: true,
    rankings: ["p0", "p1"],
    firstPlayMade: true,
  };
  const game = {
    roomId: ROOM,
    playerMap: { 0: "u_rotonmeta", 1: "u_drita" },
    rematchVotes: new Set<string>(),
    releasedSeats: new Set<string>(),
    abandonedSeats: new Map<number, string>(),
    gameState,
  } as unknown as OnlineGameState;
  activeGames.set(ROOM, game);

  await vacateSeat(io, ROOM, "u_drita", "drita");

  const vacated = game.gameState.players[1];
  assert.equal(vacated?.type, "ai");
  assert.equal(
    vacated?.personality,
    undefined,
    "a vacated seat must read the same as a never-seated one to botSeatsFromPersonality"
  );
});
