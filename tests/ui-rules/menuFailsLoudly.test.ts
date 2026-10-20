// tests/ui-rules/menuFailsLoudly.test.ts — two ways a menu screen hid a fact
// from the player, pinned by reading the source.
//
// A height written as a shared value times a number is a guess about how tall
// the content is: the FAQ answer was cut off at 400 px, the longest one being
// taller on a phone. And an ErrorBlock without `stale` draws the full error card
// above data that is still on screen.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { blankComments, sourcesUnder } from "../helpers/sourceScan.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const lineOf = (source: string, index: number) => source.slice(0, index).split("\n").length;

/** Where an animated `maxHeight` is a shared value times a number, either way round. */
export function cappedMaxHeights(source: string): number[] {
  const code = blankComments(source);
  const pattern = /\bmaxHeight\s*:[^,\n}]*(\.value\s*\*\s*\d|\d[\d.]*\s*\*\s*[\w.]*\.value)/g;
  return [...code.matchAll(pattern)].map((m) => lineOf(code, m.index));
}

/** Each `<ErrorBlock` tag up to the `/>` that closes it, with the expression `stale` was given. */
export function errorBlocks(source: string): { line: number; stale: string | undefined }[] {
  const code = blankComments(source);
  return [...code.matchAll(/<ErrorBlock\b/g)].map((m) => {
    let depth = 0;
    let end = m.index;
    for (; end < code.length; end++) {
      const c = code[end];
      if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0 && code[end - 1] === "/") break;
    }
    const tag = code.slice(m.index, end + 1);
    return { line: lineOf(code, m.index), stale: /\bstale=\{([^}]*)\}/.exec(tag)?.[1].trim() };
  });
}

const isLiteral = (stale: string | undefined) => stale === undefined || stale === "true" || stale === "false";

const sources = sourcesUnder(repoRoot, ["app", "components"]);
const appSources = sources.filter(([rel]) => rel.startsWith("app/"));

test("the scans see the shapes they exist to refuse", () => {
  assert.deepEqual(cappedMaxHeights("const s = { maxHeight: height.value * 400 };"), [1]);
  assert.deepEqual(cappedMaxHeights("const s = { maxHeight: 400 * height.value };"), [1]);
  assert.deepEqual(cappedMaxHeights("// maxHeight: height.value * 400\nconst s = { maxHeight: measured.value };"), []);

  const bare = errorBlocks("<ErrorBlock title={x} retry={{ a: 1 }} />");
  assert.equal(bare.length, 1);
  assert.ok(isLiteral(bare[0].stale), "a bare ErrorBlock has no stale");
  assert.ok(isLiteral(errorBlocks("<ErrorBlock stale={true} title={x} />")[0].stale), "a literal stale");
  assert.ok(isLiteral(errorBlocks("<ErrorBlock stale={false} title={x} />")[0].stale), "a literal stale");
  assert.ok(!isLiteral(errorBlocks("<ErrorBlock stale={q.data !== undefined} title={x} />")[0].stale));
  assert.deepEqual(errorBlocks("// <ErrorBlock title={x} />\n"), [], "a commented-out block is not a block");
});

test("the scans read a real tree, not nothing", () => {
  assert.ok(sources.length > 50, `only ${sources.length} sources under app and components`);
  const blocks = appSources.flatMap(([, source]) => errorBlocks(source));
  assert.ok(blocks.length >= 8, `only ${blocks.length} ErrorBlock under app; the scan is looking at the wrong thing`);
});

test("no animated style multiplies a shared value by a number for maxHeight", () => {
  const offenders = sources.flatMap(([rel, source]) => cappedMaxHeights(source).map((l) => `${rel}:${l}`));
  assert.deepEqual(offenders, [], "animate the height from a measured size, not a number that guesses it");
});

test("every ErrorBlock under app says from the query whether older data is on screen", () => {
  const offenders = appSources.flatMap(([rel, source]) =>
    errorBlocks(source)
      .filter((b) => isLiteral(b.stale))
      .map((b) => `${rel}:${b.line}`)
  );
  assert.deepEqual(offenders, [], "pass stale={<query>.data !== undefined}");
});
