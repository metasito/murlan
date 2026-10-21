import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import * as fc from "fast-check";
import * as gameEngine from "../../lib/game/gameEngine.ts";
import { actingSeat, createDeck, tableDemand, type Card, type Combination, type GameState } from "../../lib/game/gameEngine.ts";
import { mulberry32 } from "../support/game.ts";
import * as model from "./rules.ts";
import { isSilent, type ModelCard, type SilenceId } from "./rules.ts";

// docs/adr/0012-a-rules-model-is-a-test-oracle.md

// Fixed so CI explores the same space each run; set FC_SEED to search elsewhere.
const SEED = Number(process.env.FC_SEED ?? 20261021);
const NUM_RUNS = Number(process.env.FC_RUNS ?? 60);
const MOVES_CEILING = 2000;

/** The engine entry points the properties compare against; a planted defect replaces one. */
type Engine = Pick<typeof gameEngine, "buildCombination" | "checkSelection" | "getAllValidPlays" | "applyMove" | "startRound" | "getValidGivebackCards">;
const REAL: Engine = gameEngine;

const DECK = model.deck();
const ENGINE_CARD = new Map(createDeck().map((card) => [card.id, card]));
const MODEL_CARD = new Map(DECK.map((card) => [card.id, card]));
const byId = (id: string) => MODEL_CARD.get(id)!;
const toEngine = (cards: ModelCard[]): Card[] => cards.map((card) => ENGINE_CARD.get(card.id)!);
const ids = (cards: { id: string }[]) => cards.map((c) => c.id);
const key = (cardIds: string[]) => [...cardIds].sort().join(",");
const ENGINE_KIND: Record<model.Kind, string> = {
  single: "single",
  pair: "pair",
  triple: "triple",
  bomb: "bomb",
  straight: "straight",
  royal: "royal_straight",
};

const ORDINARY = ["3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A", "2"] as const;
const SEQUENCE = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"] as const;
const SUITS = ["clubs", "diamonds", "hearts", "spades"] as const;
const JOKERS = [byId("joker_bw"), byId("joker_colored")];

/** The first case each silence was met on, this run. */
const silencesMet = new Map<SilenceId, unknown>();
const meet = (silence: model.Silent, at: unknown) => {
  if (!silencesMet.has(silence.silent)) silencesMet.set(silence.silent, at);
};

function tally() {
  const counts = new Map<string, number>();
  return {
    add: (name: string) => counts.set(name, (counts.get(name) ?? 0) + 1),
    floor(names: string[]) {
      const missing = names.filter((name) => !counts.get(name));
      assert.deepEqual(missing, [], `the property never reached these cases: ${JSON.stringify(Object.fromEntries(counts))}`);
    },
  };
}

type Shape = { kind: "same"; size: number } | { kind: "run"; size: number; oneSuit: boolean };
const arbShape: fc.Arbitrary<Shape> = fc.oneof(
  fc.record({ kind: fc.constant("same" as const), size: fc.integer({ min: 1, max: 4 }) }),
  fc.record({ kind: fc.constant("run" as const), size: fc.integer({ min: 5, max: 13 }), oneSuit: fc.boolean() })
);

function arbShaped(shape: Shape): fc.Arbitrary<ModelCard[]> {
  if (shape.kind === "same") {
    const ranked = fc
      .tuple(fc.constantFrom(...ORDINARY), fc.shuffledSubarray([...SUITS], { minLength: shape.size, maxLength: shape.size }))
      .map(([rank, suits]) => suits.map((suit) => byId(`${rank}_${suit}`)));
    const jokers = shape.size <= 2 ? fc.shuffledSubarray(JOKERS, { minLength: shape.size, maxLength: shape.size }) : fc.constant<ModelCard[]>([JOKERS[0]]);
    return fc.oneof({ weight: 5, arbitrary: ranked }, { weight: 1, arbitrary: jokers });
  }
  return fc
    .tuple(fc.integer({ min: 0, max: 12 }), fc.array(fc.constantFrom(...SUITS), { minLength: shape.size, maxLength: shape.size }))
    .map(([start, suits]) => Array.from({ length: shape.size }, (_, i) => byId(`${SEQUENCE[(start + i) % 13]}_${shape.oneSuit ? suits[0] : suits[i]}`)));
}

