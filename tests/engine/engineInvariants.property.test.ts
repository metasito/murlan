import { test } from "node:test";
import assert from "node:assert/strict";
import * as fc from "fast-check";
import {
  checkPass,
  checkPlay,
  getAllValidPlays,
  getRankStrength,
  getValidGivebackCards,
  initializeGame,
  initializeRematch,
  processExchangeChoice,
  processPass,
  processPlay,
  teamForSeat,
  type Card,
  type Combination,
  type GameMode,
  type GameState,
} from "../../lib/game/gameEngine.ts";
import { autoMoveForSeat } from "../../lib/game/autoMove.ts";
import { withSeededDeals } from "../helpers/offlineMatch.ts";
import { mulberry32 } from "../support/game.ts";

// Every step of two rounds, under any sequence of legal choices, keeps the
// engine's own promises. fast-check shrinks a failure to the shortest choice
// list that still breaks one, and prints the seed that replays it.

// Fixed so CI explores the same space each run; set FC_SEED to search elsewhere.
const SEED = Number(process.env.FC_SEED ?? 20261019);
const NUM_RUNS = Number(process.env.FC_RUNS ?? 60);
const MOVES_CEILING = 600;

const TABLES: { players: number; mode: GameMode }[] = [
  { players: 2, mode: "free_for_all" },
  { players: 3, mode: "free_for_all" },
  { players: 4, mode: "free_for_all" },
  { players: 4, mode: "teams" },
];

type Step =
  | { kind: "bot" }
  | { kind: "play"; combo: Combination }
  | { kind: "pass" }
  | { kind: "giveback"; card: Card };

const ids = (cards: Card[]) => cards.map((c) => c.id);
const handIds = (state: GameState) => state.players.flatMap((p) => ids(p.hand));

function stepsFor(state: GameState): Step[] {
  const exchange = state.exchangePhase;
  if (exchange?.active) {
    const winner = state.players[exchange.winnerIdx];
    return [{ kind: "bot" }, ...getValidGivebackCards(winner.hand, exchange.cardFromLoser?.id).map((card) => ({ kind: "giveback" as const, card }))];
  }
  const seat = state.players[state.currentTurnIndex];
  const isNewTrick = state.lastPlayedCombination === null;
  const requireCard = !state.firstPlayMade && state.startCard
    ? seat.hand.find((c) => c.id === state.startCard!.id)
    : undefined;
  const plays = getAllValidPlays(seat.hand, state.lastPlayedCombination, isNewTrick, requireCard);
  return [
    { kind: "bot" },
    ...plays.map((combo) => ({ kind: "play" as const, combo })),
    ...(checkPass(state).ok ? [{ kind: "pass" as const }] : []),
  ];
}

/** Applies one step and returns what it put on the table, checking it was legal before it landed. */
function apply(state: GameState, step: Step, rng: () => number): { next: GameState; played: Card[] } {
  const acting = state.exchangePhase?.active ? state.exchangePhase.winnerIdx : state.currentTurnIndex;
  switch (step.kind) {
    case "giveback":
      return { next: processExchangeChoice(state, step.card.id), played: [] };
    case "pass":
      return { next: processPass(state), played: [] };
    case "play": {
      const check = checkPlay(state, acting, ids(step.combo.cards));
      assert.ok(check.ok, `an offered play is refused: ${JSON.stringify(check)}`);
      return { next: processPlay(state, step.combo), played: step.combo.cards };
    }
    case "bot": {
      let chosen: Combination | null | undefined;
      const next = autoMoveForSeat(state, acting, true, { rng, onMove: (_, combo) => { chosen = combo; } });
      assert.ok(next, `seat ${acting} is on move and the bot has nothing to do`);
      if (chosen) assert.ok(checkPlay(state, acting, ids(chosen.cards)).ok, "the bot played an illegal combination");
      if (chosen === null) assert.ok(checkPass(state).ok, "the bot passed where a pass is refused");
      return { next, played: chosen?.cards ?? [] };
    }
  }
}

function assertHolds(state: GameState, dealt: string[], played: Card[]) {
  const held = handIds(state);
  const everywhere = [...held, ...ids(played)];
  assert.equal(new Set(everywhere).size, everywhere.length, "a card is in two places");
  assert.deepEqual([...everywhere].sort(), dealt, "a card appeared or vanished");

  const tally = new Array<number>(15).fill(0);
  for (const card of played) tally[getRankStrength(card.rank)] += 1;
  assert.deepEqual(state.playedRanks ?? tally.map(() => 0), tally, "playedRanks disagrees with the cards played");

  assert.equal(new Set(state.finishingOrder).size, state.finishingOrder.length, "a seat finished twice");
  if (state.roundOver) {
    assert.deepEqual([...state.finishingOrder].sort(), state.players.map((p) => p.id).sort(), "the finishing order is not every seat once");
  } else if (!state.exchangePhase?.active) {
    assert.ok(state.players[state.currentTurnIndex].hand.length > 0, `seat ${state.currentTurnIndex} is on move with no cards`);
  }
}

function playRound(start: GameState, choices: number[], rng: () => number): GameState {
  let state = start;
  const dealt = handIds(start).sort();
  const played: Card[] = [];
  assertHolds(state, dealt, played);
  for (let move = 0; !state.roundOver; move++) {
    assert.ok(move < MOVES_CEILING, `the round did not end in ${MOVES_CEILING} moves`);
    const steps = stepsFor(state);
    const choice = choices[move] ?? Math.floor(rng() * steps.length);
    const { next, played: landed } = apply(state, steps[choice % steps.length], rng);
    assert.notEqual(next, state, "a legal step left the state untouched");
    played.push(...landed);
    state = next;
    assertHolds(state, dealt, played);
  }
  return state;
}

for (const table of TABLES) {
  test(`${table.players} seats, ${table.mode}: two rounds of any legal choices keep the engine's invariants`, () => {
    const setup = Array.from({ length: table.players }, (_, i) => ({ name: `P${i}`, type: "bot" as const, team: teamForSeat(i, table.players, table.mode) }));
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 2 ** 31 - 1 }), fc.array(fc.nat()), fc.array(fc.nat()), (seed, firstChoices, secondChoices) => {
        const rng = mulberry32(seed);
        const first = withSeededDeals(seed, () => initializeGame(setup, table.mode, 0));
        const over = playRound(first, firstChoices, rng);
        const withIds = setup.map((p, i) => ({ ...p, id: `player_${i}` }));
        const second = withSeededDeals(seed + 1, () => initializeRematch(withIds, table.mode, over.finishingOrder, 1 % table.players));
        playRound(second, secondChoices, rng);
      }),
      { seed: SEED, numRuns: NUM_RUNS },
    );
  });
}
