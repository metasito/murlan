// The game layer reaches Socket.IO and the stores through the table runtime
// alone, the socket handlers send table events through it alone, and tests
// reach Socket.IO through the recording runtime alone.
//
// Each rule is a function over sources, so it is run three ways: over the
// repo (no offender), over a file it must see (the floor: a pattern that has
// stopped matching anything passes by not looking), and over a planted breach.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { blankComments, sourcesUnder } from "../helpers/sourceScan.ts";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const game = (f: string) => path.posix.join("server", "game", f);
const socket = (f: string) => path.posix.join("server", "socket", f);

type Sources = [string, string][];

/** Comments name these on purpose; only code sends. */
const code = (src: string) => blankComments(src);

const NAMES_SOCKET_SERVER = /\bSocketServer\b|from "socket\.io"/;
/** A call on Socket.IO itself: `io.…` or `….transport.…`. */
const VIA_TRANSPORT = /\b(?:io|transport)\s*\./;
/** A send addressed through Socket.IO: `.to(…).emit(`, with or without `.timeout(…)`. */
const ARGS = String.raw`\((?:[^()]|\([^()]*\))*\)`;
const ADDRESSED_SEND = new RegExp(String.raw`\.to${ARGS}\s*(?:\.timeout${ARGS}\s*)?\.emit\(`);
const STORE_IMPORT = /from "\.\.\/store\/(?:roomStore|activeGameStore)\.ts"/;
/** retention.ts reaches the stores for `roomStore.purgeRooms` alone. */
const PAST_PURGE = /from "\.\.\/store\/activeGameStore\.ts"|\broomStore\s*(?:\.\s*(?!purgeRooms\b|ts")\w+|\[)|=\s*roomStore\b/;
/** A handler family reading Socket.IO off its context. */
const HANDLER_IO = /\{[^}]*\bio\b[^}]*\}\s*:\s*HandlerContext|\bctx\.io\b/;

const hits = (sources: Sources, pattern: RegExp, allowed: string[] = []) =>
  sources.filter(([file, src]) => !allowed.includes(file) && pattern.test(code(src))).map(([file]) => file);

/** Matches in `socketPresence.ts` outside its session-eviction functions. */
function presenceOutsideEviction(sources: Sources): string[] {
  return sources
    .filter(([file]) => file === socket("socketPresence.ts"))
    .flatMap(([file, src]) =>
      code(src)
        .split(/\n(?=(?:export )?(?:async )?function )/)
        .filter((chunk) => !/^(?:export )?(?:async )?function \w*[Ee]vict/.test(chunk) && VIA_TRANSPORT.test(chunk))
        .map(() => file)
    );
}

const rules = {
  gameNamesSocketServer: (s: Sources) => hits(s, NAMES_SOCKET_SERVER, [game("tableRuntime.ts"), game("tableRouter.ts")]),
  gameUsesTransport: (s: Sources) => hits(s, VIA_TRANSPORT, [game("tableRouter.ts")]),
  gameAddressesSends: (s: Sources) => hits(s, ADDRESSED_SEND),
  gameImportsStores: (s: Sources) =>
    hits(s, STORE_IMPORT, [game("tableRuntime.ts"), game("retention.ts")]).concat(
      hits(s.filter(([file]) => file === game("retention.ts")), PAST_PURGE)
    ),
  socketAddressesSends: (s: Sources) => hits(s, ADDRESSED_SEND, [socket("socketOutbox.ts")]),
  socketUsesTransport: (s: Sources) =>
    hits(s, VIA_TRANSPORT, [
      socket("socket.ts"),
      socket("socketOutbox.ts"),
      socket("seating.ts"),
      socket("socketRegistry.ts"),
      socket("socketPresence.ts"),
    ]).concat(presenceOutsideEviction(s)),
  handlerReadsIo: (s: Sources) => hits(s, HANDLER_IO),
};

const gameSources = () => sourcesUnder(ROOT, [path.posix.join("server", "game")]);
const socketSources = () => sourcesUnder(ROOT, [path.posix.join("server", "socket")]);