const arbMutated = (cards: ModelCard[]): fc.Arbitrary<ModelCard[]> =>
  fc.oneof(
    { weight: 6, arbitrary: fc.constant(cards) },
    { weight: 1, arbitrary: fc.tuple(fc.nat(), fc.constantFrom(...JOKERS)).map(([at, joker]) => cards.map((c, i) => (i === at % cards.length ? joker : c))) },
    { weight: 1, arbitrary: fc.constantFrom(...DECK).map((extra) => (cards.some((c) => c.id === extra.id) ? cards : [...cards, extra])) }
  );

const arbCardSet: fc.Arbitrary<ModelCard[]> = fc.oneof(
  { weight: 3, arbitrary: arbShape.chain(arbShaped).chain(arbMutated) },
  { weight: 1, arbitrary: fc.shuffledSubarray(DECK, { minLength: 1, maxLength: 13 }) }
);

const classifiedBoth = (cards: ModelCard[]) => model.classify(cards) !== null && REAL.buildCombination(toEngine(cards)) !== null;
const arbCombo = arbCardSet.filter(classifiedBoth);
const run = <T,>(arb: fc.Arbitrary<T>, check: (value: T) => void, runs: number) => fc.assert(fc.property(arb, check), { seed: SEED, numRuns: runs });

test("the model's deck is the engine's deck, card for card", () => {
  assert.equal(DECK.length, 54);
  assert.deepEqual(ids(DECK).sort(), [...ENGINE_CARD.keys()].sort());
  for (const card of DECK) {
    const engine = ENGINE_CARD.get(card.id)!;
    assert.deepEqual({ suit: card.suit, rank: card.rank }, { suit: engine.suit, rank: engine.rank }, card.id);
  }
});

function classificationAgrees(engine: Engine) {
  const seen = tally();
  run(
    arbCardSet,
    (cards) => {
      const m = model.classify(cards);
      const expected = m === null ? null : ENGINE_KIND[m.kind];
      seen.add(String(expected));
      assert.equal(engine.buildCombination(toEngine(cards))?.type ?? null, expected, `${key(ids(cards))}: the combination it is`);
    },
    NUM_RUNS * 20
  );
  seen.floor(["null", ...Object.values(ENGINE_KIND)]);
}

const arbBeatsCase = arbShape.chain((shape) => fc.tuple(arbShaped(shape), fc.oneof(arbShaped(shape), arbCombo)));

function beatsAgrees(engine: Engine) {
  const seen = tally();
  run(
    arbBeatsCase,
    ([candidate, toBeat]) => {
      fc.pre(classifiedBoth(candidate) && classifiedBoth(toBeat));
      const c = model.classify(candidate)!;
      const t = model.classify(toBeat)!;
      const m = model.beats(c, t);
      if (isSilent(m)) return meet(m, { candidate: ids(candidate), toBeat: ids(toBeat) });
      seen.add(`${c.kind} on ${t.kind}: ${m}`);
      const answer = engine.checkSelection(toEngine(candidate), { toBeat: engine.buildCombination(toEngine(toBeat)), mustInclude: null }).ok;
      assert.equal(answer, m, `whether ${key(ids(candidate))} beats ${key(ids(toBeat))}`);
    },
    NUM_RUNS * 20
  );
  seen.floor(["straight on straight: true", "straight on straight: false", "royal on bomb: true", "bomb on royal: false", "bomb on single: true", "pair on pair: false"]);
}

const classOf = (cardIds: string[]) => {
  const combo = model.classify(cardIds.map(byId))!;
  return `${combo.kind}/${combo.size}/${String(combo.strength)}`;
};

const arbLegalCase = fc.option(arbCombo, { freq: 3 }).chain((toBeat) => {
  const taken = new Set(ids(toBeat ?? []));
  const free = DECK.filter((c) => !taken.has(c.id));
  const withBomb = fc.tuple(fc.constantFrom(...ORDINARY), fc.shuffledSubarray(free, { maxLength: 14 })).map(([rank, rest]) => {
    const four = free.filter((c) => c.rank === rank);
    return [...four, ...rest.filter((c) => c.rank !== rank)];
  });
  const hand = fc.oneof({ weight: 2, arbitrary: fc.shuffledSubarray(free, { minLength: 1, maxLength: 18 }) }, { weight: 1, arbitrary: withBomb }).filter((h) => h.length > 0);
  return fc.tuple(fc.constant(toBeat), hand, fc.boolean());
});

