// tests/keyboardOneStrategy.test.ts — every KeyboardAvoidingView answers the
// keyboard the same way.
//
// Four call sites had grown two strategies that were opposites on both
// platforms, and the sign-in screen ran two of them at once, nested. Two views
// responding to one keyboard event compound rather than agree.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { blankComments } from "./helpers/sourceScan.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HELPER = "keyboardBehavior";

function uiFiles(): string[] {
  return ["app", "components"].flatMap((dir) =>
    readdirSync(path.join(repoRoot, dir), { recursive: true, encoding: "utf8" })
      .filter((f) => /\.tsx?$/.test(f))
      .map((f) => path.join(repoRoot, dir, f))
  );
}

/** Every `behavior={…}` written on a KeyboardAvoidingView, with its file. */
function behaviours(): { file: string; expression: string }[] {
  const out: { file: string; expression: string }[] = [];
  for (const file of uiFiles()) {
    const source = blankComments(readFileSync(file, "utf8"));
    for (const tag of source.matchAll(/<KeyboardAvoidingView\b([^>]*)>/g)) {
      const behavior = /behavior=\{([^}]*(?:\{[^}]*\})?[^}]*)\}/.exec(tag[1]);
      out.push({
        file: path.relative(repoRoot, file).split(path.sep).join("/"),
        expression: behavior ? behavior[1].trim() : "",
      });
    }
  }
  return out;
}

describe("one keyboard strategy", () => {
  test(`every KeyboardAvoidingView takes its behaviour from ${HELPER}`, () => {
    const rogue = behaviours().filter((b) => !b.expression.startsWith(HELPER));
    assert.deepEqual(
      rogue.map((b) => `${b.file}: behavior={${b.expression}}`),
      [],
      `these choose their own strategy. Two of them disagreeing is how the sign-in screen came ` +
        `to run opposite ones nested; call ${HELPER}() from lib/keyboard.ts instead`
    );
  });

  // A screen inside `MenuLayout` already has one. A second, at any setting, is
  // two answers to one event.
  test("nothing wraps MenuLayout in a KeyboardAvoidingView", () => {
    const nested: string[] = [];
    for (const file of uiFiles()) {
      const source = blankComments(readFileSync(file, "utf8"));
      if (!/<MenuLayout\b/.test(source)) continue;
      if (/<KeyboardAvoidingView\b[\s\S]*<MenuLayout\b/.test(source)) {
        nested.push(path.relative(repoRoot, file).split(path.sep).join("/"));
      }
    }
    assert.deepEqual(nested, [], `MenuLayout brings its own: ${nested.join(", ")}`);
  });

  // The floor for both: a walk that finds nothing passes either assertion, and
  // so does a regex that matches no tag.
  test("the scan finds the views it is judging", () => {
    const found = behaviours();
    assert.ok(found.length >= 3, `only ${found.length} KeyboardAvoidingView(s) found`);
    assert.ok(
      found.every((b) => b.expression.length > 0),
      "a KeyboardAvoidingView with no behaviour at all was read as compliant"
    );
    assert.ok(uiFiles().length > 50, "the walk is not reaching app/ and components/");
  });
});
