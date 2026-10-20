// tests/tooling/situation.test.ts — a named situation is a real deal and moves the engine accepts.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { dealOf, reach, reachSteps, type Situation } from "../../lib/situation.ts";
import { ALL_CAPTURE_STATES } from "../../lib/captureStates.ts";
import { createDeck, dealCards } from "../../lib/game/gameEngine.ts";
import { decodeOfflineSave, encodeOfflineSave, type OfflineSave } from "../../lib/offlineSave.ts";

const SITUATIONS: Situation[] = ALL_CAPTURE_STATES.map((s) => s.situation);

const opening = (seats: 2 | 3 | 4, holding: Situation["holding"] = {}): Situation => ({
  name: `${seats} seats`,
  seats,
  mode: "free_for_all",
  holding,
  moves: [],
});

/** `value` without its `undefined` keys, which every reader of a save takes for absent ones. */
function defined(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(defined);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).map(([k, v]) => [k, defined(v)]));
}

describe("dealOf", () => {
  test("fills every seat to the size dealCards deals it, each card once", () => {
    for (const seats of [2, 3, 4] as const) {
      for (let firstSeat = 0; firstSeat < seats; firstSeat++) {
        const deal = dealOf({ ...opening(seats), firstSeat });
        const sizes = dealCards(seats, firstSeat).hands.map((h) => h.length);
        assert.deepEqual(deal.map((h) => h.length), sizes, `${seats} seats from ${firstSeat}`);
        const ids = deal.flat().map((c) => c.id);
        assert.equal(new Set(ids).size, ids.length, `${seats} seats deal a card twice`);
        assert.ok(ids.every((id) => createDeck().some((c) => c.id === id)));
      }
    }
  });

  test("keeps what each seat holds", () => {
    const deal = dealOf(opening(4, { 2: "3_spades joker_bw" }));
    assert.ok(["3_spades", "joker_bw"].every((id) => deal[2].some((c) => c.id === id)));
  });

  test("refuses one card held by two seats", () => {
    assert.throws(() => dealOf(opening(4, { 0: "5_hearts", 3: "5_hearts" })), /5_hearts is held by two seats/);
  });

  test("refuses a seat holding more than its deal", () => {
    const all = createDeck().slice(0, 15).map((c) => c.id).join(" ");
    assert.throws(() => dealOf(opening(4, { 1: all })), /seat 1 holds 15 cards of a 14-card hand/);
  });

  test("refuses a card the deck has not got, and a seat the table has not got", () => {
    assert.throws(() => dealOf(opening(4, { 0: "1_hearts" })), /no card 1_hearts/);
    assert.throws(() => dealOf(opening(2, { 2: "5_hearts" })), /no seat 2/);
  });
});

describe("reach", () => {
  test("a short deal is refused", () => {
    const situation = opening(4);
    const deal = dealOf(situation);
    deal[3].pop();
    assert.throws(() => reachSteps(situation, deal), /4 seats: a deal of 14\/14\/13\/12 is not the 14\/14\/13\/13 one/);
  });

  test("a step the engine refuses throws, naming the situation, the step and the refusal", () => {
    const illegal: Situation = {
      ...opening(4, { 0: "3_spades 4_hearts" }),
      name: "a planted pass",
      moves: [{ seat: 0, play: "3_spades" }, { seat: 2, pass: true }],
    };
    assert.throws(() => reach(illegal), /a planted pass: step 1, seat 2's pass, is refused: notYourTurn/);
  });

  test("every step of every situation is one the engine accepted", () => {
    for (const situation of SITUATIONS) {
      const steps = reachSteps(situation);
      assert.equal(steps.length, situation.moves.length + 1, situation.name);
      assert.deepEqual(reach(situation), steps.at(-1), situation.name);
    }
  });

  test("every situation survives the offline save unchanged", () => {
    for (const situation of SITUATIONS) {
      const gameState = reach(situation);
      const match: OfflineSave["match"] = { length: "match", target: 21, scores: {}, rounds: [], over: false, winners: [], isDraw: false };
      const decoded = decodeOfflineSave(encodeOfflineSave({ gameState, match, dealFirstSeat: situation.firstSeat ?? 0 }));
      assert.equal(decoded.kind, "ok", situation.name);
      assert.deepEqual(decoded.kind === "ok" && decoded.save.gameState, defined(gameState), situation.name);
    }
  });
});
