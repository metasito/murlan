// tests/server/logRedaction.test.ts — what must never reach the log in cleartext: a
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
// The source scan in logRedactionScan.test.ts makes this a rule rather than two strings: a
// schema growing another code-shaped field fails there until it is redacted too.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { Writable } from "node:stream";
import { createLogger, setErrorRecorder } from "../../server/shared/logger.ts";
import { createRequestLogger } from "../../server/http/logger.ts";
import { errorHandler } from "../../server/http/errorHandler.ts";
import { ANSWERED_BY_SHELL, unmatchedKind } from "../../server/http/staticPaths.ts";
import { blankStrings } from "../helpers/sourceScan.ts";

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

describe("what a hand-written line may name", () => {
  test("a brace inside a message does not end the fields", () => {
    // The decoy this scan would otherwise fall to, asserted on the scanner
    // itself because no call in server/ has this shape today.
    const source =
      `logger.error({ err, note: "}", to }, "a } in prose"); // don't stop here\n` +
      `logger.warn({ to }, "x");`;
    const blanked = blankStrings(source);
    assert.equal(blanked.includes('"}"'), false, "the string's brace was left in place");
    assert.equal(blanked.length, source.length, "offsets moved, so every slice is wrong");
    // An apostrophe in prose reads as a string that runs to the next one, which
    // is how a comment came to swallow whole files of calls.
    assert.equal(blanked.split("logger.").length - 1, 2, "a comment swallowed the call after it");
  });
});

