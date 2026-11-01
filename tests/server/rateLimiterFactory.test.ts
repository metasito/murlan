// #953: server/http/rateLimit.ts is the only place a rate limiter may be built.
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import ts from "typescript";
import express from "express";
import type { AddressInfo } from "node:net";
import { createClient } from "redis";
import { routeLimiter } from "../../server/http/rateLimit.ts";
import { closeRedis, keyspace } from "../../server/store/redis.ts";
import { trackedFiles } from "../helpers/trackedFiles.ts";
import { routeSources } from "../helpers/routeSources.ts";
import { dropKeyspace } from "../helpers/redisKeys.ts";
import { scopedDatabaseUrl } from "../helpers/testServer.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SERVER_DIR = path.join(REPO_ROOT, "server");

// Counts live in Redis under the keyspace DATABASE_URL names: one of this run's own keeps a rerun
// inside a window from inheriting the last run's counts.
const realDatabaseUrl = process.env.DATABASE_URL;
const scoped = scopedDatabaseUrl(realDatabaseUrl ?? "postgres://unused/murlan", `rlf_${Date.now()}_${Math.floor(Math.random() * 1e6)}`);
process.env.DATABASE_URL = scoped;
after(async () => {
  closeRedis();
  await dropKeyspace(scoped);
  if (realDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = realDatabaseUrl;
});

let names = 0;
const freshName = () => `t${++names}`;

interface LimiterDeclaration {
  file: string;
  variable: string;
  callee: string;
  /** The `name` option, when it is a string literal. */
  name: string | undefined;
}

/** Every `const <name>Limiter = <callee>(...)` in the route area files, where every limiter lives. */
function limiterDeclarations(): LimiterDeclaration[] {
  const found: LimiterDeclaration[] = [];
  let file = "";

  const visit = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      /Limiter$/.test(node.name.text) &&
      node.initializer &&
      ts.isCallExpression(node.initializer) &&
      ts.isIdentifier(node.initializer.expression)
    ) {
      const [options] = node.initializer.arguments;
      const nameOption =
        options && ts.isObjectLiteralExpression(options)
          ? options.properties.find((p) => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === "name")
          : undefined;
      const name =
        nameOption && ts.isPropertyAssignment(nameOption) && ts.isStringLiteral(nameOption.initializer)
          ? nameOption.initializer.text
          : undefined;
      found.push({ file, variable: node.name.text, callee: node.initializer.expression.text, name });
    }
    ts.forEachChild(node, visit);
  };
  for (const source of routeSources()) {
    file = source.file;
    visit(source.sourceFile);
  }
  return found;
}

test("every limiter in the route area files is built by the factory", () => {
  const declared = limiterDeclarations();

  // RULES §6: a scan that finds nothing passes. A floor, not an equality — a
  // fourteenth limiter built the right way must not have to edit this test.
  assert.ok(declared.length >= 13, `only ${declared.length} limiters found — the scan has stopped seeing them`);

  const byHand = declared.filter((d) => d.callee !== "routeLimiter");
  assert.deepEqual(byHand, [], `these bypass routeLimiter: ${byHand.map((d) => `${d.variable} = ${d.callee}()`).join(", ")}`);
});

test("every route limiter names its counts with a literal no other limiter uses", () => {
  const declared = limiterDeclarations();
  const unnamed = declared.filter((d) => d.name === undefined).map((d) => d.variable);
  assert.deepEqual(unnamed, [], "a name the scan cannot read is a name it cannot check");
  const seen = new Map<string, string>();
  for (const { variable, name } of declared) {
    assert.ok(!seen.has(name!), `${variable} and ${seen.get(name!)} share the name "${name}", so one count`);
    seen.set(name!, variable);
  }
});

describe("every route limiter counts in Redis", { skip: process.env.REDIS_URL ? false : "REDIS_URL not set — skipping the shared-store check" }, () => {
  async function sharedCounts(name: string): Promise<number[]> {
    const redis = createClient({ url: process.env.REDIS_URL });
    redis.on("error", () => {});
    await redis.connect();
    try {
      const counts: number[] = [];
      for await (const batch of redis.scanIterator({ MATCH: `${keyspace(scoped)}:limit:${name}:*` })) {
        for (const key of batch) counts.push(Number(await redis.get(key)));
      }
      return counts;
    } finally {
      redis.destroy();
    }
  }

  for (const { file, variable, name } of limiterDeclarations()) {
    test(`${variable} (${file})`, async () => {
      const limiter = ((await import(`../../server/http/routes/${file}`)) as Record<string, unknown>)[variable];
      assert.equal(typeof limiter, "function", `${variable} is not exported from routes/${file}`);
      const app = express();
      app.use(express.json());
      app.use((req, _res, next) => {
        (req as { session?: unknown }).session = { userId: `u-${variable}` };
        next();
      });
      // Refused, so a limiter skipping successful requests still keeps its count.
      app.post("/", limiter as express.RequestHandler, (_req, res) => {
        res.status(400).json({});
      });
      const { url, close } = await serve(app);
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: `${variable}@example.test`, username: `u-${variable}` }),
        });
        assert.equal(res.status, 400);
        assert.deepEqual(await sharedCounts(name!), [1], `${variable} did not count in Redis`);
      } finally {
        await close();
      }
    });
  }
});

