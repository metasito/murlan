// tests/ui-rules/orientation.test.ts — a player already holding the device in landscape
// must never be yanked into portrait. React Native's <Modal> defaults to
// supportedOrientations={["portrait"]} on iOS, so a modal opened in landscape
// rotates the whole app and leaves the screen underneath laid out for the old
// size — every tap then lands on nothing. Only the game table may force an
// orientation, and only to landscape, because it is the one screen that needs
// the width.
//
// components/AppModal.tsx is the only <Modal>, and the rest of this is lint guards in
// eslint.guards.cjs: `one-modal-element`, `one-modal-import`, `modal-keeps-landscape`,
// `orientation-lock-owner` and `never-portrait-lock`.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("orientation is never narrowed behind the player's back", () => {
  test("the game table forces landscape", () => {
    const src = readFileSync(path.join(repoRoot, "components", "GameTable.tsx"), "utf8");
    assert.match(src, /lockAsync\(\s*ScreenOrientation\.OrientationLock\.LANDSCAPE\s*\)/);
  });

  test("app.json leaves the app free to rotate", () => {
    const appJson = JSON.parse(
      readFileSync(path.join(repoRoot, "app.json"), "utf8")
    ) as { expo: { orientation?: string } };
    assert.equal(
      appJson.expo.orientation,
      "default",
      'app.json must stay orientation:"default" — pinning it to portrait would ' +
        "override every per-screen decision"
    );
  });
});
