// #850 clause 3: a takeover finishes the current hand at minimum legal
// strength — a raw boolean, not the engine AI — and the engine only plays the
// seat properly from the next deal. Two things are pinned here: `vacateSeat`
// marking the seat weak only for a mid-hand departure (server/game/gameTurn.ts's
// own `!game.gameState.gameOver` guard), and `autoMoveForSeat`'s `useAi=false`
// path — what `runBotTurn` calls once it reads `weakSeats` — always resolving
// the seat's turn, since a seat that cannot act stalls the whole table.
//
// The third suite is a different concern reached through the same function:
// which of `vacateSeat`'s exits write the room's row (#1008).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type { Server as SocketServer } from "socket.io";
import { vacateSeat, autoMoveForSeat, armTurn } from "../../server/game/gameTurn.ts";
import { autoMoveForSeat as chooseMove } from "../../lib/game/autoMove.ts";
import { gameOverWriters, persistence } from "../../server/game/gamePersistence.ts";
import { activeGames } from "../../server/game/gameRoom.ts";
import { clearRoomTimers } from "../../server/game/gameTimers.ts";
import type { OnlineGameState } from "../../server/game/gameRoom.ts";
import { emptyRankTally, sortHand } from "../../lib/game/gameEngine.ts";
import type { Card, GameState, Player } from "../../lib/game/gameEngine.ts";
import type { GameOverWriters } from "../../server/game/gameOver.ts";

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
      await vacateSeat(io, ROOM, "drita",gameOverWriters);

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
      await vacateSeat(io, ROOM, "drita",gameOverWriters);
      assert.ok(!game.weakSeats.has(1));
    } finally {
      clearRoomTimers(ROOM);
      activeGames.delete(ROOM);
    }
  });
});

