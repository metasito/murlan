import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { sourcesUnder } from "../helpers/sourceScan.ts";

const root = path.resolve(import.meta.dirname, "..", "..");
const GAME = path.join(root, "lib", "game");
const TIMELINE = path.join(root, "lib", "timeline");

interface Import { file: string; spec: string | null; text: string; typeOnly: boolean }
interface Scan { imports: Import[]; envReads: string[] }

const isProcessEnv = (node: ts.Node): boolean =>
  (ts.isPropertyAccessExpression(node) && node.name.text === "env" && ts.isIdentifier(node.expression) && node.expression.text === "process") ||
  (ts.isElementAccessExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === "process" &&
    ts.isStringLiteralLike(node.argumentExpression) &&
    node.argumentExpression.text === "env");

function scan(file: string, source: string): Scan {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const imports: Import[] = [];
  const envReads: string[] = [];
  const add = (specNode: ts.Expression, typeOnly: boolean) =>
    imports.push({
      file,
      spec: ts.isStringLiteralLike(specNode) ? specNode.text : null,
      text: specNode.getText(sf),
      typeOnly,
    });
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      add(node.moduleSpecifier, node.importClause?.isTypeOnly === true);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      add(node.moduleSpecifier, node.isTypeOnly);
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      add(node.moduleReference.expression, node.isTypeOnly);
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require")) &&
      node.arguments.length > 0
    ) {
      add(node.arguments[0], false);
    } else if (isProcessEnv(node)) {
      envReads.push(`${path.relative(root, file)}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1} ${node.parent.getText(sf)}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { imports, envReads };
}

function target(file: string, spec: string): string | null {
  if (spec.startsWith(".")) return path.resolve(path.dirname(file), spec);
  if (spec.startsWith("@/")) return path.join(root, spec.slice(2));
  return null;
}

const inside = (dir: string) => (i: Import): boolean => {
  const t = i.spec === null ? null : target(i.file, i.spec);
  return t !== null && t.startsWith(dir + path.sep);
};

const describeImport = (i: Import) => `${path.relative(root, i.file)} -> ${i.spec ?? `<non-literal ${i.text}>`}`;

const offenders = (imports: Import[]): string[] =>
  imports.filter((i) => !i.typeOnly && !inside(GAME)(i)).map(describeImport);

const gameSources = sourcesUnder(root, [path.relative(root, GAME).split(path.sep).join("/")]);
const gameFiles = gameSources.map(([rel]) => path.join(root, rel));
const gameScans = gameSources.map(([rel, text]) => scan(path.join(root, rel), text));
const imports = gameScans.flatMap((s) => s.imports);
const runtimeCount = imports.filter((i) => !i.typeOnly).length;
const FLOOR_NOTE = "design 01-engine §4.6's floor of 15 files and 20 imports was counted before the timelines left lib/game, and cannot hold after it";

test("every runtime import in lib/game resolves inside lib/game", () => {
  const scanned = gameFiles.map((f) => path.relative(GAME, f));
  for (const core of ["gameEngine.ts", "autoMove.ts", "sharedGameFlow.ts"]) {
    assert.ok(scanned.includes(core), `the scan of lib/game did not reach ${core}; it scanned ${scanned.join(", ") || "nothing"}`);
  }
  assert.ok(gameFiles.length >= 8, `scanned ${gameFiles.length} files in lib/game, below the floor of 8; ${FLOOR_NOTE}`);
  assert.ok(imports.length >= 15, `found ${imports.length} imports in lib/game, below the floor of 15; ${FLOOR_NOTE}`);
  assert.ok(runtimeCount >= 5, `found ${runtimeCount} runtime imports in lib/game, below the floor of 5`);
  assert.deepEqual(offenders(imports), []);
});

test("lib/game reads no environment: a build flag or pacing knob belongs in lib/timeline/", () => {
  assert.deepEqual(gameScans.flatMap((s) => s.envReads), []);
});

test("a planted runtime import leaving lib/game is caught, and a type-only one is not", () => {
  const probe = path.join(GAME, "__boundaryProbe.ts");
  const planted = scan(
    probe,
    [
      `import { Motion } from "../tokens.ts";`,
      `import { useState } from "react";`,
      `export { Colors } from "@/lib/theme";`,
      `const late = await import("../timeline/dealTimeline.ts");`,
      `import type { TranslationKey } from "../../shared/i18n.ts";`,
      `import { type Card } from "@/lib/game/gameEngine";`,
      `export type { Hold } from "../tokens.ts";`,
      `import { standings } from "./standings.ts";`,
      `import { scoreRound } from "@/lib/game/gameEngine";`,
      `import { type Palette } from "@/lib/theme";`,
      `import type { Colors as C } from "@/lib/theme";`,
      `import haptics = require("../device/hapticsEngine");`,
      `import type tokens = require("../tokens");`,
      "const dyn = await import(`../timeline/${name}.ts`);",
      "const req = require(`./${name}`);",
      `const fixed = require(\`./standings.ts\`);`,
    ].join("\n"),
  ).imports;
  assert.equal(planted.length, 16);
  const at = (spec: string) => `${path.relative(root, probe)} -> ${spec}`;
  assert.deepEqual(offenders(planted), [
    at("../tokens.ts"),
    at("react"),
    at("@/lib/theme"),
    at("../timeline/dealTimeline.ts"),
    at("@/lib/theme"),
    at("../device/hapticsEngine"),
    at("<non-literal `../timeline/${name}.ts`>"),
    at("<non-literal `./${name}`>"),
  ]);
});

