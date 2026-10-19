// tests/tooling/libGameBoundary.test.ts — lib/game holds the game: every runtime import there resolves inside lib/game/.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = path.resolve(import.meta.dirname, "..", "..");
const GAME = path.join(root, "lib", "game");

interface Import { file: string; spec: string; typeOnly: boolean }

function typeOnly(node: ts.ImportDeclaration | ts.ExportDeclaration): boolean {
  if (ts.isExportDeclaration(node)) {
    const clause = node.exportClause;
    return node.isTypeOnly || (!!clause && ts.isNamedExports(clause) && clause.elements.length > 0 && clause.elements.every((e) => e.isTypeOnly));
  }
  const clause = node.importClause;
  if (!clause) return false;
  if (clause.isTypeOnly) return true;
  const bindings = clause.namedBindings;
  return !clause.name && !!bindings && ts.isNamedImports(bindings) && bindings.elements.length > 0 && bindings.elements.every((e) => e.isTypeOnly);
}

function importsOf(file: string, source: string): Import[] {
  const out: Import[] = [];
  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      out.push({ file, spec: node.moduleSpecifier.text, typeOnly: typeOnly(node) });
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require")) &&
      node.arguments.length > 0 &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      out.push({ file, spec: node.arguments[0].text, typeOnly: false });
    }
    ts.forEachChild(node, visit);
  };
  visit(ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true));
  return out;
}

function resolvesInsideGame(file: string, spec: string): boolean {
  const target = spec.startsWith(".") ? path.resolve(path.dirname(file), spec) : spec.startsWith("@/") ? path.join(root, spec.slice(2)) : null;
  return target !== null && target.startsWith(GAME + path.sep);
}

const offenders = (imports: Import[]): string[] =>
  imports.filter((i) => !i.typeOnly && !resolvesInsideGame(i.file, i.spec)).map((i) => `${path.relative(root, i.file)} -> ${i.spec}`);

const gameFiles = readdirSync(GAME, { recursive: true, encoding: "utf8" })
  .filter((f) => /\.tsx?$/.test(f))
  .map((f) => path.join(GAME, f));
const imports = gameFiles.flatMap((f) => importsOf(f, readFileSync(f, "utf8")));

test("every runtime import in lib/game resolves inside lib/game", () => {
  assert.ok(gameFiles.length >= 8, `scanned only ${gameFiles.length} files in lib/game`);
  assert.ok(imports.length >= 15, `found only ${imports.length} imports in lib/game`);
  assert.ok(imports.filter((i) => !i.typeOnly).length >= 5, "found too few runtime imports in lib/game to trust the scan");
  assert.deepEqual(offenders(imports), []);
});

test("a planted runtime import leaving lib/game is caught, and a type-only one is not", () => {
  const probe = path.join(GAME, "__boundaryProbe.ts");
  const planted = importsOf(
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
    ].join("\n"),
  );
  assert.equal(planted.length, 9);
  assert.deepEqual(offenders(planted), [
    "lib/game/__boundaryProbe.ts -> ../tokens.ts",
    "lib/game/__boundaryProbe.ts -> react",
    "lib/game/__boundaryProbe.ts -> @/lib/theme",
    "lib/game/__boundaryProbe.ts -> ../timeline/dealTimeline.ts",
  ]);
});
