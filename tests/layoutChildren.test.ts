// tests/layoutChildren.test.ts — a navigator gets Screens, and nothing else.
//
// expo-router walks a layout's children with `Children.forEach`, which does not
// skip a falsy one. So `{cond && <Stack.Screen …>}` hands the navigator a
// literal `false` whenever `cond` is false, and `{cond ? … : null}` hands it a
// `null` — neither is a Screen, and every render then logs
// "Layout children must be of type Screen". A production bundle warned on
// every screen for exactly this, and only a built e2e run could see it: the
// condition in question was `__DEV__`, which is true in every dev loop.
//
// `<Stack.Protected guard={…}>` is the API for a route that is not always
// there. Nothing falsy reaches the navigator.
//
// The scan reads the inline shape and stops there. An element hoisted to a
// variable, or built by a helper the layout only calls, is past it — a regex
// cannot follow either. What it buys is that the shape which actually shipped
// fails in two seconds instead of in a built browser run.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "app");

function layouts(): { file: string; source: string }[] {
  return readdirSync(appDir, { recursive: true, encoding: "utf8" })
    .filter((f) => path.basename(f) === "_layout.tsx")
    .map((file) => ({ file, source: readFileSync(path.join(appDir, file), "utf8") }));
}

/** A JSX expression container that can evaluate to a falsy child. */
const CONDITIONAL_SCREEN = /\{[^{}]*(?:&&|\?)[^{}]*<\w+\.Screen/;

describe("a navigator's children", () => {
  test("there are layouts to scan", () => {
    // The floor under the scan: a scan that reads nothing passes everything.
    assert.ok(layouts().length >= 2, `expected app/**/_layout.tsx, found ${layouts().length}`);
  });

  test("no layout hands a navigator a child that can be falsy", () => {
    const offenders = layouts()
      .filter(({ source }) => CONDITIONAL_SCREEN.test(source))
      .map(({ file }) => file);
    assert.deepEqual(
      offenders,
      [],
      `these guard a Screen with a conditional instead of <Stack.Protected guard>: ${offenders.join(", ")}`
    );
  });

  test("the scan can see a conditional Screen when there is one", () => {
    // Proves the pattern above matches the shape it exists to find, rather
    // than passing because it matches nothing at all.
    assert.ok(CONDITIONAL_SCREEN.test("{__DEV__ && <Stack.Screen name=\"capture\" />}"));
    assert.ok(CONDITIONAL_SCREEN.test("{ready ? <Tabs.Screen name=\"x\" /> : null}"));
    assert.ok(!CONDITIONAL_SCREEN.test("<Stack.Screen name=\"index\" />"));
  });

  // What a player can actually reach is decided by `app/capture.tsx`, which
  // renders nothing outside a development build. `Protected` takes the screen
  // off the navigator; it does not take the route out of the tree, so this
  // pins the guard rather than the bundle.
  test("the capture harness stays off the navigator outside a development build", () => {
    const root = layouts().find(({ file }) => file === "_layout.tsx");
    assert.ok(root, "app/_layout.tsx is missing");
    assert.match(
      root.source.replace(/\s+/g, " "),
      /<Stack\.Protected guard=\{__DEV__\}> <Stack\.Screen name="capture" \/> <\/Stack\.Protected>/,
      "the capture harness must stay behind a __DEV__ guard"
    );
  });
});
