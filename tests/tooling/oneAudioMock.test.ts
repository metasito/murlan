import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { moduleEdges } from "../helpers/moduleEdges.ts";
import { sourcesUnder } from "../helpers/sourceScan.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SETUP = "tests/native/setup.ts";
const AUDIO = [
  "react-native-audio-api", "react-native-turbo-haptics", "expo-audio", "expo-haptics", "modules/murlan-audio-session",
  "lib/device/assetFiles", "lib/device/audioEngine", "lib/device/hapticsEngine", "lib/device/feedback",
  "lib/device/sounds", "lib/device/haptics", "lib/device/music", "lib/device/cues", "lib/device/playCue",
];

const mocks = (sources: [string, string][]) =>
  sources.flatMap(([file, text]) => moduleEdges(file, text).filter((e) => e.via === "mock" && AUDIO.includes(e.to)).map((e) => `${e.from} -> ${e.to}`));

test("the scan sees jest.mock and jest.doMock of an audio module by any spelling", () => {
  assert.deepEqual(
    mocks([
      ["tests/native/a.test.tsx", 'jest.mock("expo-audio", () => ({}));'],
      ["tests/native/b.test.tsx", 'jest.doMock("@/lib/device/feedback", () => ({}));'],
      ["tests/native/c.test.tsx", 'jest.mock("@/lib/device/other", () => ({}));'],
    ]),
    ["tests/native/a.test.tsx -> expo-audio", "tests/native/b.test.tsx -> lib/device/feedback"]
  );
});

test("only tests/native/setup.ts mocks an audio layer, and it mocks the four the engines import", () => {
  const found = mocks(sourcesUnder(repoRoot, ["tests"]));
  assert.deepEqual(found.filter((m) => !m.startsWith(`${SETUP} ->`)), []);
  assert.deepEqual(found.sort(), [
    `${SETUP} -> lib/device/assetFiles`, `${SETUP} -> modules/murlan-audio-session`, `${SETUP} -> react-native-audio-api`, `${SETUP} -> react-native-turbo-haptics`,
  ]);
});
