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
const usesAt = (prefix: string): Step => {
  const found = ACTION.steps!.find((s) => s.uses?.startsWith(prefix));
  assert.ok(found, `no step uses ${prefix}`);
  return found;
};
const KEY = "${{ steps.native.outputs.key }}";
const ON_A_MISS = "steps.cached.outputs.cache-hit != 'true'";

test("the ios-app key is computed, restored and saved in the action alone", () => {
  assert.equal(ACTION_TEXT.match(/key=ios-app-/g)?.length, 1);
  for (const f of workflows) {
    const source = code(`.github/workflows/${f}`);
    assert.doesNotMatch(source, /ios-app-\$/, f);
    assert.doesNotMatch(source, /path: \$\{\{ runner\.temp \}\}\/ios-app\s*$/m, f);
  }
});

test("ios.yml restores and ios-app-cache.yml saves through that one action", () => {
  const callers = workflows.filter((f) => calls(f).length > 0);
  assert.deepEqual(callers.sort(), ["ios-app-cache.yml", "ios.yml"]);
  assert.deepEqual(calls("ios-app-cache.yml").map((s) => s.with?.["lookup-only"]), ["true"]);
  assert.deepEqual(calls("ios.yml").map((s) => s.with?.["lookup-only"]), [undefined]);
});

test("ios-app-cache.yml runs on every push to main, and when dispatched", () => {
  assert.deepEqual(loadWorkflow("ios-app-cache.yml").on, { push: { branches: ["main"] }, workflow_dispatch: null });
});

test("a save run is green only on a real hit, or once the build it saved is in the cache", () => {
  const restore = step(ACTION, "cached");
  assert.equal(restore.with?.key, KEY);
  assert.equal(restore.with?.["lookup-only"], "${{ inputs.lookup-only }}");
  assert.equal(restore.with?.["fail-on-cache-miss"], "${{ inputs.lookup-only != 'true' }}", "ios.yml's app job would build on a miss");
  assert.doesNotMatch(ACTION_TEXT, /restore-keys|continue-on-error|\|\| true/);
  for (const [marker, s] of [["Build the app", step(ACTION, "Build the app")], ["actions/cache/save@", usesAt("actions/cache/save@")]] as const) {
    assert.equal(s.if, ON_A_MISS, marker);
  }
  const check = step(ACTION, "The build is in the cache");
  assert.equal(check.if, `inputs.lookup-only == 'true' && ${ON_A_MISS}`);
  assert.equal(check.with?.key, KEY);
  assert.equal(check.with?.["fail-on-cache-miss"], true);
});

test("every build checks ios.yml's rebundling against Xcode's bundle, through the same stand-in .app, before saving", () => {
  const STAND_IN = /rebundle-ios-app\.sh .*"\$products\/js\.app"/;
  assert.match(allSteps(loadWorkflow("ios.yml")).map((s) => s.run ?? "").join("\n"), STAND_IN);
  const name = "The rebundled JS is the bundle Xcode built";
  const check = step(ACTION, name);
  const save = ACTION.steps!.indexOf(usesAt("actions/cache/save@"));
  assert.ok(stepIndex(ACTION, "Build the app") < stepIndex(ACTION, name) && stepIndex(ACTION, name) < save);
  assert.equal(check.if, ON_A_MISS);
  assert.match(check.run ?? "", /node scripts\/e2eBuildMark\.mjs --present "\$products\/js\.app"/);
  assert.match(check.run ?? "", STAND_IN);
  assert.match(check.run ?? "", /cmp "\$RUNNER_TEMP\/xcode\.jsbundle" "\$products\/js\.app\/main\.jsbundle"/);
});

test("the key follows the action's own text, not the workflows calling it", () => {
  const key = step(ACTION, "native").run ?? "";
  assert.match(key, /shasum < "\$GITHUB_ACTION_PATH\/action\.yml"/);
  assert.doesNotMatch(key, /hashFiles|\.github\/workflows/);
});
