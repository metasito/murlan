import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import ts from "typescript";
import { sourcesUnder } from "../helpers/sourceScan.ts";

// The rules model is written from docs/GAME-RULES.md alone (docs/adr/0012-a-rules-model-is-a-test-oracle.md):
// at runtime it reaches nothing outside tests/model/, and only the engine's Card and Combination
// types may be named. Its *.test.ts files are the comparison, which must import the engine.

const root = path.resolve(import.meta.dirname, "..", "..");
const MODEL = path.join(root, "tests", "model");
const TYPES_ALLOWED = new Set(["Card", "Combination"]);

interface Import {
  spec: string | null;
  text: string;
  typeOnly: boolean;
  names: string[];
}

function scan(file: string, source: string): Import[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const imports: Import[] = [];
  const add = (specNode: ts.Expression, typeOnly: boolean, names: string[] = []) =>
    imports.push({ spec: ts.isStringLiteralLike(specNode) ? specNode.text : null, text: specNode.getText(sf), typeOnly, names });
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause;
      const bindings = clause?.namedBindings;
      const named = bindings && ts.isNamedImports(bindings) ? bindings.elements : [];
      const allTypes = clause?.isTypeOnly === true || (named.length > 0 && !clause?.name && named.every((e) => e.isTypeOnly));
      const names = [...(clause?.name ? [clause.name.text] : []), ...(bindings && ts.isNamespaceImport(bindings) ? ["*"] : []), ...named.map((e) => (e.propertyName ?? e.name).text)];
      add(node.moduleSpecifier, allTypes, names);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      add(node.moduleSpecifier, node.isTypeOnly, ["*"]);
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      add(node.moduleReference.expression, node.isTypeOnly, ["*"]);
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require")) &&
      node.arguments.length > 0
    ) {
      add(node.arguments[0], false);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return imports;
}

const insideModel = (file: string, spec: string) => spec.startsWith(".") && path.resolve(path.dirname(file), spec).startsWith(MODEL + path.sep);

function offenders(file: string, imports: Import[]): string[] {
  const at = (i: Import, why: string) => `${path.relative(root, file)} -> ${i.spec ?? `<non-literal ${i.text}>`} (${why})`;
  return imports.flatMap((i) => {
    if (i.spec !== null && insideModel(file, i.spec)) return [];
    if (!i.typeOnly) return [at(i, "runtime import")];
    const extra = i.names.filter((name) => !TYPES_ALLOWED.has(name));
    return extra.length > 0 ? [at(i, `types other than Card and Combination: ${extra.join(", ")}`)] : [];
  });
}

const modelSources = sourcesUnder(root, ["tests/model"]).filter(([rel]) => !rel.endsWith(".test.ts"));

test("the rules model imports nothing outside tests/model at runtime", () => {
  const scanned = modelSources.map(([rel]) => rel);
  assert.ok(scanned.includes("tests/model/rules.ts"), `the scan did not reach tests/model/rules.ts; it scanned ${scanned.join(", ") || "nothing"}`);
  const rules = modelSources.find(([rel]) => rel === "tests/model/rules.ts")![1];
  for (const decision of ["deck", "classify", "beats", "legalPlays", "opening", "step", "givebackOptions", "exchange"]) {
    assert.match(rules, new RegExp(`export function ${decision}\\b|export const ${decision}\\b`), `tests/model/rules.ts no longer exports ${decision}`);
  }
  assert.deepEqual(modelSources.flatMap(([rel, text]) => offenders(path.join(root, rel), scan(path.join(root, rel), text))), []);
});

test("a planted import from outside the model is caught, and a type-only Card or Combination is not", () => {
  const probe = path.join(MODEL, "__independenceProbe.ts");
  const engine = ["..", "..", "lib", "game", "gameEngine.ts"].join("/");
  const planted = scan(
    probe,
    [
      `import { buildCombination } from "${engine}";`,
      `import { type Card, buildCombination as b } from "${engine}";`,
      `import * as engine from "${engine}";`,
      `import { mulberry32 } from "../support/game.ts";`,
      `const late = await import("${engine}");`,
      `const req = require("${engine}");`,
      "const dyn = await import(`../../lib/${name}`);",
      `import type { Card, Combination } from "${engine}";`,
      `import { type Card as C } from "${engine}";`,
      `import type { GameState } from "${engine}";`,
      `import { SILENT } from "./rules.ts";`,
    ].join("\n")
  );
  assert.equal(planted.length, 11);
  const at = (spec: string, why: string) => `tests/model/__independenceProbe.ts -> ${spec} (${why})`;
  assert.deepEqual(offenders(probe, planted), [
    at(engine, "runtime import"),
    at(engine, "runtime import"),
    at(engine, "runtime import"),
    at("../support/game.ts", "runtime import"),
    at(engine, "runtime import"),
    at(engine, "runtime import"),
    at("<non-literal `../../lib/${name}`>", "runtime import"),
    at(engine, "types other than Card and Combination: GameState"),
  ]);
});
