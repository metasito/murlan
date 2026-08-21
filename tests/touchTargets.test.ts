// tests/touchTargets.test.ts — nothing in the repo measured a touch target.
//
// tests/e2e/tapTargets.spec.ts is named for them but checks occlusion only:
// whether a control's centre point belongs to something inert. A control can
// pass that while being 32pt tall.
//
// The size sweep lives in the e2e spec, where a rect can actually be measured.
// This is the half that runs in CI: the declared floors, at their source.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { TOUCH_TARGET_MIN } from "../lib/tokens.ts";
import { physicalTouchTarget } from "../components/cardFaceModel.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The bespoke controls that bypass MenuButton's own size scale. */
const CONTROLS: [string, string][] = [
  ["components/GameTable.tsx", "rematchChoice"],
  ["components/GameOverOverlay.tsx", "homeBtn"],
  ["components/GameOverOverlay.tsx", "rematchGradient"],
  ["components/SettingsModal.tsx", "segment"],
  ["components/SettingsModal.tsx", "localeBtn"],
  ["components/MenuButton.tsx", "sm"],
  ["app/lobby.tsx", "personalityBtn"],
  ["app/(online)/room.tsx", "codeBtn"],
  ["app/index.tsx", "friendsBtn"],
  ["components/ResultExchangeOverlay.tsx", "confirmGrad"],
];

/** Controls sized by an explicit box rather than a floor. */
const FIXED_SIZE: [string, string][] = [
  ["components/ReactionLayer.tsx", "trigger"],
  ["app/(online)/friends.tsx", "iconBtn"],
  ["app/index.tsx", "settingsBtn"],
];

/**
 * The control rail's knobs are the one pair whose box is a runtime number
 * rather than a declared style, so there is nothing here to read: their size
 * is `physicalTouchTarget(scale)`, which grows with the table and floors at
 * the HIG minimum. Both halves of that are asserted below.
 */
const RAIL_KNOB_SIZE = /size=\{knobSize\}/;

/** The body of a `name: { … }` entry in a StyleSheet, however it is wrapped. */
function styleBlock(file: string, style: string): string {
  const source = readFileSync(path.join(repoRoot, file), "utf8");
  const at = source.indexOf(`\n  ${style}: {`);
  assert.notEqual(at, -1, `${file} has no style named ${style}`);
  const open = source.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return source.slice(open + 1, i);
  }
  throw new Error(`${file} ${style} is unterminated`);
}

/** A named style's declared size for one property, resolved through the token. */
function declaredSize(file: string, style: string, prop: string): number {
  const m = new RegExp(String.raw`\b${prop}:\s*(TOUCH_TARGET_MIN|\d+)`).exec(styleBlock(file, style));
  assert.ok(m, `${file} ${style} declares no ${prop}`);
  return m[1] === "TOUCH_TARGET_MIN" ? TOUCH_TARGET_MIN : Number(m[1]);
}

test("the touch minimum is the iOS HIG floor", () => {
  assert.equal(TOUCH_TARGET_MIN, 44);
});

for (const [file, style] of CONTROLS) {
  test(`${file} ${style} is at least ${TOUCH_TARGET_MIN}pt tall`, () => {
    const h = declaredSize(file, style, "minHeight");
    assert.ok(h >= TOUCH_TARGET_MIN, `${style} is ${h}pt, needs >=${TOUCH_TARGET_MIN}`);
  });
}

for (const [file, style] of FIXED_SIZE) {
  test(`${file} ${style} is at least ${TOUCH_TARGET_MIN}pt square`, () => {
    for (const side of ["width", "height"]) {
      const n = declaredSize(file, style, side);
      assert.ok(n >= TOUCH_TARGET_MIN, `${style} ${side} is ${n}pt, needs >=${TOUCH_TARGET_MIN}`);
    }
  });
}

test("the rail's knobs are sized by physicalTouchTarget, at the HIG floor", () => {
  const source = readFileSync(path.join(repoRoot, "components/GameTable.tsx"), "utf8");
  assert.match(source, /const knobSize = physicalTouchTarget\(scale\)/);
  assert.match(source, RAIL_KNOB_SIZE);
  // A touch target's floor is physical size, never `TOUCH_TARGET_MIN * s`: on
  // an iPhone SE the table's scale is 0.82, which would put a scaled knob at
  // 36pt.
  assert.equal(physicalTouchTarget(0.82), TOUCH_TARGET_MIN);
  assert.equal(physicalTouchTarget(1), TOUCH_TARGET_MIN);
  assert.ok(physicalTouchTarget(1.13) > TOUCH_TARGET_MIN);
});

test("the reader finds a real declaration", () => {
  // MenuButton is the in-repo reference for what this project considers a
  // correct control. If the reader stopped matching, every case above would
  // throw rather than pass — but only if it is actually reading a number.
  assert.equal(declaredSize("components/MenuButton.tsx", "md", "minHeight"), 52);
});
