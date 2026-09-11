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

/** Reads back what pino actually wrote, rather than what it was handed. */
function loggedLine(fields: Record<string, unknown>): Record<string, unknown> {
  let written = "";
  const sink = new Writable({
    write(chunk, _enc, done) {
      written += String(chunk);
      done();
    },
  });
  createLogger(sink).warn(fields, "Socket event refused");
  return JSON.parse(written);
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
 * One real request through the very middleware `server/app.ts` mounts, and the
 * line it wrote. A hand-built options object would only prove the test's own
 * serializer drops the address.
 */
async function completedRequestLine(
  target: string,
  headers: Record<string, string> = {}
): Promise<Record<string, any> | null> {
  let resolveLine: (line: string | null) => void = () => {};
  const firstLine = new Promise<string | null>((resolve) => (resolveLine = resolve));
  const sink = new Writable({
    write(chunk, _enc, done) {
      resolveLine(String(chunk));
      done();
    },
  });

  const middleware = createRequestLogger(createLogger(sink));
  const server = http.createServer((req, res) => {
    middleware(req, res);
    res.end("ok");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;

  try {
    await (await fetch(`http://127.0.0.1:${port}${target}`, { headers })).text();
    // Nothing written within a settled event loop means nothing was logged;
    // `/health` is filtered, so a silent answer is a real outcome here.
    const timer = setTimeout(() => resolveLine(null), 250);
    const line = await firstLine;
    clearTimeout(timer);
    return line === null ? null : JSON.parse(line);
  } finally {
    server.close();
  }
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
    const line = await completedRequestLine("/api/profile?username=ana", PROXY_HEADERS);
    const written = JSON.stringify(line);
    assert.equal(written.includes("203.0.113.7"), false, "a proxy header put the client IP in the line");
    assert.equal(written.includes("127.0.0.1"), false, "the socket's peer address reached the line");
    assert.equal(line?.req.remoteAddress, undefined);
    assert.equal(line?.req.remotePort, undefined);
  });

  test("the header bag is not written at all", async () => {
    const line = await completedRequestLine("/api/profile", PROXY_HEADERS);
    assert.equal(line?.req.headers, undefined);
    assert.equal(JSON.stringify(line).includes("iPhone"), false, "the user agent is a fingerprint we do not need");
  });

  test("the query string is dropped, the path is kept", async () => {
    const line = await completedRequestLine("/api/profile?username=ana", PROXY_HEADERS);
    assert.equal(line?.req.url, "/api/profile");
  });

  test("what a fault is diagnosed from still comes through", async () => {
    const line = await completedRequestLine("/api/profile", PROXY_HEADERS);
    assert.equal(line?.req.method, "GET");
    assert.equal(line?.res.statusCode, 200);
  });

  test("a health check still writes nothing", async () => {
    assert.equal(await completedRequestLine("/health"), null);
  });

  test("server/app.ts mounts that middleware rather than building its own", () => {
    const app = readFileSync(path.join(repoRoot, "server", "app.ts"), "utf8");
    assert.match(app, /createRequestLogger\(\)/, "server/app.ts no longer mounts createRequestLogger()");
    assert.equal(
      /pinoHttp\s*\(/.test(app),
      false,
      "server/app.ts builds its own pino-http options — the serializers that keep the client IP out " +
        "of the log live in server/logger.ts, and a second options object silently bypasses them"
    );
  });
});
