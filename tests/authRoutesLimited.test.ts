// tests/authRoutesLimited.test.ts — #892: rate limiting is a per-route
// decision with no enforced default. Two `/api/auth/*` routes shipped with
// none at all (verify-email, change-password) and were only found by a
// review agent reading every mounting by hand. This is that reading, done
// once and pinned: every `app.<verb>("/api/auth/…", …)` call in
// server/routes.ts must name at least one `*Limiter` identifier in its
// argument list, with three named, deliberate exceptions.
//
// The exact set of discovered paths is asserted against a written list —
// RULES §6's decoy failure mode is a scan that matches nothing and passes,
// so a route that stops being found this way has to fail as loudly as one
// that arrives unprotected.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import ts from "typescript";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROUTES_FILE = path.join(REPO_ROOT, "server", "routes.ts");

const HTTP_VERBS = new Set(["get", "post", "put", "delete", "patch"]);

/**
 * Routes deliberately left without a rate limiter, and why — see #892's
 * design doc. Any `/api/auth/*` mounting not in this set must name a
 * `*Limiter` identifier among its arguments.
 */
const NO_LIMITER_BY_DESIGN = new Set([
  // Destroys the session; there is nothing here to amplify or brute-force.
  "/api/auth/logout",
  // A read of the caller's own session — cheap, and answers 401 for anyone
  // without one. No account or provider cost an attacker can spend.
  "/api/auth/me",
  // Self-limiting: a second call 409s EMAIL_ALREADY_SET before doing any
  // work, once the first has set the account's email.
  "/api/auth/add-email",
]);

/** Every `/api/auth/*` route mounting in server/routes.ts, with whether it names a `*Limiter`. */
function authRouteMountings(): { path: string; hasLimiter: boolean }[] {
  const source = readFileSync(ROUTES_FILE, "utf8");
  const sourceFile = ts.createSourceFile(ROUTES_FILE, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const found: { path: string; hasLimiter: boolean }[] = [];

  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "app" &&
      HTTP_VERBS.has(node.expression.name.text)
    ) {
      const [routePath, ...rest] = node.arguments;
      if (routePath && ts.isStringLiteral(routePath) && routePath.text.startsWith("/api/auth/")) {
        const hasLimiter = rest.some((arg) => ts.isIdentifier(arg) && /Limiter$/.test(arg.text));
        found.push({ path: routePath.text, hasLimiter });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

test("every unlimited /api/auth/* route is a named exception, and no others exist", () => {
  const mountings = authRouteMountings();

  assert.deepEqual(
    mountings.map((m) => m.path).sort(),
    [
      "/api/auth/add-email",
      "/api/auth/change-password",
      "/api/auth/login",
      "/api/auth/logout",
      "/api/auth/me",
      "/api/auth/register",
      "/api/auth/reset-password",
      "/api/auth/socket-ticket",
      "/api/auth/verify-email",
      "/api/auth/request-password-reset",
    ].sort(),
    "the set of /api/auth/* mountings the scan finds has changed — update " +
      "this list (and NO_LIMITER_BY_DESIGN, if the change is a deliberate " +
      "new exception) rather than widening the assertion to pass"
  );

  const unprotected = mountings.filter((m) => !m.hasLimiter && !NO_LIMITER_BY_DESIGN.has(m.path));
  assert.deepEqual(
    unprotected.map((m) => m.path),
    [],
    "an /api/auth/* route with no *Limiter in its argument list, and not " +
      "in NO_LIMITER_BY_DESIGN — #892 was two of these found only by a " +
      "human reading every mounting"
  );
});
