import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ALIASES, localPath, resolveSpecifier } from "../helpers/specifiers.ts";
import { moduleEdges } from "../helpers/moduleEdges.ts";

const root = path.resolve(import.meta.dirname, "..", "..");
const SCANNERS = ["tests/helpers/moduleEdges.ts", "tests/tooling/libGameBoundary.test.ts", "tests/tooling/rulesModelIndependence.test.ts", "tests/tooling/relatedTests.test.ts", "tests/tooling/e2eRunnableImports.test.ts"];

test("every path mapping the project declares resolves, from any file, to the directory it names", () => {
  assert.ok(ALIASES.length >= 2);
  assert.equal(localPath("lib/theme.ts", "@/components/x"), "components/x");
  assert.equal(localPath("lib/theme.ts", "@shared/y"), "shared/y");
  assert.equal(localPath("lib/game/gameEngine.ts", "../b"), "lib/b");
  assert.equal(localPath("lib/theme.ts", "react"), null);
  assert.equal(localPath("lib/theme.ts", "node:fs"), null);
});

test("a specifier that is no relative path, mapped path or installed package is red", () => {
  assert.throws(() => resolveSpecifier("lib/theme.ts", "~/lib/x"), /no relative path, no mapped path/);
  assert.throws(() => resolveSpecifier("lib/theme.ts", "@nowhere/pkg"), /no relative path/);
});

test("the import-equals form is an edge", () => {
  const edges = moduleEdges("lib/theme.ts", 'import b = require("@shared/b");\nimport c = require("./c");');
  assert.deepEqual(edges.map((e) => e.to), ["shared/b", "lib/c"]);
});

test("no import scanner spells an alias prefix out; they all read the mappings through the helper", () => {
  const spelled = SCANNERS.filter((f) => /startsWith\("@\/"\)|\["@\/", |\["@shared\/"/.test(readFileSync(path.join(root, f), "utf8")));
  assert.deepEqual(spelled, []);
});

test("a string ending in `from` is no import", () => {
  assert.deepEqual(moduleEdges("lib/theme.ts", 'export const a = "give back from";\nexport const b = "x";\n'), []);
});
