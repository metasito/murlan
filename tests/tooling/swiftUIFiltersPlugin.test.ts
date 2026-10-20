import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { insertSwiftUIFilters, patchedAppDelegate, podOf } from "../helpers/appDelegate.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const FLAGS = path.join(repoRoot, "modules/murlan-rn-patches/ios/MurlanReactNativeFlags.mm");

test("the installed Expo template's AppDelegate turns the SwiftUI filters on after creating the factory and before starting it", () => {
  const out = patchedAppDelegate();
  const at = (s: string) => out.indexOf(s);
  // Expo's generated module provider imports every module `internal`, and Swift refuses two levels.
  assert.ok(at(`\ninternal import ${podOf(FLAGS).name}\n`) > at("import React"), "imports the pod at the provider's access level");
  const call = at("MurlanReactNativeFlags.enableSwiftUIFilters()");
  assert.ok(call > at("ExpoReactNativeFactory(delegate:"), "after the factory sets its release level");
  assert.ok(call < at("factory.startReactNative("), "before React Native starts reading flags on other threads");
  assert.equal(insertSwiftUIFilters(out), out, "a second prebuild pass adds nothing");
});

test("a template without the anchor fails the prebuild instead of shipping without the flag", () => {
  assert.throws(() => insertSwiftUIFilters("import React\nlet factory = Something()\n"), /AppDelegate template changed/);
});
