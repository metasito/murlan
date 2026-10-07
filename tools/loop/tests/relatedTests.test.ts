import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { nearTests } from "../related-tests.mjs";

const T = (n: string) => `tests/native/${n}.test.tsx`;
const src: Record<string, string> = {
  [T("feltFallbackShade")]: "import { Felt } from '@/components/table/feltSkia.web';",
  [T("scorePill")]: "import { GameTable } from '@/components/GameTable';",
  [T("tableShake")]: "import { GameTable } from '@/components/GameTable';",
  [T("sounds")]: "import { play } from '../../lib/other';",
};
const near = (changed: string[], related = Object.keys(src)) => nearTests({ changed, related, source: (f) => src[f] ?? "" });

describe("the native tests a change reaches first", () => {
  test("#1265: named after the module, reached only through GameTable", () =>
    assert.deepEqual(near(["components/table/scorePill.tsx"]), [T("scorePill")]));
  test("#1256: imports the module it is named after", () => assert.deepEqual(near(["lib/device/sounds.ts"]), [T("sounds")]));
  test("#1257: imports the changed platform file", () =>
    assert.deepEqual(near(["components/table/feltSkia.web.tsx"]), [T("feltFallbackShade")]));
  test("a name match jest's graph does not reach is dropped", () => assert.deepEqual(near(["lib/x/tableShake.ts"], [T("scorePill")]), []));
  test("a changed test file always runs", () => assert.deepEqual(near([T("brandNew")], []), [T("brandNew")]));
});
