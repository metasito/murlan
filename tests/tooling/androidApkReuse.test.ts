// tests/tooling/androidApkReuse.test.ts — maestro.yml compiles the native app only when Expo's
// native fingerprint or the bundled resources changed, and every run installs the cached APK
// with this commit's JavaScript packed into it.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel: string) => readFileSync(path.join(repoRoot, rel), "utf8");
const src = read(".github/workflows/maestro.yml");
const script = read("tools/ci/rebundle-android-app.sh")
  .split("\n")
  .filter((l) => !l.trim().startsWith("#"))
  .join("\n");

function step(name: string): string {
  const at = src.indexOf(`- name: ${name}\n`);
  assert.notEqual(at, -1, `no step named "${name}"`);
  const next = src.indexOf("\n      - ", at + 1);
  return src.slice(at, next === -1 ? undefined : next);
}

const code = (block: string) => block.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");

describe("maestro.yml reuses the native build", () => {
  test("the bundle is made once, by Gradle's own task, before anything is keyed on it", () => {
    const bundle = code(step("Bundle the JS"));
    assert.match(bundle, /gradlew -p android createBundleReleaseJsAndAssets/);
    assert.doesNotMatch(bundle, /^\s+if:/m, "a run that skips the bundle installs a stale one");
    assert.ok(src.indexOf("- name: Bundle the JS") < src.indexOf("actions/cache/restore"));
  });

  test("the APK is keyed on the native fingerprint and on the resources the bundle carries", () => {
    const fingerprint = code(step("Fingerprint the native build"));
    assert.match(fingerprint, /fingerprint:generate --platform android/);
    assert.ok(
      src.indexOf("- name: Fingerprint the native build") < src.indexOf("- name: Generate the native project"),
      "after prebuild the fingerprint hashes the generated android/ tree",
    );
    const key = code(step("Key the native build"));
    assert.match(key, /steps\.fingerprint\.outputs\.hash/);
    assert.match(key, /steps\.prebuild\.outputs\.ndk/);
    assert.match(key, /generated\/res\/react\/release/, "a new image would install into an APK without it");
    assert.match(key, /hashFiles\('\.github\/workflows\/maestro\.yml'\)/);
    const restore = src.slice(src.indexOf("actions/cache/restore"), src.indexOf("actions/cache/restore") + 300);
    assert.match(restore, /key: \$\{\{ steps\.native\.outputs\.key \}\}/);
  });

  test("the native build runs only on a miss, with the bundle's env whether Gradle re-bundles or not", () => {
    const build = code(step("Build the app"));
    assert.match(build, /if: steps\.cached\.outputs\.cache-hit != 'true'/);
    assert.doesNotMatch(build, /-x createBundleReleaseJsAndAssets/, "packageReleaseResources reads its output");
    const job = src.slice(src.indexOf("\n  android:"), src.indexOf("\n    steps:"));
    assert.match(job, /\n    env:[\s\S]*EXPO_PUBLIC_E2E_FAST: "1"/);
    assert.doesNotMatch(src.slice(src.indexOf("\n    steps:")), /EXPO_PUBLIC_E2E_FAST:/);
    const save = src.slice(src.indexOf("actions/cache/save"), src.indexOf("actions/cache/save") + 300);
    assert.match(save, /if: steps\.cached\.outputs\.cache-hit != 'true'/);
  });

  test("every run installs the APK this commit's bundle was packed into", () => {
    const pack = code(step("Put the JS into the app"));
    assert.doesNotMatch(pack, /^\s+if:/m, "a miss would install an APK the packing path never touched");
    assert.match(pack, /tools\/ci\/rebundle-android-app\.sh/);
    const writers = [...src.matchAll(/^[^#\n]*APP_APK=/gm)];
    assert.equal(writers.length, 1, "more than one step decides which APK is installed");
    assert.ok(pack.includes(writers[0][0].trim()));
  });

  test("the packed APK carries Gradle's bundle byte for byte, stored, aligned and re-signed", () => {
    assert.match(script, /zip -0\b/, "the template stores the bundle uncompressed");
    const align = script.search(/"\$zipalign" -p -f 4/);
    const sign = script.search(/"\$apksigner" sign/);
    assert.ok(align !== -1 && align < sign, "signing must follow alignment");
    assert.match(script, /unzip -p[^\n]*assets\/index\.android\.bundle[^\n]*\|\s*cmp\b/);
  });

  test("the build uses an NDK the runner already has", () => {
    const prebuild = code(step("Generate the native project"));
    assert.match(prebuild, /\$ANDROID_HOME\/ndk/);
    assert.match(prebuild, /ext\.ndkVersion/);
    assert.ok(src.indexOf("- name: Generate the native project") < src.indexOf("- name: Bundle the JS"));
  });
});
