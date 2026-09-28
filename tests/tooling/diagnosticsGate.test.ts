import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { moduleEdges } from "../helpers/moduleEdges.ts";
import { sourcesUnder } from "../helpers/sourceScan.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const DIRS = ["app", "components", "context", "lib", "modules"].filter((d) => existsSync(path.join(repoRoot, d)));

const idOf = (file: string) => file.replace(/\.(tsx?|mjs|js)$/, "").replace(/\/index$/, "");
const diagnosticsOnly = (id: string) =>
  id.startsWith("lib/diagnostics/") || id === "components/BenchScreen" || id.startsWith("modules/murlan-diagnostics");

function ungated(sources: [string, string][]): string[] {
  return sources.flatMap(([file, text]) =>
    diagnosticsOnly(idOf(file))
      ? []
      : moduleEdges(file, text)
          .filter((e) => e.via !== "mock" && diagnosticsOnly(e.to) && !(e.via === "require" && e.gated))
          .map((e) => `${e.from} -> ${e.to}`)
  );
}

test("the scan flags an ungated require and a static import, and passes a gated require", () => {
  assert.deepEqual(
    ungated([
      ["app/a.tsx", 'const X = require("@/lib/diagnostics/recorder");'],
      ["app/b.tsx", 'import { probe } from "@/lib/diagnostics/probe";'],
      ["app/c.tsx", 'const X = process.env.EXPO_PUBLIC_DIAGNOSTICS === "1" ? require("@/components/BenchScreen") : null;'],
      ["app/d.tsx", 'const X = process.env.EXPO_PUBLIC_DIAGNOSTICS === "0" ? require("@/components/BenchScreen") : null;'],
      ["lib/diagnostics/recorder.ts", 'import { probe } from "./probe";'],
    ]),
    ["app/a.tsx -> lib/diagnostics/recorder", "app/b.tsx -> lib/diagnostics/probe", "app/d.tsx -> components/BenchScreen"]
  );
});

test("nothing a production bundle reaches imports diagnostics code except behind the literal gate", () => {
  const sources = sourcesUnder(repoRoot, DIRS);
  assert.ok(sources.length > 100, `read ${sources.length} sources — the scan is not reading the tree`);
  assert.deepEqual(ungated(sources), []);
});

test("the gate is exercised, not merely unviolated", () => {
  const gated = sourcesUnder(repoRoot, DIRS)
    .flatMap(([file, text]) => moduleEdges(file, text))
    .filter((e) => e.via === "require" && e.gated)
    .map((e) => `${e.from} -> ${e.to}`)
    .sort();
  assert.deepEqual(gated, ["app/bench.tsx -> components/BenchScreen", "lib/diagnostics/index.ts -> lib/diagnostics/recorder"]);
});
