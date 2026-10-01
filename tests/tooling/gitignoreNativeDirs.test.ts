import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const ignored = (p: string) => spawnSync("git", ["check-ignore", "--no-index", "-q", p], { cwd: repoRoot }).status === 0;

test("the generated native projects are ignored, and a local module's native sources are not", () => {
  assert.equal(ignored("ios/Podfile"), true, "check-ignore reads nothing — the floor");
  assert.equal(ignored("android/app/build.gradle"), true);
  assert.equal(ignored("modules/murlan-diagnostics/ios/MurlanDiagnosticsModule.swift"), false);
  assert.equal(ignored("modules/murlan-diagnostics/android/build.gradle"), false);
  assert.equal(ignored("modules/murlan-audio-session/ios/MurlanAudioSessionModule.swift"), false);
  assert.equal(ignored("modules/murlan-orientation/ios/MurlanOrientationModule.swift"), false);
});
