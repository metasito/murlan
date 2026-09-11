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
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import http from "node:http";
import express from "express";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { Writable } from "node:stream";
import { createLogger, createRequestLogger, REDACT_PATHS } from "../server/logger.ts";
import { ANSWERED_BY_SHELL, unmatchedKind } from "../server/staticPaths.ts";

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

/** Every `.ts` under `server/`, at any depth, so a later split cannot narrow the scan. */
function serverSources(dir = path.join(repoRoot, "server")): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return serverSources(full);
    return entry.name.endsWith(".ts") ? [full] : [];
  });
}

/** The leading `{…}` of a call's arguments — the fields, without the message after them. */
function firstObjectArg(args: string): string {
  const text = args.trimStart();
  if (!text.startsWith("{")) return "";
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === "{") depth += 1;
    else if (text[i] === "}" && (depth -= 1) === 0) return text.slice(0, i + 1);
  }
  return text;
}

/**
 * Every `logger.<level>(…)` call under `server/`, as its fields and its whole
 * argument text. Braces and parentheses are balanced rather than matched to the
 * first closer, so a nested object or call cannot cut the slice short and hide
 * a field from the rules below; one unbalanced inside a string only ever runs
 * the slice long, which makes them stricter, never blinder.
 *
 * The rules read `fields`, not `args`: a message is prose, and "handed the seat
 * to, then took it back" is not a privacy defect.
 */
function loggerCalls(): { file: string; fields: string; args: string }[] {
  const calls: { file: string; fields: string; args: string }[] = [];
  for (const full of serverSources()) {
    const file = path.relative(path.join(repoRoot, "server"), full);
    const src = readFileSync(full, "utf8");
    for (const m of src.matchAll(/\blogger\.(?:trace|debug|info|warn|error|fatal)\(/g)) {
      const start = m.index + m[0].length;
      let depth = 1;
      let i = start;
      while (i < src.length && depth > 0) {
        if (src[i] === "(") depth += 1;
        else if (src[i] === ")") depth -= 1;
        i += 1;
      }
      const args = src.slice(start, i - 1);
      calls.push({ file, fields: firstObjectArg(args), args });
    }
  }
  return calls;
}

describe("what a hand-written line may name", () => {
  test("the scan reads the calls it is a rule about", () => {
    // The floor: every assertion below passes on an empty list.
    const calls = loggerCalls();
    assert.ok(calls.length > 20, `the scan found ${calls.length} logger calls under server/`);
    for (const file of ["mail.ts", "routes.ts", "socketSafety.ts", "socketRooms.ts"])
      assert.ok(calls.some((c) => c.file === file), `the scan is not reading server/${file}`);
    assert.ok(
      calls.some((c) => c.fields.includes("userId")),
      "no call's fields were read — firstObjectArg is returning nothing"
    );
  });

  test("no line names an email address", () => {
    // `to` is the recipient's address at every call site that binds it, so the
    // rule is the name rather than a list of lines. `userId` is what a failed
    // send is diagnosed from; the address adds nothing a log stream — which has
    // no retention window and no deletion path — should outlive the account
    // with. The quote is for `{ "to": … }`, which is the same field.
    for (const { file, fields } of loggerCalls())
      assert.equal(
        /\bto\b"?\s*[,:}]/.test(fields),
        false,
        `server/${file}: a logger call passes \`to\`, the address a message was sent to`
      );
  });

  test("no line names a live room code", () => {
    // The credential `REDACT_PATHS` keeps out of a refused socket event is the
    // same credential when a handler logs it directly, where no redact path
    // reaches it: `payload.code` is a path, and a top-level `code` is a
    // refusal's own reason, which the suite above asserts is kept.
    for (const { file, fields } of loggerCalls())
      assert.equal(
        /\broom\.code\b|\broomCode\b/.test(fields),
        false,
        `server/${file}: a logger call passes a room code, the sole credential for joining that table`
      );
  });

  test("a crash report is not copied beside the row that expires it", () => {
    const reported = loggerCalls().filter((c) => c.args.includes("Client reported an unhandled error"));
    assert.equal(reported.length, 1, "the crash-report line was renamed or removed — this rule lost its subject");
    for (const field of ["userId", "clientError", "message", "stack"])
      assert.equal(
        reported[0].fields.includes(field),
        false,
        `the crash-report log line still carries ${field} — client_errors is swept at 90 days and ` +
          `cleared by deleteUser, and a copy in the log is reached by neither`
      );
  });

  test("a crash report that could not be stored is still written down", () => {
    // The exception that is not one: when the insert fails there is no row for
    // the line to duplicate, and losing the report entirely is the worse half.
    const failed = loggerCalls().filter((c) => c.args.includes("Failed to store a client error report"));
    assert.equal(failed.length, 1);
    assert.ok(failed[0].fields.includes("report"), "a report the database refused is now lost entirely");
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
    // one. The scan below is what fails if that mount stops having this shape.
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
    // The floor under `kind: "shell"`: without this line every missing build
    // file reads as a served one, and the suite above would only be testing its
    // own harness.
    assert.match(
      app,
      /\[ANSWERED_BY_SHELL\] = true/,
      "the SPA catch-all no longer marks what it answered — a lost bundle and a served one " +
        "are the same log line again"
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
      /written only when it matches one\s+of our own routes/,
      /then only in that route's general form rather than as you sent it/,
      /when it matches\s+none of them[\s\S]{0,300}no address is\s+written at all/,
      /only one of four fixed words of our own saying which part of the service was\s+asked for/,
      /never your email address and never the contents\s+of a crash report/,
      /your username where the action was about it/,
      /no id from the address, which is written only when it matches one of our own routes and then only in that route's general form/,
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
