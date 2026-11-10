// tests/ui-rules/swayShows.test.ts — the floor that stands in for "the felt redrew a swaying light" once the sway rides the compositor.
import { test } from "node:test";
import assert from "node:assert/strict";
import { swayShows } from "../e2e/helpers/renderCounters.ts";

const at = (opacity: number, running = 1) => ({ opacity, running });

test("a layer whose animation runs and whose opacity moves shows the sway", () => {
  assert.equal(swayShows([at(0.2), at(0.5), at(0.8)]), true);
});

test("a table with no end-B layer, a layer with no running animation, or a frozen opacity does not", () => {
  assert.equal(swayShows([null, null, null]), false);
  assert.equal(swayShows([at(0.2), null, at(0.8)]), false);
  assert.equal(swayShows([at(0.2, 0), at(0.5, 0), at(0.8, 0)]), false);
  assert.equal(swayShows([at(0.5), at(0.5), at(0.5)]), false);
  assert.equal(swayShows([]), false);
  assert.equal(swayShows([at(0.2)]), false);
});
