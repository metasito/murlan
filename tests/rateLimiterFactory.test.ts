// #953: server/rateLimit.ts is the only place a rate limiter may be built.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import ts from "typescript";
import express from "express";
import type { AddressInfo } from "node:net";
import { accountLimiter } from "../server/rateLimit.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVER_DIR = path.join(REPO_ROOT, "server");
const ROUTES_FILE = path.join(SERVER_DIR, "routes.ts");

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

  // RULES §6: a scan that finds nothing passes. A floor, not an equality — a
  // fourteenth limiter built the right way must not have to edit this test.
  assert.ok(declared.length >= 13, `only ${declared.length} limiters found — the scan has stopped seeing them`);

  const byHand = declared.filter((d) => d.callee !== "accountLimiter");
  assert.deepEqual(byHand, [], `these bypass accountLimiter: ${byHand.map((d) => `${d.name} = ${d.callee}()`).join(", ")}`);
});

test("server/rateLimit.ts is the only file under server/ that calls rateLimit()", () => {
  const sources = readdirSync(SERVER_DIR, { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".ts") && f !== "rateLimit.ts")
    .map((f) => ({ file: f, text: readFileSync(path.join(SERVER_DIR, f), "utf8") }));

  assert.ok(sources.length > 0, "no server sources scanned");
  const callers = sources.filter((s) => /\brateLimit\s*\(/.test(s.text)).map((s) => s.file);
  assert.deepEqual(callers, [], `these build a limiter by hand: ${callers.join(", ")}`);
});

/** Listen on an ephemeral port and return calls into the app. */
async function serve(app: express.Express) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/** An app whose only route is the limiter, then a 200. */
function limited(limiter: express.RequestHandler) {
  const app = express();
  app.get("/", limiter, (_req, res) => {
    res.json({ ok: true });
  });
  return app;
}

test("a limiter from the factory sends standard headers and no legacy ones", async () => {
  const { url, close } = await serve(limited(accountLimiter({ windowMs: 60_000, defaultMax: 1, message: { code: "RATE_LIMITED" } })));
  try {
    const first = await fetch(url);
    assert.equal(first.status, 200);
    assert.ok(first.headers.get("ratelimit-limit"), "no standard RateLimit header");
    assert.equal(first.headers.get("x-ratelimit-limit"), null, "legacy X-RateLimit header still sent");

    const second = await fetch(url);
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

  const a = await serve(limited(two));
  const b = await serve(limited(fallback));
  try {
    assert.equal((await fetch(a.url)).status, 200);
    assert.equal((await fetch(a.url)).status, 200);
    assert.equal((await fetch(a.url)).status, 429, "env var did not raise the max");

    assert.equal((await fetch(b.url)).status, 200);
    assert.equal((await fetch(b.url)).status, 429, "a junk env var did not fall back to defaultMax");
  } finally {
    await a.close();
    await b.close();
  }
});

test("keyBy: session gives each account its own budget", async () => {
  const app = express();
  // Stand in for express-session: the header names whoever is signed in.
  app.use((req, _res, next) => {
    const id = req.headers["x-test-user"];
    if (typeof id === "string") (req as { session?: unknown }).session = { userId: id };
    next();
  });
  app.get("/", accountLimiter({ windowMs: 60_000, defaultMax: 1, keyBy: "session", message: {} }), (_req, res) => {
    res.json({ ok: true });
  });
  const { url, close } = await serve(app);
  const get = (user: string) => fetch(url, { headers: { "x-test-user": user } });

  try {
    assert.equal((await get("ana")).status, 200);
    assert.equal((await get("ana")).status, 429);
    assert.equal((await get("bes")).status, 200, "bes spent ana's budget — the key is not the account");
  } finally {
    await close();
  }
});

test("keyBy: email and username key on the submitted value, case-folded", async () => {
  for (const keyBy of ["email", "username"] as const) {
    const app = express();
    app.use(express.json());
    app.post("/", accountLimiter({ windowMs: 60_000, defaultMax: 1, keyBy, message: {} }), (_req, res) => {
      res.json({ ok: true });
    });
    const { url, close } = await serve(app);
    const post = (value: string) =>
      fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ [keyBy]: value }),
      });

    try {
      assert.equal((await post("Ana@example.com")).status, 200);
      assert.equal((await post("ana@example.com")).status, 429, `${keyBy}: case forked one caller into two budgets`);
      assert.equal((await post("bes@example.com")).status, 200, `${keyBy}: a second caller inherited the first's budget`);
    } finally {
      await close();
    }
  }
});
