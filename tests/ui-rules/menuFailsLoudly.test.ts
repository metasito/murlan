// tests/ui-rules/menuFailsLoudly.test.ts — two ways a menu screen hid a fact
// from the player, pinned by reading the source.
//
// A height written as a shared value times a number is a guess about how tall
// the content is: the FAQ answer was cut off at 400 px, the longest one being
// taller on a phone. And an ErrorBlock without `stale` draws the full error card
// above data that is still on screen.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function sourcesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(path.join(repoRoot, dir), { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourcesUnder(rel));
    else if (/\.tsx?$/.test(entry.name)) out.push(rel);
  }
  return out;
}

const screens = [...sourcesUnder("app"), ...sourcesUnder("components")];
const read = (rel: string) => readFileSync(path.join(repoRoot, rel), "utf8");
const lineOf = (source: string, index: number) => source.slice(0, index).split("\n").length;

test("no animated style multiplies a shared value by a number for maxHeight", () => {
  const offenders: string[] = [];
  const maxHeightByLiteral = /\bmaxHeight\s*:[^,\n}]*(\.value\s*\*\s*\d|\d[\d.]*\s*\*\s*[\w.]*\.value)/g;
  for (const rel of screens) {
    const source = read(rel);
    for (const m of source.matchAll(maxHeightByLiteral)) offenders.push(`${rel}:${lineOf(source, m.index)}`);
  }
  assert.deepEqual(offenders, [], "animate the height from a measured size, not a number that guesses it");
});

/** Each `<ErrorBlock` opening tag, up to the `/>` that closes it. */
function errorBlockTags(source: string): { tag: string; line: number }[] {
  const found: { tag: string; line: number }[] = [];
  for (const m of source.matchAll(/<ErrorBlock\b/g)) {
    let depth = 0;
    let end = m.index;
    for (; end < source.length; end++) {
      const c = source[end];
      if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0 && source[end - 1] === "/") break;
    }
    found.push({ tag: source.slice(m.index, end + 1), line: lineOf(source, m.index) });
  }
  return found;
}

test("every ErrorBlock under app says from the query whether older data is on screen", () => {
  const offenders: string[] = [];
  let seen = 0;
  for (const rel of sourcesUnder("app")) {
    const source = read(rel);
    for (const { tag, line } of errorBlockTags(source)) {
      seen++;
      const stale = /\bstale=\{([^}]*)\}/.exec(tag)?.[1].trim();
      const literal = stale === undefined || stale === "true" || stale === "false";
      if (literal) offenders.push(`${rel}:${line}`);
    }
  }
  assert.ok(seen > 0, "found no ErrorBlock to check; the scan is looking at nothing");
  assert.deepEqual(offenders, [], "pass stale={<query>.data !== undefined}");
});
