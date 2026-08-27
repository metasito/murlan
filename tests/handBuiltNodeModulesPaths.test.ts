// tests/handBuiltNodeModulesPaths.test.ts — no script or test locates an
// installed package by joining a repo root onto the literal string
// "node_modules"; every such site asks Node to resolve the package instead
// (`require.resolve` / `import.meta.resolve`). A hand-built join assumes
// node_modules/ sits directly beneath the root it was joined onto, which is
// false in a git worktree — deliberately created with no node_modules of its
// own — so every one of these breaks there while working from a plain
// checkout. See issue #275.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import ts from "typescript";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Build output and vendored code. Anything unrecognised is scanned. */
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "server_dist",
  "static-build",
  "test-results",
  "playwright-report",
]);

/**
 * tests/typeSuppressions.test.ts carries "node_modules" as a directory name
 * in its own walk's skip-list — a name to not descend into, never a path
 * resolved to find where a package lives. That is the one site this scan
 * must not flag; #275 names it explicitly as correct and untouched.
 */
const IGNORE_LIST = new Set(["tests/typeSuppressions.test.ts"]);

function sourceFiles(dir: string): string[] {
  return readdirSync(path.join(repoRoot, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) {
      return e.name.startsWith(".") || SKIP_DIRS.has(e.name) ? [] : sourceFiles(rel);
    }
    return /\.(ts|tsx|mjs|js)$/.test(e.name) ? [rel] : [];
  });
}

interface HandBuiltJoin {
  line: number;
  text: string;
}

/** The local names bound to node:path's `join`/`resolve`, however this file imports them. */
function pathBindings(sf: ts.SourceFile) {
  const objectNames = new Set<string>(); // `path` in `path.join(...)`
  const fnNames = new Set<string>(); // `join` in `join(...)`, from a named import
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    if (stmt.moduleSpecifier.text !== "path" && stmt.moduleSpecifier.text !== "node:path") continue;
    const clause = stmt.importClause;
    if (!clause) continue;
    if (clause.name) objectNames.add(clause.name.text); // default import
    const bindings = clause.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) objectNames.add(bindings.name.text);
    if (bindings && ts.isNamedImports(bindings)) {
      for (const el of bindings.elements) {
        const imported = (el.propertyName ?? el.name).text;
        if (imported === "join" || imported === "resolve") fnNames.add(el.name.text);
      }
    }
  }
  return { objectNames, fnNames };
}

/** A string/template literal that is, or opens with, a "node_modules" path segment. */
function isNodeModulesLiteral(node: ts.Node): boolean {
  if (!ts.isStringLiteral(node) && !ts.isNoSubstitutionTemplateLiteral(node)) return false;
  return node.text === "node_modules" || node.text.startsWith("node_modules/");
}

/**
 * Every `path.join(...)`/`path.resolve(...)` call in `source` that carries a
 * literal "node_modules" segment — the shape all seven sites in #275 shared.
 * Only `path`/`node:path`'s own `join`/`resolve` count, bound through
 * whichever import shape this file actually uses; `["node_modules"].join()`
 * is `Array.prototype.join`, not this.
 */
export function handBuiltNodeModulesJoins(source: string, filename = "snippet.ts"): HandBuiltJoin[] {
  const sf = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const { objectNames, fnNames } = pathBindings(sf);
  const found: HandBuiltJoin[] = [];

  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const isMethodCall =
        ts.isPropertyAccessExpression(callee) &&
        ts.isIdentifier(callee.expression) &&
        objectNames.has(callee.expression.text) &&
        (callee.name.text === "join" || callee.name.text === "resolve");
      const isNamedCall = ts.isIdentifier(callee) && fnNames.has(callee.text);

      if ((isMethodCall || isNamedCall) && node.arguments.some(isNodeModulesLiteral)) {
        found.push({
          line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
          text: node.getText(sf),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

test("the scan matches a hand-built node_modules join, spread across lines, and not an unrelated call", () => {
  const literal = handBuiltNodeModulesJoins(
    'import path from "node:path";\nconst x = path.join(ROOT, "node_modules", pkg, "index.js");\n'
  );
  assert.equal(literal.length, 1, 'a bare "node_modules" segment in path.join must be caught');

  const subpathPrefix = handBuiltNodeModulesJoins(
    'import path from "node:path";\n' +
      'const x = path.join(\n  repoRoot,\n  "node_modules/@expo/vector-icons/build/vendor/Fonts",\n  `${family}.ttf`\n);\n'
  );
  assert.equal(subpathPrefix.length, 1, 'a multi-line call with a "node_modules/…" prefix must be caught');

  const namedImport = handBuiltNodeModulesJoins(
    'import { join } from "node:path";\nconst x = join(cwd, "node_modules", "babel-preset-expo");\n'
  );
  assert.equal(namedImport.length, 1, "a named `join` import must be caught the same as `path.join`");

  const resolved = handBuiltNodeModulesJoins(
    'import path from "node:path";\nconst x = path.join(OUT_DIR, `${family}.ttf`);\n'
  );
  assert.deepEqual(resolved, [], "a path.join with no node_modules literal must not be flagged");

  const arrayJoin = handBuiltNodeModulesJoins('const x = ["node_modules", "x"].join("/");\n');
  assert.deepEqual(
    arrayJoin,
    [],
    "Array.prototype.join is not path.join, even when an element names node_modules"
  );

  const skipListEntry = handBuiltNodeModulesJoins(
    'const SKIP = new Set(["node_modules", "dist"]);\n'
  );
  assert.deepEqual(
    skipListEntry,
    [],
    "a directory name in a skip-list is not a path.join call at all"
  );
});

test("no file outside the ignore list hand-builds a node_modules path", () => {
  const files = sourceFiles(".")
    .map((f) => f.slice(2))
    .filter((f) => !IGNORE_LIST.has(f));
  assert.ok(files.length > 100, `only ${files.length} files scanned — the walk found nothing`);

  const found = files.flatMap((rel) => {
    const source = readFileSync(path.join(repoRoot, rel), "utf8");
    return handBuiltNodeModulesJoins(source, rel).map((h) => `${rel}:${h.line} — ${h.text}`);
  });

  assert.deepEqual(
    found,
    [],
    "each of these locates a package by joining a repo root onto the literal \"node_modules\" " +
      "instead of asking Node to resolve it (require.resolve / import.meta.resolve) — a git " +
      "worktree has no node_modules of its own and this join finds nothing there"
  );
});
