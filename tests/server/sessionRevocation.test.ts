// A socket outlives the session that opened it, so every route that ends a
// session must also end that session's sockets (server/socket/socketRegistry.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { routeSources } from "../helpers/routeSources.ts";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

function sessionDeleters(): Set<string> {
  const names = new Set<string>();
  for (const entry of readdirSync(new URL("../../server/", import.meta.url), { recursive: true, encoding: "utf8" })) {
    const file = entry.replaceAll("\\", "/");
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
  const starts = [...source.matchAll(/(?:\bon(?:SignedIn)?\(\s*app,|app\.(?:get|post|put|patch|delete)\()\s*"([^"]+)"/g)];
  return starts.map((m, i) => ({
    route: m[1]!,
    body: source.slice(m.index, starts[i + 1]?.index ?? source.length),
  }));
}

/** The body of `export function name(` in `source`, up to its closing brace at column 0. */
function functionBody(source: string, name: string): string {
  const body = source.slice(source.indexOf(`export function ${name}(`));
  return body.slice(0, body.indexOf("\n}\n"));
}

// accountSession's signIn regenerates the session, and is proved below to revoke the prior
// session's sockets, so a route calling it both ends a session and revokes.
const SESSION_ENDING = /\.session\.(?:destroy|regenerate)\(|\bsignIn\(/;
const REVOKING = /\b(?:revokeAccountSockets|evictUser|signIn)\(/;

function unrevokedRoutes(routeFiles: string[], deleters: Set<string>, revoking: RegExp = REVOKING) {
  const endsSession = (body: string) =>
    SESSION_ENDING.test(body) || [...deleters].some((name) => new RegExp(`\\b${name}\\(`).test(body));
  const sessionRoutes = routeFiles.flatMap(routeBlocks).filter((b) => endsSession(b.body));
  return {
    sessionRoutes: sessionRoutes.map((b) => b.route),
    unrevoked: sessionRoutes.filter((b) => !new RegExp(revoking.source).test(b.body)).map((b) => b.route),
  };
}

const routes = () => routeSources().map((s) => s.text);

test("the scan finds the functions that delete sessions", () => {
  const deleters = sessionDeleters();
  for (const name of ["changePassword", "resetPassword", "deleteUser"]) {
    assert.ok(deleters.has(name), `${name} not found among ${[...deleters]}`);
  }
});

test("evictUser revokes the account's sockets", () => {
  const registry = read("server/socket/socketRegistry.ts");
  const body = registry.slice(registry.indexOf("export async function evictUser("));
  const end = body.indexOf("\n}\n");
  assert.match(body.slice(0, end), /\brevokeAccountSockets\(/);
});

test("signIn regenerates the session and revokes the prior session's sockets", () => {
  const signIn = functionBody(read("server/http/accountSession.ts"), "signIn");
  assert.match(signIn, /\.session\.regenerate\(/);
  assert.match(signIn, /\brevokeAccountSockets\(/);
});

test("every route that ends a session also revokes its sockets", () => {
  const source = routes();
  const { sessionRoutes, unrevoked } = unrevokedRoutes(source, sessionDeleters());
  assert.ok(sessionRoutes.length >= 6, `only found ${sessionRoutes.join(", ")}`);
  for (const route of ["POST /api/auth/register", "POST /api/auth/login"]) {
    assert.ok(sessionRoutes.includes(route), `${route} signs in, so it ends the prior session`);
  }
  assert.deepEqual(unrevoked, []);

  const direct = /\b(?:revokeAccountSockets|evictUser)\(/g;
  assert.deepEqual(
    unrevokedRoutes(source.map((text) => text.replace(direct, "noop(")), sessionDeleters(), direct).unrevoked,
    sessionRoutes,
    "with signIn not counted as revoking and every direct revoke stripped, every session route must read as unrevoked"
  );
});
