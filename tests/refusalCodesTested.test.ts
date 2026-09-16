import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { sourcesUnder } from "./helpers/sourceScan.ts";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const SELF = path.basename(import.meta.filename);

/** Every string literal inside the `code` of an object literal that also says `ok: false`. */
function refusalCodes(): Map<string, string> {
  const codes = new Map<string, string>();
  for (const file of readdirSync(path.join(REPO_ROOT, "server")).filter((f) => f.endsWith(".ts"))) {
    const source = readFileSync(path.join(REPO_ROOT, "server", file), "utf8");
    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const visit = (node: ts.Node) => {
      if (ts.isObjectLiteralExpression(node)) {
        const prop = (name: string) =>
          node.properties.find(
            (p): p is ts.PropertyAssignment =>
              ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === name
          );
        const ok = prop("ok");
        const code = prop("code");
        if (ok?.initializer.kind === ts.SyntaxKind.FalseKeyword && code) {
          const collect = (n: ts.Node) => {
            if (ts.isStringLiteral(n)) codes.set(n.text, `server/${file}`);
            ts.forEachChild(n, collect);
          };
          collect(code.initializer);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return codes;
}

test("every refusal code the server returns is named by a test", () => {
  const codes = refusalCodes();
  for (const known of ["NOT_THE_HOST", "NOT_YOUR_EXCHANGE", "ROOM_NOT_WAITING", "TABLE_UNREACHABLE"]) {
    assert.ok(codes.has(known), `the scan no longer finds ${known}, so it is not reading what it claims to`);
  }

  const tests = sourcesUnder(REPO_ROOT, ["tests"], /\.(ts|tsx|mjs)$/)
    .filter(([file]) => path.basename(file) !== SELF)
    .map(([, source]) => source)
    .join("\n");
  const untested = [...codes]
    .filter(([code]) => !new RegExp(`["'\`]${code}["'\`]`).test(tests))
    .map(([code, where]) => `${code} (${where})`);
  assert.deepEqual(untested, [], "a refusal no test provokes is a guard a refactor can delete with CI green");
});
