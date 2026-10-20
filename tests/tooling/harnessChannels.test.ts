// tests/tooling/harnessChannels.test.ts — every channel lib/harnessChannels.ts registers has a
// screen writing it. The known-channel guard refuses a key the registry lacks and
// tests/e2e/helpers/selectors.ts reads the registry, so what is left is reachability: a channel
// no screen writes any more makes every selector built on it match nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { blankCommentsAndStrings, jsxTags, scannedFiles, sourcesUnder } from "../helpers/sourceScan.ts";
import { CHANNELS, type Channel } from "../../lib/harnessChannels.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * `dataSet` reaches the DOM through react-native-web's `hyphenateString`, which is
 * `/[A-Z]/g` replaced by `-` plus the lowercase letter
 * (`modules/createDOMProps/index.js:19-25`). This mirrors it.
 */
const attributeFor = (key: string) => `data-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;

const WRITER = /(?:harnessState\(|dataSet=\{|dataSet:)\s*\{([^}]*)\}/g;

/** Every channel key written inside a JSX tag of a screen, and the file it comes from. */
function written(): Map<string, string> {
  const out = new Map<string, string>();
  for (const rel of scannedFiles(repoRoot)) {
    const source = blankCommentsAndStrings(readFileSync(path.join(repoRoot, rel), "utf8"));
    for (const tag of jsxTags(source)) {
      if (tag.isClose) continue;
      for (const object of tag.text.matchAll(WRITER)) {
        for (const key of object[1].matchAll(/(?:^|,)\s*(\w+)\s*:/g)) out.set(key[1], rel);
      }
    }
  }
  return out;
}

test("each channel is the attribute react-native-web renders its key as", () => {
  for (const [key, attribute] of Object.entries(CHANNELS)) assert.equal(attribute, attributeFor(key), key);
});

test("every registered channel has a screen writing it", () => {
  const writes = written();
  assert.ok(writes.size > 0, "no screen writes a harness channel at all, so the scan reads nothing");
  const unwritten = (Object.keys(CHANNELS) as Channel[]).filter((key) => !writes.has(key));
  assert.deepEqual(unwritten, [], "nothing writes these any more, so every selector built on them matches nothing");
});

test("the scan sees a channel written as a dataSet prop, a dataSet property and a harnessState call", () => {
  const tag = (code: string) => jsxTags(blankCommentsAndStrings(code)).find((t) => !t.isClose)!.text;
  const keys = (code: string) => [...tag(code).matchAll(WRITER)].flatMap((m) => [...m[1].matchAll(/(?:^|,)\s*(\w+)\s*:/g)].map((k) => k[1]));
  assert.deepEqual(keys("<View dataSet={{ tableState: a, dealing: String(b) }} />"), ["tableState", "dealing"]);
  assert.deepEqual(keys("<View {...({ dataSet: { seatLit: String(lit) } } as ViewProps)} />"), ["seatLit"]);
  assert.deepEqual(keys("<View {...harnessState({ handState: label })}>"), ["handState"]);
  assert.deepEqual(keys('// <View dataSet={{ lit: "x" }} />\n<View />'), []);
});

const SELECTORS = "tests/e2e/helpers/selectors.ts";

/** Every place under tests/e2e/ that spells a channel's attribute instead of reading selectors.ts. */
function handWritten(files: [string, string][]): string[] {
  const attributes = Object.values(CHANNELS);
  return files.flatMap(([rel, source]) =>
    rel === SELECTORS
      ? []
      : source
          .split("\n")
          .flatMap((line, i) => (attributes.some((a) => new RegExp(`\\b${a}\\b`).test(line)) ? [`${rel}:${i + 1}`] : [])),
  );
}

test("no browser spec spells a channel's attribute outside selectors.ts", () => {
  const files = sourcesUnder(repoRoot, ["tests/e2e"]);
  assert.ok(files.some(([rel]) => rel === SELECTORS), "the scan never reached selectors.ts, so it read nothing");
  assert.deepEqual(handWritten(files), [], "read these through tests/e2e/helpers/selectors.ts, which builds them from CHANNELS");
});

test("the spelling check sees a hand-written channel, and nothing in selectors.ts", () => {
  const spec = path.posix.join("tests", "e2e", "plant.spec.ts");
  assert.deepEqual(handWritten([[spec, 'const ok = 1;\nel.getAttribute("data-seat-lit");']]), [`${spec}:2`]);
  assert.deepEqual(handWritten([[SELECTORS, 'const z = "[data-hand-state]";']]), []);
  assert.deepEqual(handWritten([[spec, 'const s = "[data-testid=x] [data-side=top]";']]), []);
});
