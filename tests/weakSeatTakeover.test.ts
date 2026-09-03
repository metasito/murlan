// #850 clause 3: a takeover finishes the current hand at minimum legal
// strength — a raw boolean, not the engine AI — and the engine only plays the
// seat properly from the next deal. Two things are pinned here: `vacateSeat`
// marking the seat weak only for a mid-hand departure (server/gameTurn.ts's
// own `!game.gameState.gameOver` guard), and `autoMoveForSeat`'s `useAi=false`
// path — what `runBotTurn` calls once it reads `weakSeats` — always resolving
// the seat's turn, since a seat that cannot act stalls the whole table.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type { Server as SocketServer } from "socket.io";
import { vacateSeat, autoMoveForSeat } from "../server/gameTurn.ts";
import { activeGames } from "../server/gameRoom.ts";
import { clearRoomTimers } from "../server/gameTimers.ts";
import type { OnlineGameState } from "../server/gameRoom.ts";
import { emptyRankTally, sortHand } from "../lib/gameEngine.ts";
import type { GameState, Player } from "../lib/gameEngine.ts";

const ROOM = "weak-seat-room";

/** Answers both call shapes gameTurn.ts's own emits and sendGameStateTo need. */
const io = {
  to: () => ({
    emit: () => {},
    timeout: () => ({ emit: () => {} }),
  }),
} as unknown as SocketServer;

function player(id: string, name: string, hand: Player["hand"] = []): Player {
  return { id, name, hand, type: "human" };
}

function baseGame(overrides: Partial<OnlineGameState>): OnlineGameState {
  return {
    roomId: ROOM,
    joinCode: "AAAAAA",
    playerMap: {},
    rematchVotes: new Set(),
    rematchIntents: new Map(),
    cumulativeScores: {},
    gameMode: "free_for_all",
    maxPlayers: 4,
    matchTarget: 21,
    matchLength: "match",
    handsPlayed: 0,
    matchOver: false,
    handFlags: {},
    abandonedSeats: new Map(),
    botSeatsAtStart: new Set(),
    releasedSeats: new Set(),
    vacatedSeats: new Map(),
    weakSeats: new Set(),
    endMatchVotes: new Set(),
    dealFirstSeat: 0,
    spectators: new Set(),
    moveLog: null,
    gameState: overrides.gameState as GameState,
    ...overrides,
  } as OnlineGameState;
}

describe("a mid-hand takeover is weak only for the hand it happened on (#850 clause 3)", () => {
  test("vacateSeat marks the seat weak when the table survives it mid-hand", async () => {
    const gameState: GameState = {
      players: [
        player("p0", "Alice", [{ rank: "4", suit: "spades" } as never]),
        player("p1", "Bob", [{ rank: "5", suit: "spades" } as never]),
        player("p2", "Carl", [{ rank: "6", suit: "spades" } as never]),
        player("p3", "Drita", [{ rank: "7", suit: "spades" } as never]),
      ],
      currentTurnIndex: 0, // Alice's turn — not the seat being vacated.
      lastPlayedCombination: null,
      lastPlayedBy: -1,
      passCount: 0,
      gameMode: "free_for_all",
      roundWinner: null,
      gameOver: false,
      rankings: [],
      firstPlayMade: true,
      playedRanks: emptyRankTally(),
    };
    const game = baseGame({
      gameState,
      playerMap: { 0: "alice", 1: "bob", 2: "carl", 3: "drita" },
    });
    activeGames.set(ROOM, game);

    try {
      await vacateSeat(io, ROOM, "drita", "Drita");

      assert.ok(game.weakSeats.has(3), "the seat just vacated mid-hand must be weak");
      assert.equal(game.vacatedSeats.get(3)?.userId, "drita");
      // The table survives (three seats remain) rather than being conceded.
      assert.equal(game.gameState.gameOver, false);
    } finally {
      clearRoomTimers(ROOM);
      activeGames.delete(ROOM);
    }
  });

  test("vacateSeat between hands leaves the seat off weakSeats — no hand is in progress to protect", async () => {
    const gameState: GameState = {
      players: [player("p0", "Alice", []), player("p1", "Drita", [])],
      currentTurnIndex: 0,
      lastPlayedCombination: null,
      lastPlayedBy: -1,
      passCount: 0,
      gameMode: "free_for_all",
      roundWinner: null,
      gameOver: true, // between hands
      rankings: ["p0", "p1"],
      firstPlayMade: true,
    };
    const game = baseGame({
      gameState,
      playerMap: { 0: "alice", 1: "drita" },
    });
    activeGames.set(ROOM, game);

    try {
      await vacateSeat(io, ROOM, "drita", "Drita");
      assert.ok(!game.weakSeats.has(1));
    } finally {
      clearRoomTimers(ROOM);
      activeGames.delete(ROOM);
    }
  });
});

