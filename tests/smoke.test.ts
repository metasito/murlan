import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-ignore — see tests/helpers.ts for why the .ts extension is required
import { buildCombination, canPlayerPlay, c } from "./helpers.ts";

test("harness works and engine imports", () => {
  assert.equal(buildCombination([c("3", "spades")])?.type, "single");
});

test("REGRESSION: enumerator finds a straight blocked by a duplicate rank", () => {
  const hand = [c("3","spades"), c("4","hearts"), c("5","clubs"), c("5","diamonds"), c("6","spades"), c("7","hearts")];
  const opp = buildCombination([c("2","clubs"), c("3","clubs"), c("4","clubs"), c("5","hearts"), c("6","clubs")]);
  assert.ok(opp, "opponent combo should build");
  assert.equal(canPlayerPlay(hand, opp, false), true, "3-4-5-6-7 beats 2-3-4-5-6 and must be found");
});
