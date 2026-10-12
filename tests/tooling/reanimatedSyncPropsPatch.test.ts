import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const locked: string = JSON.parse(readFileSync(path.join(repoRoot, "package-lock.json"), "utf8")).packages[
  "node_modules/react-native-reanimated"
].version;
const PATCH = `patches/react-native-reanimated+${locked}.patch`;
const library = path.dirname(createRequire(import.meta.url).resolve("react-native-reanimated/package.json"));
const PROXY = path.join(library, "android/src/main/java/com/swmansion/reanimated/NativeProxy.kt");
const UPSTREAM = "software-mansion/react-native-reanimated#10435";
const DROP = `If the installed Reanimated contains ${UPSTREAM}, delete ${PATCH} and this test; otherwise re-derive the patch.`;

const GUARD =
  /private val getViewExistsMethod by lazy \{\s*runCatching \{[^\n]+\}\.getOrNull\(\)\s*\}[\s\S]*if \(getViewExistsMethod\?\.invoke\(mountingManager, viewTag\) == false\) \{\s*return@parse\s*\}\s*updatePropsSynchronouslyMethod\.invoke\(mountingManager, viewTag, props\)/;
const STACK_LOG = /Log\.w\("Reanimated", "synchronouslyUpdateUIProps failed for tag \$viewTag", e\)/;

/** Each hunk as the text it expects and the text it leaves; a hunk already applied is left alone. */
function applyPatch(source: string, patch: string): string {
  const hunks = patch.split(/^@@[^\n]*\n/m).slice(1);
  return hunks.reduce((text, hunk) => {
    const lines = hunk.replace(/\n$/, "").split("\n");
    const before = lines.filter((l) => !l.startsWith("+")).map((l) => l.slice(1)).join("\n");
    const after = lines.filter((l) => !l.startsWith("-")).map((l) => l.slice(1)).join("\n");
    if (text.includes(after)) return text;
    assert.equal(text.split(before).length, 2, `a hunk of ${PATCH} no longer matches NativeProxy.kt. ${DROP}`);
    return text.replace(before, () => after);
  }, source);
}

test("the installed Reanimated skips synchronous props for an unmounted view (#1557)", () => {
  assert.ok(existsSync(path.join(repoRoot, PATCH)), `${PATCH} is missing. ${DROP}`);
  const installed = readFileSync(PROXY, "utf8").replace(/\r\n/g, "\n");
  // CI's install ran patch-package; a local worktree shares an install that may predate this patch.
  const source = process.env.CI ? installed : applyPatch(installed, readFileSync(path.join(repoRoot, PATCH), "utf8"));
  assert.match(source, GUARD, `NativeProxy.kt updates a view without asking whether it is mounted. ${DROP}`);
  assert.doesNotMatch(source, STACK_LOG, "the failure is still logged with its whole stack");
});

test("the in-memory apply is the patch, not a pass-through", () => {
  const pristine = readFileSync(PROXY, "utf8").replace(/\r\n/g, "\n");
  if (GUARD.test(pristine)) return;
  assert.doesNotMatch(applyPatch(pristine, ""), GUARD);
  assert.throws(() => applyPatch("unrelated", readFileSync(path.join(repoRoot, PATCH), "utf8")), /no longer matches/);
});
