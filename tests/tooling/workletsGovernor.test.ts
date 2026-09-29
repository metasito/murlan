import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const LIB = path.dirname(createRequire(path.join(ROOT, "package.json")).resolve("react-native-worklets/package.json"));
const json = (file: string) => JSON.parse(readFileSync(file, "utf8"));

type Flags = Record<string, unknown>;

function iosGovernor(libraryFlags: Flags, packageJson: { worklets?: { staticFeatureFlags?: Flags } }): boolean {
  const flags = { ...libraryFlags, ...packageJson.worklets?.staticFeatureFlags };
  return String(flags.IOS_DYNAMIC_FRAMERATE_ENABLED) === "true";
}

const libraryFlags = json(path.join(LIB, "src/featureFlags/staticFlags.json"));

test("the library's pod build still overlays package.json's worklets.staticFeatureFlags on its staticFlags.json", () => {
  const utils = readFileSync(path.join(LIB, "scripts/worklets_utils.rb"), "utf8");
  assert.match(utils, /File\.path\('\.\/src\/featureFlags\/staticFlags\.json'\)/);
  assert.match(utils, /package_json\['worklets'\]\['staticFeatureFlags'\]/);
});

test("the iOS build reads the worklets frame-rate governor as on", () => {
  assert.equal(iosGovernor(libraryFlags, json(path.join(ROOT, "package.json"))), true);
});

test("a planted override in package.json reads as off, whether a boolean or a string", () => {
  assert.equal(iosGovernor(libraryFlags, { worklets: { staticFeatureFlags: { IOS_DYNAMIC_FRAMERATE_ENABLED: false } } }), false);
  assert.equal(iosGovernor(libraryFlags, { worklets: { staticFeatureFlags: { IOS_DYNAMIC_FRAMERATE_ENABLED: "false" } } }), false);
});

test("a library whose own flag is off, or has no such flag, reads as off", () => {
  assert.equal(iosGovernor({ ...libraryFlags, IOS_DYNAMIC_FRAMERATE_ENABLED: false }, {}), false);
  const { IOS_DYNAMIC_FRAMERATE_ENABLED: _, ...renamed } = libraryFlags;
  assert.equal(iosGovernor(renamed, {}), false);
});
