import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { allSteps, loadAction, loadWorkflow, step, stepIndex, workflowFiles, type Step } from "../helpers/workflow.ts";

const root = path.resolve(import.meta.dirname, "..", "..");
const code = (rel: string) => readFileSync(path.join(root, rel), "utf8").replace(/^[ \t]*#.*$/gm, "");
const workflows = workflowFiles();
const ACTION = loadAction("ios-app");
const ACTION_TEXT = code(".github/actions/ios-app/action.yml");
const calls = (file: string) => allSteps(loadWorkflow(file)).filter((s) => s.uses === "./.github/actions/ios-app");
const appCache = (s: Step) => s.uses?.startsWith("actions/cache/") && s.with?.path === "${{ runner.temp }}/ios-app";
const KEY = "${{ steps.native.outputs.key }}";
const ON_A_MISS = "steps.cached.outputs.cache-hit != 'true'";

test("the ios-app key is computed, restored and saved in the action alone", () => {
  assert.equal(ACTION_TEXT.match(/key=ios-app-/g)?.length, 1);
  for (const f of workflows) {
    const source = code(`.github/workflows/${f}`);
    assert.doesNotMatch(source, /ios-app-\$/, f);
    assert.doesNotMatch(source, /path: \$\{\{ runner\.temp \}\}\/ios-app\s*$/m, f);
  }
  const appSteps = ACTION.steps!.filter(appCache);
  assert.equal(appSteps.length, 3, "restore, save, and the fill run's check");
  for (const s of appSteps) {
    assert.equal(s.with?.key, KEY);
    assert.equal(s.with?.["restore-keys"], undefined, "a near-miss app is another build's native code");
  }
});

test("ios.yml restores and ios-app-cache.yml fills through that one action", () => {
  assert.deepEqual(calls("ios-app-cache.yml").map((s) => s.with?.mode), ["fill"]);
  assert.deepEqual(calls("ios.yml").map((s) => s.with?.mode), ["restore"]);
  for (const f of ["ios-app-cache.yml", "ios.yml"]) assert.deepEqual(calls(f).map((s) => s.with?.flavour), ["e2e"], f);
});

test("ios-app-cache.yml runs on every push to main, and when dispatched", () => {
  assert.deepEqual(loadWorkflow("ios-app-cache.yml").on, { push: { branches: ["main"] }, workflow_dispatch: null });
});

test("a fill run is green only on a real hit, or once the build it saved is in the cache; a restore never builds", () => {
  const restore = step(ACTION, "cached");
  assert.equal(restore.with?.key, KEY);
  assert.equal(restore.with?.["lookup-only"], "${{ inputs.mode == 'fill' }}");
  assert.equal(restore.with?.["fail-on-cache-miss"], "${{ inputs.mode == 'restore' }}", "ios.yml's app job would build on a miss");
  assert.equal(step(ACTION, "compile").if, ON_A_MISS);
  assert.doesNotMatch(ACTION_TEXT, /continue-on-error|\|\| true/);
  const save = ACTION.steps!.find((s) => appCache(s) && s.uses?.startsWith("actions/cache/save@"));
  assert.ok(save);
  assert.equal(save.if, `steps.build.outputs.app-cache == 'true' && ${ON_A_MISS}`);
  const check = step(ACTION, "The build is in the cache");
  assert.equal(check.if, `inputs.mode == 'fill' && ${ON_A_MISS}`);
  assert.equal(check.with?.key, KEY);
  assert.equal(check.with?.["fail-on-cache-miss"], true);
});

test("a compile-mode caller never reads or writes the app cache", () => {
  const name = step(ACTION, "build").run ?? "";
  assert.match(name, /app-cache=\$\(\[ "\$MODE" = compile \] && echo false \|\| echo true\)/);
  assert.equal(step(ACTION, "native").if, "steps.build.outputs.app-cache == 'true'");
  assert.equal(step(ACTION, "cached").if, "steps.build.outputs.app-cache == 'true'");
});

test("every Release build checks the rebundled JS against Xcode's bundle, through the same stand-in .app, before saving", () => {
  const start = step(ACTION, "Start bundling the JS");
  assert.match(start.run ?? "", /rebundle-ios-app\.sh "\$PRODUCTS\/js\.app"/);
  const name = "The rebundled JS is the bundle Xcode built";
  const check = step(ACTION, name);
  const save = ACTION.steps!.findIndex((s) => appCache(s) && s.uses?.startsWith("actions/cache/save@"));
  assert.ok(stepIndex(ACTION, "Wait for the JS bundle") < stepIndex(ACTION, "compile"), "both write main.jsbundle into the products dir");
  assert.ok(stepIndex(ACTION, "compile") < stepIndex(ACTION, name) && stepIndex(ACTION, name) < save);
  assert.equal(check.if, `steps.build.outputs.rebundle == 'true' && ${ON_A_MISS}`);
  assert.match(check.run ?? "", /cmp "\$APP\/main\.jsbundle" "\$PRODUCTS\/js\.app\/main\.jsbundle"/);
  assert.match(step(ACTION, "app").run ?? "", /cp -R "\$PRODUCTS\/js\.app\/\." "\$app\/"/);
});

test("the served app carries its flavour's marks", () => {
  const marks = step(ACTION, "The app carries its flavour's marks, and no other's");
  assert.ok(stepIndex(ACTION, "app") < ACTION.steps!.indexOf(marks));
  assert.equal(marks.env?.APP, "${{ steps.app.outputs.app }}");
  assert.match(marks.run ?? "", /e2eBuildMark\.mjs .*"\$APP"\n.*e2eBuildMark\.mjs .*"\$APP" --mark diagnostics/);
});

test("the key follows the action's own text and the flavour, not the workflows calling it", () => {
  const native = step(ACTION, "native");
  assert.match(native.run ?? "", /shasum < "\$GITHUB_ACTION_PATH\/action\.yml"/);
  assert.match(native.run ?? "", /key=ios-app-.*-\$FLAVOUR-\$hash/);
  assert.equal(native.env?.FLAVOUR, "${{ inputs.sdk }}-${{ inputs.configuration }}-${{ inputs.flavour }}");
  assert.doesNotMatch(native.run ?? "", /hashFiles|\.github\/workflows/);
});