describe("the repo breaks no rule", () => {
  for (const [name, rule] of Object.entries(rules)) {
    test(name, () => {
      const sources = name.startsWith("game") ? gameSources() : socketSources();
      assert.deepEqual(rule(sources), []);
    });
  }
});

describe("each pattern still sees what it is about", () => {
  const read = (file: string) => [...gameSources(), ...socketSources()].find(([f]) => f === file)![1];
  const floors: [RegExp, string][] = [
    [NAMES_SOCKET_SERVER, game("tableRuntime.ts")],
    [VIA_TRANSPORT, game("tableRouter.ts")],
    [VIA_TRANSPORT, socket("socketPresence.ts")],
    [ADDRESSED_SEND, socket("socketOutbox.ts")],
    [STORE_IMPORT, game("tableRuntime.ts")],
    [STORE_IMPORT, game("retention.ts")],
  ];
  for (const [pattern, file] of floors) {
    test(`${pattern.source.slice(0, 24)}… matches ${file}`, () => {
      assert.ok(pattern.test(code(read(file))));
    });
  }

  test("HandlerContext carries the runtime and not Socket.IO", () => {
    const body = /export interface HandlerContext \{([^}]*)\}/.exec(read(socket("socketTypes.ts")))?.[1];
    assert.ok(body?.includes("rt:"), "socketTypes.ts no longer reads as this test expects");
    assert.ok(!/\bio\s*:/.test(body ?? ""), "a handler can reach Socket.IO past the runtime");
  });
});

describe("a planted breach is caught", () => {
  const plants: [keyof typeof rules, string, string][] = [
    ["gameNamesSocketServer", game("plant.ts"), 'import type { SocketServer } from "../socket/socketTypes.ts";'],
    ["gameUsesTransport", game("plant.ts"), "rt.transport.serverSideEmit(EVENT, action);"],
    ["gameAddressesSends", game("plant.ts"), 'out.to(userRoom(uid)).timeout(5).emit("game:state", s, ack);'],
    ["gameImportsStores", game("plant.ts"), 'import { roomStore } from "../store/roomStore.ts";'],
    ["gameImportsStores", game("retention.ts"), "await roomStore.getRoomById(id);"],
    ["gameImportsStores", game("retention.ts"), "const { getRoomById } = roomStore;"],
    ["gameImportsStores", game("retention.ts"), 'import { activeGameStore } from "../store/activeGameStore.ts";'],
    ["socketAddressesSends", socket("plant.ts"), 'io.to(roomId).emit("game:reaction", r);'],
    ["socketUsesTransport", socket("socketRooms.ts"), "rt.transport.in(roomId).fetchSockets();"],
    ["socketUsesTransport", socket("socketPresence.ts"), "export function announce() {\n  io.to(r);\n}"],
    ["handlerReadsIo", socket("plant.ts"), "export function registerX({ io, rt }: HandlerContext) {}"],
  ];
  for (const [rule, file, src] of plants) {
    test(`${rule} in ${file}`, () => {
      assert.deepEqual(rules[rule]([[file, src]]), [file]);
    });
  }
});

test("the runtime, and with it the routing listener, exists before the first connection", () => {
  const [[, setup]] = sourcesUnder(ROOT, [path.posix.join("server", "socket")], /^socket\.ts$/);
  const built = setup.indexOf("createTableRuntime(");
  const connects = setup.indexOf('io.on("connection"');
  assert.ok(built !== -1 && connects !== -1, "setupSocket no longer reads as this test expects");
  assert.ok(built < connects, "a table action forwarded before the runtime exists is answered by nobody");
});

test("the test suite builds a Socket.IO server by hand in one place", () => {
  // Assembled here so this file is not a hit of its own.
  const cast = new RegExp(["as unknown as", "SocketServer"].join(" "), "g");
  const found = sourcesUnder(ROOT, ["tests"]).flatMap(([file, src]) => (src.match(cast) ?? []).map(() => file));
  assert.deepEqual(found, [path.posix.join("tests", "helpers", "recordingRuntime.ts")]);
});
