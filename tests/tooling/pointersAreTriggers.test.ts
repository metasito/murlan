// tests/tooling/pointersAreTriggers.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const claude = readFileSync(path.join(root, "CLAUDE.md"), "utf8");

// The pointer list is the only place CLAUDE.md names another document, and each line must say
// the condition for going there: a pointer that only describes its target is not reached.
const TRIGGER = /\b(before|when|after|once|if)\b/i;

test("every pointer line names its trigger", () => {
  const lines = claude.split("\n").filter((l) => /^- .*`(docs|\.claude)\/[^`]+`/.test(l));
  assert.ok(lines.length >= 4, `found ${lines.length} pointer lines; the list moved`);
  assert.deepEqual(lines.filter((l) => !TRIGGER.test(l)), []);
});
