// A socket outlives the session that opened it, so every route that ends a
// session must also end that session's sockets (server/socketRegistry.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

function sessionDeleters(): Set<string> {
  const names = new Set<string>();
  for (const file of readdirSync(new URL("../server/", import.meta.url))) {
    if (!file.endsWith(".ts")) continue;
    const source = read(`server/${file}`);
    for (const hit of source.matchAll(/sql`\s*DELETE FROM session\b/g)) {
      const before = source.slice(0, hit.index);
      const decls = [...before.matchAll(/(?:async\s+|function\s+)(\w+)\s*\(/g)];
      const name = decls.at(-1)?.[1];
      if (name) names.add(name);
    }
  }
  return names;
}

function routeBlocks(source: string): { route: string; body: string }[] {
  const starts = [...source.matchAll(/app\.(?:get|post|put|patch|delete)\(\s*"([^"]+)"/g)];
  return starts.map((m, i) => ({
    route: m[1]!,
    body: source.slice(m.index, starts[i + 1]?.index ?? source.length),
  }));
}

function unrevokedRoutes(routesSource: string, deleters: Set<string>) {
  const endsSession = (body: string) =>
    /\.session\.(?:destroy|regenerate)\(/.test(body) ||
    [...deleters].some((name) => new RegExp(`\\b${name}\\(`).test(body));
  const sessionRoutes = routeBlocks(routesSource).filter((b) => endsSession(b.body));
  return {
    sessionRoutes: sessionRoutes.map((b) => b.route),
    unrevoked: sessionRoutes
      .filter((b) => !/\b(?:revokeAccountSockets|evictUser)\(/.test(b.body))
      .map((b) => b.route),
  };
}

test("the scan finds the functions that delete sessions", () => {
  const deleters = sessionDeleters();
  for (const name of ["changePassword", "resetPassword", "deleteUser"]) {
    assert.ok(deleters.has(name), `${name} not found among ${[...deleters]}`);
  }
});

test("evictUser revokes the account's sockets", () => {
  const registry = read("server/socketRegistry.ts");
  const body = registry.slice(registry.indexOf("export async function evictUser("));
  const end = body.indexOf("\n}\n");
  assert.match(body.slice(0, end), /\brevokeAccountSockets\(/);
});

test("every route that ends a session also revokes its sockets", () => {
  const routes = read("server/routes.ts");
  const { sessionRoutes, unrevoked } = unrevokedRoutes(routes, sessionDeleters());
  assert.ok(sessionRoutes.length >= 6, `only found ${sessionRoutes.join(", ")}`);
  assert.deepEqual(unrevoked, []);

  const stripped = routes.replace(/\b(?:revokeAccountSockets|evictUser)\(/g, "noop(");
  assert.deepEqual(unrevokedRoutes(stripped, sessionDeleters()).unrevoked, sessionRoutes);
});
