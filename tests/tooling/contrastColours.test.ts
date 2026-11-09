// tests/tooling/contrastColours.test.ts — sourceArrays reads a component's gradient stops off the
// parsed module, so a stop it cannot resolve is an error and not a shorter list.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Colors, Garnet, Gradient } from "../../lib/tokens.ts";
import { sourceArrays } from "../helpers/contrastColours.ts";

function arraysIn(files: Record<string, string>): (name: string) => string[] {
  const root = mkdtempSync(path.join(tmpdir(), "contrast-arrays-"));
  try {
    for (const [file, text] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      writeFileSync(path.join(root, file), text);
    }
    return sourceArrays(root, ["components/**/*.tsx"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("a stop is a token, a literal or a spread gradient, whatever follows it on the line", () => {
  const stops = arraysIn({
    "components/a.tsx": 'const PRESSED = [Colors.gold, "#6B5220", ...Gradient.playButton, Garnet.base] as const; // [not a stop]\n',
  });
  assert.deepEqual(stops("PRESSED"), [Colors.gold, "#6B5220", ...Gradient.playButton, Garnet.base]);
});

test("a stop it cannot resolve is refused, not dropped", () => {
  for (const stop of ["Colors.noSuchToken", "pick(1)", "STOPS[0]", "Colors['gold']"]) {
    const stops = arraysIn({ "components/a.tsx": `const PRESSED = [Colors.gold, ${stop}];\n` });
    assert.throws(() => stops("PRESSED"), /cannot resolve/, stop);
  }
});

test("the web variant's array counts beside the plain module's", () => {
  const stops = arraysIn({
    "components/b.tsx": "const PRESSED = [Colors.gold];\n",
    "components/b.web.tsx": "const PRESSED = [Colors.goldDark];\n",
  });
  assert.deepEqual(stops("PRESSED"), [Colors.gold, Colors.goldDark]);
});

test("only a module-level array is a component's: a local of the same name is not", () => {
  const stops = arraysIn({ "components/c.tsx": "function f() { const PRESSED = [Colors.gold]; return PRESSED; }\n" });
  assert.throws(() => stops("PRESSED"), /no component declares an array named PRESSED/);
});

test("an array that is not a literal, or has no stops, is refused", () => {
  assert.throws(() => arraysIn({ "components/d.tsx": "const PRESSED = makeStops();\n" })("PRESSED"), /not an array literal/);
  assert.throws(() => arraysIn({ "components/e.tsx": "const PRESSED = [];\n" })("PRESSED"), /no gradient stops/);
});
