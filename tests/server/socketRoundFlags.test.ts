// tests/server/socketRoundFlags.test.ts — pure turn logic, exercised against the
// module that owns it with no socket server and no database.
//
// Round flags: a human's AFK-forced move is chosen by autoMoveForSeat
// rather than sent through game:play, and must still record bomb/joker
// tracking — otherwise the purist / iron_will / wild_card achievements
// silently under-count whenever a player's forced-minimum card happens to
// be a lone joker. The flags are written where every move lands: commitMove.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { GameState, Card } from "../../lib/game/gameEngine.ts";
import { autoMoveForSeat } from "../../lib/game/autoMove.ts";
import { commitMove } from "../../server/game/tableMoves.ts";
import { clearRoomTimers } from "../../server/game/gameTimers.ts";
import { onlineTable } from "../helpers/onlineTable.ts";
import { recordingRuntime } from "../helpers/recordingRuntime.ts";
import { aThreePlayed } from "../support/game.ts";

const ROOM = "round-flags-room";

afterEach(() => clearRoomTimers(ROOM));

/** The AFK-forced move for a seat, and the flags committing it leaves on the game. */
function forcedMoveWithFlags(state: GameState, seat: number) {
  const auto = autoMoveForSeat(state, seat, "floor");
  assert.ok(auto, "the forced move must succeed");
  const game = onlineTable({ roomId: ROOM, playerMap: { 1: "bob" }, gameState: state });
  void commitMove(recordingRuntime().rt, game, auto);
  return { auto, roundFlags: game.roundFlags };
}

function baseState(overrides: Partial<GameState> = {}): GameState {
  return {
    players: [
      { id: "player_0", name: "Alice", hand: [], type: "human" },
      {
        id: "player_1",
        name: "Bob",
        hand: [{ id: "4_hearts", suit: "hearts", rank: "4", isJoker: false }],
        type: "human",
      },
    ],
    currentTurnIndex: 0,
    lastPlayedCombination: null,
    lastPlayedBy: 0,
    passCount: 0,
    gameMode: "free_for_all",
    roundOver: false,
    finishingOrder: [],
    openingCard: null,
    playedRanks: aThreePlayed(),
    lastMove: { seq: 0, kind: "deal" },
    ...overrides,
  };
}

test("an AFK-forced lone-joker play sets roundFlags.joker (regression: used to be silently missed)", () => {
  const joker: Card = { id: "joker_bw", suit: null, rank: "joker_bw", isJoker: true };
  const state = baseState({
    players: [
      { id: "player_0", name: "Alice", hand: [joker], type: "human" },
      {
        id: "player_1",
        name: "Bob",
        hand: [{ id: "4_hearts", suit: "hearts", rank: "4", isJoker: false }],
        type: "human",
      },
    ],
  });

  // "floor" is exactly the AFK-forced-human path: a new round with only a
  // joker in hand forces it out as the minimum legal play.
  const { auto, roundFlags } = forcedMoveWithFlags(state, 0);

  assert.equal(auto.move?.kind, "play", "the joker must actually have been played");
  assert.deepEqual(auto.move.kind === "play" && auto.move.combo.cards.map((c) => c.id), ["joker_bw"]);
  assert.equal(auto.state.players[0].hand.length, 0);
  assert.deepEqual(roundFlags[0], { bomb: false, joker: true });
});

test("an AFK-forced ordinary single leaves roundFlags empty for that seat", () => {
  const state = baseState({
    players: [
      {
        id: "player_0",
        name: "Alice",
        hand: [{ id: "5_hearts", suit: "hearts", rank: "5", isJoker: false }],
        type: "human",
      },
      {
        id: "player_1",
        name: "Bob",
        hand: [{ id: "4_hearts", suit: "hearts", rank: "4", isJoker: false }],
        type: "human",
      },
    ],
  });

  const { auto, roundFlags } = forcedMoveWithFlags(state, 0);

  assert.equal(auto.move?.kind, "play");
  assert.equal(auto.state.players[0].hand.length, 0);
  assert.equal(roundFlags[0]?.joker ?? false, false);
  assert.equal(roundFlags[0]?.bomb ?? false, false);
});