function legalPlaysAgree(engine: Engine) {
  const seen = tally();
  run(
    arbLegalCase,
    ([toBeatCards, hand, opening]) => {
      const mustInclude = opening && toBeatCards === null && hand.some((c) => c.id === "3_spades") ? "3_spades" : null;
      const { plays, silent } = model.legalPlays(hand, toBeatCards && model.classify(toBeatCards), mustInclude);
      const silentKeys = new Set(silent.map(key));
      const offered = engine.getAllValidPlays(toEngine(hand), {
        toBeat: toBeatCards && engine.buildCombination(toEngine(toBeatCards)),
        mustInclude: mustInclude === null ? null : ENGINE_CARD.get(mustInclude)!,
      })
        .map((combo) => ids(combo.cards))
        .filter((cardIds) => !silentKeys.has(key(cardIds)));
      seen.add(toBeatCards === null ? (mustInclude ? "opening" : "lead") : plays.length > 0 ? "answerable" : "unanswerable");
      const modelKeys = new Set(plays.map(key));
      assert.deepEqual(offered.filter((cardIds) => !modelKeys.has(key(cardIds))).map(key), [], "the engine offers plays the model refuses");
      assert.deepEqual([...new Set(offered.map(classOf))].sort(), [...new Set(plays.map(classOf))].sort(), "the classes of play offered");
      const demand = { toBeat: toBeatCards && engine.buildCombination(toEngine(toBeatCards)), mustInclude: mustInclude === null ? null : ENGINE_CARD.get(mustInclude)! };
      const refused = plays.filter((cardIds) => !engine.checkSelection(toEngine(cardIds.map(byId)), demand).ok).map(key);
      assert.deepEqual(refused, [], "the engine refuses plays the model offers");
    },
    NUM_RUNS * 5
  );
  seen.floor(["opening", "lead", "answerable", "unanswerable"]);
}

const HAND_SIZES: Record<number, number[]> = { 2: [14, 14], 3: [18, 18, 18], 4: [14, 14, 13, 13] };

function dealt(seats: number, rand: () => number): ModelCard[][] {
  const pool = [...DECK];
  for (let i = pool.length - 1; i > 0; i--) {
    const k = Math.floor(rand() * (i + 1));
    [pool[i], pool[k]] = [pool[k], pool[i]];
  }
  let at = 0;
  return HAND_SIZES[seats].map((size) => pool.slice(at, (at += size)));
}

const seatsFor = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `s${i}`, type: "bot" as const }));

const engineView = (state: GameState) => ({
  toAct: actingSeat(state),
  tableEmpty: state.lastPlayedCombination === null,
  finishingOrder: state.finishingOrder.map((id) => Number(id.replace("player_", ""))),
  roundOver: state.roundOver,
});

const modelView = (round: model.Round) => ({
  toAct: round.toAct,
  tableEmpty: round.table === null,
  finishingOrder: round.finishingOrder,
  roundOver: round.roundOver,
});

const describe = (move: model.Move) => (move.kind === "pass" ? "pass" : key(move.cardIds));

