// tests/nativeActPairing.test.ts — the pairing that breaks every test below it.
//
// `fireEvent` is async. An un-awaited one leaves its own `act` scope open, and
// the next `act` entered without yielding first nests inside it: React says
// "You seem to have overlapping act() calls", and its act environment stays
// corrupted for the rest of the FILE. Every later `render()` then returns a tree
// whose queries find nothing, so the test that pays is not the one that did it.
//
// Awaiting the `fireEvent` is the form to write. `await waitFor(...)` after a
// bare one is measured safe, because it yields before entering its own scope
// (#523).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const NATIVE = path.resolve(import.meta.dirname, "native");

/**
 * Line numbers falling inside an `act(…)` callback. A `fireEvent` in there is
 * already covered by the enclosing flush, and is the common existing form —
 * without this the scan names every one of them.
 */
function insideAct(lines: string[]): Set<number> {
  const inside = new Set<number>();
  for (let i = 0; i < lines.length; i++) {
    const opener = /\bact\(/.exec(lines[i]);
    if (!opener) continue;
    let depth = 0;
    let open = false;
    for (let j = i; j < lines.length; j++) {
      for (const ch of j === i ? lines[j].slice(opener.index) : lines[j]) {
        if (ch === "{") {
          depth++;
          open = true;
        } else if (ch === "}") depth--;
      }
      if (open) inside.add(j);
      if (open && depth <= 0) break;
    }
  }
  return inside;
}

/**
 * The awaits that enter an `act` scope. `unmount` and `rerender` are `act`
 * calls of their own (`dist/render.js`), so they pair exactly as `act` does and
 * a scan that only knows the word `act` reads them as safe.
 */
const FLUSH = /\bawait\s+(?:act\(|[\w.]+\.(?:unmount|rerender)\()/;

/**
 * A bare `fireEvent…(…)` whose test then enters an `act` scope before it awaits
 * anything else.
 *
 * The two need not be adjacent — any run of synchronous statements between them
 * still pairs — so what decides it is which `await` comes first. Anything else
 * awaited in between has already let the open scope close.
 */
function poisonedLines(source: string): number[] {
  const lines = source.split("\n");
  const skippable = (l: string) => l.trim() === "" || /^\s*(\/\/|\/\*|\*)/.test(l);
  const enclosed = insideAct(lines);
  const hits: number[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (!/\bfireEvent\.\w+\(/.test(lines[i])) continue;
    // `act(` on the line itself covers the brace-less arrow form, which the
    // block tracker cannot see because it never opens one.
    if (/\bawait\s+fireEvent\./.test(lines[i]) || /\bact\(/.test(lines[i])) continue;
    if (enclosed.has(i)) continue;

    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j];
      if (skippable(line)) continue;
      // A later test's flush is that test's business, not this one's.
      if (/\b(it|test)\(/.test(line)) break;
      if (FLUSH.test(line)) {
        hits.push(i + 1);
        break;
      }
      if (/\bawait\b/.test(line)) break;
    }
  }
  return hits;
}

const nativeSources: { name: string; source: string }[] = readdirSync(NATIVE, {
  recursive: true,
  encoding: "utf8",
})
  .filter((f) => /\.test\.tsx?$/.test(f))
  .map((f) => ({
    name: `tests/native/${f}`.replaceAll(path.sep, "/"),
    source: readFileSync(path.join(NATIVE, f), "utf8"),
  }));

describe("no native test pairs a bare fireEvent with an act flush", () => {
  // The floor. Without it a regex that matches nothing reports the same empty
  // list as a clean suite.
  test("the pattern names the shape, and only that shape", () => {
    assert.deepEqual(poisonedLines("fireEvent.press(x);\nawait act(async () => {});"), [1]);
    assert.deepEqual(poisonedLines("fireEvent.press(x);\n\n  await act(async () => {});"), [1]);
    assert.deepEqual(poisonedLines("fireEvent.press(x);\n// flush it\nawait act(async () => {});"), [1]);
    // Not adjacency: any run of synchronous statements between the two still pairs.
    assert.deepEqual(
      poisonedLines("fireEvent.press(x);\nexpect(a).toBe(b);\nconst n = 1;\nawait act(async () => {});"),
      [1]
    );
    // The first await decides it. Anything else closes the scope first.
    assert.deepEqual(
      poisonedLines("fireEvent.press(x);\nawait waitFor(() => {});\nawait act(async () => {});"),
      []
    );
    // A flush belonging to the next test is not this test's pairing.
    assert.deepEqual(
      poisonedLines("fireEvent.press(x);\n});\nit('next', async () => {\nawait act(async () => {});"),
      []
    );
    // Awaiting the fireEvent is the fix, so it must never be named.
    assert.deepEqual(poisonedLines("await fireEvent.press(x);\nawait act(async () => {});"), []);
    // Measured safe: waitFor does not corrupt the environment.
    assert.deepEqual(poisonedLines("fireEvent.press(x);\nawait waitFor(() => {});"), []);
    // Already inside an act, which is the common existing form — on one line,
    // and spread over a block, which is how tests/native/ actually writes it.
    assert.deepEqual(poisonedLines("await act(async () => fireEvent.press(x));\nawait act(async () => {});"), []);
    assert.deepEqual(
      poisonedLines("await act(async () => {\n  fireEvent.press(x);\n});\nawait act(async () => {});"),
      []
    );
    // A bare press with an assertion and nothing else is a different question (#522).
    assert.deepEqual(poisonedLines("fireEvent.press(x);\nexpect(spy).toHaveBeenCalled();"), []);
    // `unmount` and `rerender` are act calls wearing another name.
    assert.deepEqual(poisonedLines("fireEvent.press(x);\nawait view.unmount();"), [1]);
    assert.deepEqual(poisonedLines("fireEvent.press(x);\nexpect(spy).toHaveBeenCalled();\nawait r.unmount();"), [1]);
    assert.deepEqual(poisonedLines("fireEvent.press(x);\nawait view.rerender(<A />);"), [1]);
  });

  test("the scan reads the suite it claims to", () => {
    assert.ok(nativeSources.length > 20, `only read ${nativeSources.length} files`);
  });

  test("none of them does", () => {
    const offenders = nativeSources
      .flatMap(({ name, source }) => poisonedLines(source).map((n) => `${name}:${n}`));
    assert.deepEqual(offenders, [], "these leave every later test in their file unable to find anything");
  });
});
