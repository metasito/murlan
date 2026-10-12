import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { gunzipSync } from "node:zlib";

const require = createRequire(import.meta.url);
const { insertSwiftUIFilters } = require("../../plugins/withSwiftUIFilters.js") as { insertSwiftUIFilters: (s: string) => string };

/** The AppDelegate `expo prebuild` writes, read out of the installed template's ustar archive. */
function templateAppDelegate(): string {
  const tar = gunzipSync(readFileSync(require.resolve("expo/template.tgz")));
  const field = (at: number, len: number) => tar.toString("latin1", at, at + len).replace(/\0.*$/s, "");
  for (let at = 0; at + 512 <= tar.length && tar[at] !== 0; ) {
    const name = field(at + 345, 155) + "/" + field(at, 100);
    const size = parseInt(field(at + 124, 12).trim(), 8) || 0;
    if (name.endsWith("/AppDelegate.swift")) return tar.toString("utf8", at + 512, at + 512 + size);
    at += 512 + Math.ceil(size / 512) * 512;
  }
  throw new Error("the installed Expo template has no AppDelegate.swift");
}

test("the installed Expo template's AppDelegate turns the SwiftUI filters on after creating the factory and before starting it", () => {
  const out = insertSwiftUIFilters(templateAppDelegate());
  const at = (s: string) => out.indexOf(s);
  // Expo's generated module provider imports every module `internal`, and Swift refuses two levels.
  assert.ok(at("\ninternal import MurlanDiagnostics\n") > at("import React"), "imports the pod at the provider's access level");
  const call = at("MurlanReactNativeFlags.enableSwiftUIFilters()");
  assert.ok(call > at("ExpoReactNativeFactory(delegate:"), "after the factory sets its release level");
  assert.ok(call < at("factory.startReactNative("), "before React Native starts reading flags on other threads");
  assert.equal(insertSwiftUIFilters(out), out, "a second prebuild pass adds nothing");
});

test("a template without the anchor fails the prebuild instead of shipping without the flag", () => {
  assert.throws(() => insertSwiftUIFilters("import React\nlet factory = Something()\n"), /AppDelegate template changed/);
});
