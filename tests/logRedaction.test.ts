// tests/logRedaction.test.ts — what must never reach the log in cleartext: a
// room code, and the address the player connected from.
//
// The second suite is the one that answers #962. It runs a real request
// through the middleware `server/app.ts` mounts, because the only honest way
// to ask what a log line holds is to read the line — a fixture req handed to a
// serializer would miss the header bag pino-http builds for itself.
//
// `onEvent` logs the parsed payload of a refused socket event, which is what
// makes a refusal diagnosable at all. Two of those payloads carry a room code,
// and a room code is the sole credential for `room:join` and `room:spectate` —
// so a `NOT_FRIENDS` refusal, which any account can trigger at will, would
// otherwise hand every private table to whoever reads the logs.
//
// The scan is what makes this a rule rather than two strings: a schema growing
// another code-shaped field fails here until it is redacted too.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import http from "node:http";
import express from "express";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { Writable } from "node:stream";
import { createLogger, createRequestLogger, REDACT_PATHS } from "../server/logger.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const schemas = readFileSync(path.join(repoRoot, "server", "socketSchemas.ts"), "utf8");

/** Every object key declared in the socket schemas, comments stripped. */
function schemaFields(): string[] {
  const source = schemas.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const fields = new Set<string>();
  for (const m of source.matchAll(/^\s{2,}([A-Za-z_][A-Za-z0-9_]*)\s*:/gm)) fields.add(m[1]);
  return [...fields];
}

/** A pino destination that keeps what was written to it. */
function captureSink(): { sink: Writable; written: () => string } {
  let written = "";
  return {
    sink: new Writable({
      write(chunk, _enc, done) {
        written += String(chunk);
        done();
      },
    }),
    written: () => written,
  };
}

/** Reads back what pino actually wrote, rather than what it was handed. */
function loggedLine(fields: Record<string, unknown>): Record<string, unknown> {
  const { sink, written } = captureSink();
  createLogger(sink).warn(fields, "Socket event refused");
  return JSON.parse(written());
}

describe("what a refused socket event leaves in the log", () => {
  test("the schemas declare fields to scan at all", () => {
    const fields = schemaFields();
    assert.ok(fields.includes("roomCode"), `scan found ${fields.length} fields but not roomCode`);
    assert.ok(fields.includes("cardIds"), "the scan is not reading the schemas");
  });

  test("every code-shaped payload field is redacted", () => {
    for (const field of schemaFields().filter((f) => /code$/i.test(f))) {
      assert.ok(
        REDACT_PATHS.includes(`payload.${field}`),
        `${field} is a socket payload field that reads like a room code and is logged in the ` +
          `clear — add "payload.${field}" to REDACT_PATHS in server/logger.ts`
      );
    }
  });

  test("a friend invite's room code does not survive into the line", () => {
    const line = loggedLine({
      event: "friend:invite",
      code: "NOT_FRIENDS",
      payload: { friendUserId: "u2", roomCode: "SECRET7" },
    });
    assert.equal((line.payload as Record<string, unknown>).roomCode, "[redacted]");
    assert.equal(JSON.stringify(line).includes("SECRET7"), false);
  });

  test("a room join's code does not survive into the line", () => {
    const line = loggedLine({ event: "room:join", code: "ROOM_FULL", payload: { code: "ABC123" } });
    assert.equal((line.payload as Record<string, unknown>).code, "[redacted]");
    assert.equal(JSON.stringify(line).includes("ABC123"), false);
  });

  test("the refusal's own code is not redacted with them", () => {
    // Top-level `code` is what the client was told, and reading it is the
    // whole point of the line; only `payload.code` is a credential.
    const line = loggedLine({ event: "room:join", code: "ROOM_FULL", payload: { code: "ABC123" } });
    assert.equal(line.code, "ROOM_FULL");
  });

  test("what a refusal is actually diagnosed from still comes through", () => {
    const line = loggedLine({
      event: "game:exchange_give_card",
      code: "INVALID_CARD",
      payload: { cardId: "A_clubs" },
    });
    assert.equal((line.payload as Record<string, unknown>).cardId, "A_clubs");
  });

  test("the session cookie is still redacted", () => {
    const line = loggedLine({ req: { headers: { cookie: "connect.sid=s%3Alive" } } });
    assert.equal(JSON.stringify(line).includes("connect.sid"), false);
  });
});

/**
 * One request, answered and closed. `agent: false` is what closes it: a
 * keep-alive socket left in a client pool aborts the runner under
 * `--test-force-exit`, which is how `npm test` runs this file.
 */
function requested(
  port: number,
  target: string,
  { headers, method }: { headers: Record<string, string>; method: string }
): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: target, method, headers, agent: false }, (res) => {
      res.resume();
      res.on("end", () => resolve());
    });
    req.on("error", reject);
    req.end();
  });
}