function roundPlayAgrees(engine: Engine) {
  const seen = tally();
  run(
    fc.tuple(fc.constantFrom(2, 3, 4), fc.integer({ min: 1, max: 2 ** 31 - 1 })),
    ([seats, choiceSeed]) => {
      const rand = mulberry32(choiceSeed);
      const hands = dealt(seats, rand);
      let state = engine.startRound(seatsFor(seats), "free_for_all", { dealt: hands.map(toEngine) });
      let round = model.firstRound(hands);
      seen.add(round.mustInclude === "3_spades" ? "opened on the 3♠" : "opened on the lowest card");
      assert.equal(state.openingCard?.id ?? null, round.mustInclude, "the opening card");
      assert.deepEqual(engineView(state), modelView(round), "the deal");
      for (let moves = 0; !round.roundOver; moves++) {
        assert.ok(moves < MOVES_CEILING, `the round did not end in ${MOVES_CEILING} moves`);
        const hand = round.hands[round.toAct];
        const { plays, silent } = model.legalPlays(hand, round.table?.combo ?? null, round.mustInclude);
        const silentKeys = new Set(silent.map(key));
        const enginePlays = engine.getAllValidPlays(state.players[round.toAct].hand, tableDemand(state))
          .map((combo) => ids(combo.cards))
          .filter((cardIds) => !silentKeys.has(key(cardIds)));
        const probes: model.Move[] = [
          { kind: "pass" },
          ...enginePlays.map((cardIds) => ({ kind: "play" as const, cardIds })),
          ...plays.filter(() => rand() < 0.2).map((cardIds) => ({ kind: "play" as const, cardIds })),
          ...Array.from({ length: 3 }, () => ({ kind: "play" as const, cardIds: ids(hand.filter(() => rand() < 0.25)) })),
        ];
        for (const probe of probes) {
          if (probe.kind === "play" && probe.cardIds.length === 0) continue;
          const m = model.step(round, probe);
          if (isSilent(m)) {
            meet(m, { hand: ids(hand), move: probe });
            continue;
          }
          const accepted = engine.applyMove(state, actingSeat(state), probe).ok;
          assert.equal(accepted, m.ok, `move ${moves}, seat ${round.toAct}: ok-or-refused for ${describe(probe)}`);
        }
        const move: model.Move =
          round.table !== null && (rand() < 0.45 || enginePlays.length === 0)
            ? { kind: "pass" }
            : { kind: "play", cardIds: enginePlays[Math.floor(rand() * enginePlays.length)] };
        const result = engine.applyMove(state, actingSeat(state), move);
        const step = model.step(round, move);
        assert.ok(result.ok && !isSilent(step) && step.ok, `move ${moves}: ${describe(move)} was offered and refused`);
        const leaderOut = round.table !== null && round.hands[round.table.by].length === 0;
        state = result.state;
        round = step.round;
        const closedTrick = state.lastMove.kind === "pass" && state.lastMove.closedTrick;
        assert.equal(closedTrick, step.closedTrick, `move ${moves}: whether ${describe(move)} closed the trick`);
        assert.deepEqual(engineView(state), modelView(round), `move ${moves}: after ${describe(move)}`);
        if (step.closedTrick) seen.add(leaderOut ? "trick closed after its winner went out" : "trick closed");
      }
      seen.add(`round over at ${seats}`);
    },
    NUM_RUNS
  );
  seen.floor(["opened on the 3♠", "opened on the lowest card", "trick closed", "trick closed after its winner went out", "round over at 2", "round over at 3", "round over at 4"]);
}

function exchangeAgrees(engine: Engine) {
  const seen = tally();
  run(
    fc.tuple(fc.constantFrom(2, 3, 4), fc.integer({ min: 1, max: 2 ** 31 - 1 }), fc.nat(), fc.nat()),
    ([seats, dealSeed, a, b]) => {
      const hands = dealt(seats, mulberry32(dealSeed));
      const winnerSeat = a % seats;
      const loserSeat = (winnerSeat + 1 + (b % (seats - 1))) % seats;
      const state = engine.startRound(seatsFor(seats), "free_for_all", { dealt: hands.map(toEngine), opening: { kind: "exchange", winnerSeat, loserSeat } });
      const owed = model.exchange(hands[loserSeat]);
      if (isSilent(owed)) return meet(owed, { lastHand: ids(hands[loserSeat]) });
      const phase = state.exchangePhase!;
      seen.add(owed.kind);
      if (owed.kind === "shown") {
        assert.equal(phase.kind, "twoJokers");
        assert.equal(actingSeat(state), winnerSeat, "the first place leads");
        return;
      }
      assert.ok(phase.kind === "open", `the exchange is ${phase.kind}`);
      assert.equal(phase.cardFromLoser.id, owed.fromLast, "the card the last place owes");
      const hand = [...hands[winnerSeat], byId(owed.fromLast)];
      const options = model.givebackOptions(hand, owed.fromLast);
      if (isSilent(options)) return meet(options, { hand: ids(hand), receivedId: owed.fromLast });
      assert.deepEqual(ids(engine.getValidGivebackCards(state.players[winnerSeat].hand, phase.cardFromLoser.id)).sort(), options);
      const after = engine.applyMove(state, winnerSeat, { kind: "giveback", cardId: options[0] });
      assert.ok(after.ok, "the engine refused a giveback both sides offer");
      assert.equal(after.state.currentTurnIndex, loserSeat, "the last place leads");
    },
    NUM_RUNS * 5
  );
  seen.floor(["shown", "swap"]);
}

