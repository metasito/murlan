import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const library = path.dirname(createRequire(import.meta.url).resolve("react-native-reanimated/package.json"));
const PROXY = path.join(library, "android/src/main/java/com/swmansion/reanimated/NativeProxy.kt");

const GUARD =
  /private val getViewExistsMethod by lazy \{\s*runCatching \{[^\n]+\}\.getOrNull\(\)\s*\}[\s\S]*if \(getViewExistsMethod\?\.invoke\(mountingManager, viewTag\) == false\) \{\s*return@parse\s*\}\s*updatePropsSynchronouslyMethod\.invoke\(mountingManager, viewTag, props\)/;
const STACK_LOG = /Log\.w\("Reanimated", "synchronouslyUpdateUIProps failed for tag \$viewTag", e\)/;

test("the installed Reanimated skips synchronous props for an unmounted view (#1557, software-mansion/react-native-reanimated#10435)", () => {
  const source = readFileSync(PROXY, "utf8").replace(/\r\n/g, "\n");
  assert.match(source, GUARD, "NativeProxy.kt updates a view without asking whether it is mounted: re-derive the patch #1557 shipped");
  assert.doesNotMatch(source, STACK_LOG, "the failure is logged with its whole stack again");
});
