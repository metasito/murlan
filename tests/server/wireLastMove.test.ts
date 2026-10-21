import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeStateForPlayer } from "../../server/game/gamePersistence.ts";
import { buildCombination, getValidGivebackCards, startRound, type GameState, type SeatSetup } from "../../lib/game/gameEngine.ts";
import { givenBack, passed, played } from "../support/moves.ts";
import { rng } from "../support/game.ts";

const SEATS: SeatSetup[] = [0, 1, 2, 3].map((i) => ({ name: `p${i}`, type: "human" }));
const PLAYER_MAP = { 0: "u0", 1: "u1", 2: "u2", 3: "u3" };

function afterGiveback(): GameState {
  const dealt = startRound(SEATS, "free_for_all", { random: rng(1).source, opening: { kind: "exchange", winnerSeat: 0, loserSeat: 3 } });
  const phase = dealt.exchangePhase!;
  return givenBack(dealt, getValidGivebackCards(dealt.players[0].hand, phase.cardFromLoser?.id)[0].id);
}

function afterPass(): GameState {
  const opened = startRound(SEATS, "free_for_all", { random: rng(2).source });
  const opener = opened.players[opened.currentTurnIndex];
  return passed(played(opened, buildCombination([opener.hand.find((c) => c.id === opened.openingCard!.id)!])!));
}

for (const [name, state] of [["giveback", afterGiveback()], ["pass", afterPass()]] as const) {
  test(`the ${name} reaches the mover, another seat and a spectator alike`, () => {
    const mover = state.lastMove.kind === "deal" ? 0 : state.lastMove.seat;
    const other = (mover + 1) % SEATS.length;
    const views = [`u${mover}`, `u${other}`, "spectator"].map(
      (viewer) => sanitizeStateForPlayer(state, viewer, PLAYER_MAP).lastMove
    );
    assert.equal(state.lastMove.kind, name);
    for (const view of views) assert.deepEqual(view, state.lastMove);
  });
}
