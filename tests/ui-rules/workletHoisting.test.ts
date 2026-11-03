// tests/ui-rules/workletHoisting.test.ts — no worklet calls a function the React Compiler hoisted out of it.
//
// The compiler lifts a callback that captures nothing (`sets.every((s) => s.length === 0)`) to a
// module-level `function _temp`, before the worklets plugin reads the worklet. The worklet then closes
// over `_temp` as a plain JS function, which on the UI runtime is a remote function: calling it throws
// "[Worklets] Tried to synchronously call a Remote Function", and a frame that throws kills a release
// build. Jest runs every worklet on the JS thread, and web has no UI runtime, so only a device run or
// this compile can see it. A `"worklet"` directive in the callback makes the hoisted function a worklet.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { sourcesUnder } from "../helpers/sourceScan.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const { transformSync } = createRequire(path.join(repoRoot, "package.json"))("@babel/core") as typeof import("@babel/core");

const UI_CODE = /worklet|useAnimated|useDerivedValue|useFrameCallback|scheduleOnUI|runOnUI/;

/** The release transform Metro runs for iOS: babel.config.js, the worklets plugin and the React Compiler. */
function compiled(rel: string, source: string): string {
  return transformSync(source, {
    cwd: repoRoot,
    root: repoRoot,
    filename: path.join(repoRoot, rel),
    babelrc: false,
    configFile: path.join(repoRoot, "babel.config.js"),
    envName: "production",
    caller: { name: "metro", bundler: "metro", platform: "ios", isServer: false, isReactServer: false, isDev: false, supportsReactCompiler: true } as never,
  })!.code!;
}

/** `worklet: _temp` for each worklet whose closure (an object or, by position, an array) names a function the compiler hoisted. */
function remoteCalls(code: string): string[] {
  const plain = new Set([...code.matchAll(/\bfunction (_temp\d*)\(/g)].map((m) => m[1]));
  return [...code.matchAll(/(\w+)\.__closure\s*=\s*[[{]([^\]}]*)[\]}]/g)].flatMap(([, worklet, keys]) =>
    keys
      .split(",")
      .map((k) => k.trim().split(":")[0])
      .filter((k) => plain.has(k))
      .map((k) => `${worklet}: ${k}`)
  );
}

test("no worklet closes over a function the React Compiler hoisted out of it", () => {
  const found = sourcesUnder(repoRoot, ["app", "components", "context", "lib"])
    .filter(([rel, src]) => !/\.web\.tsx?$|\.d\.ts$/.test(rel) && UI_CODE.test(src))
    .flatMap(([rel, src]) => remoteCalls(compiled(rel, src)).map((hit) => `${rel} ${hit}`));
  assert.deepEqual(found, [], 'give each callback inside these worklets its own "worklet" directive');
});

const probe = (callback: string) => `
import { useAnimatedReaction, useSharedValue } from "react-native-reanimated";
export function Probe({ sets }: { sets: number[][] }) {
  const out = useSharedValue(false);
  useAnimatedReaction(() => sets.length, () => {
    out.value = sets.every(${callback});
  });
  return null;
}
`;

test("a capture-free callback inside a worklet is caught, and one with its own directive is not", () => {
  assert.deepEqual(remoteCalls(compiled("components/probe.tsx", probe("(s) => s.length === 0"))), ["probeTsx2: _temp"]);
  assert.deepEqual(remoteCalls(compiled("components/probe.tsx", probe('(s) => { "worklet"; return s.length === 0; }'))), []);
});
