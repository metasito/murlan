// tests/ui-rules/swayShows.test.ts — the floor that stands in for "the felt redrew a swaying light" once the sway rides the compositor.
import { test } from "node:test";
import assert from "node:assert/strict";
import { swayShows } from "../e2e/helpers/renderCounters.ts";

const at = (opacity: number, running = 1) => ({ opacity, running });
const leaning = { lean: 6 };

test("a layer whose animation runs and whose opacity moves shows the sway", () => {
  assert.equal(swayShows([at(0.2), at(0.5), at(0.8)], leaning), true);
});

test("a table with no end-B layer, a layer with no running animation, or a frozen opacity does not", () => {
  assert.equal(swayShows([null, null, null], leaning), false);
  assert.equal(swayShows([at(0.2), null, at(0.8)], leaning), false);
  assert.equal(swayShows([at(0.2, 0), at(0.5, 0), at(0.8, 0)], leaning), false);
  assert.equal(swayShows([at(0.5), at(0.5), at(0.5)], leaning), false);
  assert.equal(swayShows([], leaning), false);
  assert.equal(swayShows([at(0.2)], leaning), false);
});

test("a picture that is a copy of end A, is blank, or was not read does not", () => {
  const samples = [at(0.2), at(0.5), at(0.8)];
  assert.equal(swayShows(samples, { lean: -6 }), false, "end B a copy of end A");
  assert.equal(swayShows(samples, { lean: 0 }), false, "end B blank");
  assert.equal(swayShows(samples, { lean: NaN }), false);
  assert.equal(swayShows(samples, null), false);
});
