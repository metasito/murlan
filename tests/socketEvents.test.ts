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
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** [repoRelativePath, source] for every .ts file directly under server/. */
function serverSources(): [string, string][] {
  return readdirSync(path.join(repoRoot, "server"))
    .filter((f) => f.endsWith(".ts"))
    .map((f): [string, string] => [
      `server/${f}`,
      readFileSync(path.join(repoRoot, "server", f), "utf8"),
    ]);
}

/**
 * Socket.io's own lifecycle events. These are not client-controlled messages —
 * nothing a client sends triggers them and there is no payload to validate —
 * so the wrapper has nothing to add.
 */
const LIFECYCLE = new Set(["disconnect", "disconnecting", "error"]);

/**
 * `onEvent` itself registers with `socket.on(event, …)`, where `event` is its
 * own string-typed parameter — the wrapper's implementation, not a bypass of
 * it. Nothing else may register this way.
 */
const WRAPPER_FILE = "server/socketSafety.ts";

/** Blanks out line and block comments, preserving line numbers and string contents. */
function stripComments(source: string): string {
  return source.replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, (m) => m.replace(/[^\n]/g, " "));
}

/** Every literal event name passed to a bare `socket.on(…)` call, double or single quoted or backtick-without-interpolation. */
function literalSocketOnEvents(source: string): string[] {
  return [...stripComments(source).matchAll(/socket\.on\(\s*(["'`])((?:(?!\1).)*)\1/gs)]
    .filter((m) => m[1] !== "`" || !m[2].includes("${"))
    .map((m) => m[2]);
}

/** `file:line` for every `socket.on(` whose first argument is not a string literal. */
function nonLiteralSocketOnCalls(file: string, source: string): string[] {
  const out: string[] = [];
  const clean = stripComments(source);
  for (const m of clean.matchAll(/socket\.on\(\s*/g)) {
    if (file === WRAPPER_FILE) continue;
    const next = clean[m.index + m[0].length];
    if (next === '"' || next === "'" || next === "`") continue;
    out.push(`${file}:${clean.slice(0, m.index).split("\n").length}`);
  }
  return out;
}

test("no inbound socket event bypasses onEvent", () => {
  const bypassing: string[] = [];
  for (const [file, source] of serverSources()) {
    for (const event of literalSocketOnEvents(source)) {
      if (LIFECYCLE.has(event)) continue;
      bypassing.push(`${file}: ${event}`);
    }
  }

  assert.deepEqual(
    bypassing,
    [],
    `these events are registered with a bare socket.on and so are neither rate-limited ` +
      `nor contained: ${bypassing.join(", ")}. Register them with onEvent instead — ` +
      `NoPayloadSchema is there for the ones that take no payload.`
  );
});

// A single-quoted, backtick, or constant-named registration matches neither
// the literal scan above nor onEvent's own call shape — it would otherwise
// bypass both checks in this file at once.
test("no socket.on call names its event with anything but a string literal", () => {
  const offenders: string[] = [];
  for (const [file, source] of serverSources()) {
    offenders.push(...nonLiteralSocketOnCalls(file, source));
  }
  assert.deepEqual(
    offenders,
    [],
    `socket.on called with a non-literal event name — this bypasses the literal-event scan above:\n${offenders.join("\n")}`
  );
});

test("the literal-event scanner catches single quotes, backticks and files beyond socket.ts", () => {
  assert.deepEqual(literalSocketOnEvents('socket.on("room:x", () => {});'), ["room:x"]);
  assert.deepEqual(literalSocketOnEvents("socket.on('room:x', () => {});"), ["room:x"]);
  assert.deepEqual(literalSocketOnEvents("socket.on(`room:x`, () => {});"), ["room:x"]);
  assert.deepEqual(literalSocketOnEvents("socket.on(`room:${x}`, () => {});"), []);
});

test("the non-literal scanner catches a constant event name", () => {
  assert.deepEqual(
    nonLiteralSocketOnCalls("server/example.ts", "socket.on(EVENT, () => {});"),
    ["server/example.ts:1"]
  );
  assert.deepEqual(
    nonLiteralSocketOnCalls(WRAPPER_FILE, "socket.on(event, () => {});"),
    []
  );
});

// The counterpart: the wrapper is only worth anything if the events actually
// reach it, so a refactor that quietly stopped calling it should fail here too.
test("the events that exist are registered through the wrapper", () => {
  const source = readFileSync(path.join(repoRoot, "server/socket.ts"), "utf8");
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
