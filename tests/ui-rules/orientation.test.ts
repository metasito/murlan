// tests/ui-rules/orientation.test.ts — a player already holding the device in landscape
// must never be yanked into portrait. React Native's <Modal> defaults to
// supportedOrientations={["portrait"]} on iOS, so a modal opened in landscape
// rotates the whole app and leaves the screen underneath laid out for the old
// size — every tap then lands on nothing. Only the game table may force an
// orientation, and only to landscape, because it is the one screen that needs
// the width.
//
// components/AppModal.tsx is the only <Modal>, and the rest of this is lint guards in
// eslint.guards.cjs: `one-modal`, `modal-keeps-landscape`, `landscape-only` and
// `no-portrait-lock`.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import ts from "typescript";
import { localPath } from "../helpers/specifiers.ts";
import { sourcesUnder } from "../helpers/sourceScan.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("orientation is never narrowed behind the player's back", () => {
  test("the game table forces landscape, and is the only caller of the lock", () => {
    const lock = readFileSync(path.join(repoRoot, "lib", "device", "orientation.tsx"), "utf8");
    assert.match(lock, /export function useLandscapeLock\(/);
    assert.match(lock, /lockAsync\(\s*ScreenOrientation\.OrientationLock\.LANDSCAPE\s*\)/);
    const target = path.posix.join("lib", "device", "orientation");
    const bare = (p: string) => p.replace(/\.(tsx?|jsx?)$/, "").replace(/\/index$/, "");
    // Every way to reach a module's bindings; a clause of `null` takes all of them.
    const reaches = (file: string, text: string): { to: string; clause: string | null }[] => {
      const out: { to: string; clause: string | null }[] = [];
      const visit = (node: ts.Node) => {
        const spec = (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier : undefined;
        if (spec) {
          const to = localPath(file, spec.text);
          if (to !== null) out.push({ to: bare(to), clause: node.getText().slice(0, spec.getStart() - node.getStart()) });
        } else if (ts.isCallExpression(node) && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0]) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || node.expression.getText() === "require")) {
          const to = localPath(file, node.arguments[0].text);
          if (to !== null) out.push({ to: bare(to), clause: null });
        }
        ts.forEachChild(node, visit);
      };
      visit(ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS));
      return out;
    };
    const importers = sourcesUnder(repoRoot, ["app", "components", "context", "lib", "modules"])
      .filter(([f]) => bare(f) !== target)
      .filter(([f, text]) =>
        reaches(f, text).some(({ to, clause }) => to === target && (clause === null || /\*|\buseLandscapeLock\b/.test(clause)))
      )
      .map(([f]) => f);
    assert.deepEqual(importers, ["components/GameTable.tsx"]);
  });

  test("app.json leaves the app free to rotate", () => {
    const appJson = JSON.parse(
      readFileSync(path.join(repoRoot, "app.json"), "utf8")
    ) as { expo: { orientation?: string } };
    assert.equal(
      appJson.expo.orientation,
      "default",
      'app.json must stay orientation:"default" — pinning it to portrait would ' +
        "override every per-screen decision"
    );
  });
});
