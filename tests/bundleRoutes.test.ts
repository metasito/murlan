// tests/bundleRoutes.test.ts — the guard that names an empty route table.
//
// The defect it exists for cannot be reproduced here: it needs two checkouts of
// this repo exporting against one machine-wide Metro cache. What this file pins
// is that the guard reads `app/` rather than a list, and that it actually fails
// on a bundle with no routes — a guard that only ever passes is the failure
// mode, not the export.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expectedRouteKeys, missingRoutes } from "../scripts/bundleRoutes.mjs";

function fakeAppDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "murlan-routes-"));
  mkdirSync(path.join(dir, "(online)"));
  for (const f of ["_layout.tsx", "lobby.tsx", "+not-found.tsx", "+native-intent.tsx", "readme.md"]) {
    writeFileSync(path.join(dir, f), "");
  }
  writeFileSync(path.join(dir, "(online)", "room.tsx"), "");
  return dir;
}

describe("the exported bundle carries this checkout's routes", () => {
  test("the expected keys come from app/, nested groups included", () => {
    assert.deepEqual(expectedRouteKeys(fakeAppDir()).sort(), [
      "./(online)/room.tsx",
      "./+not-found.tsx",
      "./_layout.tsx",
      "./lobby.tsx",
    ]);
  });

  test("the shapes expo-router's own context excludes are not required", () => {
    const keys = expectedRouteKeys(fakeAppDir());
    assert.ok(!keys.includes("./+native-intent.tsx"), "+native-intent is source, never a route");
    assert.ok(!keys.some((k) => k.endsWith(".md")), "only .ts/.tsx files become routes");
  });

  test("a bundle carrying every key is accepted", () => {
    const dir = fakeAppDir();
    const bundle = expectedRouteKeys(dir).map((k) => JSON.stringify(k)).join(",");
    assert.deepEqual(missingRoutes(bundle, dir), []);
  });

  // The floor. This is the bundle the bug actually produces: `_layout` present,
  // routes gone. A guard that passed on this would catch nothing.
  test("a bundle with _layout and no routes is reported, key by key", () => {
    const dir = fakeAppDir();
    const missing = missingRoutes('__d(function(){"_layout"})', dir);
    assert.deepEqual(missing, expectedRouteKeys(dir));
  });
});

/** `metro.config.js`'s own `cacheVersion`, read under a given environment. */
function cacheVersionWith(env: Record<string, string | undefined>): string {
  return execFileSync(
    process.execPath,
    ["-e", "process.stdout.write(require('./metro.config.js').cacheVersion)"],
    { cwd: path.resolve(import.meta.dirname, ".."), env: { ...process.env, ...env }, encoding: "utf8" }
  );
}

describe("Metro's transform cache key covers what the transform depends on", () => {
  test("the project root, so two checkouts do not share entries", () => {
    assert.ok(
      cacheVersionWith({}).includes(path.resolve(import.meta.dirname, "..")),
      "two checkouts of this repo would overwrite each other's cached transforms"
    );
  });

  // babel-preset-expo replaces `process.env.EXPO_PUBLIC_*` with a literal in a production
  // build, so the value is part of the cached output. A build that sets one differently must
  // not read back a transform made under the other — which is how an e2e export and a
  // production build come to serve each other's code.
  test("every EXPO_PUBLIC_ value babel inlines", () => {
    const off = cacheVersionWith({ EXPO_PUBLIC_E2E_FAST: undefined });
    const on = cacheVersionWith({ EXPO_PUBLIC_E2E_FAST: "1" });
    assert.notEqual(on, off, "a zero-delay e2e build shares cache entries with a real one");
    assert.ok(on.includes("EXPO_PUBLIC_E2E_FAST=1"));
  });
});
