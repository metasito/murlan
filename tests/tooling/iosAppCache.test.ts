import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..", "..");
const code = (rel: string) => readFileSync(path.join(root, rel), "utf8").replace(/^[ \t]*#.*$/gm, "");
const workflows = readdirSync(path.join(root, ".github/workflows")).filter((f) => f.endsWith(".yml"));
const ACTION = code(".github/actions/ios-app/action.yml");
const CALL = /uses: \.\/\.github\/actions\/ios-app\n((?: {8}.*\n)*)/;

const step = (source: string, marker: string) => {
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `no step with ${marker}`);
  const end = source.indexOf("\n    - ", start);
  return source.slice(source.lastIndexOf("\n    - ", start), end === -1 ? undefined : end);
};

test("the ios-app key is computed, restored and saved in the action alone", () => {
  assert.equal(ACTION.match(/key=ios-app-/g)?.length, 1);
  for (const f of workflows) {
    const source = code(`.github/workflows/${f}`);
    assert.doesNotMatch(source, /ios-app-\$/, f);
    assert.doesNotMatch(source, /path: \$\{\{ runner\.temp \}\}\/ios-app\s*$/m, f);
  }
});

test("ios.yml restores and ios-app-cache.yml saves through that one action", () => {
  const callers = workflows.filter((f) => CALL.test(code(`.github/workflows/${f}`)));
  assert.deepEqual(callers.sort(), ["ios-app-cache.yml", "ios.yml"]);
  assert.match(CALL.exec(code(".github/workflows/ios-app-cache.yml"))![1], /lookup-only: "true"/);
  assert.doesNotMatch(CALL.exec(code(".github/workflows/ios.yml"))![1], /lookup-only/);
});

test("ios-app-cache.yml runs on every push to main, and when dispatched", () => {
  const on = code(".github/workflows/ios-app-cache.yml").match(/^on:\n((?:[ \t]+.*\n|\n)*)/m)?.[1] ?? "";
  assert.equal(on.trim(), "push:\n    branches: [main]\n  workflow_dispatch:");
});

test("a save run is green only on a real hit, or once the build it saved is in the cache", () => {
  const restore = step(ACTION, "id: cached");
  assert.match(restore, /key: \$\{\{ steps\.native\.outputs\.key \}\}/);
  assert.match(restore, /lookup-only: \$\{\{ inputs\.lookup-only \}\}/);
  assert.match(restore, /fail-on-cache-miss: \$\{\{ inputs\.lookup-only != 'true' \}\}/, "ios.yml's app job would build on a miss");
  assert.doesNotMatch(ACTION, /restore-keys|continue-on-error|\|\| true/);
  for (const marker of ["name: Build the app", "actions/cache/save@"]) {
    assert.match(step(ACTION, marker), /if: steps\.cached\.outputs\.cache-hit != 'true'\n/, marker);
  }
  const check = step(ACTION, "name: The build is in the cache");
  assert.match(check, /if: inputs\.lookup-only == 'true' && steps\.cached\.outputs\.cache-hit != 'true'\n/);
  assert.match(check, /key: \$\{\{ steps\.native\.outputs\.key \}\}/);
  assert.match(check, /fail-on-cache-miss: true/);
});

test("every build checks ios.yml's rebundling against Xcode's bundle, through the same stand-in .app, before saving", () => {
  const STAND_IN = /rebundle-ios-app\.sh .*"\$products\/js\.app"/;
  assert.match(code(".github/workflows/ios.yml"), STAND_IN);
  const check = step(ACTION, "name: The rebundled JS is the bundle Xcode built");
  const at = (marker: string) => ACTION.indexOf(marker);
  assert.ok(at("name: Build the app") < at("name: The rebundled JS") && at("name: The rebundled JS") < at("actions/cache/save@"));
  assert.match(check, /if: steps\.cached\.outputs\.cache-hit != 'true'\n/);
  assert.match(check, /node scripts\/e2eBuildMark\.mjs --present "\$products\/js\.app"/);
  assert.match(check, STAND_IN);
  assert.match(check, /cmp "\$RUNNER_TEMP\/xcode\.jsbundle" "\$products\/js\.app\/main\.jsbundle"/);
});

test("the key follows the action's own text, not the workflows calling it", () => {
  const key = step(ACTION, "id: native");
  assert.match(key, /shasum < "\$GITHUB_ACTION_PATH\/action\.yml"/);
  assert.doesNotMatch(key, /hashFiles|\.github\/workflows/);
});
