// tests/tooling/androidApkReuse.test.ts — maestro.yml compiles the native app only when Expo's
// native fingerprint or the bundled resources changed, and every run installs the cached APK
// with this commit's JavaScript packed into it.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { loadWorkflow, step as stepOf, stepIndex, type Step } from "../helpers/workflow.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel: string) => readFileSync(path.join(repoRoot, rel), "utf8");
const workflow = loadWorkflow("maestro.yml");
const android = workflow.jobs.android;
const script = read("tools/ci/rebundle-android-app.sh")
  .split("\n")
  .filter((l) => !l.trim().startsWith("#"))
  .join("\n");

const code = (run = "") => run.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
const step = (name: string) => stepOf(android, name);
const run = (name: string) => code(step(name).run);
const uses = (prefix: string): { at: number; step: Step } => {
  const at = (android.steps ?? []).findIndex((s) => s.uses?.startsWith(prefix));
  assert.notEqual(at, -1, `no step uses ${prefix}`);
  return { at, step: android.steps![at] };
};
const RESTORE = "actions/cache/restore@";
const ON_A_MISS = "steps.cached.outputs.cache-hit != 'true'";

describe("maestro.yml reuses the native build", () => {
  test("the bundle is made once, by Gradle's own task, before anything is keyed on it", () => {
    assert.match(run("Bundle the JS"), /gradlew -p android createBundleReleaseJsAndAssets/);
    assert.equal(step("Bundle the JS").if, undefined, "a run that skips the bundle installs a stale one");
    assert.ok(stepIndex(android, "Bundle the JS") < uses(RESTORE).at);
  });

  test("the APK is keyed on the native fingerprint and on the resources the bundle carries", () => {
    assert.match(run("Fingerprint the native build"), /fingerprint:generate --platform android/);
    assert.ok(
      stepIndex(android, "Fingerprint the native build") < stepIndex(android, "Generate the native project"),
      "after prebuild the fingerprint hashes the generated android/ tree",
    );
    const key = run("Key the native build");
    assert.match(key, /steps\.fingerprint\.outputs\.hash/);
    assert.match(key, /steps\.prebuild\.outputs\.ndk/);
    assert.match(key, /generated\/res\/react\/release/, "a new image would install into an APK without it");
    assert.match(key, /hashFiles\('\.github\/workflows\/maestro\.yml'\)/);
    assert.equal(uses(RESTORE).step.with?.key, "${{ steps.native.outputs.key }}");
  });

  test("the native build runs only on a miss, with the bundle's env whether Gradle re-bundles or not", () => {
    assert.equal(step("Build the app").if, ON_A_MISS);
    assert.doesNotMatch(run("Build the app"), /-x createBundleReleaseJsAndAssets/, "packageReleaseResources reads its output");
    assert.equal(android.env?.EXPO_PUBLIC_E2E_FAST, "1");
    const elsewhere = { ...workflow, jobs: { ...workflow.jobs, android: { ...android, env: undefined } } };
    assert.doesNotMatch(JSON.stringify(elsewhere), /EXPO_PUBLIC_E2E_FAST/);
    assert.equal(uses("actions/cache/save@").step.if, ON_A_MISS);
  });

  test("every run installs the APK this commit's bundle was packed into", () => {
    assert.equal(step("Put the JS into the app").if, undefined, "a miss would install an APK the packing path never touched");
    const pack = run("Put the JS into the app");
    assert.match(pack, /tools\/ci\/rebundle-android-app\.sh/);
    const writers = Object.values(workflow.jobs)
      .flatMap((j) => j.steps ?? [])
      .flatMap((s) => code(s.run).split("\n"))
      .filter((line) => line.includes("APP_APK="));
    assert.equal(writers.length, 1, "more than one step decides which APK is installed");
    assert.ok(pack.includes(writers[0].trim()));
  });

  test("the packed APK carries Gradle's bundle byte for byte, stored, aligned and re-signed", () => {
    assert.match(script, /zip -0\b/, "the template stores the bundle uncompressed");
    const align = script.search(/"\$zipalign" -p -f 4/);
    const sign = script.search(/"\$apksigner" sign/);
    assert.ok(align !== -1 && align < sign, "signing must follow alignment");
    assert.match(script, /unzip -p[^\n]*assets\/index\.android\.bundle[^\n]*\|\s*cmp\b/);
  });

  test("the build uses an NDK the runner already has", () => {
    const prebuild = run("Generate the native project");
    assert.match(prebuild, /\$ANDROID_HOME\/ndk/);
    assert.match(prebuild, /ext\.ndkVersion/);
    assert.ok(stepIndex(android, "Generate the native project") < stepIndex(android, "Bundle the JS"));
  });
});
