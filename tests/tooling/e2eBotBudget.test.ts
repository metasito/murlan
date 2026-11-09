import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

const bot = readFileSync(path.resolve(import.meta.dirname, "..", "e2e", "helpers", "bot.ts"), "utf8");

const timeoutArguments = (text: string): string[] => {
  const source = ts.createSourceFile("bot.ts", text, ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "giocaAccepts") found.push(node.arguments.slice(1).map((a) => a.getText(source)).join(", "));
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
};

test("every read of GIOCA's label waits the helper's own click budget, never a number or a constant of its own", () => {
  const reads = timeoutArguments(bot);
  assert.ok(reads.length >= 2, "the scan finds the reads it guards");
  assert.deepEqual(
    reads.filter((args) => args !== "" && args !== "CARD_CLICK_TIMEOUT_MS"),
    [],
    "a fixed wait on GIOCA runs out on a throttled table and reports an unplayable hand"
  );
  assert.deepEqual(timeoutArguments("giocaAccepts(page, ONE_SECOND); giocaAccepts(page, 2_000); giocaAccepts(page, t); giocaAccepts(page);"), ["ONE_SECOND", "2_000", "t", ""]);
});
