// tests/sourceMaps.test.ts — a crash frame resolves to the file and line it
// actually came from, using a build map on disk exactly where
// scripts/moveSourceMaps.mjs leaves one; and degrades to the raw frame for
// everything that isn't that — a missing map, an unparsable frame, a
// platform this app never ships web maps for.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { SourceMapGenerator } from "source-map";
import { symbolicate } from "../server/sourceMaps.ts";

const MAPS_ROOT = path.resolve(process.cwd(), "sourcemaps");
const FIXTURE_DIR = path.join(MAPS_ROOT, "_expo", "static", "js", "web");
const FIXTURE_MAP = path.join(FIXTURE_DIR, "entry-test123.js.map");

before(() => {
  mkdirSync(FIXTURE_DIR, { recursive: true });
  const gen = new SourceMapGenerator({ file: "entry-test123.js" });
  // V8 reports a 1-based column in a stack frame; the map format is 0-based,
  // so a frame at column 41 must resolve via a mapping recorded at 40.
  gen.addMapping({
    generated: { line: 1, column: 40 },
    original: { line: 5, column: 2 },
    source: "components/table/hand.tsx",
    name: "CardView",
  });
  gen.setSourceContent("components/table/hand.tsx", "<CardView />");
  writeFileSync(FIXTURE_MAP, gen.toString());
});

after(() => {
  rmSync(MAPS_ROOT, { recursive: true, force: true });
});

test("a V8 frame resolves through its build's map", async () => {
  const resolved = await symbolicate(
    "    at foo (https://murlan.example/_expo/static/js/web/entry-test123.js:1:41)"
  );
  assert.equal(resolved, "components/table/hand.tsx:5 (CardView)");
});

test("a Safari/Hermes-shaped frame resolves the same way", async () => {
  const resolved = await symbolicate(
    "foo@https://murlan.example/_expo/static/js/web/entry-test123.js:1:41"
  );
  assert.equal(resolved, "components/table/hand.tsx:5 (CardView)");
});

test("a frame for a build with no map on disk falls back to its raw text", async () => {
  const raw = "at foo (https://murlan.example/_expo/static/js/web/entry-unknown.js:1:41)";
  assert.equal(await symbolicate(raw), raw);
});

test("text that isn't a stack frame falls back to itself, not a crash", async () => {
  assert.equal(await symbolicate("totally not a stack trace"), "totally not a stack trace");
});

test("no stack at all resolves to null", async () => {
  assert.equal(await symbolicate(undefined), null);
  assert.equal(await symbolicate(""), null);
});

test("a path attempting to leave sourcemaps/ never resolves outside it", async () => {
  const raw = "at foo (https://murlan.example/../../../../etc/passwd:1:1)";
  // The URL parser collapses the traversal before it ever reaches disk, so
  // this is exactly a map that does not exist — same fallback as any other.
  assert.equal(await symbolicate(raw), raw);
});
