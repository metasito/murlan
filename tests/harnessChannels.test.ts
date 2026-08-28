// tests/harnessChannels.test.ts — the browser suite's `data-*` hooks, both ends.
//
// A channel is written in components/GameTable.tsx and read in
// tests/e2e/helpers/selectors.ts, and nothing in between is typed. Renaming one end
// costs a browser run that reports "the hand never rendered" — a missing selector
// reading as a missing feature, which is the whole reason these moved off aria-label.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(path.join(repoRoot, rel), "utf8");

const WRITER = "components/GameTable.tsx";
const READER = "tests/e2e/helpers/selectors.ts";

/** react-native-web's own `hyphenateString`, which is how `dataSet` reaches the DOM. */
const attributeFor = (key: string) => `data-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;

const written = () =>
  [...read(WRITER).matchAll(/harnessState\(\{\s*(\w+):/g)].map((m) => attributeFor(m[1]));

/** Bare (`"data-table-state"`) or inside a selector (`"[data-hand-state]"`) alike. */
const readBack = () => [...read(READER).matchAll(/data-[a-z]+(?:-[a-z]+)*/g)].map((m) => m[0]);

test("every channel the table publishes is the one the suite reads", () => {
  const publishes = written();
  assert.ok(publishes.length > 0, `${WRITER} publishes no harness channel at all`);
  const reads = readBack();
  assert.deepEqual(
    publishes.filter((attr) => !reads.includes(attr)),
    [],
    `${READER} does not name these, so the suite will look for an attribute nothing sets`
  );
});

test("the suite reads no channel the table has stopped publishing", () => {
  const publishes = written();
  assert.deepEqual(
    readBack().filter((attr) => attr !== "data-testid" && !publishes.includes(attr)),
    [],
    `${WRITER} no longer sets these, so every selector built on them matches nothing`
  );
});
