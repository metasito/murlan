// The table's flight helpers are reached through one hook per concern (#1218).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const MODULES = [
  "components/impact.ts",
  "components/passes.ts",
  "components/tableLayout.ts",
  "components/table/throws.ts",
  "components/table/exchangeModel.ts",
];

const OWNERS: Record<string, string> = {
  readHandArrival: "components/table/hand.tsx",
  readExchangeLegs: "components/table/ExchangeLegs.tsx",
  readThrownPlay: "components/table/pile.tsx",
  readExchangeSeats: "components/table/useTableExchange.ts",
  passedSeats: "components/table/seats.tsx",
};

function walk(dir: string): string[] {
  return readdirSync(path.join(repoRoot, dir), { recursive: true, encoding: "utf8" })
    .map((f) => `${dir}/${f.split(path.sep).join("/")}`)
    .filter((f) => /\.tsx?$/.test(f) && !f.includes("node_modules"));
}

function namesImportedFromModule(rel: string, module: string): string[] {
  const src = readFileSync(path.join(repoRoot, rel), "utf8");
  const name = path.basename(module, ".ts");
  return [...src.matchAll(new RegExp(`import\\s+(?:type\\s+)?\\{([^}]*)\\}\\s+from\\s+["'][^"']*/${name}(?:\\.ts)?["']`, "g"))]
    .flatMap((m) => m[1].split(","))
    .map((name) => name.replace(/^\s*type\s+/, "").split(/\s+as\s+/)[0].trim())
    .filter(Boolean);
}

const files = [...["app", "components", "lib"].flatMap(walk), ...walk("tests")];
const importersOf = (module: string) =>
  files.filter((rel) => rel !== module).map((rel) => ({ rel, names: namesImportedFromModule(rel, module) }));
const importers = MODULES.flatMap(importersOf);

test("each hand-arrival, exchange-leg and passed-seat helper has one component owner", () => {
  const strays = importers
    .filter(({ rel }) => rel.startsWith("app/") || rel.startsWith("components/"))
    .flatMap(({ rel, names }) =>
      names.filter((n) => OWNERS[n] !== undefined && OWNERS[n] !== rel).map((n) => `${rel} → ${n}`)
    );

  assert.ok(importers.some(({ names }) => names.includes("readHandArrival")), "the import scan found nothing");
  assert.deepEqual(strays, []);
});

for (const module of MODULES) {
  test(`every export of ${module} is imported somewhere`, () => {
    const src = readFileSync(path.join(repoRoot, module), "utf8");
    const exported = [...src.matchAll(/^export (?:const|function|interface|type) (\w+)/gm)].map((m) => m[1]);
    const used = new Set(importersOf(module).flatMap(({ names }) => names));

    assert.ok(exported.length > 0);
    assert.deepEqual(exported.filter((name) => !used.has(name)), []);
  });
}
