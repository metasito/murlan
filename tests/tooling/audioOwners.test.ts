import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { moduleEdges } from "../helpers/moduleEdges.ts";
import { sourcesUnder } from "../helpers/sourceScan.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const inDevice = (p: string) => `lib/device/${p}`;
const DIRS =["app", "components", "context", "lib", "modules"].filter((d) => existsSync(path.join(repoRoot, d)));

const OWNERS: Record<string, string[]> = {
  "react-native-audio-api": ["lib/device/audioEngine.ts"],
  "modules/murlan-audio-session": ["lib/device/audioEngine.ts"],
  "modules/murlan-diagnostics": ["lib/diagnostics/probe.ts"],
};

function importers(sources: [string, string][]): Map<string, string[]> {
  const out = new Map<string, Set<string>>();
  for (const [file, text] of sources) {
    for (const edge of moduleEdges(file, text)) {
      if (edge.via === "mock" || edge.to === file.replace(/\.(tsx?)$/, "")) continue;
      out.set(edge.to, (out.get(edge.to) ?? new Set()).add(file));
    }
  }
  return new Map([...out].map(([to, from]) => [to, [...from].sort()]));
}

test("the scan sees a value import, a relative require and a package, and skips a type-only import", () => {
  const found = importers([
    ["components/x.tsx", 'import { play } from "@/lib/device/audioEngine";'],
    [inDevice("y.ts"), 'import type { Bus } from "./audioEngine";'],
    [inDevice("w.ts"), 'import { type Bus } from "./audioEngine";'],
    [inDevice("z.ts"), 'const m = require("react-native-audio-api");'],
  ]);
  assert.deepEqual(found.get("lib/device/audioEngine"), ["components/x.tsx"]);
  assert.deepEqual(found.get("react-native-audio-api"), [inDevice("z.ts")]);
});

test("each audio layer is imported by its one owner and nothing else", () => {
  const sources = sourcesUnder(repoRoot, DIRS);
  assert.ok(sources.length > 100, `read ${sources.length} sources — the scan is not reading the tree`);
  const found = importers(sources);
  for (const [target, owners] of Object.entries(OWNERS)) assert.deepEqual(found.get(target) ?? [], owners, target);
});
