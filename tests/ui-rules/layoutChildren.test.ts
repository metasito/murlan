// tests/ui-rules/layoutChildren.test.ts — a navigator gets Screens, and nothing else.
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
// The inline shape is the `screens-unconditional` guard in eslint.guards.cjs. An element
// hoisted to a variable, or built by a helper the layout only calls, is past it.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "app");

describe("a navigator's children", () => {
  // `Protected` takes the screen off the navigator, not the route out of the
  // tree, so `app/capture.tsx` keeps a guard of its own — pinned below.
  test("the capture harness stays off the navigator outside a development or e2e build", () => {
    assert.match(
      readFileSync(path.join(appDir, "_layout.tsx"), "utf8").replace(/\s+/g, " "),
      /<Stack\.Protected guard=\{captureEnabled\(\)\}> <Stack\.Screen name="capture" \/> <\/Stack\.Protected>/,
      "the capture harness must stay behind captureEnabled()"
    );
  });

  test("the capture screen returns before anything else outside a development or e2e build", () => {
    const source = readFileSync(path.join(appDir, "capture.tsx"), "utf8");
    assert.match(source, /export default function CaptureScreen\(\) \{\s*if \(!captureEnabled\(\)\) \{/);
  });
});
