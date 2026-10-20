// Every value the engine exports is imported by production code. An export only a
// test reaches is engine surface no caller decides through, and the next caller
// re-derives the decision from it instead.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = path.resolve(import.meta.dirname, "..", "..");
const ENGINE = path.join("lib", "game", "gameEngine.ts");
const PRODUCTION = ["app", "components", "context", "lib", "server", "shared", "scripts"];
const ENGINE_SPEC = /(^|\/)gameEngine(\.ts)?$/;

interface Source {
  rel: string;
  text: string;
}

const parse = (file: string, text: string) => ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
const exported = (node: ts.Node) =>
  ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);

/** The engine's value exports, and any export form this scan cannot name. */
function valueExports(text: string): { names: string[]; unreadable: string[] } {
  const names: string[] = [];
  const unreadable: string[] = [];
  for (const node of parse(ENGINE, text).statements) {
    if (ts.isExportDeclaration(node) || ts.isExportAssignment(node)) {
      if (!(ts.isExportDeclaration(node) && node.isTypeOnly)) unreadable.push(node.getText());
    } else if (!exported(node)) {
      continue;
    } else if (ts.isVariableStatement(node)) {
      for (const d of node.declarationList.declarations) {
        if (ts.isIdentifier(d.name)) names.push(d.name.text);
        else unreadable.push(d.getText());
      }
    } else if (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isEnumDeclaration(node)) {
      if (node.name) names.push(node.name.text);
      else unreadable.push(node.getText());
    }
  }
  return { names, unreadable };
}

/** Value names a file takes from the engine; a namespace import cannot be read and is reported. */
function engineImports(source: Source): { names: string[]; namespaces: string[] } {
  const names: string[] = [];
  const namespaces: string[] = [];
  for (const node of parse(source.rel, source.text).statements) {
    const spec = ts.isImportDeclaration(node) || ts.isExportDeclaration(node) ? node.moduleSpecifier : undefined;
    if (!spec || !ts.isStringLiteralLike(spec) || !ENGINE_SPEC.test(spec.text)) continue;
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause;
      if (!clause || clause.isTypeOnly) continue;
      const bindings = clause.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) namespaces.push(source.rel);
      if (bindings && ts.isNamedImports(bindings)) {
        for (const el of bindings.elements) if (!el.isTypeOnly) names.push((el.propertyName ?? el.name).text);
      }
    } else if (ts.isExportDeclaration(node) && !node.isTypeOnly && node.exportClause && ts.isNamedExports(node.exportClause)) {
      for (const el of node.exportClause.elements) if (!el.isTypeOnly) names.push((el.propertyName ?? el.name).text);
    }
  }
  return { names, namespaces };
}

function productionSources(): Source[] {
  return PRODUCTION.flatMap((dir) =>
    readdirSync(path.join(root, dir), { recursive: true, encoding: "utf8" })
      .filter((f) => /\.(ts|tsx|mjs|js)$/.test(f) && !f.split(path.sep).includes("node_modules"))
      .map((f) => path.join(dir, f))
      .filter((rel) => rel !== ENGINE)
      .map((rel) => ({ rel, text: readFileSync(path.join(root, rel), "utf8") }))
  );
}

function audit(engineText: string, sources: Source[]) {
  const { names, unreadable } = valueExports(engineText);
  const imported = new Set<string>();
  const importers = new Set<string>();
  const namespaces: string[] = [];
  for (const source of sources) {
    const found = engineImports(source);
    found.names.forEach((n) => imported.add(n));
    if (found.names.length > 0) importers.add(source.rel);
    namespaces.push(...found.namespaces);
  }
  return { names, unreadable, namespaces, importers, unimported: names.filter((n) => !imported.has(n)) };
}

const engineText = readFileSync(path.join(root, ENGINE), "utf8");
const sources = productionSources();

test("every value gameEngine.ts exports has a production importer", () => {
  const result = audit(engineText, sources);
  assert.ok(result.names.length >= 20, `scanned only ${result.names.length} engine exports`);
  assert.ok(result.importers.size >= 10, `found only ${result.importers.size} production files importing the engine`);
  assert.deepEqual(result.unreadable, [], "an engine export this scan cannot name");
  assert.deepEqual(result.namespaces, [], "a namespace import hides which engine exports a file uses");
  assert.deepEqual(
    result.unimported,
    [],
    "exported but imported by no production file: un-export it, and test it through what production calls"
  );
});

test("a planted export nobody imports is caught, and one production imports is not", () => {
  const planted = `${engineText}\nexport function plantedProbe() {}\nexport const plantedUsed = 1;\nexport const plantedTyped = 2;\n`;
  const importer: Source = {
    rel: path.join("lib", "probeImporter.ts"),
    text: 'import { plantedUsed, type plantedTyped } from "./game/gameEngine.ts";\n',
  };
  assert.deepEqual(audit(planted, [...sources, importer]).unimported, ["plantedProbe", "plantedTyped"]);
});

test("an export form the scan cannot name, or a namespace import, is reported rather than passed", () => {
  const result = audit(`${engineText}\nexport { plantedProbe as renamed };\n`, [
    { rel: path.join("lib", "probeNamespace.ts"), text: 'import * as engine from "./game/gameEngine.ts";\n' },
  ]);
  assert.equal(result.unreadable.length, 1);
  assert.deepEqual(result.namespaces, [path.join("lib", "probeNamespace.ts")]);
});
