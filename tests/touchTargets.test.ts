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
// @ts-ignore
import { TOUCH_TARGET_MIN } from "../lib/tokens.ts";

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
];

/** Controls sized by an explicit box rather than a floor. */
const FIXED_SIZE: [string, string][] = [
  ["components/GameTable.tsx", "quitBtn"],
  ["app/(online)/friends.tsx", "iconBtn"],
];

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

test("the reader finds a real declaration", () => {
  // MenuButton is the in-repo reference for what this project considers a
  // correct control. If the reader stopped matching, every case above would
  // throw rather than pass — but only if it is actually reading a number.
  assert.equal(declaredSize("components/MenuButton.tsx", "md", "minHeight"), 52);
});
