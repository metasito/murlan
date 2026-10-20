import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

const ROUTES_DIR = path.resolve(import.meta.dirname, "..", "..", "server", "http", "routes");

/** Area files, at least this many: a scan of an emptied or renamed directory must fail, not pass. */
const AREA_FLOOR = 7;

export interface RouteSource {
  /** Relative to the routes directory, e.g. `auth.ts`. */
  file: string;
  text: string;
  sourceFile: ts.SourceFile;
}

/** Every area file under the routes directory, read from disk. */
export function routeSources(): RouteSource[] {
  const files = readdirSync(ROUTES_DIR).filter((f) => f.endsWith(".ts"));
  if (files.length < AREA_FLOOR) throw new Error(`only ${files.length} route files found under ${ROUTES_DIR}`);
  return files.map((file) => {
    const text = readFileSync(path.join(ROUTES_DIR, file), "utf8");
    return { file, text, sourceFile: ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS) };
  });
}

export interface RouteCall {
  /** `POST /api/friends/add`. */
  route: string;
  /** The bare identifiers passed after the key: the middleware the route names. */
  middleware: string[];
  /** The last argument: the route's handler. */
  handler: ts.Node | undefined;
  call: ts.CallExpression;
  sourceFile: ts.SourceFile;
}

const VERBS = new Set(["get", "post", "put", "delete", "patch"]);

/**
 * Every mounting in `sourceFile`: `on(app, "KEY", …)`, `onSignedIn(app, "KEY", …)`, and a plain
 * `app.<verb>("/path", …)`, in source order.
 */
export function routeCalls(sourceFile: ts.SourceFile): RouteCall[] {
  const found: RouteCall[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      let key: ts.Expression | undefined;
      let rest: readonly ts.Expression[] = [];
      let verb: string | undefined;
      if (ts.isIdentifier(callee) && (callee.text === "on" || callee.text === "onSignedIn")) {
        [, key, ...rest] = node.arguments;
      } else if (
        ts.isPropertyAccessExpression(callee) &&
        ts.isIdentifier(callee.expression) &&
        callee.expression.text === "app" &&
        VERBS.has(callee.name.text)
      ) {
        verb = callee.name.text.toUpperCase();
        [key, ...rest] = node.arguments;
      }
      if (key) {
        const literal = ts.isStringLiteral(key) ? key.text : "<non-literal>";
        const last = rest[rest.length - 1];
        found.push({
          route: verb ? `${verb} ${literal}` : literal,
          middleware: rest.filter(ts.isIdentifier).map((arg) => arg.text),
          handler: last && (ts.isArrowFunction(last) || ts.isFunctionExpression(last)) ? last : undefined,
          call: node,
          sourceFile,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

/** Every mounting across the routes directory. */
export function allRouteCalls(): RouteCall[] {
  return routeSources().flatMap((s) => routeCalls(s.sourceFile));
}
