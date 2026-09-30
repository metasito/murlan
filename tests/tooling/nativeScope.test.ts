import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { needsNative, patchReader } from "../../tools/ci/nativeScope.mjs";

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

const header = (p: string) => `diff --git ${p.replace(/^("?)/, "$1a/")} ${p.replace(/^("?)/, "$1b/")}\n+x\n`;

test("quoted and CRLF headers are parsed, not left to the fail-safe", () => {
  assert.equal(needsNative([ADAPTER], "", "", () => header('"node_modules/x/ios/\\303\\251.mm"')), true);
  assert.equal(needsNative([ADAPTER], "", "", () => header('"node_modules/x/dist/\\303\\251.js"')), false);
  assert.equal(needsNative([ADAPTER], "", "", () => header("node_modules/x/dist/my file.js")), false);
  assert.equal(needsNative([AUDIO], "", "", () => repoPatch(AUDIO).replace(/\n/g, "\r\n")), true);
  assert.equal(needsNative([ADAPTER], "", "", () => repoPatch(ADAPTER).replace(/\n/g, "\r\n")), false);
});

test("readable text with no diff header runs the compiles", () => {
  for (const text of ["", "--- a/x.js\n+++ b/x.js\n@@ -1 +1 @@\n-a\n+b\n"]) {
    assert.equal(needsNative([ADAPTER], "", "", () => text), true, JSON.stringify(text));
  }
});

test("a native source outside a native folder is native", () => {
  for (const f of ["src/Foo.swift", "src/foo.hpp", "src/foo.c", "build.gradle"]) {
    assert.equal(needsNative([ADAPTER], "", "", () => header(`node_modules/x/${f}`)), true, f);
  }
});

test("the CLI reads a patch at HEAD, else at the base, else not at all", () => {
  const show = (have: Record<string, string>) => (rev: string, f: string) => {
    if (!(`${rev}:${f}` in have)) throw new Error("missing");
    return have[`${rev}:${f}`];
  };
  assert.equal(patchReader(show({ "HEAD:p": "new", "main:p": "old" }), "main")("p"), "new");
  assert.equal(patchReader(show({ "main:p": "old" }), "main")("p"), "old");
  assert.equal(patchReader(show({}), "main")("p"), null);
});

test("a local native module's sources need the native builds; other sources do not", () => {
  assert.equal(needsNative(["modules/murlan-diagnostics/ios/MurlanDiagnosticsModule.swift"], "", ""), true);
  assert.equal(needsNative(["lib/diagnostics/probe.ts"], "", ""), false);
});
