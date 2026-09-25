// tests/ui-rules/frameCallbackIdentity.test.ts — a frame callback keeps one identity across renders.
//
// `useFrameCallback` re-registers on every new identity, and the build's React Compiler drops a
// `useCallback` around a worklet, so this reads the build's own output rather than the source.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { sourcesUnder } from "../helpers/sourceScan.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const { transformSync } = createRequire(path.join(repoRoot, "package.json"))("@babel/core");

function built(rel: string, source: string): string {
  const filename = path.join(repoRoot, rel);
  return transformSync(source, {
    filename,
    root: repoRoot,
    babelrc: false,
    configFile: path.join(repoRoot, "babel.config.js"),
    caller: {
      name: "metro",
      bundler: "metro",
      platform: "web",
      isDev: false,
      isServer: false,
      isReactServer: false,
      isNodeModule: false,
      isHMREnabled: false,
      supportsReactCompiler: true,
      supportsStaticESM: true,
    },
  }).code;
}

const CALLERS = sourcesUnder(repoRoot, ["app", "components", "context", "lib"], /\.tsx?$/).filter(([, source]) =>
  /\buseFrameCallback\(/.test(source)
);

test("the build passes useFrameCallback a callback made once, not one per render", () => {
  assert.ok(CALLERS.length > 0, "no file calls useFrameCallback, so this reaches nothing");
  const inline = CALLERS.filter(([rel, source]) => /\buseFrameCallback\(\s*(?:function\b|\(|async\b)/.test(built(rel, source)));
  assert.deepEqual(
    inline.map(([rel]) => rel),
    [],
    "the built code hands useFrameCallback a function literal, which is a new identity on every " +
      "render: build the worklet once, in a `useState` initializer"
  );
});
