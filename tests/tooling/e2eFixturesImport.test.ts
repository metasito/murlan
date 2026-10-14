// tests/e2e/fixtures.ts fails a test on any browser error, but only a test built from its `test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { blankComments, sourcesUnder } from "../helpers/sourceScan.ts";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const FIXTURES = "tests/e2e/fixtures.ts";
const PLAYWRIGHT = String.raw`["']@playwright/test["']`;

/** How `source` can reach `@playwright/test`'s own `test`, as the offending text. */
function rawTestImports(source: string): string[] {
  const code = blankComments(source);
  const found: string[] = [];
  for (const m of code.matchAll(new RegExp(String.raw`\b(import|export)\s+(type\s+)?([^;]*?)\s*from\s*${PLAYWRIGHT}`, "g"))) {
    if (m[2]) continue;
    const clause = m[3];
    const named = clause.match(/\{([^}]*)\}/);
    const outsideBraces = clause.replace(/\{[^}]*\}/, "").replace(/,/g, "").trim();
    const namesTest = named?.[1]
      .split(",")
      .map((s) => s.trim())
      .some((s) => !s.startsWith("type ") && s.split(/\s+as\s+/)[0] === "test");
    if (namesTest || outsideBraces !== "" || clause.trim() === "*") found.push(m[0].replace(/\s+/g, " "));
  }
  for (const m of code.matchAll(new RegExp(String.raw`\b(?:require|import)\s*\(\s*${PLAYWRIGHT}\s*\)(?!\s*\.)`, "g"))) found.push(m[0]);
  return found;
}

test("every spec and helper takes `test` from ./fixtures", () => {
  const sources = sourcesUnder(repoRoot, ["tests/e2e"]);
  assert.ok(sources.some(([rel]) => rel === FIXTURES), `${FIXTURES} is where the check lives`);
  const offenders = sources
    .filter(([rel]) => rel !== FIXTURES)
    .flatMap(([rel, src]) => rawTestImports(src).map((hit) => `${rel}: ${hit}`));
  assert.deepEqual(offenders, [], "import `test` from ./fixtures instead, so a browser error fails it");
});

test("the scan finds every way to reach the raw `test`", () => {
  const caught = [
    `import { test, expect } from "@playwright/test";`,
    `import { expect, test as base } from '@playwright/test';`,
    `import {\n  expect,\n  test,\n  type Page,\n} from "@playwright/test";`,
    `import * as pw from "@playwright/test";`,
    `import pw from "@playwright/test";`,
    `import pw, { expect } from "@playwright/test";`,
    `export { test } from "@playwright/test";`,
    `const { test } = require("@playwright/test");`,
    `const pw = await import("@playwright/test");`,
  ];
  for (const src of caught) assert.equal(rawTestImports(src).length, 1, src);
});

test("the scan leaves types, expect and commented-out imports alone", () => {
  const allowed = [
    `import type { Page, test } from "@playwright/test";`,
    `import { expect, type Page, devices, defineConfig } from "@playwright/test";`,
    `import { type test } from "@playwright/test";`,
    `import { test, expect } from "./fixtures";`,
    `// import { test } from "@playwright/test";`,
    `let page: import("@playwright/test").Page;`,
  ];
  for (const src of allowed) assert.deepEqual(rawTestImports(src), [], src);
});
