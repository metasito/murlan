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
    const target = path.join(repoRoot, "lib", "device", "orientation");
    const resolve = (from: string, spec: string) =>
      (spec.startsWith("@/") ? path.join(repoRoot, spec.slice(2)) : spec.startsWith(".") ? path.join(path.dirname(from), spec) : spec)
        .replace(/\.(tsx?|jsx?)$/, "")
        .replace(/[\\/]index$/, "");
    // Every way to reach a module's bindings; a clause of `null` takes all of them.
    const reaches = (src: string): { spec: string; clause: string | null }[] => [
      ...[...src.matchAll(/\b(?:import|export)\s+(?:type\s+)?([^;'"]*?)\s*from\s*["']([^"']+)["']/g)].map((m) => ({ spec: m[2], clause: m[1] })),
      ...[...src.matchAll(/\b(?:require|import)\s*\(\s*["']([^"']+)["']\s*\)/g)].map((m) => ({ spec: m[1], clause: null })),
    ];
    const importers = ["app", "components", "context", "lib", "modules"]
      .flatMap((dir) => readdirSync(path.join(repoRoot, dir), { recursive: true, encoding: "utf8" }).map((f) => path.join(repoRoot, dir, f)))
      .filter((f) => /\.tsx?$/.test(f) && resolve(f, f) !== target)
      .filter((f) =>
        reaches(readFileSync(f, "utf8")).some(
          ({ spec, clause }) => resolve(f, spec) === target && (clause === null || /\*|\buseLandscapeLock\b/.test(clause))
        )
      )
      .map((f) => path.relative(repoRoot, f).split(path.sep).join("/"));
    assert.deepEqual(importers, ["components/GameTable.tsx"]);
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
