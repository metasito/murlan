import { test } from "node:test";
import assert from "node:assert/strict";
import { tableFontSize } from "../../components/cardFaceModel.ts";
import { tableScale } from "../../components/tableLayout.ts";

test("an SE's table text stays at 10px or more", () => {
  const se = tableScale({ width: 568, height: 320 });
  assert.ok(se < 0.85);
  assert.equal(tableFontSize(9.5, se), 10);
  assert.equal(tableFontSize(20, 1), 20);
});