test("server/http/rateLimit.ts is the only file under server/ that calls rateLimit()", () => {
  const CALLS_RATE_LIMIT = /\brateLimit\s*\(/;
  const scanned = new Map(
    readdirSync(SERVER_DIR, { recursive: true, encoding: "utf8" })
      .map((f) => f.split(path.sep).join("/"))
      .filter((f) => f.endsWith(".ts") && f !== "http/rateLimit.ts")
      .map((f) => [f, readFileSync(path.join(SERVER_DIR, f), "utf8")]),
  );

  // RULES §6: a scan reading nothing passes, and one reading a subset passes
  // just as quietly. This second listing deliberately does not share the
  // filter above — a predicate narrowed there would otherwise narrow the
  // floor with it, and the guard would move in lockstep with the guarded.
  const mustRead = trackedFiles(REPO_ROOT, "server")
    .map((f) => f.slice("server/".length))
    .filter((f) => /\.ts$/.test(f) && f !== "http/rateLimit.ts");
  const missed = mustRead.filter((f) => !scanned.has(f));
  assert.deepEqual(missed, [], `the walk never read: ${missed.join(", ")}`);
  for (const area of ["auth", "account", "friends", "reports"]) {
    assert.ok(scanned.has(`http/routes/${area}.ts`), `routes/${area}.ts, where its limiters live, was not read`);
  }

  // Positive control: a scan of 57 files proves nothing unless the pattern
  // can be seen to match the one file that legitimately calls rateLimit().
  assert.match(readFileSync(path.join(SERVER_DIR, "http", "rateLimit.ts"), "utf8"), CALLS_RATE_LIMIT);

  const callers = [...scanned].filter(([, text]) => CALLS_RATE_LIMIT.test(text)).map(([file]) => file);
  assert.deepEqual(callers, [], `these build a limiter by hand: ${callers.join(", ")}`);
});

/** `close` must be awaited, or node:test holds the port and never exits. */
async function serve(app: express.Express) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function limited(limiter: express.RequestHandler) {
  const app = express();
  app.get("/", limiter, (_req, res) => {
    res.json({ ok: true });
  });
  return app;
}

test("a limiter from the factory sends standard headers and no legacy ones", async () => {
  const { url, close } = await serve(limited(routeLimiter({ name: freshName(), windowMs: 60_000, defaultMax: 1, message: { code: "RATE_LIMITED" } })));
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

test("the env var is read per request: set after the limiter is built, it applies", async () => {
  const two = routeLimiter({ name: freshName(), windowMs: 60_000, defaultMax: 9, envVar: "MURLAN_TEST_RATE_LIMIT", message: {} });
  const fallback = routeLimiter({ name: freshName(), windowMs: 60_000, defaultMax: 1, envVar: "MURLAN_TEST_RATE_LIMIT", message: {} });
  const a = await serve(limited(two));
  const b = await serve(limited(fallback));
  try {
    process.env.MURLAN_TEST_RATE_LIMIT = "2";
    assert.equal((await fetch(a.url)).status, 200);
    assert.equal((await fetch(a.url)).status, 200);
    assert.equal((await fetch(a.url)).status, 429, "an env var set after the build did not set the max");

    process.env.MURLAN_TEST_RATE_LIMIT = "nonsense";
    assert.equal((await fetch(b.url)).status, 200);
    assert.equal((await fetch(b.url)).status, 429, "a junk env var did not fall back to defaultMax");
  } finally {
    delete process.env.MURLAN_TEST_RATE_LIMIT;
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
  app.get("/", routeLimiter({ name: freshName(), windowMs: 60_000, defaultMax: 1, keyBy: "session", message: {} }), (_req, res) => {
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
    app.post("/", routeLimiter({ name: freshName(), windowMs: 60_000, defaultMax: 1, keyBy, message: {} }), (_req, res) => {
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
