// tests/socketEvents.test.ts — the socket protocol has two ends and neither may
// drift from the other.
//
// Inbound: `onEvent` (server/socketSafety.ts) is what validates a payload,
// rate-limits the account behind the socket, and contains a throwing handler so
// it reports as an error on that one socket instead of escaping into the
// process guards. An event registered with a bare `socket.on` gets none of
// that, and is exactly the one nobody remembers to check — `room:unspectate`
// sat outside the wrapper from the day spectating shipped, while
// server/socketSchemas.ts claimed to hold schemas "for every inbound socket
// event".
//
// Outbound: an event the server emits and no client listens for is dead weight
// that reads as live protocol. `game:match_over` duplicated four fields
// `game:over` already carried, and `room:player_left` announced a departure the
// `room:state` two lines above had already applied.
//
// Structural, like tests/orientation.test.ts and tests/tokenRoles.test.ts: the
// property is about how the code is written, so it is checked by reading it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** [repoRelativePath, source] for every matching file under `dir`, recursively. */
function sourcesUnder(dir: string, extensions: string[]): [string, string][] {
  return readdirSync(path.join(repoRoot, dir), { recursive: true, encoding: "utf8" })
    .filter((f) => extensions.some((e) => f.endsWith(e)))
    .map((f): [string, string] => [
      `${dir}/${f.split(path.sep).join("/")}`,
      readFileSync(path.join(repoRoot, dir, f), "utf8"),
    ]);
}

const serverSources = () => sourcesUnder("server", [".ts"]);

/** Everywhere a client registers socket listeners. */
const CLIENT_DIRS = ["app", "components", "context", "lib"];

const clientSources = () => CLIENT_DIRS.flatMap((d) => sourcesUnder(d, [".ts", ".tsx"]));

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

/**
 * Server events that deliberately have no client listener. An entry without a
 * reason is an entry nobody can ever retire.
 */
const FIRE_AND_FORGET = new Map<string, string>([
  [
    "game:started",
    "a lifecycle signal the integration suites wait on; the app navigates on gameState " +
      "becoming non-null instead, because a one-shot event is lost outright if it lands " +
      "while a client is reconnecting",
  ],
]);

/**
 * The two places an event name is computed rather than written out. Both stay
 * inside the scan's reach: `emitToUser`'s callers name the event with a
 * literal, and `errorEventFor` maps an inbound name onto one of the four
 * `*:error` events, each emitted literally elsewhere too. Anything else
 * computing a name is outside the reach of `literalEmittedEvents` and so has to
 * come back here first.
 */
const COMPUTED_EVENT_NAMES = new Set(["event", "errorEventFor(event)"]);

/**
 * Both shapes an outbound event takes: `<anything>.emit(name, …)` — covering
 * `socket.emit`, `io.emit` and `io.to(x).emit` — and `emitToUser(userId, name,
 * …)`, the dispatcher server/routes.ts reaches sockets through.
 */
const EMIT_PATTERNS = [
  /\.emit\(\s*(["'`])((?:(?!\1).)*)\1/gs,
  /\bemitToUser\(\s*[^,]*,\s*(["'`])((?:(?!\1).)*)\1/gs,
];

/** Every literally-named emitted event, mapped to the `file:line` of each emit. */
function literalEmittedEvents(sources: [string, string][]): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const [file, source] of sources) {
    const clean = stripComments(source);
    for (const pattern of EMIT_PATTERNS) {
      for (const m of clean.matchAll(pattern)) {
        if (m[1] === "`" && m[2].includes("${")) continue;
        const line = clean.slice(0, m.index).split("\n").length;
        found.set(m[2], [...(found.get(m[2]) ?? []), `${file}:${line}`]);
      }
    }
  }
  return found;
}

/** `file:line — expression` for every `.emit(` whose event name is not a string literal. */
function computedEmitCalls(file: string, source: string): string[] {
  const clean = stripComments(source);
  return [...clean.matchAll(/\.emit\((?!\s*["'`])\s*([^\n,]*)/g)]
    .filter((m) => !COMPUTED_EVENT_NAMES.has(m[1].trim()))
    .map((m) => `${file}:${clean.slice(0, m.index).split("\n").length} — ${m[1].trim()}`);
}

/** Every event name a client hands to `socket.on`. */
function listenedEvents(sources: [string, string][]): Set<string> {
  return new Set(sources.flatMap(([, source]) => literalSocketOnEvents(source)));
}

function unlistenedEmits(
  emitted: Map<string, string[]>,
  listened: Set<string>
): string[] {
  return [...emitted]
    .filter(([event]) => !listened.has(event) && !FIRE_AND_FORGET.has(event))
    .map(([event, sites]) => `${event} (${sites.join(", ")})`);
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

test("every event the server emits has a client listener", () => {
  const orphaned = unlistenedEmits(
    literalEmittedEvents(serverSources()),
    listenedEvents(clientSources())
  );

  assert.deepEqual(
    orphaned,
    [],
    `the server emits these and nothing in ${CLIENT_DIRS.join("/, ")}/ listens:\n` +
      `${orphaned.join("\n")}\n` +
      `Delete the emit, or add the event to FIRE_AND_FORGET with the reason it has no listener.`
  );
});

test("no .emit call names its event with anything but a string literal", () => {
  const offenders = serverSources().flatMap(([file, source]) =>
    computedEmitCalls(file, source)
  );
  assert.deepEqual(
    offenders,
    [],
    `.emit called with a computed event name — this is invisible to the outbound scan above:\n${offenders.join("\n")}`
  );
});

test("the outbound scanner reads every emit shape the server uses", () => {
  const shapes = literalEmittedEvents([
    [
      "server/example.ts",
      [
        'socket.emit("game:a", {});',
        'io.emit("game:b", {});',
        'io.to(roomId).emit("game:c", {});',
        "io.to(roomId).emit(\n  'game:d',\n  payload\n);",
        "replaced.emit(`game:e`, {});",
        'emitToUser(friend.id, "game:f", {});',
        "socket.emit(`game:${x}`, {});",
      ].join("\n"),
    ],
  ]);
  assert.deepEqual(
    [...shapes.keys()].sort(),
    ["game:a", "game:b", "game:c", "game:d", "game:e", "game:f"]
  );
  assert.deepEqual(shapes.get("game:d"), ["server/example.ts:4"]);
});

test("the outbound scanner catches an emitted event nothing listens for", () => {
  const emitted = literalEmittedEvents([
    ["server/example.ts", 'io.to(roomId).emit("game:ghost", {});\nsocket.emit("game:state", {});'],
  ]);
  assert.deepEqual(unlistenedEmits(emitted, new Set(["game:state"])), [
    "game:ghost (server/example.ts:1)",
  ]);
  assert.deepEqual(
    unlistenedEmits(emitted, new Set(["game:state", "game:ghost"])),
    []
  );
});

test("the computed-name scanner catches a constant event name", () => {
  assert.deepEqual(
    computedEmitCalls("server/example.ts", "io.to(roomId).emit(EVENT, payload);"),
    ["server/example.ts:1 — EVENT"]
  );
  assert.deepEqual(
    computedEmitCalls("server/example.ts", "_io.to(socketId).emit(event, data);"),
    []
  );
});
