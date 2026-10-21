import { test } from "node:test";
import assert from "node:assert/strict";
import * as fc from "fast-check";
import type { GameMode, GameState, LastMove } from "../../lib/game/gameEngine.ts";
import type { OfflineTable } from "../../lib/game/matchFlow.ts";
import type { MoveContext } from "../../lib/game/simulate.ts";
import { replayStateAt, type ReplayDto, type ReplayMove } from "../../lib/game/replay.ts";
import { decodeOfflineSave, encodeOfflineSave } from "../../lib/offlineSave.ts";
import { parseGameState } from "../../shared/gameStateSchema.ts";
import { appendReplayMove, replaySeatsOf } from "../../server/game/replayShape.ts";
import { simulateOfflineMatch, type SimulateMatchOptions } from "../helpers/offlineMatch.ts";
import { mulberry32 } from "../support/game.ts";

// Every state of a seeded match makes three round trips — the offline save, the persisted restore
// gate, the replay — and each loses nothing. fast-check shrinks a failure to its (seed, table).

const SEED = Number(process.env.FC_SEED ?? 20261021);
const NUM_RUNS = Number(process.env.FC_RUNS ?? 6);
const MIN_TRANSITIONS = 40;

const TABLES: { players: number; mode: GameMode }[] = [
  { players: 2, mode: "free_for_all" },
  { players: 3, mode: "free_for_all" },
  { players: 4, mode: "free_for_all" },
  { players: 4, mode: "teams" },
];

const draws = fc.tuple(fc.integer({ min: 1, max: 2 ** 31 - 1 }), fc.constantFrom(...TABLES));

type Table = (typeof TABLES)[number];

function play(seed: number, table: Table, extra: Partial<SimulateMatchOptions>): void {
  simulateOfflineMatch({
    seed,
    players: Array.from({ length: table.players }, (_, i) => ({ name: `Bot${i}`, type: "bot" as const })),
    gameMode: table.mode,
    length: "match",
    botRng: mulberry32,
    ...extra,
  });
}

const seen = { exchange: false, twoJokers: false };

function trace(seed: number, table: Table, passThrough?: (t: OfflineTable) => OfflineTable): string[] {
  const states: string[] = [];
  play(seed, table, {
    passThrough,
    onTransition: (_prev, next) => {
      states.push(JSON.stringify(next));
      if (next.lastMove.kind === "giveback") seen.exchange = true;
      if (next.lastMove.kind === "deal" && next.exchangePhase?.kind === "twoJokers") seen.twoJokers = true;
    },
  });
  assert.ok(states.length >= MIN_TRANSITIONS, `only ${states.length} transitions at ${table.players} seats, ${table.mode}`);
  return states;
}

function sameTrace(seed: number, table: Table, passThrough: (t: OfflineTable) => OfflineTable): void {
  const expected = trace(seed, table);
  const actual = trace(seed, table, passThrough);
  assert.equal(actual.length, expected.length, "the round trip changed how long the match ran");
  for (let i = 0; i < expected.length; i++) {
    if (actual[i] !== expected[i]) assert.deepEqual(JSON.parse(actual[i]), JSON.parse(expected[i]), `transition ${i} differs after the round trip`);
  }
}

function assertBandCovered(): void {
  assert.ok(seen.exchange, "no exchange round was played across the band");
  assert.ok(seen.twoJokers, "no two-Joker deal was played across the band");
}

test("every state of a seeded match saves offline and resumes into the same match", () => {
  seen.exchange = seen.twoJokers = false;
  fc.assert(
    fc.property(draws, ([seed, table]) =>
      sameTrace(seed, table, (t) => {
        const back = decodeOfflineSave(encodeOfflineSave({ gameState: t.state, match: t.match, dealFirstSeat: t.dealFirstSeat }));
        assert.equal(back.kind, "ok", `the save decoded as ${back.kind}`);
        if (back.kind !== "ok") return t;
        assert.deepEqual(back.save.match, t.match);
        assert.equal(back.save.dealFirstSeat, t.dealFirstSeat);
        return { state: back.save.gameState, match: back.save.match, dealFirstSeat: back.save.dealFirstSeat };
      })
    ),
    { seed: SEED, numRuns: NUM_RUNS }
  );
  assertBandCovered();
});

