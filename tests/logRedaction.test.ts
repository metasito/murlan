// tests/logRedaction.test.ts — pino-http's default req/res serializers copy
// the entire header bag onto every completed-request log line, which put the
// live session cookie (and any bearer token) in cleartext in production logs.
// This drives one real request through the same redact config server/logger.ts
// applies and asserts the captured output never contains the secret values.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { Writable } from "node:stream";
import pinoHttp from "pino-http";
// @ts-ignore — .ts extension required by Node's type-stripping loader
import { createLogger } from "../server/logger.ts";

test("request logs redact the cookie, authorization, and set-cookie headers", async () => {
  const chunks: Buffer[] = [];
  const capture = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(chunk);
      callback();
    },
  });

  // The exact factory server/logger.ts uses for the real `logger` export,
  // pointed at the capturing stream instead of stdout. Reusing createLogger()
  // — rather than retyping the redact options here — means this test fails
  // if the real logger's redact config is ever removed, narrowed, or left
  // unwired, not just if a hand-copied paths list drifts.
  const logger = createLogger(capture);
  const httpLogger = pinoHttp({ logger });

  let resolveLogged: () => void;
  const logged = new Promise<void>((resolve) => {
    resolveLogged = resolve;
  });

  const server = http.createServer((req, res) => {
    httpLogger(req, res);
    res.setHeader("set-cookie", "murlan.sid=s%3Aserver-issued-secret.abc123; HttpOnly");
    // Registered after httpLogger's own 'finish' listener, so it runs after
    // pino-http has already written the request-completed line to `capture`.
    res.on("finish", () => resolveLogged());
    res.end("ok");
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };

  try {
    const response = await fetch(`http://127.0.0.1:${port}/some/path`, {
      headers: {
        cookie: "murlan.sid=s%3Aclient-sent-secret.xyz789",
        authorization: "Bearer super-secret-token",
      },
    });
    await response.text();
    await logged;
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  const output = Buffer.concat(chunks).toString("utf8");

  assert.equal(output.includes("murlan.sid="), false, "the cookie name/value pair must never appear");
  assert.equal(output.includes("client-sent-secret"), false, "the request cookie's value leaked");
  assert.equal(output.includes("server-issued-secret"), false, "the response set-cookie's value leaked");
  assert.equal(output.includes("super-secret-token"), false, "the authorization header's value leaked");

  // Guards against "fixing" this by disabling request logging altogether.
  assert.match(output, /"method":"GET"/);
  assert.match(output, /"url":"\/some\/path"/);
});
