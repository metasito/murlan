import { test } from "node:test";
import assert from "node:assert/strict";
import { MatchStallError, mulberry32, rng, simulateMatch, type SimulateOptions } from "../../lib/game/simulate.ts";
import { autoMoveForSeat } from "../../lib/game/autoMove.ts";
import type { SeatSetup } from "../../lib/game/gameEngine.ts";

const players: SeatSetup[] = [
  { name: "A", type: "bot" },
  { name: "B", type: "bot" },
  { name: "C", type: "bot" },
];
const base: SimulateOptions = { seed: 5, players, gameMode: "free_for_all", length: "match", botRng: mulberry32 };

const stallOf = (run: () => unknown): MatchStallError => {
  try {
    run();
  } catch (err) {
    assert.ok(err instanceof MatchStallError, `expected a MatchStallError, got ${String(err)}`);
    return err;
  }
  assert.fail("the match did not stall");
};

test("a seed gives the same stream every time, and another seed a different one", () => {
  const draw = (seed: number) => {
    const next = mulberry32(seed);
    return Array.from({ length: 4 }, next);
  };
  assert.deepEqual(draw(1), draw(1));
  assert.notDeepEqual(draw(1), draw(2));
  assert.deepEqual(draw(1), [0.6270739405881613, 0.002735721180215478, 0.5274470399599522, 0.9810509674716741]);
  assert.ok(draw(1).every((x) => x >= 0 && x < 1));
});

test("the deal's random words are the bot stream's own draws, one per word", () => {
  const stream = mulberry32(9);
  const expected = Array.from({ length: 4 }, () => Math.floor(stream() * 0x100000000));
  const r = rng(9);
  assert.deepEqual([...r.source.getRandomValues(new Uint32Array(3))], expected.slice(0, 3));
  assert.equal(Math.floor(r.next() * 0x100000000), expected[3]);
});

test("without a mover, every seat plays as the full-strength bot", () => {
  const bot = simulateMatch({ ...base, move: (state, seat, botRng) => autoMoveForSeat(state, seat, "bot", botRng) });
  const floor = simulateMatch({ ...base, move: (state, seat, botRng) => autoMoveForSeat(state, seat, "floor", botRng) });
  assert.notDeepEqual(bot.rounds, floor.rounds);
  assert.deepEqual(simulateMatch(base), bot);
});

test("a mover that is given plays every move", () => {
  let calls = 0;
  const r = simulateMatch({
    ...base,
    move: (state, seat, botRng) => {
      calls++;
      return autoMoveForSeat(state, seat, "floor", botRng);
    },
  });
  assert.equal(calls, r.rounds.reduce((total, round) => total + round.moves, 0));
});

test("each round counts its moves, and each move its place in the round from 1", () => {
  const seen: number[][] = [];
  const r = simulateMatch({
    ...base,
    onMove: ({ roundIndex, moveIndex }) => (seen[roundIndex] ??= []).push(moveIndex),
  });
  assert.ok(r.rounds.length > 1);
  for (const [i, round] of r.rounds.entries()) {
    assert.deepEqual(seen[i], Array.from({ length: round.moves }, (_, k) => k + 1));
  }
});

test("a match that needs more rounds than maxRounds stalls once that many are played", () => {
  let started = 0;
  const err = stallOf(() => simulateMatch({ ...base, maxRounds: 1, onRoundStart: () => started++ }));
  assert.equal(started, 1);
  assert.equal(err.rounds.length, 1);
  assert.equal(err.seed, 5);
  assert.match(String(err), /^MatchStallError: /);
  assert.equal(stallOf(() => simulateMatch({ ...base, maxRounds: 0 })).rounds.length, 0);
});

test("a round that needs more moves than maxMovesPerRound stalls once that many are made", () => {
  let moves = 0;
  const err = stallOf(() => simulateMatch({ ...base, maxMovesPerRound: 3, onMove: () => moves++ }));
  assert.equal(moves, 3);
  assert.deepEqual(err.rounds, []);
});

test("a seat with no move stalls the match instead of crashing it", () => {
  const err = stallOf(() => simulateMatch({ ...base, move: () => null }));
  assert.deepEqual(err.rounds, []);
  assert.match(String(err), /^MatchStallError: /);
});
