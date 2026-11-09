import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import ts from "typescript";
import path from "node:path";
import { ALIASES, localPath, resolveSpecifier } from "../helpers/specifiers.ts";
import { moduleEdges } from "../helpers/moduleEdges.ts";

const root = path.resolve(import.meta.dirname, "..", "..");

test("every path mapping the project declares resolves, from any file, to the directory it names", () => {
  assert.ok(ALIASES.length >= 2);
  assert.equal(localPath("lib/theme.ts", "@/components/x"), "components/x");
  assert.equal(localPath("lib/theme.ts", "@shared/y"), "shared/y");
  assert.equal(localPath("lib/game/gameEngine.ts", "../b"), "lib/b");
  assert.equal(localPath("lib/theme.ts", "react"), null);
  assert.equal(localPath("lib/theme.ts", "node:fs"), null);
});

test("a specifier that is no relative path, mapped path or installed package is red", () => {
  assert.throws(() => resolveSpecifier("lib/theme.ts", "~/lib/x"), /no relative path, no mapped path/);
  assert.throws(() => resolveSpecifier("lib/theme.ts", "@nowhere/pkg"), /no relative path/);
});

test("the import-equals form is an edge", () => {
  const edges = moduleEdges("lib/theme.ts", 'import b = require("@shared/b");\nimport c = require("./c");');
  assert.deepEqual(edges.map((e) => e.to), ["shared/b", "lib/c"]);
});

const SHARED = ["tests/helpers/specifiers", "tests/helpers/moduleEdges", "scripts/lib/pathMappings"];
const PREFIXES: string[] = ALIASES.map(([prefix]) => prefix);
const QUOTE = String.raw`(?:\[["']+\]|["'])`;
const SPECIFIER_REGEX = [
  String.raw`${QUOTE}(\(\?:|\()?\[\^["']`,
  String.raw`${QUOTE}(\(\?:|\()?\[\.\/\]`,
  String.raw`${QUOTE}\(\\\.(\{\d,\d\})?(\\\/)?\[\^`,
  String.raw`${QUOTE}\(\?:\\\.\\\/`,
  String.raw`\|@\\\/`,
].map((p) => new RegExp(p));
const ANCHORED_UP = new RegExp(String.raw`\^\\\.\\\.\\\/`);

/** What a test does to a specifier by hand: tests it for a mapped or relative prefix, or pulls one out of source text with a pattern. */
function handSpelled(file: string, text: string): string[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "startsWith" && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) {
      const prefix = node.arguments[0].text;
      const relative = prefix === "./" || prefix === "../" || ((prefix === "." || prefix === "..") && /spec/i.test(node.expression.expression.getText()));
      if (PREFIXES.includes(prefix) || relative) found.push(`startsWith(${JSON.stringify(prefix)})`);
    }
    if (ts.isArrayLiteralExpression(node) && node.elements.some((e) => ts.isStringLiteralLike(e) && PREFIXES.includes(e.text))) found.push("a list of alias prefixes");
    if (ts.isRegularExpressionLiteral(node)) {
      const pattern = node.text.replace(/(?<!\()\[\^["']+\][*+](?=["']|\[["']+\])/g, "");
      if ((/\b(from|import|require)\b/.test(pattern) && SPECIFIER_REGEX.some((r) => r.test(pattern))) || ANCHORED_UP.test(pattern)) found.push(`the pattern ${node.text}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** Whether the file imports the shared resolver, by whatever path it spells. */
function usesSharedResolver(file: string, text: string): boolean {
  return moduleEdges(file, text, { types: true }).some((e) => e.local && SHARED.includes(e.to));
}

test("a test that reads import specifiers by hand is red unless it goes through the shared resolver", () => {
  const files = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", "tests"], { cwd: root, encoding: "utf8" })
    .split("\0")
    .filter((f) => /\.tsx?$/.test(f) && existsSync(path.join(root, f)));
  assert.ok(files.length > 300, "the scan finds the tests it guards");
  const bypasses = files.flatMap((f) => {
    const text = readFileSync(path.join(root, f), "utf8");
    const spelled = handSpelled(f, text);
    return spelled.length && !usesSharedResolver(f, text) ? [`${f}: ${spelled.join(", ")}`] : [];
  });
  assert.deepEqual(bypasses, []);
});

test("the discovery sees each way of reading a specifier by hand, and lets a file that routes through the resolver be", () => {
  const spell = (body: string) => handSpelled("tests/tooling/specifiers.test.ts", body);
  assert.equal(spell('const a = (s: string) => s.startsWith("@/");').length, 1);
  assert.equal(spell('const a = (s: string) => s.startsWith("../");').length, 1);
  assert.equal(spell('const a = (specifier: string) => specifier.startsWith(".");').length, 1);
  assert.equal(spell('const a = [["@shared/", "shared"]];').length, 1);
  assert.equal(spell("const a = [...t.matchAll(/from\\s+[\"']([^\"']+)[\"']/g)];").length, 1);
  assert.equal(spell('const a = /^\\.\\.\\/(socket|http)\\//;').length, 1);
  assert.equal(spell("const a = /from\\s+[\"'](?:\\.\\/|@\\/lib\\/)bot[\"']/;").length, 1);
  assert.equal(spell('const a = name.startsWith(".claude");').length, 0);
  assert.equal(spell("const a = /\\b(?:from|import)\\s*\\(?\\s*[\"'][^\"']*[\"']/g;").length, 0);
  assert.equal(usesSharedResolver("tests/tooling/specifiers.test.ts", 'import { localPath } from "./helpers/specifiers.ts";'), false);
  assert.equal(usesSharedResolver("tests/tooling/specifiers.test.ts", 'import { localPath } from "../helpers/specifiers.ts";'), true);
  assert.equal(usesSharedResolver("tests/tooling/specifiers.test.ts", 'import { moduleEdges } from "@/tests/helpers/moduleEdges";'), true);
  assert.equal(usesSharedResolver("tests/tooling/specifiers.test.ts", 'import { ALIASES } from "../../scripts/lib/pathMappings.mjs";'), true);
  assert.equal(usesSharedResolver("tests/tooling/specifiers.test.ts", 'import path from "node:path";'), false);
});

test("a specifier the resolver cannot place is red in the edge scan too", () => {
  assert.throws(() => moduleEdges("lib/theme.ts", 'import "~/lib/x";'), /no relative path, no mapped path/);
  assert.throws(() => moduleEdges("lib/theme.ts", 'jest.mock("@nowhere/pkg");'), /no relative path/);
  assert.equal(moduleEdges("lib/theme.ts", 'import "react";')[0].local, false);
});

test("a string ending in `from` is no import", () => {
  assert.deepEqual(moduleEdges("lib/theme.ts", 'export const a = "give back from";\nexport const b = "x";\n'), []);
});
