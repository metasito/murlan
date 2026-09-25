// tests/tooling/nativeActPairing.test.ts — the pairing that breaks every test below it.
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

const NATIVE = path.resolve(import.meta.dirname, "../native");

/**
 * Each line's stretch inside an `act(…)` call's parentheses, as [from, to]
 * columns. A `fireEvent` in there is already covered by the enclosing flush,
 * and is the common existing form — without this the scan names every one of
 * them. Parentheses, not braces: the brace-less arrow form opens no block.
 */
function insideAct(lines: string[]): Map<number, [number, number]> {
  const inside = new Map<number, [number, number]>();
  for (let i = 0; i < lines.length; i++) {
    for (const opener of lines[i].matchAll(/\bact\(/g)) {
      let depth = 0;
      let closed = false;
      for (let j = i; j < lines.length && !closed; j++) {
        const from = j === i ? opener.index + 3 : 0;
        let to = lines[j].length;
        for (let k = from; k < lines[j].length; k++) {
          depth += lines[j][k] === "(" ? 1 : lines[j][k] === ")" ? -1 : 0;
          if (depth === 0) {
            to = k;
            closed = true;
            break;
          }
        }
        const [a, b] = inside.get(j) ?? [Infinity, -1];
        inside.set(j, [Math.min(a, from), Math.max(b, to)]);
      }
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
  return bareFireEvents(lines)
    .filter(([i, rest]) => {
      for (const line of [rest, ...lines.slice(i + 1)]) {
        if (skippable(line)) continue;
        // A later test's flush is that test's business, not this one's.
        if (/\b(it|test)\(/.test(line)) return false;
        if (FLUSH.test(line)) return true;
        if (/\bawait\b/.test(line)) return false;
      }
      return false;
    })
    .map(([i]) => i + 1);
}

const skippable = (l: string) => l.trim() === "" || /^\s*(\/\/|\/\*|\*)/.test(l);

/** Each bare `fireEvent…(…)` as [its line, what follows its statement on that line]. */
function bareFireEvents(lines: string[]): [number, string][] {
  const enclosed = insideAct(lines);
  const found: [number, string][] = [];
  for (let i = 0; i < lines.length; i++) {
    const at = lines[i].search(/\bfireEvent(?:\.\w+)?\(/);
    const [from, to] = enclosed.get(i) ?? [Infinity, -1];
    if (at < 0 || (from <= at && at <= to)) continue;
    if (/\bawait\s+$/.test(lines[i].slice(0, at))) continue;
    const end = lines[i].indexOf(";", at);
    found.push([i, end < 0 ? "" : lines[i].slice(end + 1)]);
  }
  return found;
}

/**
 * A bare `fireEvent` whose test asserts before it awaits anything: the handler
 * ran, but the re-render it caused has not, so the `expect` reads the tree as
 * it was before the press (docs/agents/checks.md, *The native harness is async*).
 */
function staleAssertLines(source: string): number[] {
  const lines = source.split("\n");
  return bareFireEvents(lines)
    .filter(([i, rest]) => {
      for (const line of [rest, ...lines.slice(i + 1)]) {
        if (skippable(line)) continue;
        if (/\b(it|test)\(/.test(line) || /\bawait\b/.test(line)) return false;
        if (/\bexpect\(/.test(line)) return true;
      }
      return false;
    })
    .map(([i]) => i + 1);
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
    assert.deepEqual(poisonedLines("fireEvent(x, 'press');\nawait act(async () => {});"), [1]);
    assert.deepEqual(poisonedLines("fireEvent.press(x); await act(async () => {});"), [1]);
    assert.deepEqual(poisonedLines("act(() => {}); fireEvent.press(x);\nawait act(async () => {});"), [1]);
    assert.deepEqual(poisonedLines("await act(async () => {\n  go();\n}); fireEvent.press(x);\nawait act(async () => {});"), [3]);
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

describe("no native test asserts on the tree a bare fireEvent has not re-rendered yet", () => {
  test("the pattern names a press read back before anything is awaited, and only that", () => {
    assert.deepEqual(staleAssertLines("fireEvent.press(x);\nexpect(spy).toHaveBeenCalled();"), [1]);
    assert.deepEqual(staleAssertLines("fireEvent.press(x); expect(spy).toHaveBeenCalled();"), [1]);
    assert.deepEqual(staleAssertLines("act(() => {}); fireEvent.press(x);\nexpect(a).toBe(b);"), [1]);
    assert.deepEqual(staleAssertLines("fireEvent(x, 'press');\n\n// read it\nexpect(a).toBe(b);"), [1]);
    assert.deepEqual(staleAssertLines("fireEvent.press(\n  x\n);\nconst n = 1;\nexpect(a).toBe(n);"), [1]);
    assert.deepEqual(staleAssertLines("await fireEvent.press(x);\nexpect(a).toBe(b);"), []);
    assert.deepEqual(staleAssertLines("await fireEvent(x, 'press');\nexpect(a).toBe(b);"), []);
    assert.deepEqual(staleAssertLines("fireEvent.press(x);\nawait waitFor(() => expect(a).toBe(b));"), []);
    assert.deepEqual(staleAssertLines("await act(async () => {\n  fireEvent.press(x);\n});\nexpect(a).toBe(b);"), []);
    assert.deepEqual(staleAssertLines("fireEvent.press(x);\n});\nit('next', () => {\nexpect(a).toBe(b);"), []);
  });

  test("none of them does", () => {
    const offenders = nativeSources
      .flatMap(({ name, source }) => staleAssertLines(source).map((n) => `${name}:${n}`));
    assert.deepEqual(offenders, [], "write `await fireEvent…(…)`: the expect below it reads the pre-press tree");
  });
});
