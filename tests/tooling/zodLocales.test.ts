// metro.config.js resolves zod's every-locale index to an empty module, which holds only while
// nothing the bundle ships reads `z.locales`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { scanSources, sourcesUnder } from "../helpers/sourceScan.ts";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const require = createRequire(import.meta.url);
const SHIPPED = ["app", "components", "context", "lib", "shared"];

const OTHER_BINDING = /import\s+(?!(?:type\s+)?\{ z \} from)[^;]*?from "zod[^"]*"/g;
const READS_LOCALES = /\bz\s*\.\s*(?:core\s*\.\s*)?locales\b/g;

test("the scans see what they are for", () => {
  const planted = (src: string, pattern: RegExp) => scanSources(pattern, [["x.ts", src]]).length;
  assert.equal(planted('import * as zod from "zod";', OTHER_BINDING), 1);
  assert.equal(planted('import { z as y } from "zod";', OTHER_BINDING), 1);
  assert.equal(planted('import { en } from "zod/locales";', OTHER_BINDING), 1);
  assert.equal(planted('import type { z } from "zod";\nimport { z } from "zod";', OTHER_BINDING), 0);
  assert.equal(planted("z.config(z.locales.de());", READS_LOCALES), 1);
});

test("every shipped zod import binds `z`, and none reads its locales", () => {
  const sources = sourcesUnder(repoRoot, SHIPPED);
  assert.ok(scanSources(/from "zod"/g, sources).length >= 5, "the scan found no zod import at all");
  assert.deepEqual(scanSources(OTHER_BINDING, sources), []);
  assert.deepEqual(scanSources(READS_LOCALES, sources), []);
});

test("Metro resolves zod's locale index, and only it, to an empty module", () => {
  const { resolver } = require(path.join(repoRoot, "metro.config.js"));
  const zodRoot = path.dirname(require.resolve("zod/package.json"));
  const at = (filePath: string) =>
    resolver.resolveRequest({ resolveRequest: () => ({ type: "sourceFile", filePath }) }, "x", "web");
  for (const ext of ["js", "cjs"]) {
    assert.deepEqual(at(path.join(zodRoot, "v4", "locales", `index.${ext}`)), { type: "empty" });
  }
  const en = path.join(zodRoot, "v4", "locales", "en.js");
  assert.deepEqual(at(en), { type: "sourceFile", filePath: en });
});
