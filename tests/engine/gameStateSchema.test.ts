// tests/engine/gameStateSchema.test.ts — the one parse both restore seams hold a stored engine state to.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { UNSATISFIABLE_EXCHANGE, parseGameState, storedShapeAt, type Same } from "../../shared/gameStateSchema.ts";
import type { Card, GameState, Player } from "../../lib/game/gameEngine.ts";
import { reachSteps } from "../../lib/situation.ts";
import { ALL_CAPTURE_STATES, captureGameState } from "../../lib/captureStates.ts";
import { card, seat, state } from "../support/game.ts";
import { GAME_SCHEMA_VERSION, SHAPES_SINCE as GAME_SHAPES_SINCE } from "../../shared/persistedEnvelope.ts";
import { OFFLINE_SAVE_VERSION, SHAPES_SINCE as OFFLINE_SHAPES_SINCE } from "../../lib/offlineSave.ts";

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

describe("a state stored before openingCard, read as openingFlags", () => {
  const THREE_SPADES = card("3", "spades");
  const legacy = (flags: Record<string, unknown>) => {
    const { openingCard: _opening, ...rest } = state({ players: [seat(0, [THREE_SPADES]), seat(1, [card("4", "clubs")])] });
    return { ...rest, trickWinner: null, ...flags };
  };
  const rows: [string, Record<string, unknown>, unknown][] = [
    ["the opening still owed", { firstPlayMade: false, startCard: THREE_SPADES }, THREE_SPADES],
    ["the opening played", { firstPlayMade: true, startCard: THREE_SPADES }, null],
    ["an exchange round, no start card", { firstPlayMade: true }, null],
  ];
  for (const [name, flags, openingCard] of rows) {
    test(name, () => {
      const parsed = parseGameState(legacy(flags), "openingFlags");
      assert.ok(parsed.ok, parsed.ok ? "" : parsed.reason);
      assert.deepEqual(parsed.state.openingCard, openingCard);
      assert.ok(!("firstPlayMade" in parsed.state) && !("startCard" in parsed.state) && !("trickWinner" in parsed.state));
    });
  }

  test("the same state read as current is refused for its missing openingCard", () => {
    assert.match(reason(legacy({ firstPlayMade: true })), /^game state openingCard: /);
  });
});

describe("a state stored before the exchange phase's kind, read as exchangeFlags", () => {
  const TAKEN = card("A", "spades");
  const GIVEN = card("4", "clubs");
  const seats = { winnerIdx: 0, loserIdx: 1 };
  const stored = (exchangePhase: Record<string, unknown>) =>
    ({ ...state({ players: [seat(0, [TAKEN, card("5", "hearts")]), seat(1, [GIVEN])] }), exchangePhase });
  const rows: [string, Record<string, unknown>, unknown][] = [
    ["both Jokers", { active: false, ...seats, twoJokerException: true }, { kind: "twoJokers", ...seats }],
    ["an open exchange", { active: true, ...seats, cardFromLoser: TAKEN, twoJokerException: false }, { kind: "open", ...seats, cardFromLoser: TAKEN }],
    [
      "a settled exchange, its stamp kept",
      { active: false, ...seats, cardFromLoser: TAKEN, cardToLoser: GIVEN, twoJokerException: false, settledAt: 7 },
      { kind: "settled", ...seats, cardFromLoser: TAKEN, cardToLoser: GIVEN, settledAt: 7 },
    ],
  ];
  for (const [name, flags, phase] of rows) {
    test(name, () => {
      for (const shape of ["exchangeFlags", "openingFlags"] as const) {
        const raw = stored(flags);
        const parsed = parseGameState(shape === "openingFlags" ? { ...raw, firstPlayMade: true } : raw, shape);
        assert.ok(parsed.ok, parsed.ok ? "" : parsed.reason);
        assert.deepEqual(parsed.state.exchangePhase, phase, shape);
      }
    });
  }

  test("the same phase read as current is refused", () => {
    assert.match(reason(stored(rows[1][1])), /^game state exchangePhase/);
  });

  for (const [seam, since, version] of [
    ["active_games", GAME_SHAPES_SINCE, GAME_SCHEMA_VERSION],
    ["the offline save", OFFLINE_SHAPES_SINCE, OFFLINE_SAVE_VERSION],
  ] as const) {
    test(`each version of ${seam} reads in the shape it was written in`, () => {
      assert.deepEqual([5, 6, 7, 8].map((v) => storedShapeAt(v, since)), ["openingFlags", "openingFlags", "exchangeFlags", "current"]);
      assert.equal(storedShapeAt(version, since), "current");
    });
  }
});

describe("states the engine could not have written", () => {
  test("an open exchange whose winner holds nothing to give back", () => {
    const empty = state({
      players: [seat(0, []), seat(1, [card("4", "clubs")])],
      exchangePhase: { kind: "open", winnerIdx: 0, loserIdx: 1, cardFromLoser: card("4", "hearts") },
    });
    assert.equal(reason(empty), UNSATISFIABLE_EXCHANGE);
    assert.ok(parseGameState({ ...empty, exchangePhase: { kind: "twoJokers", winnerIdx: 0, loserIdx: 1 } }).ok);
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
  type Phase = Extract<NonNullable<GameState["exchangePhase"]>, { kind: "settled" }>;
  const phase = {
    kind: z.literal("settled"),
    winnerIdx: z.number(),
    loserIdx: z.number(),
    cardFromLoser: z.custom<Card>(),
    cardToLoser: z.custom<Card>(),
  };

  test("refuses a schema missing an optional field, at the top or nested", () => {
    const whole = z.object({ ...phase, settledAt: z.number().optional() });
    const withoutSettledAt = z.object(phase);
    const matches: Same<z.infer<typeof whole>, Phase> = true;
    // @ts-expect-error a schema missing the optional `settledAt` is not the engine's phase
    const drifted: Same<z.infer<typeof withoutSettledAt>, Phase> = true;
    // @ts-expect-error a player missing the optional `finishPosition`, inside an array, is not the engine's
    const nested: Same<{ players: Omit<Player, "finishPosition">[] }, { players: Player[] }> = true;
    const settled = { kind: "settled", winnerIdx: 0, loserIdx: 1, cardFromLoser: card("A", "spades"), cardToLoser: card("4", "clubs") };
    assert.ok(whole.safeParse(settled).success && withoutSettledAt.safeParse(settled).success, "only the type can tell them apart");
    assert.deepEqual([matches, drifted, nested], [true, true, true]);
  });
});