test("a planted environment read in lib/game is caught", () => {
  const probe = path.join(GAME, "__boundaryProbe.ts");
  const reads = scan(
    probe,
    [
      `export const DELAY_MS = process.env.EXPO_PUBLIC_E2E_FAST === "1" ? 0 : 1100;`,
      `const flag = process["env"].CI;`,
      `const notEnv = process.platform;`,
    ].join("\n"),
  ).envReads;
  assert.deepEqual(reads, [
    `${path.relative(root, probe)}:1 process.env.EXPO_PUBLIC_E2E_FAST`,
    `${path.relative(root, probe)}:2 process["env"].CI`,
  ]);
});

const serverSafeOffenders = (scans: Scan[]): string[] =>
  scans
    .flatMap((s) => s.imports)
    .filter((i) => !i.typeOnly && !(i.spec !== null && i.spec.startsWith(".") && i.spec.endsWith(".ts")))
    .map(describeImport);

const serverFiles = sourcesUnder(root, ["server"]).map(([rel]) => path.join(root, rel));
const timelinesImportedBy = (files: string[]): string[] =>
  files
    .flatMap((f) => scan(f, readFileSync(f, "utf8")).imports)
    .filter((i) => !i.typeOnly && inside(TIMELINE)(i))
    .map((i) => target(i.file, i.spec as string) as string);
const serverLoadedTimelines = (() => {
  const loaded = new Set(timelinesImportedBy(serverFiles));
  for (const f of loaded) for (const next of timelinesImportedBy([f])) loaded.add(next);
  return [...loaded].sort();
})();

test("every lib/timeline module the server imports loads under plain Node: relative `.ts` runtime imports only", () => {
  const named = serverLoadedTimelines.map((f) => path.relative(root, f));
  for (const needed of ["lib/timeline/turnGates.ts", "lib/timeline/dealTimeline.ts", "lib/timeline/exchangeTimeline.ts"]) {
    assert.ok(named.includes(needed), `the scan of server/ no longer finds its import of ${needed}; it found ${named.join(", ") || "none"}`);
  }
  assert.deepEqual(serverSafeOffenders(serverLoadedTimelines.map((f) => scan(f, readFileSync(f, "utf8")))), []);
});

test("a planted alias, bare or extensionless import in a server-loaded timeline is caught", () => {
  const probe = path.join(TIMELINE, "__serverProbe.ts");
  const planted = scan(
    probe,
    [
      `import { Motion } from "@/lib/tokens";`,
      `import { Platform } from "react-native";`,
      `import { dealEndMs } from "./dealTimeline";`,
      `import { Hold } from "../tokens.ts";`,
      `import type { LegStage } from "@/lib/timeline/exchangeTimeline";`,
    ].join("\n"),
  );
  const at = (spec: string) => `${path.relative(root, probe)} -> ${spec}`;
  assert.deepEqual(serverSafeOffenders([planted]), [at("@/lib/tokens"), at("react-native"), at("./dealTimeline")]);
});
