import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const json = (file: string) => JSON.parse(readFileSync(path.join(repoRoot, file), "utf8"));
const PINS = { "react-native-audio-api": "0.13.6", "react-native-turbo-haptics": "1.2.0" };

test("both libraries are pinned exactly, and the lockfile resolves the pins", () => {
  const deps = json("package.json").dependencies;
  const lock = json("package-lock.json").packages;
  for (const [name, version] of Object.entries(PINS)) {
    assert.equal(deps[name], version, `${name} must be pinned to exactly ${version}`);
    assert.equal(lock[`node_modules/${name}`]?.version, version, `package-lock.json resolves ${name} elsewhere`);
  }
});

test("the audio library's plugin runs with every service, permission, background mode and download off", () => {
  const plugins: unknown[] = json("app.json").expo.plugins;
  const entry = plugins.find((p) => Array.isArray(p) && p[0] === "react-native-audio-api") as [string, object] | undefined;
  assert.deepEqual(entry?.[1], {
    iosBackgroundMode: false,
    androidForegroundService: false,
    androidPermissions: [],
    disableFFmpeg: true,
    disableStaticExternalLibs: true,
  });
  assert.ok(!plugins.includes("react-native-audio-api"), "a bare plugin entry runs every default");
});
