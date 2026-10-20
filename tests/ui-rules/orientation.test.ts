// tests/ui-rules/orientation.test.ts — a player already holding the device in landscape
// must never be yanked into portrait. React Native's <Modal> defaults to
// supportedOrientations={["portrait"]} on iOS, so a modal opened in landscape
// rotates the whole app and leaves the screen underneath laid out for the old
// size — every tap then lands on nothing. Only the game table may force an
// orientation, and only to landscape, because it is the one screen that needs
// the width.
//
// components/AppModal.tsx is the only <Modal>, and the rest of this is lint guards in
// eslint.guards.cjs: `one-modal`, `modal-keeps-landscape`, `landscape-only` and
// `no-portrait-lock`.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("orientation is never narrowed behind the player's back", () => {
  test("the game table forces landscape, and is the only caller of the lock", () => {
    const lock = readFileSync(path.join(repoRoot, "lib", "device", "orientation.tsx"), "utf8");
    assert.match(lock, /export function useLandscapeLock\(/);
    assert.match(lock, /lockAsync\(\s*ScreenOrientation\.OrientationLock\.LANDSCAPE\s*\)/);
    const callers = ["app", "components", "context", "lib"]
      .flatMap((dir) => readdirSync(path.join(repoRoot, dir), { recursive: true, encoding: "utf8" }).map((f) => path.join(dir, f)))
      .filter((f) => /\.tsx?$/.test(f) && /(?<!function )\buseLandscapeLock\(\)/.test(readFileSync(path.join(repoRoot, f), "utf8")))
      .map((f) => f.split(path.sep).join("/"));
    assert.deepEqual(callers, ["components/GameTable.tsx"]);
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
