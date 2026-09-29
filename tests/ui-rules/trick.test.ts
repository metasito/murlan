// The plays on the felt and the trick being swept: every card on the table is drawn from here.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type { Combination } from "../../lib/game/gameEngine.ts";
import { comboKey } from "../../components/flightPhysics.ts";
import { clearTrick, NO_TRICK, playOnto, roleOf, sweepEnded, sweepTrick, topPlay, type Trick, type TrickPlay } from "../../components/table/trick.ts";

const combo = (ids: string[]): Combination => ({ type: "single", strength: 1, cards: ids.map((id) => ({ id })) }) as unknown as Combination;

const thrown = (ids: string[], playedBy: number): TrickPlay => {
  const c = combo(ids);
  const key = comboKey(c, playedBy);
  return { key, combo: c, playedBy, spec: { key, n: ids.length, from: [], to: [], catchUp: false, reduced: true, contact: 0, end: 0 } };
};

const onFelt = (t: Trick) => [...t.plays, ...(t.swept?.plays ?? [])].flatMap((p) => p.combo.cards.map((c) => c.id));

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("playOnto", () => {
  test("a repeated play changes nothing", () => {
    const once = playOnto(playOnto(NO_TRICK, thrown(["a"], 0)), thrown(["b"], 1));
    assert.equal(playOnto(once, thrown(["b"], 1)), once);
    assert.equal(playOnto(once, thrown(["a"], 0)), once);
  });

  test("the input trick is not mutated", () => {
    const one = playOnto(NO_TRICK, thrown(["a"], 0));
    playOnto(one, thrown(["b"], 1));
    assert.deepEqual(one.plays.map((p) => p.key), [thrown(["a"], 0).key]);
    assert.deepEqual(NO_TRICK, { plays: [], swept: null });
  });

  test("the last play is top, the one before beaten, the rest buried", () => {
    const t = ["a", "b", "c", "d"].reduce((acc, id, i) => playOnto(acc, thrown([id], i % 3)), NO_TRICK);
    assert.deepEqual(t.plays.map((_, i) => roleOf(t.plays, i)), ["buried", "buried", "beaten", "top"]);
    assert.equal(topPlay(t)?.combo.cards[0].id, "d");
    assert.equal(topPlay(t)?.playedBy, 0);
    assert.equal(topPlay(NO_TRICK), null);
  });
});

describe("sweepTrick", () => {
  const held = playOnto(playOnto(NO_TRICK, thrown(["a"], 0)), thrown(["b", "c"], 1));
  const to = { dx: 10, dy: -20 };

  test("the sweep takes the whole trick and leaves the felt empty", () => {
    const s = sweepTrick(held, to);
    assert.deepEqual(s.plays, []);
    assert.equal(s.swept?.plays, held.plays);
    assert.deepEqual(s.swept?.to, to);
  });

  test("a lead during the sweep lands on the felt without touching the swept cards", () => {
    const next = playOnto(sweepTrick(held, to), thrown(["d"], 1));
    assert.deepEqual(onFelt(next).sort(), ["a", "b", "c", "d"]);
    assert.equal(sweepEnded(next).swept, null);
    assert.deepEqual(onFelt(sweepEnded(next)), ["d"]);
  });

  test("clearing the felt leaves a running sweep alone", () => {
    const s = sweepTrick(held, to);
    assert.equal(clearTrick(s).swept, s.swept);
    assert.deepEqual(clearTrick(held), NO_TRICK);
  });
});

test("over 400 seeded throws, sweeps and clears no card is on the felt twice", () => {
  const rand = mulberry32(1259);
  let t: Trick = NO_TRICK;
  let next = 0;
  const counts = { throw: 0, repeat: 0, sweep: 0, clear: 0, ended: 0 };
  for (let step = 0; step < 400; step++) {
    const r = rand();
    if (r < 0.5) {
      const n = 1 + Math.floor(rand() * 4);
      t = playOnto(t, thrown(Array.from({ length: n }, () => `c${next++}`), Math.floor(rand() * 4)));
      counts.throw++;
    } else if (r < 0.65 && t.plays.length > 0) {
      const again = t.plays[Math.floor(rand() * t.plays.length)];
      assert.equal(playOnto(t, { ...again }), t);
      counts.repeat++;
    } else if (r < 0.8) {
      t = sweepTrick(t, { dx: rand(), dy: rand() });
      counts.sweep++;
    } else if (r < 0.9) {
      t = clearTrick(t);
      counts.clear++;
    } else {
      t = sweepEnded(t);
      counts.ended++;
    }
    const ids = onFelt(t);
    assert.equal(new Set(ids).size, ids.length, `step ${step}: ${ids.join(",")}`);
  }
  for (const [op, n] of Object.entries(counts)) assert.ok(n > 20, `${op} ran ${n} times`);
});
