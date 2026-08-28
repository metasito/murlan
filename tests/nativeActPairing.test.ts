// tests/nativeActPairing.test.ts — the two lines that break every test below them.
//
// `fireEvent` is async. An un-awaited one leaves its own `act` scope open, and
// an `await act(...)` that follows nests inside it: React's act environment is
// corrupted for the rest of the FILE, and every later `render()` returns a tree
// whose queries find nothing. The test that pays is not the one that did it.
//
// `await waitFor(...)` after a bare `fireEvent` is measured safe, and so is
// awaiting the `fireEvent` — which is the fix and the form to write (#523).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const NATIVE = path.resolve(import.meta.dirname, "native");

/** A bare `fireEvent…(…)` statement whose next non-blank line opens an `act`. */
function poisonedLines(source: string): number[] {
  const lines = source.split("\n");
  const hits: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!/(?<!await\s)\bfireEvent\.\w+\(/.test(line)) continue;
    if (/\bawait\s+fireEvent\./.test(line) || /\bact\(/.test(line)) continue;
    // A comment between the two is likelier than not: the flush gets added
    // deliberately, so it gets explained.
    const next = lines
      .slice(i + 1)
      .find((l) => l.trim() !== "" && !/^\s*(\/\/|\/\*|\*)/.test(l));
    if (next && /\bawait\s+act\(/.test(next)) hits.push(i + 1);
  }
  return hits;
}

function nativeSources(): { name: string; source: string }[] {
  return readdirSync(NATIVE, { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".test.tsx"))
    .map((f) => ({
      name: `tests/native/${f}`.replaceAll(path.sep, "/"),
      source: readFileSync(path.join(NATIVE, f), "utf8"),
    }));
}

describe("no native test pairs a bare fireEvent with an act flush", () => {
  // The floor. Without it a regex that matches nothing reports the same empty
  // list as a clean suite.
  test("the pattern names the shape, and only that shape", () => {
    assert.deepEqual(poisonedLines("fireEvent.press(x);\nawait act(async () => {});"), [1]);
    assert.deepEqual(poisonedLines("fireEvent.press(x);\n\n  await act(async () => {});"), [1]);
    assert.deepEqual(poisonedLines("fireEvent.press(x);\n// flush it\nawait act(async () => {});"), [1]);
    // Awaiting the fireEvent is the fix, so it must never be named.
    assert.deepEqual(poisonedLines("await fireEvent.press(x);\nawait act(async () => {});"), []);
    // Measured safe: waitFor does not corrupt the environment.
    assert.deepEqual(poisonedLines("fireEvent.press(x);\nawait waitFor(() => {});"), []);
    // Already inside an act, which is the common existing form.
    assert.deepEqual(poisonedLines("await act(async () => fireEvent.press(x));\nawait act(async () => {});"), []);
    // A bare press with an assertion after it is a different question (#522).
    assert.deepEqual(poisonedLines("fireEvent.press(x);\nexpect(spy).toHaveBeenCalled();"), []);
  });

  test("the scan reads the suite it claims to", () => {
    assert.ok(nativeSources().length > 20, `only read ${nativeSources().length} files`);
  });

  test("none of them does", () => {
    const offenders = nativeSources()
      .flatMap(({ name, source }) => poisonedLines(source).map((n) => `${name}:${n}`));
    assert.deepEqual(offenders, [], "these leave every later test in their file unable to find anything");
  });
});
