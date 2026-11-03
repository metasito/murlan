import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const REANIMATED = path.dirname(createRequire(path.join(ROOT, "package.json")).resolve("react-native-reanimated/package.json"));
const json = (file: string) => JSON.parse(readFileSync(file, "utf8"));

type Flags = Record<string, unknown>;

function reanimatedFlag(name: string, libraryFlags: Flags, packageJson: { reanimated?: { staticFeatureFlags?: Flags } }): boolean {
  const flags = { ...libraryFlags, ...packageJson.reanimated?.staticFeatureFlags };
  return String(flags[name]) === "true";
}

const libraryFlags = json(path.join(REANIMATED, "src/featureFlags/staticFlags.json"));
const SYNC_FLAGS = ["IOS_SYNCHRONOUSLY_UPDATE_UI_PROPS", "ANDROID_SYNCHRONOUSLY_UPDATE_UI_PROPS"];

test("iOS may run above 60 Hz on an iPhone: the Info.plist key is on", () => {
  assert.equal(json(path.join(ROOT, "app.json")).expo.ios.infoPlist.CADisableMinimumFrameDurationOnPhone, true);
});

test("the library's pod and gradle builds still overlay package.json's reanimated.staticFeatureFlags on its staticFlags.json", () => {
  const rb = readFileSync(path.join(REANIMATED, "scripts/reanimated_utils.rb"), "utf8");
  assert.match(rb, /File\.path\('\.\/src\/featureFlags\/staticFlags\.json'\)/);
  assert.match(rb, /package_json\['reanimated'\]\['staticFeatureFlags'\]/);
  const gradle = readFileSync(path.join(REANIMATED, "android/build.gradle.kts"), "utf8");
  assert.match(gradle, /src\/featureFlags\/staticFlags\.json/);
  assert.match(gradle, /packageJson\["reanimated"\]/);
});

test("the library still names both synchronous UI-props flags, off by default", () => {
  for (const name of SYNC_FLAGS) assert.equal(libraryFlags[name], false, name);
});

test("the builds read both synchronous UI-props flags as on", () => {
  const pkg = json(path.join(ROOT, "package.json"));
  for (const name of SYNC_FLAGS) assert.equal(reanimatedFlag(name, libraryFlags, pkg), true, name);
});

test("they are not paired with a flag the library refuses them with", () => {
  const pkg = json(path.join(ROOT, "package.json"));
  const flags = { ...libraryFlags, ...pkg.reanimated.staticFeatureFlags };
  assert.notEqual(String(flags.ENABLE_SHARED_ELEMENT_TRANSITIONS), "true");
});

test("a planted override reads as off, whether a boolean or a string", () => {
  for (const off of [false, "false"]) {
    assert.equal(reanimatedFlag(SYNC_FLAGS[0], libraryFlags, { reanimated: { staticFeatureFlags: { [SYNC_FLAGS[0]]: off } } }), false);
  }
  assert.equal(reanimatedFlag(SYNC_FLAGS[0], libraryFlags, {}), false);
});
