// The plays on the felt and the trick being swept: every card on the table is held here once.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createDeck, type Combination } from "../../lib/game/gameEngine.ts";
import { comboKey } from "../../components/flightPhysics.ts";
import { beatenPlay, clearTrick, NO_TRICK, playOnto, roleOf, sweepEnded, sweepTrick, topPlay, type Trick, type TrickPlay } from "../../components/table/trick.ts";

const combo = (ids: string[]): Combination => ({ type: "single", strength: 1, cards: ids.map((id) => ({ id })) }) as unknown as Combination;

const thrown = (ids: string[], playedBy: number): TrickPlay => {
  const c = combo(ids);
  const key = comboKey(c, playedBy);
  return { key, combo: c, playedBy, spec: { key, n: ids.length, from: [], to: [], catchUp: false, reduced: true, contact: 0, end: 0 } };
};

const onFelt = (t: Trick) => [...t.plays, ...(t.swept?.plays ?? [])].flatMap((p) => p.combo.cards.map((c) => c.id));
const keys = (plays: readonly TrickPlay[]) => plays.map((p) => p.key);
const trickOf = (...plays: TrickPlay[]) => plays.reduce(playOnto, NO_TRICK);

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const a = thrown(["3_hearts"], 0);
const b = thrown(["5_clubs", "5_spades"], 1);
const c = thrown(["K_diamonds"], 2);

describe("playOnto", () => {
  test("a repeated play changes nothing", () => {
    const once = trickOf(a, b);
    assert.equal(playOnto(once, { ...b }), once);
  });

  test("the input trick is not mutated", () => {
    const one = trickOf(a);
    playOnto(one, b);
    assert.deepEqual(keys(one.plays), [a.key]);
    assert.deepEqual(NO_TRICK, { plays: [], swept: null });
  });

  test("an older play coming back rewinds the felt to it", () => {
    const back = playOnto(trickOf(a, b, c), { ...b });
    assert.deepEqual(keys(back.plays), [a.key, b.key]);
    assert.equal(topPlay(back.plays)?.key, b.key);
  });

  test("a card already on the felt, thrown again, is a new manche: the felt starts over", () => {
    const next = thrown(["3_hearts", "3_spades"], 2);
    assert.deepEqual(keys(playOnto(trickOf(a, b), next).plays), [next.key]);
  });

  test("a new manche's card still being swept ends the sweep; an unrelated sweep runs on", () => {
    const sweeping = sweepTrick(trickOf(a, b), { dx: 1, dy: 1 });
    assert.equal(playOnto(sweeping, thrown(["3_hearts"], 3)).swept, null);
    assert.equal(playOnto(sweeping, c).swept, sweeping.swept);
  });
});

describe("the felt's roles", () => {
  const t = trickOf(a, b, c, thrown(["2_hearts"], 3));

  test("the last play is top, the one before beaten, the rest buried", () => {
    assert.deepEqual(t.plays.map((_, i) => roleOf(t.plays, i)), ["buried", "buried", "beaten", "top"]);
  });

  test("topPlay and beatenPlay draw those two, and never the same play", () => {
    assert.equal(topPlay(t.plays)?.combo.cards[0].id, "2_hearts");
    assert.equal(beatenPlay(t.plays)?.key, c.key);
    assert.equal(beatenPlay(trickOf(a, b).plays)?.key, a.key);
    assert.equal(beatenPlay([a]), null);
    assert.equal(topPlay([]), null);
  });
});

describe("sweepTrick", () => {
  const held = trickOf(a, b);
  const to = { dx: 10, dy: -20 };

  test("the sweep takes the whole trick and leaves the felt empty", () => {
    const s = sweepTrick(held, to);
    assert.deepEqual(s.plays, []);
    assert.equal(s.swept?.plays, held.plays);
    assert.deepEqual(s.swept?.to, to);
  });

  test("a lead during the sweep lands on the felt without touching the swept cards", () => {
    const next = playOnto(sweepTrick(held, to), c);
    assert.deepEqual(onFelt(next).sort(), ["3_hearts", "5_clubs", "5_spades", "K_diamonds"]);
    assert.deepEqual(onFelt(sweepEnded(next)), ["K_diamonds"]);
  });

  test("clearing the felt leaves a running sweep alone", () => {
    const s = sweepTrick(held, to);
    assert.equal(clearTrick(s).swept, s.swept);
    assert.deepEqual(clearTrick(held), NO_TRICK);
  });
});

test("over 400 seeded throws, rewinds, sweeps, clears and new manches no card is on the felt twice or lost", () => {
  const rand = mulberry32(1259);
  const deckIds = createDeck().map((card) => card.id);
  const shuffled = () => [...deckIds].sort(() => rand() - 0.5);
  let deck = shuffled();
  let t: Trick = NO_TRICK;
  const counts = { throw: 0, fresh: 0, repeat: 0, rewind: 0, sweep: 0, clear: 0, ended: 0, manche: 0 };
  for (let step = 0; step < 400; step++) {
    const before = t;
    const r = rand();
    if (r < 0.45) {
      if (deck.length < 4) deck = shuffled();
      const play = thrown(deck.splice(0, 1 + Math.floor(rand() * 4)), Math.floor(rand() * 4));
      t = playOnto(before, play);
      const held = new Set(before.plays.flatMap((p) => p.combo.cards.map((x) => x.id)));
      const fresh = play.combo.cards.some((x) => held.has(x.id));
      assert.deepEqual(keys(t.plays), fresh ? [play.key] : [...keys(before.plays), play.key]);
      counts[fresh ? "fresh" : "throw"]++;
    } else if (r < 0.55 && before.plays.length > 0) {
      const j = Math.floor(rand() * before.plays.length);
      t = playOnto(before, { ...before.plays[j] });
      assert.deepEqual(keys(t.plays), keys(before.plays.slice(0, j + 1)));
      assert.equal(t.swept, before.swept);
      counts[j === before.plays.length - 1 ? "repeat" : "rewind"]++;
    } else if (r < 0.7) {
      t = sweepTrick(before, { dx: rand(), dy: rand() });
      assert.equal(t.swept?.plays, before.plays);
      counts.sweep++;
    } else if (r < 0.8) {
      t = clearTrick(before);
      assert.equal(t.swept, before.swept);
      counts.clear++;
    } else if (r < 0.9) {
      t = sweepEnded(before);
      assert.equal(t.plays, before.plays);
      counts.ended++;
    } else {
      const felt = onFelt(before);
      const back = felt[Math.floor(rand() * felt.length)];
      deck = back ? [back, ...shuffled().filter((id) => id !== back)] : shuffled();
      counts.manche++;
    }
    const ids = onFelt(t);
    assert.equal(new Set(ids).size, ids.length, `step ${step}: ${ids.join(",")}`);
  }
  for (const [op, n] of Object.entries(counts)) assert.ok(n >= 10, `${op} ran ${n} times`);
});