describe("autoMoveForSeat(useAi=false) — what a weak seat's turn resolves to (#850 clause 3)", () => {
  // gameTurn.ts's autoMoveForSeat — the one runBotTurn calls once it reads
  // weakSeats — takes the table's shape, not a bare GameState.
  const mkGame = (gameState: GameState) => ({ gameState, handFlags: {}, moveLog: null });

  test("opening a fresh round plays the single lowest card, never the AI's own choice of combination", () => {
    const state: GameState = {
      players: [
        player("p0", "Alice", [
          { rank: "9", suit: "spades" } as never,
          { rank: "3", suit: "hearts" } as never,
        ]),
        player("p1", "Bob", [{ rank: "4", suit: "spades" } as never]),
      ],
      currentTurnIndex: 0,
      lastPlayedCombination: null, // new round: a pass is not legal
      lastPlayedBy: -1,
      passCount: 0,
      gameMode: "free_for_all",
      roundWinner: null,
      gameOver: false,
      rankings: [],
      firstPlayMade: true,
    };

    const next = autoMoveForSeat(mkGame(state), 0, false);
    assert.ok(next, "a weak seat must always resolve its turn — the table cannot stall on it");
    const lowest = sortHand([...state.players[0]!.hand])[0]!;
    assert.deepEqual(next!.lastPlayedCombination?.cards.map((c) => c.id ?? c.rank), [
      lowest.id ?? lowest.rank,
    ]);
    assert.equal(next!.lastPlayedCombination?.cards.length, 1, "minimum legal, not a bigger combination the AI could see");
  });

  test("mid-round with nothing worth playing, it passes rather than reaching for the AI's judgement", () => {
    const state: GameState = {
      players: [
        player("p0", "Alice", [{ rank: "3", suit: "spades" } as never]),
        player("p1", "Bob", [{ rank: "4", suit: "spades" } as never]),
      ],
      currentTurnIndex: 0,
      lastPlayedCombination: {
        type: "single",
        cards: [{ rank: "K", suit: "spades", id: "k1" } as never],
        rank: "K",
      } as never,
      lastPlayedBy: 1,
      passCount: 0,
      gameMode: "free_for_all",
      roundWinner: null,
      gameOver: false,
      rankings: [],
      firstPlayMade: true,
    };

    const next = autoMoveForSeat(mkGame(state), 0, false);
    assert.ok(next, "a weak seat must always resolve its turn even when it only ever passes");
    assert.equal(next!.lastPlayedBy, 1, "a pass leaves the last play credited to whoever made it");
  });

  test("the seat still resolves its turn with a single card left, the case a stalled table would show", () => {
    const state: GameState = {
      players: [
        player("p0", "Alice", [{ rank: "3", suit: "clubs", id: "start" } as never]),
        player("p1", "Bob", [{ rank: "4", suit: "spades" } as never]),
      ],
      currentTurnIndex: 0,
      lastPlayedCombination: null,
      lastPlayedBy: -1,
      passCount: 0,
      gameMode: "free_for_all",
      roundWinner: null,
      gameOver: false,
      rankings: [],
      firstPlayMade: false,
      startCard: { rank: "3", suit: "clubs", id: "start" } as never,
    };

    const next = autoMoveForSeat(mkGame(state), 0, false);
    assert.ok(next, "the mandatory opening card is always playable, so this must never be null");
  });
});
