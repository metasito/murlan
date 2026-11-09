import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..", "..");
const SPEC = "tests/e2e/seatNameContrast.spec.ts";
const ROW = "| **The lit seat name's contrast** |";

const specFloor = (text: string) => {
  const found = [...text.matchAll(/^const LIT_FLOOR = ([\d.]+);$/gm)];
  assert.equal(found.length, 1, `${SPEC} declares LIT_FLOOR ${found.length} times`);
  return Number(found[0]![1]);
};
const ruledFloor = (text: string) => {
  const rows = text.split("\n").filter((l) => l.startsWith(ROW));
  assert.equal(rows.length, 1, `docs/GAME-RULES.md holds ${rows.length} rows "${ROW}"`);
  const m = /regression floor of ([\d.]+):1/.exec(rows[0]!);
  assert.ok(m, `the row names no "regression floor of <n>:1": ${rows[0]}`);
  return Number(m[1]);
};
const COMPARISON = "for (const { what, ratio } of lit) expect.soft(ratio, what).toBeGreaterThanOrEqual(LIT_FLOOR);";
const unheld = (text: string) => {
  const uses = [...text.matchAll(/\bLIT_FLOOR\b/g)].length - 1;
  const bare = text.split("\n").filter((l) => l.trim() === COMPARISON).length;
  return uses === 1 && bare === 1 ? null : `${SPEC} uses LIT_FLOOR ${uses} times and holds the line \`${COMPARISON}\` ${bare} times; it must do each exactly once`;
};
const disagree = (spec: string, rules: string) => {
  const [held, ruled] = [specFloor(spec), ruledFloor(rules)];
  return held === ruled ? null : `${SPEC} holds LIT_FLOOR ${held}, the ruling in docs/GAME-RULES.md § Decisions says ${ruled}`;
};

describe("the lit seat name's floor is the one its ruling records", () => {
  const spec = readFileSync(path.join(root, SPEC), "utf8");
  const rules = readFileSync(path.join(root, "docs/GAME-RULES.md"), "utf8");

  test("the spec's LIT_FLOOR equals the Decisions row's floor", () => assert.equal(disagree(spec, rules), null));

  test("the spec compares every lit ratio against LIT_FLOOR itself, once", () => assert.equal(unheld(spec), null));

  test("a comparison loosened by arithmetic, or deleted, is not held", () => {
    for (const planted of [spec.replace("toBeGreaterThanOrEqual(LIT_FLOOR)", "toBeGreaterThanOrEqual(LIT_FLOOR - 1)"), spec.replace(COMPARISON, "")]) {
      assert.notEqual(planted, spec);
      assert.match(unheld(planted) ?? "", /must do each exactly once/);
    }
  });

  test("a floor loosened in the spec alone disagrees", () => {
    assert.equal(disagree(spec.replace(/^const LIT_FLOOR = [\d.]+;$/m, "const LIT_FLOOR = 1.0;"), rules), `${SPEC} holds LIT_FLOOR 1, the ruling in docs/GAME-RULES.md § Decisions says ${ruledFloor(rules)}`);
  });
});
