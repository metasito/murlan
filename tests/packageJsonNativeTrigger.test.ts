import { test } from "node:test";
import assert from "node:assert/strict";
import { packageJsonTouchesNative } from "../scripts/package-json-native-trigger.mjs";

test("a non-lifecycle scripts edit is not a native trigger", () => {
  const before = JSON.stringify({ name: "x", scripts: { test: "a" } });
  const after = JSON.stringify({ name: "x", scripts: { test: "b" } });
  assert.equal(packageJsonTouchesNative(before, after), false);
});

test("adding a postinstall script is a native trigger", () => {
  // #928 round 2: postinstall runs patch-package, which edits native sources —
  // a wholesale `.scripts` exemption silently skipped the compile jobs for it.
  const before = JSON.stringify({ name: "x", scripts: { test: "a" } });
  const after = JSON.stringify({
    name: "x",
    scripts: { test: "a", postinstall: "patch-package" },
  });
  assert.equal(packageJsonTouchesNative(before, after), true);
});

test("editing an existing lifecycle script is a native trigger", () => {
  const before = JSON.stringify({ scripts: { postinstall: "patch-package" } });
  const after = JSON.stringify({ scripts: { postinstall: "patch-package && echo done" } });
  assert.equal(packageJsonTouchesNative(before, after), true);
});

test("a dependency bump is a native trigger", () => {
  const before = JSON.stringify({ dependencies: { expo: "1.0.0" } });
  const after = JSON.stringify({ dependencies: { expo: "1.0.1" } });
  assert.equal(packageJsonTouchesNative(before, after), true);
});

test("malformed JSON fails unsafe", () => {
  assert.equal(packageJsonTouchesNative("{not json", "{}"), true);
});

test("key order, in scripts or elsewhere, does not matter", () => {
  const before = JSON.stringify({ b: 1, a: 2, scripts: { z: "1", test: "a" } });
  const after = JSON.stringify({ a: 2, b: 1, scripts: { test: "a", z: "2" } });
  assert.equal(packageJsonTouchesNative(before, after), false);
});
