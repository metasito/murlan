// The browser suite seeds the tutorial-seen flag straight into localStorage so
// the title screen never pushes /tutorial out from under a test's first click.
// That makes the key a second copy of something the app owns, and a drift would
// silently restore the flake — the seed would write a key nothing reads, every
// spec would still pass locally, and CI would go back to failing on whichever
// home-screen button a spec happened to click. Nothing else would fail, so this
// pins the two to each other.
//
// Source-scanned rather than imported: lib/tutorialSeen.ts pulls in
// AsyncStorage and the auth context, neither of which loads under node --test.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function stringConst(file: string, name: string): string {
  const src = readFileSync(path.join(repoRoot, file), "utf8");
  const match = src.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`));
  assert.ok(match, `${file} declares no double-quoted string const named ${name}`);
  const value = match[1];
  assert.notEqual(value, "", `${file}'s ${name} is empty, so it pins nothing`);
  return value;
}

test("the browser suite seeds the tutorial key the app actually reads", () => {
  const app = stringConst("lib/tutorialSeen.ts", "SEEN_KEY");
  const suite = stringConst("tests/e2e/helpers/navigation.ts", "TUTORIAL_SEEN_KEY");

  assert.equal(
    suite,
    app,
    "tests/e2e/helpers/navigation.ts seeds a localStorage key that " +
      "lib/tutorialSeen.ts does not read, so the title screen will still " +
      "push /tutorial mid-test",
  );
});
