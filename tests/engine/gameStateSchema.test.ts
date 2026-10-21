// tests/engine/gameStateSchema.test.ts — the one parse both restore seams hold a stored engine state to.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { UNSATISFIABLE_EXCHANGE, parseGameState, type Same } from "../../shared/gameStateSchema.ts";
import type { GameState, Player } from "../../lib/game/gameEngine.ts";
import { reachSteps } from "../../lib/situation.ts";
import { ALL_CAPTURE_STATES, captureGameState } from "../../lib/captureStates.ts";
import { card, seat, state } from "../support/game.ts";

const reason = (raw: unknown): string => {
  const parsed = parseGameState(raw);
  assert.equal(parsed.ok, false, "parsed a state that should have been refused");
  return parsed.ok ? "" : parsed.reason;
};

describe("every state the engine writes parses, unchanged", () => {
  test("each step of every named situation", () => {
    for (const capture of ALL_CAPTURE_STATES) {
      reachSteps(capture.situation).forEach((reached, step) => {
        const parsed = parseGameState(JSON.parse(JSON.stringify(reached)));
        assert.ok(parsed.ok, `${capture.situation.name} step ${step}: ${parsed.ok ? "" : parsed.reason}`);
        assert.deepEqual(parsed.state, JSON.parse(JSON.stringify(reached)));
      });
      assert.ok(parseGameState(captureGameState(capture)).ok, capture.situation.name);
    }
  });

  test("state()'s default", () => {
    const parsed = parseGameState(state());
    assert.ok(parsed.ok, parsed.ok ? "" : parsed.reason);
    assert.deepEqual(parsed.state, state());
  });
});

describe("states the engine could not have written", () => {
  test("an open exchange whose winner holds nothing to give back", () => {
    const empty = state({
      players: [seat(0, []), seat(1, [card("4", "clubs")])],
      exchangePhase: { active: true, winnerIdx: 0, loserIdx: 1, twoJokerException: false },
    });
    assert.equal(reason(empty), UNSATISFIABLE_EXCHANGE);
    assert.ok(parseGameState({ ...empty, exchangePhase: { ...empty.exchangePhase!, active: false } }).ok);
  });

  test("a round with no played-rank tally, or one the deck cannot hold", () => {
    const { playedRanks: _dropped, ...untallied } = state();
    assert.match(reason(untallied), /^game state playedRanks: /);
    assert.match(reason(state({ playedRanks: [0] })), /^game state playedRanks: /);
    assert.match(reason(state({ playedRanks: state().playedRanks.map(() => 5) })), /more of a rank played than the deck holds/);
  });

  test("a card, seat or last move of the wrong shape names where", () => {
    assert.match(reason(state({ players: [seat(0, [{ ...card("4", "clubs"), rank: "1" as never }])] })), /^game state players\.0\.hand\.0\.rank: /);
    assert.match(reason(state({ players: [{ ...seat(0), personality: "nobody" as never }] })), /unknown bot personality/);
    assert.match(reason(state({ lastMove: { seq: 3, kind: "deal" } as never })), /^game state lastMove: /);
  });

  test("a card dealt twice, held twice or held while on the pile", () => {
    const four = card("4", "clubs");
    assert.match(reason(state({ players: [seat(0, [four, four]), seat(1)] })), /4_clubs more than once/);
    assert.match(reason(state({ players: [seat(0, [four]), seat(1, [four])] })), /4_clubs more than once/);
    assert.match(
      reason(state({ players: [seat(0, [four]), seat(1)], lastPlayedCombination: { type: "single", cards: [four], strength: 1 } })),
      /4_clubs more than once/
    );
  });

  test("anything that is not an object", () => {
    for (const raw of [null, undefined, [], "state", 4]) assert.equal(reason(raw), "no game state");
  });
});

describe("Same, the check that pins each schema to the engine's type", () => {
  type Phase = NonNullable<GameState["exchangePhase"]>;
  const phase = {
    active: z.boolean(),
    winnerIdx: z.number(),
    loserIdx: z.number(),
    cardFromLoser: z.custom<Phase["cardFromLoser"]>().optional(),
    cardToLoser: z.custom<Phase["cardToLoser"]>().optional(),
    twoJokerException: z.boolean(),
  };

  test("refuses a schema missing an optional field, at the top or nested", () => {
    const whole = z.object({ ...phase, settledAt: z.number().optional() });
    const withoutSettledAt = z.object(phase);
    const matches: Same<z.infer<typeof whole>, Phase> = true;
    // @ts-expect-error a schema missing the optional `settledAt` is not the engine's phase
    const drifted: Same<z.infer<typeof withoutSettledAt>, Phase> = true;
    // @ts-expect-error a player missing the optional `finishPosition`, inside an array, is not the engine's
    const nested: Same<{ players: Omit<Player, "finishPosition">[] }, { players: Player[] }> = true;
    const open = { active: true, winnerIdx: 0, loserIdx: 1, twoJokerException: false };
    assert.ok(whole.safeParse(open).success && withoutSettledAt.safeParse(open).success, "only the type can tell them apart");
    assert.deepEqual([matches, drifted, nested], [true, true, true]);
  });
});