test("every state of a seeded match passes the persisted restore gate into the same match", () => {
  seen.exchange = seen.twoJokers = false;
  fc.assert(
    fc.property(draws, ([seed, table]) =>
      sameTrace(seed, table, (t) => {
        const restored = parseGameState(JSON.parse(JSON.stringify(t.state)));
        assert.ok(restored.ok, restored.ok ? "" : restored.reason);
        return restored.ok ? { ...t, state: restored.state } : t;
      })
    ),
    { seed: SEED, numRuns: NUM_RUNS }
  );
  assertBandCovered();
});

interface LoggedRound {
  game: { moveLog: ReplayMove[] | null; replayOpening?: LastMove };
  before: GameState;
  after: GameState[];
}

function replayAgrees(round: LoggedRound): void {
  const { game, before, after } = round;
  assert.ok(game.moveLog, "the round's move log was abandoned");
  const final = after.at(-1)!;
  assert.ok(final.roundOver, "the logged round did not end");
  const dto: ReplayDto = {
    id: "property",
    finishedAt: "",
    gameMode: final.gameMode,
    seats: replaySeatsOf(final.players, {}),
    moves: game.moveLog,
    opening: game.replayOpening ?? null,
    finishingOrder: final.finishingOrder,
  };
  for (let k = -1; k < after.length; k++) {
    const live = k < 0 ? before : after[k];
    const shown = replayStateAt(dto, k);
    const at = `move ${k} (seq ${live.lastMove.seq})`;
    assert.deepEqual(
      shown.players.map((p) => ({ id: p.id, name: p.name, handCount: (p as typeof p & { handCount: number }).handCount })),
      live.players.map((p) => ({ id: p.id, name: p.name, handCount: p.hand.length })),
      `${at}: seats`
    );
    assert.deepEqual(shown.lastMove, live.lastMove, `${at}: lastMove`);
    assert.deepEqual(shown.lastPlayedCombination, live.lastPlayedCombination, `${at}: pile`);
    if (live.lastPlayedCombination) assert.equal(shown.lastPlayedBy, live.lastPlayedBy, `${at}: whose pile`);
    assert.deepEqual(shown.playedRanks, live.playedRanks, `${at}: playedRanks`);
    assert.equal(shown.gameMode, live.gameMode, `${at}: gameMode`);
    assert.equal(shown.roundOver, live.roundOver, `${at}: roundOver`);
    if (live.roundOver) assert.deepEqual(shown.finishingOrder, live.finishingOrder, `${at}: finishingOrder`);
    else if (k >= 0) assert.equal(shown.currentTurnIndex, live.currentTurnIndex, `${at}: seat on move`);
  }
}

test("every round of a seeded match replays as the live table played it, move by move", () => {
  seen.exchange = seen.twoJokers = false;
  let rounds = 0;
  fc.assert(
    fc.property(draws, ([seed, table]) => {
      let round: LoggedRound | null = null;
      let roundIndex = -1;
      play(seed, table, {
        onTransition: (_prev, next) => {
          if (next.lastMove.kind === "giveback") seen.exchange = true;
          if (next.lastMove.kind === "deal" && next.exchangePhase?.kind === "twoJokers") seen.twoJokers = true;
        },
        // As server/game/tableMoves.ts's `commitMove` logs a move for the replay.
        onMove: ({ state, move: applied, roundIndex: index }: MoveContext) => {
          if (index !== roundIndex) {
            roundIndex = index;
            round = { game: { moveLog: [] }, before: state, after: [] };
          }
          const move = applied.move;
          if (move?.kind !== "play" && move?.kind !== "pass") return;
          const r = round!;
          if (r.after.length === 0) r.before = state;
          appendReplayMove(r.game, move.seat, move.kind === "play" ? move.combo : null, state, applied.state);
          r.after.push(applied.state);
          if (applied.state.roundOver) {
            replayAgrees(r);
            rounds++;
          }
        },
      });
    }),
    { seed: SEED, numRuns: NUM_RUNS }
  );
  assert.ok(rounds >= NUM_RUNS, `only ${rounds} rounds replayed`);
  assertBandCovered();
});
