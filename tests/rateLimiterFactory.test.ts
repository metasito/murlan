// tests/rateLimiterFactory.test.ts — #953: every limiter in server/routes.ts
// was its own 15-line `rateLimit({...})` literal, and `friendLimiter` is what
// that costs: it was the one clone whose author forgot `standardHeaders` /
// `legacyHeaders`, and nothing could see it. So the pin is on the class, not
// on that one limiter — a bare `rateLimit()` in routes.ts fails here, which is
// what makes the factory the only way to add the fourteenth.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import ts from "typescript";
import express from "express";
import type { AddressInfo } from "node:net";
import { accountLimiter } from "../server/rateLimit.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROUTES_FILE = path.join(REPO_ROOT, "server", "routes.ts");

/** Every `const <name>Limiter = <callee>(...)` in server/routes.ts. */
function limiterDeclarations(): { name: string; callee: string }[] {
  const source = readFileSync(ROUTES_FILE, "utf8");
  const sourceFile = ts.createSourceFile(ROUTES_FILE, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const found: { name: string; callee: string }[] = [];

  const visit = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      /Limiter$/.test(node.name.text) &&
      node.initializer &&
      ts.isCallExpression(node.initializer) &&
      ts.isIdentifier(node.initializer.expression)
    ) {
      found.push({ name: node.name.text, callee: node.initializer.expression.text });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

test("every limiter in server/routes.ts is built by the factory", () => {
  const declared = limiterDeclarations();

  // RULES §6: a scan that finds nothing passes. Pin the count, so a limiter
  // that stops being discovered fails as loudly as one built the old way.
  assert.equal(declared.length, 13, `expected 13 limiters, found ${declared.map((d) => d.name).join(", ")}`);

  const byHand = declared.filter((d) => d.callee !== "accountLimiter");
  assert.deepEqual(byHand, [], `these bypass accountLimiter: ${byHand.map((d) => `${d.name} = ${d.callee}()`).join(", ")}`);
});

test("server/routes.ts calls rateLimit() nowhere — the factory is the only caller", () => {
  const source = readFileSync(ROUTES_FILE, "utf8");
  assert.equal(/\brateLimit\s*\(/.test(source), false, "server/routes.ts still builds a limiter by hand");
});

/** Serve one limiter on GET /, and return calls that hit it. */
async function serve(limiter: express.RequestHandler) {
  const app = express();
  app.get("/", limiter, (_req, res) => {
    res.json({ ok: true });
  });
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    get: (headers: Record<string, string> = {}) => fetch(`http://127.0.0.1:${port}/`, { headers }),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

test("a limiter from the factory sends standard headers and no legacy ones", async () => {
  const { get, close } = await serve(accountLimiter({ windowMs: 60_000, defaultMax: 1, message: { code: "RATE_LIMITED" } }));
  try {
    const first = await get();
    assert.equal(first.status, 200);
    assert.ok(first.headers.get("ratelimit-limit"), "no standard RateLimit header");
    assert.equal(first.headers.get("x-ratelimit-limit"), null, "legacy X-RateLimit header still sent");

    const second = await get();
    assert.equal(second.status, 429);
    assert.deepEqual(await second.json(), { code: "RATE_LIMITED" });
  } finally {
    await close();
  }
});

test("defaultMax gives way to a valid env var, and survives a junk one", async () => {
  process.env.MURLAN_TEST_RATE_LIMIT = "2";
  const two = accountLimiter({ windowMs: 60_000, defaultMax: 9, envVar: "MURLAN_TEST_RATE_LIMIT", message: {} });
  process.env.MURLAN_TEST_RATE_LIMIT = "nonsense";
  const fallback = accountLimiter({ windowMs: 60_000, defaultMax: 1, envVar: "MURLAN_TEST_RATE_LIMIT", message: {} });
  delete process.env.MURLAN_TEST_RATE_LIMIT;

  const a = await serve(two);
  const b = await serve(fallback);
  try {
    assert.equal((await a.get()).status, 200);
    assert.equal((await a.get()).status, 200);
    assert.equal((await a.get()).status, 429, "env var did not raise the max");

    assert.equal((await b.get()).status, 200);
    assert.equal((await b.get()).status, 429, "a junk env var did not fall back to defaultMax");
  } finally {
    await a.close();
    await b.close();
  }
});

test("keyBy: session gives each account its own budget", async () => {
  const limiter = accountLimiter({ windowMs: 60_000, defaultMax: 1, keyBy: "session", message: {} });
  const app = express();
  // Stand in for express-session: the header names whoever is signed in.
  app.use((req, _res, next) => {
    const id = req.headers["x-test-user"];
    if (typeof id === "string") (req as { session?: unknown }).session = { userId: id };
    next();
  });
  app.get("/", limiter, (_req, res) => {
    res.json({ ok: true });
  });
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  const get = (user: string) => fetch(`http://127.0.0.1:${port}/`, { headers: { "x-test-user": user } });

  try {
    assert.equal((await get("ana")).status, 200);
    assert.equal((await get("ana")).status, 429);
    assert.equal((await get("bes")).status, 200, "bes spent ana's budget — the key is not the account");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("keyBy: email and username key on the submitted value, case-folded", async () => {
  for (const [keyBy, field] of [
    ["email", "email"],
    ["username", "username"],
  ] as const) {
    const app = express();
    app.use(express.json());
    app.post("/", accountLimiter({ windowMs: 60_000, defaultMax: 1, keyBy, message: {} }), (_req, res) => {
      res.json({ ok: true });
    });
    const server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    const { port } = server.address() as AddressInfo;
    const post = (value: string) =>
      fetch(`http://127.0.0.1:${port}/`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      });

    try {
      assert.equal((await post("Ana@example.com")).status, 200);
      assert.equal((await post("ana@example.com")).status, 429, `${keyBy}: case forked one caller into two budgets`);
      assert.equal((await post("bes@example.com")).status, 200, `${keyBy}: a second caller inherited the first's budget`);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }
});
