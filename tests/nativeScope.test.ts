import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { nativeScope, reachesNative } from "../scripts/native-scope.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("what can reach the native suite", () => {
  test("every directory tests/native actually imports from is in reach", () => {
    // The gate cannot be a list of directories someone remembers to extend:
    // this reads the imports and fails when one of them would be skipped.
    const dir = path.join(repoRoot, "tests", "native");
    const imported = new Set<string>();
    for (const name of readdirSync(dir)) {
      const source = readFileSync(path.join(dir, name), "utf8");
      for (const m of source.matchAll(/['"]@\/([a-zA-Z0-9_-]+)\//g)) imported.add(m[1]);
    }

    assert.ok(imported.size > 0, "no imports found — this test is pinning nothing");
    for (const top of imported) {
      assert.equal(
        reachesNative([`${top}/anything.ts`]),
        true,
        `a change under ${top}/ would skip jest, but tests/native imports from it`
      );
    }
  });

  test("the failure this exists for: a component change runs the suite", () => {
    // #408: a one-line edit to components/NotificationBanner.tsx passed the
    // pre-push check and reddened CI on tests/native/render.test.tsx.
    assert.equal(reachesNative(["components/NotificationBanner.tsx"]), true);
  });

  test("a change with nothing native in it does not pay for the suite", () => {
    const scope = nativeScope(["server/routes.ts", "docs/agents/RULES.md", "README.md"]);

    assert.equal(scope.run, false);
    assert.match(scope.reason, /outside its reach/);
  });

  test("one reaching path among many is enough to run it", () => {
    assert.equal(nativeScope(["server/routes.ts", "lib/theme.ts"]).run, true);
  });

  test("the native tests' own edits run them", () => {
    assert.equal(reachesNative(["tests/native/render.test.tsx"]), true);
    assert.equal(reachesNative(["tests/gameTableModel.test.ts"]), false);
  });

  test("a root config the suite is built on runs it", () => {
    for (const file of ["jest.config.js", "package.json", "babel.config.js", "tsconfig.json"]) {
      assert.equal(reachesNative([file]), true, `${file} must not be treated as out of reach`);
    }
  });

  test("an unrecognised path runs the suite rather than being assumed safe", () => {
    assert.equal(reachesNative(["some-new-top-level-dir/thing.ts"]), true);
  });

  test("nothing changed is the one case that skips without a reaching path", () => {
    assert.equal(nativeScope([]).run, false);
  });
});
