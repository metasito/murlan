// tests/logRedaction.test.ts — a room code must never reach the log in
// cleartext.
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
import { Writable } from "node:stream";
import { createLogger, REDACT_PATHS } from "../server/logger.ts";

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
