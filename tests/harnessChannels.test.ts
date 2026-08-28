// tests/harnessChannels.test.ts — the browser suite's `data-*` hooks, both ends.
//
// A channel is written by a screen and read in tests/e2e/helpers/selectors.ts, and
// nothing in between is typed. Renaming one end costs a browser run that reports "the
// hand never rendered" — a missing selector reading as a missing feature, which is the
// whole reason these moved off aria-label.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { blankComments } from "./helpers/sourceScan.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(path.join(repoRoot, rel), "utf8");

const READER = "tests/e2e/helpers/selectors.ts";
/** Anything the suite can look at, so a second screen publishing a channel is seen. */
const WRITTEN_IN = ["components", "app"];

/**
 * `dataSet` reaches the DOM through react-native-web's `hyphenateString`, which is
 * `/[A-Z]/g` replaced by `-` plus the lowercase letter
 * (`modules/createDOMProps/index.js:19-25`). This mirrors it.
 */
const attributeFor = (key: string) => `data-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;

function screens(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(path.join(repoRoot, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...screens(rel));
    else if (entry.name.endsWith(".tsx")) out.push(rel);
  }
  return out;
}

/** Every `data-*` a screen publishes, and the file it comes from. */
function written(): Map<string, string> {
  const out = new Map<string, string>();
  for (const rel of WRITTEN_IN.flatMap(screens)) {
    const source = blankComments(read(rel));
    // The whole object, then every key in it — a call setting two channels at once
    // would otherwise contribute only its first.
    for (const call of source.matchAll(/(?:harnessState|dataSet=)\(?\{\s*([^}]*)\}/g)) {
      for (const key of call[1].matchAll(/(\w+)\s*:/g)) out.set(attributeFor(key[1]), rel);
    }
  }
  return out;
}

/** Bare (`"data-table-state"`) or inside a selector (`"[data-hand-state]"`) alike. */
const readBack = () =>
  [...blankComments(read(READER)).matchAll(/data-[a-z]+(?:-[a-z]+)*/g)].map((m) => m[0]);

test("every channel a screen publishes is the one the suite reads", () => {
  const publishes = written();
  assert.ok(publishes.size > 0, "no screen publishes a harness channel at all");
  const reads = readBack();
  assert.deepEqual(
    [...publishes].filter(([attr]) => !reads.includes(attr)).map(([a, f]) => `${a} (${f})`),
    [],
    `${READER} does not name these, so the suite will look for an attribute nothing sets`
  );
});

test("the suite reads no channel a screen has stopped publishing", () => {
  const publishes = written();
  assert.deepEqual(
    readBack().filter((attr) => attr !== "data-testid" && !publishes.has(attr)),
    [],
    "nothing sets these any more, so every selector built on them matches nothing"
  );
});
