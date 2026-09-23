// flightPhysics.ts's helpers are reached through one hook per concern (#1218).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const MODULE = "components/flightPhysics.ts";

const OWNERS: Record<string, string> = {
  dealFlightsMs: "components/table/deal.tsx",
  dealLeaveMs: "components/table/deal.tsx",
  dealArrivalsMs: "components/table/deal.tsx",
  readHandArrival: "components/table/hand.tsx",
  readExchangeTrips: "components/table/ExchangeFlight.tsx",
  passedSeats: "components/table/seats.tsx",
};

function walk(dir: string): string[] {
  return readdirSync(path.join(repoRoot, dir), { recursive: true, encoding: "utf8" })
    .map((f) => `${dir}/${f.split(path.sep).join("/")}`)
    .filter((f) => /\.tsx?$/.test(f) && !f.includes("node_modules"));
}

function namesImportedFromModule(rel: string): string[] {
  const src = readFileSync(path.join(repoRoot, rel), "utf8");
  return [...src.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+["'][^"']*flightPhysics(?:\.ts)?["']/g)]
    .flatMap((m) => m[1].split(","))
    .map((name) => name.replace(/^\s*type\s+/, "").split(/\s+as\s+/)[0].trim())
    .filter(Boolean);
}

const appFiles = ["app", "components", "lib"].flatMap(walk).filter((f) => f !== MODULE);
const importers = [...appFiles, ...walk("tests")].map((rel) => ({ rel, names: namesImportedFromModule(rel) }));

test("each deal, hand-arrival, exchange-trip and passed-seat helper has one component owner", () => {
  const strays = importers
    .filter(({ rel }) => rel.startsWith("app/") || rel.startsWith("components/"))
    .flatMap(({ rel, names }) =>
      names.filter((n) => OWNERS[n] !== undefined && OWNERS[n] !== rel).map((n) => `${rel} → ${n}`)
    );

  assert.ok(importers.some(({ names }) => names.includes("dealLeaveMs")), "the import scan found nothing");
  assert.deepEqual(strays, []);
});

test("every export of flightPhysics.ts is imported somewhere", () => {
  const src = readFileSync(path.join(repoRoot, MODULE), "utf8");
  const exported = [...src.matchAll(/^export (?:const|function|interface|type) (\w+)/gm)].map((m) => m[1]);
  const used = new Set(importers.flatMap(({ names }) => names));

  assert.ok(exported.length > 0);
  assert.deepEqual(exported.filter((name) => !used.has(name)), []);
});
