// tests/ui-rules/workletHoisting.test.ts — no worklet calls a function the React Compiler hoisted out of it,
// and none reads its closure in a parameter default.
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
const { transformSync, parseSync, traverse, types } = createRequire(path.join(repoRoot, "package.json"))("@babel/core") as typeof import("@babel/core");

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

/**
 * `worklet: param` for each parameter default that reads the worklet's closure. The plugin unpacks
 * `this.__closure` in the body, which runs after the defaults, so on the UI runtime the name is an
 * unbound global and the call throws a ReferenceError.
 */
function closureDefaults(code: string): string[] {
  return [...code.matchAll(/\bcode:\s*("(?:[^"\\]|\\.)*")/g)].flatMap(([, literal]) => {
    const ast = parseSync(JSON.parse(literal) as string, { babelrc: false, configFile: false })!;
    const hits: string[] = [];
    traverse(ast, {
      Function(fn) {
        fn.skip();
        const [unpack] = fn.node.body.type === "BlockStatement" ? fn.node.body.body : [];
        const declared = unpack?.type === "VariableDeclaration" ? unpack.declarations[0] : undefined;
        if (declared?.init?.type !== "MemberExpression" || declared.init.object.type !== "ThisExpression") return;
        const captured = new Set(Object.keys(types.getBindingIdentifiers(declared.id)));
        const name = fn.node.type === "FunctionExpression" ? fn.node.id?.name : undefined;
        for (const param of fn.get("params")) {
          param.traverse({
            ReferencedIdentifier(id) {
              if (captured.has(id.node.name)) hits.push(`${name}: ${id.node.name}`);
            },
          });
        }
      },
    });
    return hits;
  });
}

let scan: [rel: string, code: string][] | undefined;
function scanned(): [rel: string, code: string][] {
  scan ??= sourcesUnder(repoRoot, ["app", "components", "context", "lib"])
    .filter(([rel, src]) => !/\.web\.tsx?$|\.d\.ts$/.test(rel) && UI_CODE.test(src))
    .map(([rel, src]) => [rel, compiled(rel, src)]);
  return scan;
}

test("no worklet closes over a function the React Compiler hoisted out of it", { timeout: 240_000 }, () => {
  assert.ok(
    scanned().some(([rel]) => rel === "components/table/feltCanvas.tsx"),
    "the scan no longer reaches the felt's worklets",
  );
  const found = scanned().flatMap(([rel, code]) => remoteCalls(code).map((hit) => `${rel} ${hit}`));
  assert.deepEqual(found, [], 'give each callback inside these worklets its own "worklet" directive');
});

test("no worklet's parameter default reads its closure", { timeout: 240_000 }, () => {
  assert.ok(
    scanned().some(([rel]) => rel === "lib/motion.ts"),
    "the scan no longer reaches the flight clock's start",
  );
  const found = scanned().flatMap(([rel, code]) => closureDefaults(code).map((hit) => `${rel} ${hit}`));
  assert.deepEqual(found, [], "read the captured value in the worklet's body, after the closure is unpacked");
});

const probe = (callback: string) =>
  [
    'import { useAnimatedReaction, useSharedValue } from "react-native-reanimated";',
    "export function Probe({ sets }: { sets: number[][] }) {",
    "  const out = useSharedValue(false);",
    "  useAnimatedReaction(() => sets.length, () => {",
    "    out.value = sets.every(" + callback + ");",
    "  });",
    "  return null;",
    "}",
  ].join("\n");

test("a parameter default reading the closure is caught, and the same read in the body is not", () => {
  const defaulted = (fn: string) => `import { Platform } from "react-native";\nexport ${fn}`;
  assert.deepEqual(closureDefaults(compiled("components/probe.ts", defaulted('function at(web = Platform.OS === "web") { "worklet"; return web; }'))), ["at_probeTs1: Platform"]);
  assert.deepEqual(closureDefaults(compiled("components/probe.ts", defaulted('function at(web?: boolean) { "worklet"; return web ?? Platform.OS === "web"; }'))), []);
});

test("a capture-free callback inside a worklet is caught, and one with its own directive is not", () => {
  assert.deepEqual(remoteCalls(compiled("components/probe.tsx", probe("(s) => s.length === 0"))), ["probeTsx2: _temp"]);
  assert.deepEqual(remoteCalls(compiled("components/probe.tsx", probe('(s) => { "worklet"; return s.length === 0; }'))), []);
});
