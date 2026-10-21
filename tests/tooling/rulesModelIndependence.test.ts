import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import ts from "typescript";
import { sourcesUnder } from "../helpers/sourceScan.ts";

// docs/adr/0012-a-rules-model-is-a-test-oracle.md

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

const CALLER_DIRS = ["app", "components", "context", "lib", "modules", "plugins", "scripts", "server", "shared", "tools"];

function reachesModel(file: string, spec: string | null): boolean {
  if (spec === null) return false;
  const target = spec.startsWith(".") ? path.resolve(path.dirname(file), spec) : spec.startsWith("@/") ? path.join(root, spec.slice(2)) : null;
  return target !== null && (target === MODEL || target.startsWith(MODEL + path.sep));
}

const callers = (file: string, imports: Import[]) => imports.filter((i) => reachesModel(file, i.spec)).map((i) => `${path.relative(root, file)} -> ${i.spec}`);

test("nothing outside tests/ imports the rules model", () => {
  const sources = sourcesUnder(root, CALLER_DIRS, /\.[cm]?[jt]sx?$/);
  const scanned = sources.map(([rel]) => rel);
  assert.ok(scanned.includes("lib/game/gameEngine.ts") && scanned.includes("server/game/gameTurn.ts"), `the reverse scan missed the engine or the server; it scanned ${scanned.length} files`);
  assert.ok(sources.length >= 300, `the reverse scan read ${sources.length} files, below the floor of 300`);
  assert.deepEqual(sources.flatMap(([rel, text]) => callers(path.join(root, rel), scan(path.join(root, rel), text))), []);
});

test("a planted import of the model from outside tests/ is caught", () => {
  const probe = path.join(root, "lib", "game", "__modelCallerProbe.ts");
  const planted = scan(
    probe,
    [
      `import { classify } from "../../tests/model/rules.ts";`,
      `import type { Silent } from "@/tests/model/rules";`,
      `const late = await import("../../tests/model/rules.ts");`,
      `import { mulberry32 } from "../../tests/support/game.ts";`,
      `import { buildCombination } from "./gameEngine.ts";`,
    ].join("\n")
  );
  const from = path.relative(root, probe);
  assert.deepEqual(callers(probe, planted), [`${from} -> ../../tests/model/rules.ts`, `${from} -> @/tests/model/rules`, `${from} -> ../../tests/model/rules.ts`]);
});
