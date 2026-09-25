import { test } from "node:test";
import assert from "node:assert/strict";
import { needsNative } from "../../tools/ci/nativeScope.mjs";

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
