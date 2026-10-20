// `server/game` is the table; `socket/` and `http/` are transports above it. Each edge
// upward is listed by name, so a new one and a removed one both fail here.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import ts from "typescript";
import { sourcesUnder } from "../helpers/sourceScan.ts";

const REPO = path.resolve(import.meta.dirname, "..", "..");
const UPWARD = /^\.\.\/(socket|http)\//;

function specifiers(file: string, text: string): string[] {
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      if (ts.isStringLiteral(node.moduleSpecifier)) found.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      found.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true));
  return found;
}

test("server/game reaches socket/ and http/ only through these edges", () => {
  const edges = sourcesUnder(REPO, ["server/game"])
    .flatMap(([file, text]) =>
      specifiers(file, text)
        .filter((spec) => UPWARD.test(spec))
        .map((spec) => `${path.posix.basename(file)} -> ${spec.slice(3)}`)
    )
    .sort();
  assert.deepEqual(edges, [
    "gamePersistence.ts -> http/clock.ts",
    "gameTimers.ts -> http/clock.ts",
    "gameTimers.ts -> http/testOnlyEnv.ts",
    "gameTurn.ts -> http/clock.ts",
    "ratings.ts -> http/clock.ts",
    "retention.ts -> http/bugReports.ts",
    "retention.ts -> http/clientErrors.ts",
    "retention.ts -> http/clock.ts",
    "retention.ts -> http/serverErrors.ts",
    "retention.ts -> socket/ticket.ts",
    "roundOver.ts -> http/clock.ts",
    "stats.ts -> http/clock.ts",
    "tableHandlers.ts -> socket/socketTable.ts",
    "tableLifecycle.ts -> socket/seating.ts",
    "tableLifecycle.ts -> socket/socketTable.ts",
    "tableRouter.ts -> http/clock.ts",
    "tableRuntime.ts -> socket/socketTypes.ts",
  ]);
});
