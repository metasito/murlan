import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { nearTests } from "../near-tests.mjs";

const T = (n: string) => `tests/native/${n}.test.tsx`;
const src: Record<string, string> = {
  [T("feltFallbackShade")]: "import { Felt } from '@/components/table/feltSkia.web';",
  [T("scorePill")]: "import { GameTable } from '@/components/GameTable';",
  [T("screenShake")]: "import { GameTable } from '@/components/GameTable';",
  [T("soundAssets")]: "import { fonts } from '@/lib/device/fonts';",
};
const near = (changed: string[], related = Object.keys(src)) => nearTests({ changed, related, source: (f) => src[f] ?? "" });

describe("the native tests a change reaches first", () => {
  test("#1265: named after the module, reached only through GameTable", () =>
    assert.deepEqual(near(["components/table/scorePill.tsx"]), [T("scorePill")]));
  test("#1256: named after the module, which its fixture does not import", () => assert.deepEqual(near(["lib/device/soundAssets.ts"]), [T("soundAssets")]));
  test("#1257: imports the changed platform file", () =>
    assert.deepEqual(near(["components/table/feltSkia.web.tsx"]), [T("feltFallbackShade")]));
  test("a name match jest's graph does not reach is dropped", () => assert.deepEqual(near(["lib/screenShake.ts"], [T("scorePill")]), []));
  test("a changed test file always runs", () => assert.deepEqual(near([T("brandNew")], []), [T("brandNew")]));
  test("the command the loop runs uses this module", () =>
    assert.match(readFileSync(new URL("../related-tests.mjs", import.meta.url), "utf8"), /from "\.\/near-tests\.mjs"/));
});