const IN_RANGE = new Set(["3", "4", "5", "6", "7", "8", "9", "10"]);
const arbGivebackCase = fc
  .tuple(
    fc.shuffledSubarray(DECK.filter((c) => !IN_RANGE.has(c.rank)), { minLength: 1, maxLength: 14 }),
    fc.shuffledSubarray(DECK.filter((c) => IN_RANGE.has(c.rank)), { maxLength: 2 }),
    fc.nat()
  )
  .map(([high, low, at]) => {
    const hand = [...high, ...low];
    return { hand, receivedId: hand[at % hand.length].id };
  });

function givebackAgrees(engine: Engine) {
  const seen = tally();
  run(
    arbGivebackCase,
    ({ hand, receivedId }) => {
      const m = model.givebackOptions(hand, receivedId);
      if (isSilent(m)) return meet(m, { hand: ids(hand), receivedId });
      seen.add(m.some((id) => IN_RANGE.has(byId(id).rank)) ? "3 to 10" : "lowest card");
      assert.deepEqual(ids(engine.getValidGivebackCards(toEngine(hand), receivedId)).sort(), m, `${key(ids(hand))} receiving ${receivedId}: the cards offered back`);
    },
    NUM_RUNS * 10
  );
  seen.floor(["3 to 10", "lowest card"]);
}

for (const property of [classificationAgrees, beatsAgrees, legalPlaysAgree, roundPlayAgrees, exchangeAgrees, givebackAgrees]) {
  test(`${property.name} against the engine`, () => property(REAL));
}

const SEQUENCE_POSITION = (card: Card) => (card.rank === "2" ? 15 : card.rank === "A" ? 14 : SEQUENCE.indexOf(card.rank as (typeof SEQUENCE)[number]) + 1);

const twoAboveAce: Engine = {
  ...REAL,
  buildCombination(cards) {
    const real = REAL.buildCombination(cards);
    if (real !== null || cards.length < 5 || cards.some((c) => c.isJoker)) return real;
    const positions = cards.map(SEQUENCE_POSITION).sort((a, b) => a - b);
    const run = positions.every((p, i) => i === 0 || p === positions[i - 1] + 1);
    return run ? { type: "straight", cards, strength: positions[positions.length - 1] } : null;
  },
};

const bombOnRoyal: Engine = {
  ...REAL,
  checkSelection(cards, demand) {
    const combo = REAL.buildCombination(cards);
    if (combo?.type === "bomb" && demand.toBeat?.type === "royal_straight") return { ok: true, combo };
    return REAL.checkSelection(cards, demand);
  },
  getAllValidPlays(hand, demand) {
    const plays = REAL.getAllValidPlays(hand, demand);
    if (demand.toBeat?.type !== "royal_straight") return plays;
    const bombs: Combination[] = REAL.getAllValidPlays(hand, { toBeat: null, mustInclude: null }).filter((c) => c.type === "bomb");
    return [...plays, ...bombs];
  },
};

const closesOnePassEarly: Engine = {
  ...REAL,
  applyMove(state, seat, move) {
    const result = REAL.applyMove(state, seat, move);
    if (move.kind !== "pass" || !result.ok || result.state.lastPlayedCombination === null) return result;
    const next = REAL.applyMove(result.state, actingSeat(result.state), move);
    return next.ok && next.state.lastPlayedCombination === null ? next : result;
  },
};

const givebackKeepsReceived: Engine = {
  ...REAL,
  getValidGivebackCards: (hand) => REAL.getValidGivebackCards(hand),
};

const owesSecondHighest: Engine = {
  ...REAL,
  startRound(seats, mode, opts) {
    const state = REAL.startRound(seats, mode, opts);
    const phase = state.exchangePhase;
    if (phase?.kind !== "open") return state;
    const loser = state.players[phase.loserIdx];
    const winner = state.players[phase.winnerIdx];
    const second = [...loser.hand].sort((a, b) => gameEngine.cardStrength(b) - gameEngine.cardStrength(a))[0];
    loser.hand = [...loser.hand.filter((c) => c.id !== second.id), phase.cardFromLoser];
    winner.hand = [...winner.hand.filter((c) => c.id !== phase.cardFromLoser.id), second];
    return { ...state, exchangePhase: { ...phase, cardFromLoser: second } };
  },
};