/**
 * Runs one real request through the very middleware `server/app.ts` mounts and
 * returns the line it wrote, or `null` if it wrote none. A hand-built options
 * object would only prove the test's own serializer drops the address.
 *
 * `express` is only reached for when a route pattern is wanted: the serializer
 * reads `req.route`, which nothing but a router sets.
 */
async function requestLine(
  target: string,
  {
    headers = {},
    route,
    catchAll = false,
    method = "GET",
  }: { headers?: Record<string, string>; route?: string; catchAll?: boolean; method?: string } = {}
): Promise<Record<string, any> | null> {
  const { sink, written } = captureSink();
  const middleware = createRequestLogger(createLogger(sink));

  let handler: http.RequestListener;
  if (route || catchAll) {
    const app = express();
    app.use(middleware);
    if (route) {
      app.get(route, (_req, res) => res.send("ok"));
      app.delete(route, (_req, res) => res.send("ok"));
    }
    // `server/app.ts`'s SPA catch-all in the two respects that matter here:
    // GET only, and it hands `/api` onward rather than answering it. Both are
    // what put a route on `req` that never handled the request. The scan below
    // is what fails if that mount stops having this shape.
    if (catchAll)
      app.get("*path", (req, res, next) => {
        if (req.path.startsWith("/api")) return next();
        res.send("spa");
      });
    handler = app as unknown as http.RequestListener;
  } else {
    handler = (req, res) => {
      middleware(req, res);
      res.end("ok");
    };
  }

  const server = http.createServer(handler);
  // pino-http writes from its own `finish` listener, registered when the
  // middleware ran — before this one, so by the time this fires the line is
  // already in the sink. No wall clock, so a slow runner cannot read as
  // "nothing was logged", which is the assertion `/health` turns on.
  const settled = new Promise<void>((resolve) => {
    server.on("request", (_req, res) => res.on("finish", () => setImmediate(resolve)));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;

  try {
    await requested(port, target, { headers, method });
    await settled;
    return written() === "" ? null : JSON.parse(written());
  } finally {
    server.closeAllConnections();
    server.close();
  }
}

/** The same, and it must have written a line — every assertion below is about what is in it. */
async function completedRequestLine(
  target: string,
  options?: { headers?: Record<string, string>; route?: string; catchAll?: boolean; method?: string }
): Promise<Record<string, any>> {
  const line = await requestLine(target, options);
  assert.ok(line, `nothing was logged for ${target} — every assertion about the line would pass vacuously`);
  return line;
}

/**
 * pino's write destination. The symbol is unique per pino copy, not
 * `Symbol.for("pino.stream")`, so it is found by description.
 */
function pinoDestination(l: object): { sync?: boolean } | undefined {
  const key = Object.getOwnPropertySymbols(l).find((s) => s.description === "pino.stream");
  return key ? (l as Record<symbol, { sync?: boolean }>)[key] : undefined;
}

const PROXY_HEADERS = {
  // RFC 7239 and its de-facto predecessor: what actually carries the client's
  // address through Replit's TLS terminator. `req.socket.remoteAddress` is the
  // terminator, not the player.
  "x-forwarded-for": "203.0.113.7, 10.0.0.1",
  forwarded: "for=203.0.113.7",
  "x-real-ip": "203.0.113.7",
  "cf-connecting-ip": "203.0.113.7",
  cookie: "connect.sid=s%3Alive",
  authorization: "Bearer live-token",
  "user-agent": "Murlan/1.0 (iPhone; iOS 18.2)",
};

describe("what a completed request leaves in the log", () => {
  test("no client address survives, from any header or from the socket", async () => {
    const line = await completedRequestLine("/api/profile?username=ana", { headers: PROXY_HEADERS });
    const written = JSON.stringify(line);
    assert.equal(written.includes("203.0.113.7"), false, "a proxy header put the client IP in the line");
    assert.equal(written.includes("127.0.0.1"), false, "the socket's peer address reached the line");
    assert.equal(line.req.remoteAddress, undefined);
    assert.equal(line.req.remotePort, undefined);
    assert.equal(written.includes("ana"), false, "the query string reached the line");
  });

  test("the header bag is not written at all", async () => {
    const line = await completedRequestLine("/api/profile", { headers: PROXY_HEADERS });
    assert.equal(line.req.headers, undefined);
    assert.equal(JSON.stringify(line).includes("iPhone"), false, "the user agent is a fingerprint we do not need");
  });

  test("a matched route is logged as its pattern, so a room code never reaches the line", async () => {
    const line = await completedRequestLine("/api/friends/invites/SECRET7", {
      route: "/api/friends/invites/:roomCode",
      method: "DELETE",
      headers: PROXY_HEADERS,
    });
    assert.equal(line.req.url, "/api/friends/invites/:roomCode");
    assert.equal(JSON.stringify(line).includes("SECRET7"), false, "a room code reached the log through the URL");
  });

  test("an account id in a path is a pattern too", async () => {
    const line = await completedRequestLine("/api/friends/42", { route: "/api/friends/:friendUserId" });
    assert.equal(line.req.url, "/api/friends/:friendUserId");
  });

  // The two below are the shape `server/app.ts` produces and a bare handler
  // cannot: express leaves `req.route` set on a route that declined, so a
  // catch-all mounted ahead of the API rides along on requests it never
  // answered — and answers none of the non-GET ones at all.
  test("a wildcard route is not a match, whether it declined or answered", async () => {
    for (const target of ["/api/typo/SECRET7", "/room/SECRET7"]) {
      const line = await completedRequestLine(target, { catchAll: true });
      assert.equal(line.req.url, undefined, `${target}: the catch-all's own pattern was logged as the address`);
      assert.equal(JSON.stringify(line).includes("SECRET7"), false, `${target}: the path reached the line`);
    }
  });

  test("a non-GET that no route matched writes no address", async () => {
    const line = await completedRequestLine("/api/friends/invites/SECRET7", {
      catchAll: true,
      method: "POST",
    });
    assert.equal(JSON.stringify(line).includes("SECRET7"), false, "a room code reached the log through a 404");
    assert.equal(line.req.url, undefined);
  });

  test("what a fault is diagnosed from still comes through", async () => {
    const line = await completedRequestLine("/api/profile", { headers: PROXY_HEADERS });
    assert.equal(line.req.method, "GET");
    assert.equal(line.res.statusCode, 200);
  });

  test("a health check still writes nothing", async () => {
    assert.equal(await requestLine("/health"), null);
  });

  test("the helper can tell a written line from none at all", async () => {
    // The floor under the assertion above: `/health` is the one test that
    // passes on nothing being logged, so something has to fail when nothing is
    // logged for anything else either.
    assert.notEqual(await requestLine("/api/profile"), null);
  });

  test("server/app.ts mounts that middleware rather than building its own", () => {
    const app = readFileSync(path.join(repoRoot, "server", "app.ts"), "utf8");
    assert.match(
      app,
      /app\.use\(createRequestLogger\(\)\)/,
      "server/app.ts no longer mounts createRequestLogger() — the serializers below it are unreached"
    );
    assert.equal(
      /pinoHttp\s*\(/.test(app),
      false,
      "server/app.ts builds its own pino-http options — the serializers that keep the client IP out " +
        "of the log live in server/logger.ts, and a second options object silently bypasses them"
    );
    // The floor under `loggedRequest`'s wildcard rule, and under the `catchAll`
    // harness above, which is a hand copy of this mount.
    assert.match(
      app,
      /app\.get\("\*path"/,
      "the SPA catch-all is no longer a GET on `*path` — the harness above copies that shape, and the " +
        "rule that drops a wildcard address is written for it"
    );
    assert.equal(
      (app.match(/app\.(get|post|put|patch|delete|use)\("[^"]*\*/g) ?? []).length,
      1,
      "server/app.ts has a second wildcard route — every address it touches is dropped from the log, " +
        "which is right for the SPA shell and wrong for a route that means to answer"
    );
  });

  test("docs/PRIVACY.md still claims what the line actually holds", () => {
    // The policy is written to be published, so every clause of it is one the
    // suite above also asserts. This cannot check the prose against the code —
    // it can only refuse to let a clause outlive the assertion that earns it.
    const policy = readFileSync(path.join(repoRoot, "docs", "PRIVACY.md"), "utf8");
    for (const claim of [
      /Your IP address is not written/,
      /neither are your request headers/,
      /anything you passed in the address's query string/,
      /written only when one of our\s+own routes answered/,
      /then only in its general form rather than as you sent it/,
      /for anything else[\s\S]{0,300}no address is written\s+at all/,
      /no id from the address, which is written only when one of our own routes answered and then only in its general form/,
    ])
      assert.match(policy, claim, `docs/PRIVACY.md no longer states ${claim}`);
  });

  test("the log is written asynchronously, so no request waits on it", () => {
    // The owner's requirement on #962. pino's default destination is a
    // SonicBoom on fd 1 with `sync: false`; `pino.destination({ sync: true })`
    // here would put an fs.writeSync on every request's path, and nothing else
    // in the repo would notice.
    const before = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const destination = pinoDestination(createLogger());
      assert.ok(destination, "createLogger() no longer holds a pino destination — this test is reading nothing");
      assert.equal(destination.sync, false);
    } finally {
      process.env.NODE_ENV = before;
    }
  });
});
