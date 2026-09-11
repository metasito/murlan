// The glyph on the portrait cover, and the angle it settles at.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ROTATE_SETTLED, ROTATE_UPRIGHT, rotateGlyphAngle } from "../components/table/rotateGlyph.ts";

describe("the portrait cover's glyph", () => {
  test("stands upright at the start and lies down at the end", () => {
    assert.equal(rotateGlyphAngle(ROTATE_UPRIGHT), 90);
    assert.equal(rotateGlyphAngle(ROTATE_SETTLED), 0);
  });

  test("parks in the pose it is asking for, not the one the player is in", () => {
    // The whole point of the still frame: a glyph parked upright shows the
    // player what they already have.
    assert.notEqual(rotateGlyphAngle(ROTATE_SETTLED), rotateGlyphAngle(ROTATE_UPRIGHT));
    assert.equal(rotateGlyphAngle(ROTATE_SETTLED), 0);
  });

  test("turns without doubling back", () => {
    const path = [0, 0.25, 0.5, 0.75, 1].map(rotateGlyphAngle);
    for (let i = 1; i < path.length; i++) {
      assert.ok(path[i]! < path[i - 1]!, "the glyph reverses part-way through its turn");
    }
  });
});
