import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { allSteps, loadAction, loadWorkflow, step, workflowFiles } from "../helpers/workflow.ts";
import { trackedFiles } from "../helpers/trackedFiles.ts";

const root = path.resolve(import.meta.dirname, "..", "..");
const THE_ACTION = ".github/actions/ios-app/action.yml";
const uncommented = (text: string) => text.replace(/^[ \t]*#.*$/gm, "");

const COMPILES: Record<string, RegExp> = {
  xcodebuild: /(?:^|[\s;&|(])xcodebuild(?![ \t]+-(?:version|showsdks)\b)(?=[\s\\]|$)/m,
  "pod install": /\bpod[ \t]+install\b/,
  "an iOS prebuild": /\bexpo[ \t]+prebuild\b(?![^\n]*--platform[ \t]+android)/,
  "expo run:ios": /\bexpo[ \t]+run:ios\b/,
};

/** Each "file: what" where a file other than the one action compiles iOS natively. */
export function strayCompiles(files: { rel: string; text: string }[]): string[] {
  return files
    .filter((f) => f.rel !== THE_ACTION)
    .flatMap((f) => Object.entries(COMPILES).filter(([, re]) => re.test(uncommented(f.text))).map(([what]) => `${f.rel}: ${what}`));
}

const ciFiles = () =>
  trackedFiles(root, ".github")
    .filter((f) => /^\.github\/(workflows\/[^/]+|actions\/[^/]+\/action)\.ya?ml$/.test(f))
    .map((rel) => ({ rel, text: readFileSync(path.join(root, rel), "utf8") }));

test("only the ios-app action compiles iOS", () => {
  const files = ciFiles();
  assert.ok(files.filter((f) => f.rel.startsWith(".github/workflows/")).length >= 15, "the workflows were not found");
  assert.ok(files.some((f) => f.rel === THE_ACTION), "the action was not found");
  assert.deepEqual(strayCompiles(files), []);
});

test("every pattern matches the action's own compile, so none can go blind", () => {
  const action = uncommented(readFileSync(path.join(root, THE_ACTION), "utf8"));
  for (const [what, re] of Object.entries(COMPILES).filter(([w]) => w !== "expo run:ios")) assert.match(action, re, what);
});

test("a compile planted in a workflow is caught; the reads around one are not", () => {
  const rel = ".github/workflows/ios-bench.yml";
  const text = readFileSync(path.join(root, rel), "utf8");
  const plant = (run: string) => strayCompiles([{ rel, text: `${text}      - run: ${run}\n` }]);
  assert.deepEqual(plant("xcodebuild -workspace ios/murlan.xcworkspace -scheme murlan build"), [`${rel}: xcodebuild`]);
  assert.deepEqual(plant('cd ios && xcodebuild \\'), [`${rel}: xcodebuild`]);
  assert.deepEqual(plant("pod install --project-directory=ios"), [`${rel}: pod install`]);
  assert.deepEqual(plant("npx expo prebuild --platform ios --no-install"), [`${rel}: an iOS prebuild`]);
  assert.deepEqual(plant("npx expo prebuild --no-install"), [`${rel}: an iOS prebuild`]);
  assert.deepEqual(plant("npx expo run:ios"), [`${rel}: expo run:ios`]);
  for (const read of ["xcodebuild -version", 'pkill -f "xcodebuild.*maestro-driver" || :', "npx expo prebuild --platform android --no-install"]) {
    assert.deepEqual(plant(read), [], read);
  }
  assert.deepEqual(strayCompiles([{ rel, text: `${text}      # xcodebuild build\n` }]), []);
});

test("the action compiles through ccache, one slice, no index, and restores every cache it has", () => {
  const action = loadAction("ios-app");
  const compile = step(action, "compile").run ?? "";
  for (const flag of ["ONLY_ACTIVE_ARCH=YES", 'ARCHS="$ARCHS"', "COMPILER_INDEX_STORE_ENABLE=NO", 'CC="$wrap/clang"', 'CXX="$wrap/clang++"', 'LD="$wrap/clang"', 'LDPLUSPLUS="$wrap/clang++"']) {
    assert.ok(compile.includes(flag), flag);
  }
  assert.match(compile, /exec %s %s "\$@"[\s\S]*"\$\(command -v ccache\)" "\$\(xcrun -f "\$tool"\)"/, "the wrappers run the compiler through ccache");
  assert.match(step(action, "build").run ?? "", /simulator\) .*archs=\$\(uname -m\)/);
  const restored = action.steps!.filter((s) => s.uses?.startsWith("actions/cache/restore@")).map((s) => s.with?.path);
  for (const dir of ["${{ runner.temp }}/ccache", "ios/Pods", "${{ runner.temp }}/ios-app"]) assert.ok(restored.includes(dir), dir);
  const saved = action.steps!.filter((s) => s.uses?.startsWith("actions/cache/save@")).map((s) => s.with?.path);
  for (const dir of ["${{ runner.temp }}/ccache", "ios/Pods", "${{ runner.temp }}/ios-app"]) assert.ok(saved.includes(dir), dir);
  assert.equal(step(action, "compile").env?.CCACHE_DIR, "${{ runner.temp }}/ccache");
  const ccacheSave = action.steps!.find((s) => s.uses?.startsWith("actions/cache/save@") && s.with?.path === "${{ runner.temp }}/ccache");
  assert.match(String(ccacheSave?.if), /github\.ref == 'refs\/heads\/main'/, "only main saves ccache, or pull-request saves evict the app cache");
});

test("every iOS build goes through the action", () => {
  const callers = workflowFiles().filter((f) => allSteps(loadWorkflow(f)).some((s) => s.uses === "./.github/actions/ios-app"));
  assert.deepEqual(callers.sort(), ["ci.yml", "ios-app-cache.yml", "ios-bench.yml", "ios-device.yml", "ios.yml"]);
  assert.ok(loadAction("diagnostics-ios").steps!.some((s) => s.uses === "./.github/actions/ios-app"), "diagnostics-ios");
});
