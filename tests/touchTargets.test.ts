// tests/touchTargets.test.ts — nothing in the repo measured a touch target.
//
// tests/e2e/tapTargets.spec.ts is named for them but checks occlusion only:
// whether a control's centre point belongs to something inert. A control can
// pass that while being 32pt tall, which is what the bespoke controls on the
// game table and in settings were.
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
];

/** The `minHeight` a named style declares, resolved through the token. */
function declaredMinHeight(file: string, style: string): number {
  const source = readFileSync(path.join(repoRoot, file), "utf8");
  const open = `\n  ${style}: {`;
  const at = source.indexOf(open);
  assert.notEqual(at, -1, `${file} has no style named ${style}`);
  const close = source.indexOf("\n  },", at + open.length);
  const block = source.slice(at + open.length, close === -1 ? undefined : close);
  const m = /\bminHeight:\s*(TOUCH_TARGET_MIN|\d+)/.exec(block);
  assert.ok(m, `${file} ${style} declares no minHeight`);
  return m[1] === "TOUCH_TARGET_MIN" ? TOUCH_TARGET_MIN : Number(m[1]);
}

test("the touch minimum is the iOS HIG floor", () => {
  assert.equal(TOUCH_TARGET_MIN, 44);
});

for (const [file, style] of CONTROLS) {
  test(`${file} ${style} is at least ${TOUCH_TARGET_MIN}pt tall`, () => {
    const h = declaredMinHeight(file, style);
    assert.ok(h >= TOUCH_TARGET_MIN, `${style} is ${h}pt, needs >=${TOUCH_TARGET_MIN}`);
  });
}

test("the reader finds a real declaration", () => {
  // MenuButton is the in-repo reference for what this project considers a
  // correct control. If the reader stopped matching, every case above would
  // throw rather than pass — but only if it is actually reading a number.
  assert.equal(declaredMinHeight("components/MenuButton.tsx", "md"), 52);
});
