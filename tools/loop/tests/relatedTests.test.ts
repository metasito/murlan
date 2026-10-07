import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { capNear, listedTests, nearTests } from "../near-tests.mjs";

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
  test("changed tests come first, then tests named after a changed module, then importers", () => {
    const importer: Record<string, string> = { [T("alpha")]: "import { z } from '@/lib/theme';" };
    const got = nearTests({ changed: [T("omega"), "lib/theme.ts"], related: [T("alpha"), T("theme")], source: (f) => importer[f] ?? "" });
    assert.deepEqual(got, [T("omega"), T("theme"), T("alpha")]);
  });
});

describe("what native:related runs and what it leaves to CI", () => {
  test("a widely imported module runs ten files, highest priority first, and names the rest", () => {
    const importers = Array.from({ length: 12 }, (_, i) => T(`imp${String(i).padStart(2, "0")}`));
    const tests = nearTests({ changed: [T("own"), "lib/device/fonts.ts"], related: importers, source: () => "from '@/lib/device/fonts'" });
    const { run, left } = capNear(tests);
    assert.equal(run.length, 10);
    assert.deepEqual(run.slice(0, 2), [T("own"), T("imp00")]);
    assert.equal(left, "… 3 more left to ci.yml native");
    assert.deepEqual(capNear([T("one")]), { run: [T("one")], left: null });
  });
  test("--listTests output keeps only paths, repo-relative and posix", () => {
    const cwd = process.cwd();
    const out = ["Running one project: ios", join(cwd, "tests", "native", "a.test.tsx"), "", `${join(cwd, "tests", "native", "b.test.tsx")} `].join("\r\n");
    assert.deepEqual(listedTests(out, cwd), [T("a"), T("b")]);
  });
});
