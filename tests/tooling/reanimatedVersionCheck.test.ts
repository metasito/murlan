// metro.config.js swaps Reanimated's worklets-version check for one that passes, in release bundles only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const require = createRequire(import.meta.url);
const CHECK = path.join(path.dirname(require.resolve("react-native-reanimated/package.json")), "scripts", "validate-worklets-version.js");
const PASSES = path.join(repoRoot, "scripts", "metro", "workletsVersionOk.js");

const { resolver } = require(path.join(repoRoot, "metro.config.js"));
const at = (filePath: string, dev: boolean) =>
  resolver.resolveRequest({ dev, resolveRequest: () => ({ type: "sourceFile", filePath }) }, "x", "ios");

test("a release bundle gets the passing check, from any copy of Reanimated", () => {
  assert.deepEqual(at(CHECK, false), { type: "sourceFile", filePath: PASSES });
  const nested = path.join(repoRoot, "node_modules", "some-lib", "node_modules", "react-native-reanimated", "scripts", "validate-worklets-version.js");
  assert.deepEqual(at(nested, false), { type: "sourceFile", filePath: PASSES });
});

test("a dev bundle keeps the real check, and nothing else is swapped", () => {
  assert.deepEqual(at(CHECK, true), { type: "sourceFile", filePath: CHECK });
  const sibling = path.join(path.dirname(CHECK), "validate-worklets-build.js");
  assert.deepEqual(at(sibling, false), { type: "sourceFile", filePath: sibling });
});

test("the passing check answers in the real check's shape", () => {
  const real: unknown = require(CHECK);
  const passes: unknown = require(PASSES);
  assert.equal(typeof real, "function");
  assert.equal(typeof passes, "function");
  assert.equal(typeof (real as (v: string) => { ok: boolean })("4.7.1").ok, "boolean");
  assert.deepEqual((passes as (v: string) => { ok: boolean })("4.7.1"), { ok: true });
});
