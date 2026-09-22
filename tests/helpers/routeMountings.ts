import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

const ROUTES_FILE = path.resolve(import.meta.dirname, "..", "..", "server", "http", "routes.ts");
const HTTP_VERBS = new Set(["get", "post", "put", "delete", "patch"]);

export interface RouteMounting {
  /** `POST /api/friends/add`, or the verb and `<non-literal>` when the path is not a string literal. */
  route: string;
  /** The bare identifiers passed after the path: the middleware the route names. */
  middleware: string[];
}

/** Every `app.<verb>(…)` call in server/http/routes.ts, in source order. */
export function routeMountings(): RouteMounting[] {
  const source = readFileSync(ROUTES_FILE, "utf8");
  const file = ts.createSourceFile(ROUTES_FILE, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const found: RouteMounting[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "app" &&
      HTTP_VERBS.has(node.expression.name.text)
    ) {
      const [routePath, ...rest] = node.arguments;
      const where = routePath && ts.isStringLiteral(routePath) ? routePath.text : "<non-literal>";
      found.push({
        route: `${node.expression.name.text.toUpperCase()} ${where}`,
        middleware: rest.filter(ts.isIdentifier).map((arg) => arg.text),
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}
