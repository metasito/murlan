import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const ENGINE = "node_modules/react-native-audio-api/ios/audioapi/ios/system/AudioEngine.mm";

test("every AVAudioEngine start in the installed library is inside @try (#1238)", () => {
  assert.ok(existsSync(path.join(repoRoot, "patches/react-native-audio-api+0.13.6.patch")), "the patch is not committed");
  const source = readFileSync(path.join(repoRoot, ENGINE), "utf8");
  const starts = source.match(/\[self\.audioEngine startAndReturnError:&error\];/g) ?? [];
  const guarded = source.match(/@try \{\s*\[self\.audioEngine startAndReturnError:&error\];\s*\} @catch \(NSException \*exception\)/g) ?? [];
  assert.equal(starts.length, 2, "the library's start sites moved; re-read AudioEngine.mm before trusting the patch");
  assert.equal(guarded.length, starts.length);
});