describe("what an unmatched request says about itself", () => {
  const HASHED = "/_expo/static/js/web/entry-0123456789abcdef0123456789abcdef.js";

  test("each surface gets its own word", () => {
    assert.equal(unmatchedKind("/api/friends/SECRET7"), "api");
    assert.equal(unmatchedKind("/assets/icon.png"), "asset");
    assert.equal(unmatchedKind(HASHED), "asset");
    assert.equal(unmatchedKind("/index.html"), "asset");
    assert.equal(unmatchedKind("/room/SECRET7"), "other");
  });

  test("a build file the shell answered is the one that names a fault", () => {
    // Present and missing are both 200 with no address, so the status code
    // reports nothing; which of the two answered is the whole signal.
    assert.equal(unmatchedKind(HASHED, true), "shell");
    assert.equal(unmatchedKind(HASHED, false), "asset");
    // A deep link into the app is also answered by the shell, and is not a fault.
    assert.equal(unmatchedKind("/room/SECRET7", true), "other");
  });

  test("the word is the whole of what it can say", () => {
    // The reason an unmatched request writes no path: the only text it carries
    // is the client's own. Four words, whatever was asked for.
    for (const target of ["/assets/SECRET7.png", "/api/SECRET7", "/room/SECRET7", "/SECRET7"])
      for (const shell of [true, false])
        assert.ok(["api", "asset", "shell", "other"].includes(unmatchedKind(target, shell)), target);
  });

  test("a prefix is not a path segment", () => {
    assert.equal(unmatchedKind("/apifake/thing"), "other");
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
    serves,
    method = "GET",
  }: {
    headers?: Record<string, string>;
    route?: string;
    catchAll?: boolean;
    serves?: string;
    method?: string;
  } = {}
): Promise<Record<string, any> | null> {
  const { sink, written } = captureSink();
  const middleware = createRequestLogger(createLogger(sink));

  let handler: http.RequestListener;
  if (route || catchAll || serves) {
    const app = express();
    app.use(middleware);
    if (route) {
      app.get(route, (_req, res) => res.send("ok"));
      app.delete(route, (_req, res) => res.send("ok"));
    }
    // `express.static` in the one respect the serializer can see: it answers
    // without a router, so it leaves `req.route` unset. A file that is present
    // takes this path and never reaches the catch-all.
    if (serves) app.use((req, res, next) => (req.path === serves ? res.send("js") : next()));
    // `server/app.ts`'s SPA catch-all in the three respects that matter here:
    // GET only, it hands `/api` onward rather than answering it, and it marks
    // what it answered. The first two are what put a route on `req` that never
    // handled the request; the third is what tells a missing file from a served
    // one. The scan in logRedactionScan.test.ts is what fails if that mount stops having this shape.
    if (catchAll)
      app.get("*path", (req, res, next) => {
        if (req.path.startsWith("/api")) return next();
        (req as typeof req & { [ANSWERED_BY_SHELL]?: true })[ANSWERED_BY_SHELL] = true;
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
  options?: {
    headers?: Record<string, string>;
    route?: string;
    catchAll?: boolean;
    serves?: string;
    method?: string;
  }
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
  // address through the host's TLS-terminating proxy. `req.socket.remoteAddress` is the
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

  test("a build file the shell answered is not the one that was served", async () => {
    // The whole of #975: both are 200 with no address, so nothing else in the
    // line separates a deploy that lost a bundle from an ordinary page load.
    const bundle = "/_expo/static/js/web/entry-0123456789abcdef0123456789abcdef.js";
    const served = await completedRequestLine(bundle, { catchAll: true, serves: bundle });
    const missing = await completedRequestLine(bundle, { catchAll: true });
    assert.equal(served.res.statusCode, 200);
    assert.equal(missing.res.statusCode, 200);
    assert.equal(served.req.kind, "asset");
    assert.equal(missing.req.kind, "shell", "a missing bundle reads as a served one");
  });

  test("a probe of the API is neither", async () => {
    const api = await completedRequestLine("/api/typo/SECRET7", { catchAll: true });
    assert.equal(api.req.kind, "api");
    assert.equal(JSON.stringify(api).includes("SECRET7"), false, "the path reached the line through `kind`");
  });

  test("a matched route says nothing about a kind", async () => {
    const line = await completedRequestLine("/api/friends/42", { route: "/api/friends/:friendUserId" });
    assert.equal(line.req.kind, undefined);
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

describe("what an error leaves beyond the log line", () => {
  test("a completed request line carries its request id", async () => {
    const line = await completedRequestLine("/api/anything", { route: "/api/anything" });
    assert.notEqual(line.reqId, undefined);
  });

  test("the error handler logs through the request's own logger", async () => {
    const { sink, written } = captureSink();
    const app = express();
    app.use(createRequestLogger(createLogger(sink)));
    app.get("/boom", () => {
      throw new Error("planted");
    });
    app.use(errorHandler);
    const server = http.createServer(app);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const { port } = server.address() as AddressInfo;
      assert.equal((await fetch(`http://127.0.0.1:${port}/boom`)).status, 500);
      const lines = written().trim().split("\n").map((l) => JSON.parse(l));
      const failure = lines.find((l) => l.msg === "Internal Server Error");
      assert.ok(failure, "the handler logged nothing");
      assert.notEqual(failure.reqId, undefined, "two concurrent 500s cannot be told apart");
    } finally {
      server.close();
    }
  });

  test("every line at error and above reaches the recorder, redacted, and nothing below", () => {
    const recorded: Record<string, unknown>[] = [];
    setErrorRecorder((entry) => recorded.push(entry));
    try {
      const log = createLogger(captureSink().sink);
      log.warn("only a warning");
      log.error({ payload: { roomCode: "ABCD" } }, "a real failure");
      log.fatal("worse");
    } finally {
      setErrorRecorder(undefined);
    }
    assert.deepEqual(recorded.map((e) => e.msg), ["a real failure", "worse"]);
    assert.equal(JSON.stringify(recorded).includes("ABCD"), false);
  });
});

describe("what a failed query leaves in the log", () => {
  /** The shape drizzle's DrizzleQueryError renders: statement, then bindings. */
  function drizzleError(): Error & { params?: string[] } {
    const err: Error & { params?: string[] } = new Error(
      'Failed query: insert into "users" ("email", "password") values ($1, $2)\nparams: player@example.com,$2b$10$abcdefghijklmnopqrstuv'
    );
    err.params = ["player@example.com", "$2b$10$abcdefghijklmnopqrstuv"];
    return err;
  }

  test("the bound parameters of a failed query are not written", () => {
    const { sink, written } = captureSink();
    createLogger(sink).error({ err: drizzleError() }, "Internal Server Error");
    const line = written();
    assert.equal(line.includes("player@example.com"), false, line);
    assert.equal(line.includes("$2b$10$"), false, line);
    assert.match(line, /Failed query: insert into/);
  });

  test("a cause carrying them is not a way round it", () => {
    const { sink, written } = captureSink();
    const outer: Error & { cause?: unknown } = new Error("Internal");
    outer.cause = drizzleError();
    createLogger(sink).error({ err: outer }, "Internal Server Error");
    assert.equal(written().includes("player@example.com"), false, written());
  });

  test("an error carrying no parameters keeps its message whole", () => {
    const { sink, written } = captureSink();
    createLogger(sink).error({ err: new Error("connection terminated") }, "boom");
    assert.match(written(), /connection terminated/);
  });
});
