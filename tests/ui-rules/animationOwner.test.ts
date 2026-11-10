// tests/ui-rules/animationOwner.test.ts — the exemptions to eslint.guards.cjs's `one-animation-owner`, pinned.
//
// The guard refuses a per-frame callback or an endless loop outside lib/motion.ts. Its `ignores` are
// whole files, so this holds what a glob cannot: each exempt file still makes the call it was
// exempted for, exactly as often, and the list never grows.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { sourcesUnder } from "../helpers/sourceScan.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const { GUARDS } = createRequire(import.meta.url)("../../eslint.guards.cjs") as {
  GUARDS: { id: string; ignores?: { glob: string }[] }[];
};

const OWNER = "lib/motion.ts";
const CALL = /\b(?:useFrameCallback|requestAnimationFrame|withRepeat)\b|\banimationName\b/g;

/** Each exempt file and how many times it names the banned calls. The count and the length only go down. */
const EXEMPT: Record<string, number> = {
  "lib/e2eTrace.ts": 5,
  "lib/diagnostics/FrameProbe.tsx": 2,
  "components/table/handShade.web.tsx": 1,
  "components/table/feltSkia.web.tsx": 1,
  "components/table/feltCanvas.tsx": 2,
};
const MAX_EXEMPT_FILES = 5;

const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\/|(?<![:"'`])\/\/.*$/gm, "");
const hitsIn = (source: string) => code(source).match(CALL)?.length ?? 0;

const guard = GUARDS.find((g) => g.id === "one-animation-owner")!;

test("the guard's exemptions are the owner and the pinned list, and nothing else", () => {
  assert.deepEqual((guard.ignores ?? []).map((i) => i.glob).sort(), [OWNER, ...Object.keys(EXEMPT)].sort());
});

test("the exemption list only shrinks, and the number follows it down", () => {
  assert.equal(Object.keys(EXEMPT).length, MAX_EXEMPT_FILES, "an exemption was added (put the loop on lib/motion.ts instead) or removed (lower MAX_EXEMPT_FILES)");
});

test("each exemption still names the banned call as often as it is pinned to", () => {
  const stale = Object.entries(EXEMPT).flatMap(([file, count]) => {
    const found = hitsIn(readFileSync(path.join(root, file), "utf8"));
    return found === count ? [] : [`${file}: pinned ${count}, found ${found}; if it fell, lower the pin or drop the entry (and its ignore)`];
  });
  assert.deepEqual(stale, []);
});

test("no source outside the owner and the exemptions names the banned calls", () => {
  const sources = sourcesUnder(root, ["app", "components", "context", "lib", "shared", "modules", "locales"], /\.tsx?$/);
  const stray = sources.filter(([rel, source]) => rel !== OWNER && !(rel in EXEMPT) && hitsIn(source) > 0).map(([rel]) => rel);
  assert.deepEqual(stray, [], "a per-frame callback or endless loop outside lib/motion.ts: use useDuring or useLoop");
});

test("the scan sees a planted stray", () => {
  assert.equal(hitsIn("const id = requestAnimationFrame(tick);"), 1);
  assert.equal(hitsIn("// requestAnimationFrame(tick)\nconst ok = 1;"), 0);
});
