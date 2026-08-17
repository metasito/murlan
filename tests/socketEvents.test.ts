// tests/socketEvents.test.ts — every inbound socket event goes through the
// boundary wrapper.
//
// `onEvent` (server/socketSafety.ts) is what validates a payload, rate-limits
// the account behind the socket, and contains a throwing handler so it reports
// as an error on that one socket instead of escaping into the process guards.
// An event registered with a bare `socket.on` gets none of that, and is exactly
// the one nobody remembers to check — `room:unspectate` sat outside the wrapper
// from the day spectating shipped, while server/socketSchemas.ts claimed to
// hold schemas "for every inbound socket event".
//
// Structural, like tests/orientation.test.ts and tests/tokenRoles.test.ts: the
// property is about how the code is written, so it is checked by reading it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(path.join(repoRoot, "server/socket.ts"), "utf8");

/**
 * Socket.io's own lifecycle events. These are not client-controlled messages —
 * nothing a client sends triggers them and there is no payload to validate —
 * so the wrapper has nothing to add.
 */
const LIFECYCLE = new Set(["disconnect", "disconnecting", "error"]);

test("no inbound socket event bypasses onEvent", () => {
  const raw = [...source.matchAll(/socket\.on\(\s*"([^"]+)"/g)].map((m) => m[1]);
  const bypassing = raw.filter((event) => !LIFECYCLE.has(event));

  assert.deepEqual(
    bypassing,
    [],
    `these events are registered with a bare socket.on and so are neither rate-limited ` +
      `nor contained: ${bypassing.join(", ")}. Register them with onEvent instead — ` +
      `NoPayloadSchema is there for the ones that take no payload.`
  );
});

// The counterpart: the wrapper is only worth anything if the events actually
// reach it, so a refactor that quietly stopped calling it should fail here too.
test("the events that exist are registered through the wrapper", () => {
  const wrapped = [...source.matchAll(/onEvent\(\s*\n\s*socket,\s*\n\s*"([^"]+)"/g)].map((m) => m[1]);

  assert.ok(
    wrapped.length >= 15,
    `only ${wrapped.length} events go through onEvent, which is fewer than this server has ` +
      `ever had — either the registrations moved or this test stopped finding them`
  );
  for (const required of [
    "room:spectate",
    "room:unspectate",
    "room:rejoin",
    "game:play",
    "game:pass",
  ]) {
    assert.ok(wrapped.includes(required), `${required} must go through onEvent`);
  }
});
