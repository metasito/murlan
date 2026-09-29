import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { needsNative } from "../../tools/ci/nativeScope.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const pkg = (dependencies: object, devDependencies: object = {}) => JSON.stringify({ dependencies, devDependencies });
const base = pkg({ expo: "54.0.1", "react-native-svg": "15.1.0" }, { jest: "29.0.0" });

test("the native config needs the compiles", () => {
  for (const f of ["app.json", "app.config.ts", "eas.json"]) assert.equal(needsNative([f], "", ""), true, f);
});

test("a library added, removed or re-versioned needs them", () => {
  assert.equal(needsNative(["package.json"], base, pkg({ expo: "54.0.2", "react-native-svg": "15.1.0" })), true);
  assert.equal(needsNative(["package.json"], base, pkg({ expo: "54.0.1" })), true);
  assert.equal(needsNative(["package.json"], base, pkg({ expo: "54.0.1", "react-native-svg": "15.1.0", x: "1" })), true);
});

test("a devDependency, a script or anything else does not", () => {
  assert.equal(needsNative(["package.json"], base, pkg({ expo: "54.0.1", "react-native-svg": "15.1.0" }, { jest: "30.0.0" })), false);
  assert.equal(needsNative(["components/Card.tsx", "package-lock.json", "README.md"], "", ""), false);
});

test("an unreadable package.json runs them", () => {
  assert.equal(needsNative(["package.json"], "", base), true);
});

const AUDIO = "patches/react-native-audio-api+0.13.6.patch";
const ADAPTER = "patches/@socket.io+postgres-adapter+0.5.0.patch";
const repoPatch = (f: string) => readFileSync(path.join(repoRoot, f), "utf8");

test("a patch counts as native by the paths its own diff touches", () => {
  assert.equal(needsNative([AUDIO], "", "", repoPatch), true);
  assert.equal(needsNative([ADAPTER], "", "", repoPatch), false);
});

test("a native hunk planted in a JS-only patch flips the answer", () => {
  const planted = `${repoPatch(ADAPTER)}diff --git a/node_modules/x/android/src/X.kt b/node_modules/x/android/src/X.kt\n`;
  assert.equal(needsNative([ADAPTER], "", "", () => planted), true);
});

test("a patch whose text cannot be read runs the compiles", () => {
  assert.equal(needsNative([AUDIO], "", "", () => null), true);
});

test("a local native module's sources need the native builds; other sources do not", () => {
  assert.equal(needsNative(["modules/murlan-diagnostics/ios/MurlanDiagnosticsModule.swift"], "", ""), true);
  assert.equal(needsNative(["lib/diagnostics/probe.ts"], "", ""), false);
});
