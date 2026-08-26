// tests/botPersonalities.test.ts — every personality must stay a legal, finite
// player. The property test in tests/gameEngine.test.ts already proves
// getAllValidPlays is complete; these prove the personality knobs never reach
// outside it and never stall a hand.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BOT_PERSONALITIES,
  DEFAULT_BOT_PERSONALITY,
  botSeatNames,
  getBotPersonality,
  isBotPersonalityId,
} from "../lib/botPersonalities.ts";
import {
  aiChoosePlay,
  buildCombination,
  createDeck,
  getAllValidPlays,
  initializeGame,
  processPass,
  processPlay,
} from "../lib/gameEngine.ts";
import { c, makePlayer } from "./helpers.ts";
import type { GameState } from "../lib/gameEngine.ts";
import type { BotPersonalityId } from "../lib/botPersonalities.ts";

/** Deterministic stand-in for Math.random: a repeating fixed sequence. */
function fixedRng(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

interface TableShape {
  seats?: number;
  gameMode?: "free_for_all" | "teams";
}

function botTable(
  personality: BotPersonalityId,
  { seats = 4, gameMode = "free_for_all" }: TableShape = {}
): GameState {
  return initializeGame(
    Array.from({ length: seats }, (_, i) => ({
      name: `bot${i}`,
      type: "ai" as const,
      personality,
      team: gameMode === "teams" ? ((i % 2 === 0 ? "A" : "B") as "A" | "B") : undefined,
    })),
    gameMode
  );
}

/**
 * Runs a whole hand with every seat on `personality`, asserting at each step
 * that the chosen play was one getAllValidPlays offered. Returns the turns taken.
 */
function playOutHand(
  personality: BotPersonalityId,
  rng: () => number,
  shape: TableShape = {}
): number {
  let state = botTable(personality, shape);
  let turns = 0;
  const limit = 2000;

  while (!state.gameOver && turns < limit) {
    turns++;
    const seat = state.currentTurnIndex;
    const player = state.players[seat];
    const isNewRound = state.lastPlayedCombination === null;
    const requireCard = !state.firstPlayMade ? state.startCard : undefined;
    const legal = getAllValidPlays(
      player.hand,
      isNewRound ? null : state.lastPlayedCombination,
      isNewRound,
      requireCard
    );

    const choice = aiChoosePlay(
      player,
      isNewRound ? null : state.lastPlayedCombination,
      isNewRound,
      state.players.filter((_, i) => i !== seat).map((p) => p.hand.length),
      requireCard,
      rng
    );

    if (choice) {
      // aiChoosePlay enumerates its own candidates, so compare by content:
      // same combination type over the same card ids.
      const key = (c: { type: string; cards: { id: string }[] }) =>
        `${c.type}:${c.cards.map((x) => x.id).sort().join(",")}`;
      assert.ok(
        legal.some((p) => key(p) === key(choice)),
        `${personality} returned a play getAllValidPlays did not offer`
      );
      state = processPlay(state, choice);
      continue;
    }

    assert.ok(!isNewRound, `${personality} passed while leading a round`);
    state = processPass(state);
  }

  assert.ok(state.gameOver, `${personality} did not finish a hand in ${limit} turns`);
  return turns;
}

for (const p of BOT_PERSONALITIES) {
  test(`${p.id} finishes hands and only ever plays legal combinations`, () => {
    // Three rng sequences: never fires the knobs, always fires them, and a mix.
    for (const rng of [fixedRng([0.99]), fixedRng([0]), fixedRng([0.1, 0.9, 0.5, 0.3])]) {
      for (let round = 0; round < 5; round++) playOutHand(p.id, rng);
    }
  });
}

test("personalities are distinguishable, not just named", () => {
  const ids = BOT_PERSONALITIES.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
  const traits = BOT_PERSONALITIES.map((p) => `${p.difficulty}|${p.aggression}|${p.unpredictability}`);
  assert.equal(new Set(traits).size, traits.length);
});

// The two knobs have to change the play, not just the label. Both positions
// below are ones the strategy tier resolves identically for every personality,
// so any difference in the answer comes from the personality alone.

test("aggression decides whether a round is contested or conceded", () => {
  // Eight cards, the only legal answers to a 10 are the two 2s, and no opponent
  // is close to finishing — the hard tier concedes the round here.
  const hand = [c("2", "hearts"), c("2", "diamonds"), c("3", "clubs"), c("4", "clubs"),
    c("5", "clubs"), c("6", "clubs"), c("7", "clubs"), c("9", "clubs")];
  const lastPlayed = buildCombination([c("10", "spades")])!;
  const ask = (personality: BotPersonalityId) =>
    aiChoosePlay(makePlayer("bot", hand, { type: "ai", personality }), lastPlayed, false,
      [7, 7, 7], undefined, fixedRng([0.5]));

  assert.equal(ask("ana"), null, "a patient personality lets the round go");
  assert.deepEqual(ask("gent")?.cards.map((x) => x.rank), ["2"], "a ruthless one spends a 2 to take it");
});

test("aggression decides whether a lead spends premium cards", () => {
  // Leading with nine cards: the medium tier's longest multi-card play is the
  // triple of 2s, and a plain pair is available instead.
  const hand = [c("2", "hearts"), c("2", "diamonds"), c("2", "clubs"), c("3", "hearts"),
    c("3", "diamonds"), c("5", "clubs"), c("7", "diamonds"), c("9", "spades"), c("J", "clubs")];
  const ask = (personality: BotPersonalityId) =>
    aiChoosePlay(makePlayer("bot", hand, { type: "ai", personality }), null, true,
      [9, 9, 9], undefined, fixedRng([0.5]));

  assert.deepEqual(ask("besnik")?.cards.map((x) => x.rank), ["2", "2", "2"], "an aggressive lead dumps the 2s");
  assert.ok(
    !ask("drita")!.cards.some((x) => x.rank === "2"),
    "a cautious lead keeps them"
  );
});

// #368: the easy tier used to sort `getAllValidPlays`'s own return value in
// place before applyPersonality read it, so the unpredictability knob saw a
// strength-sorted array instead of the array's natural order — the same rng
// landed on a different alt purely because of which difficulty tier ran.
test("aiChoosePlay never sorts the array getAllValidPlays returned in place", () => {
  const src = readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../lib/gameEngine.ts"),
    "utf8"
  );
  const start = src.indexOf("export function aiChoosePlay");
  const end = src.indexOf("// ─── Game state processing", start);
  assert.ok(start > 0 && end > start, "could not locate aiChoosePlay's body to scan");
  assert.doesNotMatch(src.slice(start, end), /\bplays\.sort\(/);
});

test("easy tier's ordinary pick (no knob firing) is unchanged by the fix", () => {
  const hand = [
    c("9", "clubs"), c("9", "hearts"), c("5", "diamonds"), c("5", "clubs"),
    c("K", "spades"), c("7", "hearts"), c("3", "clubs"), c("J", "diamonds"),
  ];
  const choice = aiChoosePlay(
    makePlayer("bot", hand, { type: "ai", personality: "luan" }),
    null,
    true,
    [8, 8, 8],
    undefined,
    // Above every knob's threshold: neither aggression nor unpredictability fires,
    // so the pick is just the lowest-strength play — the same before and after.
    fixedRng([0.99])
  );
  assert.deepEqual(choice?.cards.map((x) => x.id), ["3_clubs"]);
});

test("easy tier's unpredictability alt follows getAllValidPlays' own order", () => {
  const hand = [
    c("9", "clubs"), c("9", "hearts"), c("5", "diamonds"), c("5", "clubs"),
    c("K", "spades"), c("7", "hearts"), c("3", "clubs"), c("J", "diamonds"),
  ];
  const legal = getAllValidPlays(hand, null, true, undefined);
  const primary = [...legal].sort((a, b) => a.strength - b.strength)[0];
  const alts = legal.filter(
    (p) => p !== primary && p.type === primary.type && p.cards.length === primary.cards.length
  );
  assert.ok(alts.length > 1, "fixture needs more than one alt to prove ordering");

  const altRng = 0.3;
  const expected = alts[Math.min(alts.length - 1, Math.floor(altRng * alts.length))];

  const choice = aiChoosePlay(
    makePlayer("bot", hand, { type: "ai", personality: "luan" }),
    null,
    true,
    [8, 8, 8],
    undefined,
    fixedRng([0.1, altRng]) // 0.1 < luan's 0.45 unpredictability: the knob fires
  );
  assert.deepEqual(choice?.cards.map((x) => x.id), expected.cards.map((x) => x.id));
});

test("an unknown or missing personality resolves to the default", () => {
  assert.equal(getBotPersonality(undefined).id, DEFAULT_BOT_PERSONALITY);
  assert.equal(getBotPersonality("not-a-personality").id, DEFAULT_BOT_PERSONALITY);
  assert.equal(isBotPersonalityId("not-a-personality"), false);
  assert.equal(isBotPersonalityId("ana"), true);
});

test("botSeatNames numbers only the repeated personalities", () => {
  assert.deepEqual(botSeatNames(["ana", "gent", "ana"]), ["Ana 1", "Gent", "Ana 2"]);
  assert.deepEqual(botSeatNames([]), []);
});

// The offline authority has no server behind it, so a lead that returns
// nothing would freeze the table rather than be caught.
test("leading a round always produces a play, for every personality and hand size", () => {
  const deck = createDeck();
  for (const { id } of BOT_PERSONALITIES) {
    for (let size = 1; size <= 14; size++) {
      for (let offset = 0; offset + size <= deck.length; offset += 5) {
        const hand = deck.slice(offset, offset + size);
        const play = aiChoosePlay(
          makePlayer("bot", hand, { type: "ai", personality: id }),
          null,
          true,
          [size, size, size],
          undefined,
          fixedRng([0.1, 0.5, 0.9])
        );
        assert.ok(play, `${id} led nothing holding ${size} cards from offset ${offset}`);
      }
    }
  }
});

// Every table above is a 4-seat free-for-all. The AI reads the opponent hand
// counts and, in teams mode, its partner's seat, so neither the shorter table
// nor the paired one is the same problem.
test("every personality finishes a hand at 2 and 3 seats, and in teams mode", () => {
  const shapes: [string, Parameters<typeof playOutHand>[2]][] = [
    ["2 seats", { seats: 2 }],
    ["3 seats", { seats: 3 }],
    ["4 seats, teams", { seats: 4, gameMode: "teams" }],
  ];
  for (const p of BOT_PERSONALITIES) {
    for (const [label, shape] of shapes) {
      for (const rng of [fixedRng([0.99]), fixedRng([0]), fixedRng([0.1, 0.9, 0.5, 0.3])]) {
        assert.ok(playOutHand(p.id, rng, shape) > 0, `${p.id} at ${label}`);
      }
    }
  }
});

// findStartingPlayer falls back to the lowest card held when no seat has the
// 3♠, so `requireCard` is not always the 3♠ — and a play that omits it is
// illegal whatever it is.
test("a requireCard that is not the 3♠ is still honoured", () => {
  const hand = [
    c("5", "spades"), c("5", "hearts"), c("7", "clubs"), c("9", "diamonds"),
    c("J", "clubs"), c("K", "hearts"), c("A", "spades"), c("2", "clubs"),
  ];
  for (const required of [hand[0], hand[3], hand[7]]) {
    for (const p of BOT_PERSONALITIES) {
      const choice = aiChoosePlay(
        makePlayer("bot", hand, { type: "ai", personality: p.id }),
        null,
        true,
        [8, 8, 8],
        required,
        fixedRng([0.5])
      );
      assert.ok(choice, `${p.id} must lead when it holds ${required.id}`);
      assert.ok(
        choice!.cards.some((x) => x.id === required.id),
        `${p.id} led without the required ${required.id}`
      );
    }
  }
});