describe("runBotTurn plays a weak seat at the floor and a bot seat with the AI", () => {
  const card = (id: string, rank: Card["rank"], suit: Card["suit"]): Card => ({ id, rank, suit, isJoker: false });

  // A pair that empties the hand: the AI always finishes, the floor leads one card.
  function leadingPair(): GameState {
    return {
      players: [
        player("p0", "Vacant", [card("9s", "9", "spades"), card("9h", "9", "hearts")]),
        player("p1", "Bob", [card("4s", "4", "spades")]),
        player("p2", "Carl", [card("5s", "5", "spades")]),
        player("p3", "Drita", [card("6s", "6", "spades")]),
      ],
      currentTurnIndex: 0,
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
  }

  async function botPlays(weak: boolean) {
    const state = leadingPair();
    const game = baseGame({
      gameState: state,
      playerMap: { 1: "bob", 2: "carl", 3: "drita" },
      weakSeats: new Set(weak ? [0] : []),
    });
    activeGames.set(ROOM, game);
    try {
      armTurn(io, ROOM, 0);
      await new Promise((r) => setTimeout(r, 30));
      return { state, played: game.gameState.lastPlayedCombination?.cards.map((c) => c.id) };
    } finally {
      clearRoomTimers(ROOM);
      activeGames.delete(ROOM);
    }
  }

  test("a weak seat plays exactly the minimum legal move", async (t) => {
    t.mock.method(persistence, "writeActiveGame", async () => {});
    const { state, played } = await botPlays(true);
    const floor = chooseMove(state, 0, false, {})!.lastPlayedCombination!.cards.map((c) => c.id);
    assert.equal(floor.length, 1);
    assert.deepEqual(played, floor, "runBotTurn must read weakSeats and play the seat at the floor");
  });

  test("a seat that is not weak plays the AI's own choice, which differs from the floor", async (t) => {
    t.mock.method(persistence, "writeActiveGame", async () => {});
    const { state, played } = await botPlays(false);
    const ai = chooseMove(state, 0, true, {})!.lastPlayedCombination!.cards.map((c) => c.id);
    assert.equal(ai.length, 2);
    assert.deepEqual(played, ai);
  });
});

describe("vacateSeat writes the row on every exit the table survives (#1008)", () => {
  /**
   * Every writer recorded, not just the persist: `vacateSeat` hands this same
   * set to `handleGameOver` and `voidAbandonedMatch`, so a one-key stub would
   * throw `undefined is not a function` on a branch instead of naming it.
   */
  function persistSpy() {
    const wrote: { roomId: string; seats: string[]; vacated: number[] }[] = [];
    const reached: (keyof GameOverWriters)[] = [];
    const record =
      (name: keyof GameOverWriters) =>
      async (): Promise<void> => {
        reached.push(name);
      };
    return {
      wrote,
      reached,
      writers: {
        updateRoomStatus: record("updateRoomStatus"),
        recordGameResult: record("recordGameResult"),
        recordRatedResult: async () => {
          await record("recordRatedResult")();
          return new Map<string, number>();
        },
        saveReplay: record("saveReplay"),
        previewRatedDeltas: async () => {
          reached.push("previewRatedDeltas");
          return new Map<string, number>();
        },
        // Copied here, not read from `game` after the call: the stub is handed
        // the live table by reference, and what the row must carry is what
        // these fields held at the moment the write was made.
        persistGameState: async (roomId: string, game: OnlineGameState) => {
          reached.push("persistGameState");
          wrote.push({
            roomId,
            seats: Object.keys(game.playerMap),
            vacated: [...game.vacatedSeats.keys()],
          });
        },
      } satisfies GameOverWriters,
    };
  }

  test("mid-hand, with the table still playing on", async () => {
    const gameState: GameState = {
      players: [
        player("p0", "Alice", [{ rank: "4", suit: "spades" } as never]),
        player("p1", "Bob", [{ rank: "5", suit: "spades" } as never]),
        player("p2", "Carl", [{ rank: "6", suit: "spades" } as never]),
        player("p3", "Drita", [{ rank: "7", suit: "spades" } as never]),
      ],
      currentTurnIndex: 0,
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
    activeGames.set(
      ROOM,
      baseGame({ gameState, playerMap: { 0: "alice", 1: "bob", 2: "carl", 3: "drita" } })
    );
    const spy = persistSpy();

    try {
      await vacateSeat(io, ROOM, "drita",spy.writers);
      assert.deepEqual(
        spy.wrote,
        [{ roomId: ROOM, seats: ["0", "1", "2"], vacated: [3] }],
        "the surviving table's new roster — Drita's seat gone, and recorded as reclaimable"
      );
    } finally {
      clearRoomTimers(ROOM);
      activeGames.delete(ROOM);
    }
  });

  test("between hands, with someone left to deal to", async () => {
    const gameState: GameState = {
      players: [player("p0", "Alice", []), player("p1", "Drita", [])],
      currentTurnIndex: 0,
      lastPlayedCombination: null,
      lastPlayedBy: -1,
      passCount: 0,
      gameMode: "free_for_all",
      roundWinner: null,
      gameOver: true,
      rankings: ["p0", "p1"],
      firstPlayMade: true,
    };
    activeGames.set(ROOM, baseGame({ gameState, playerMap: { 0: "alice", 1: "drita" } }));
    const spy = persistSpy();

    try {
      await vacateSeat(io, ROOM, "drita",spy.writers);
      assert.deepEqual(
        spy.wrote,
        [{ roomId: ROOM, seats: ["0"], vacated: [1] }],
        "a seat vacated between hands is still reclaimable — off the roster, on vacatedSeats"
      );
    } finally {
      clearRoomTimers(ROOM);
      activeGames.delete(ROOM);
    }
  });

  test("the last player leaving between hands writes nothing — the row is deleted", async () => {
    const gameState: GameState = {
      players: [player("p0", "Drita", [])],
      currentTurnIndex: 0,
      lastPlayedCombination: null,
      lastPlayedBy: -1,
      passCount: 0,
      gameMode: "free_for_all",
      roundWinner: null,
      gameOver: true,
      rankings: ["p0"],
      firstPlayMade: true,
    };
    activeGames.set(ROOM, baseGame({ gameState, playerMap: { 0: "drita" } }));
    const spy = persistSpy();

    try {
      await vacateSeat(io, ROOM, "drita",spy.writers);
      assert.deepEqual(spy.wrote, [], "persisting a table being disposed of races its own delete");
      assert.equal(activeGames.has(ROOM), false, "the table is gone, not merely unwritten");
      // This branch does write — roomStore.updateRoomStatus, and disposeGame's
      // own delete of the row — but both sit outside the seam, so all this can
      // say is that no GameOverWriters member ran. That is what rules out
      // handleGameOver and voidAbandonedMatch, each of which persists.
      assert.deepEqual(spy.reached, [], "no GameOverWriters member on the path that deletes the row");
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