const PLANTED: [string, Engine, (engine: Engine) => void, RegExp][] = [
  ["a 2 above the Ace in a straight", twoAboveAce, classificationAgrees, /^(?=.*\b2_)(?=.*\bA_).*: the combination it is/],
  ["a bomb beating a royal straight", bombOnRoyal, beatsAgrees, /^whether (\w+_\w+,?){4} beats/],
  ["a bomb beating a royal straight", bombOnRoyal, legalPlaysAgree, /the engine offers plays the model refuses/],
  ["a trick closing one pass early", closesOnePassEarly, roundPlayAgrees, /whether pass closed the trick/],
  ["a giveback offering the card just received", givebackKeepsReceived, givebackAgrees, /receiving \w+: the cards offered back/],
  ["the last place owing their second-highest card", owesSecondHighest, exchangeAgrees, /the card the last place owes/],
];

for (const [defect, engine, property, reason] of PLANTED) {
  test(`${property.name} goes red on ${defect}`, () => {
    assert.throws(
      () => property(engine),
      (error: Error) => {
        const cause = error.cause instanceof Error ? error.cause.message : "";
        assert.match(cause, reason, `red for another reason: ${error.message}`);
        return true;
      }
    );
  });
}

interface Disagreement {
  id: SilenceId;
  section: string;
  property: string;
  seed: number;
  case: { candidate?: string[]; toBeat?: string[]; lastHand?: string[]; hand?: string[]; receivedId?: string };
  engine: unknown;
  conflictsWith?: string;
  question: string;
  issue: number;
}

const LISTED: Disagreement[] = JSON.parse(readFileSync(path.join(import.meta.dirname, "disagreements.json"), "utf8"));
const GAME_RULES = readFileSync(path.join(import.meta.dirname, "..", "..", "docs", "GAME-RULES.md"), "utf8");

function answers(entry: Disagreement): { model: unknown; engine: unknown } {
  const c = entry.case;
  if (c.candidate && c.toBeat) {
    const [candidate, toBeat] = [c.candidate.map(byId), c.toBeat.map(byId)];
    return {
      model: model.beats(model.classify(candidate)!, model.classify(toBeat)),
      engine: REAL.checkSelection(toEngine(candidate), { toBeat: REAL.buildCombination(toEngine(toBeat)), mustInclude: null }).ok,
    };
  }
  if (c.lastHand) {
    const hand = c.lastHand.map(byId);
    const state = REAL.startRound(seatsFor(2), "free_for_all", { dealt: [[], toEngine(hand)], opening: { kind: "exchange", winnerSeat: 0, loserSeat: 1 } });
    const phase = state.exchangePhase;
    return { model: model.exchange(hand), engine: phase?.kind === "open" ? phase.cardFromLoser.id : phase?.kind };
  }
  const hand = (c.hand ?? []).map(byId);
  return { model: model.givebackOptions(hand, c.receivedId ?? ""), engine: ids(REAL.getValidGivebackCards(toEngine(hand), c.receivedId)).sort() };
}

test("disagreements.json: every silence met is listed, and every listed case is still one", () => {
  assert.ok(LISTED.length > 0, "disagreements.json lists nothing");
  for (const entry of LISTED) {
    assert.ok(entry.section && entry.question && Number.isInteger(entry.seed) && Number.isInteger(entry.issue), `${entry.id} is missing its §, question, seed or issue`);
    const row = entry.conflictsWith?.match(/§ Decisions "([^"]+)"/)?.[1];
    if (entry.conflictsWith !== undefined) assert.ok(row && GAME_RULES.includes(`| **${row}** |`), `${entry.id} conflicts with a § Decisions row that does not exist: ${entry.conflictsWith}`);
    const { model: m, engine } = answers(entry);
    assert.deepEqual(m, { silent: entry.id }, `${entry.id}: the model now answers this case, so its entry goes`);
    assert.deepEqual(engine, entry.engine, `${entry.id}: the engine's answer changed`);
  }
  const listed = new Set(LISTED.map((entry) => entry.id));
  const unlisted = [...silencesMet].filter(([id]) => !listed.has(id));
  assert.deepEqual(unlisted, [], "a silence the properties met is not listed");
});
