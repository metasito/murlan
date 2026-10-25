import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import ts from "typescript";
import { blankComments, sourcesUnder } from "../helpers/sourceScan.ts";

const root = path.resolve(import.meta.dirname, "..", "..");
const protocolFile = path.join(root, "shared", "protocol.ts");

const options = ts.getParsedCommandLineOfConfigFile(path.join(root, "tsconfig.json"), {}, {
  ...ts.sys,
  onUnRecoverableConfigFileDiagnostic: (d) => assert.fail(ts.flattenDiagnosticMessageText(d.messageText, "\n")),
})!.options;

function eventMaps() {
  const program = ts.createProgram([protocolFile], options);
  const checker = program.getTypeChecker();
  const exports = checker.getExportsOfModule(checker.getSymbolAtLocation(program.getSourceFile(protocolFile)!)!);
  const map = (name: string) => {
    const type = checker.getDeclaredTypeOfSymbol(exports.find((s) => s.name === name)!);
    return {
      names: new Set(checker.getPropertiesOfType(type).map((p) => p.name)),
      open: checker.getIndexInfosOfType(type).length > 0,
    };
  };
  return { toClient: map("ServerToClientEvents"), toServer: map("ClientToServerEvents") };
}

const RESERVED = new Set(["connect", "disconnect", "connect_error", "disconnecting", "error"]);

function codeUnder(dirs: string[]): [string, string][] {
  return sourcesUnder(root, dirs).map(([file, text]): [string, string] => [file, blankComments(text)]);
}

/** `event (file)` for every literal event name one of `patterns` captures. */
function literalEvents(sources: [string, string][], patterns: RegExp[]): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const [file, source] of sources) {
    for (const pattern of patterns) {
      for (const m of source.matchAll(pattern)) found.set(m[1], [...(found.get(m[1]) ?? []), file]);
    }
  }
  return found;
}

const server = codeUnder(["server"]);
const client = codeUnder(["app", "components", "context", "lib"]);

/** `onEvent`'s default refusal channel: every event `errorEventFor`'s return type names, at the file emitting through it. */
function errorEventEmits(sources: [string, string][]): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const [file, source] of sources) {
    const declared = /function errorEventFor\([^)]*\):\s*([^{]+)\{/.exec(source)?.[1];
    if (!declared || !/\.emit\(\s*errorEventFor\(/.test(source)) continue;
    for (const m of declared.matchAll(/"([^"]+)"/g)) found.set(m[1], [...(found.get(m[1]) ?? []), file]);
  }
  return found;
}

const sites = {
  serverEmits: new Map([
    ...errorEventEmits(server),
    ...literalEvents(server, [
      /\.emit\(\s*"([^"]+)"/g,
      /\bemitToUser\(\s*[^,]+,\s*"([^"]+)"/g,
      /\btellInvitees\(\s*[^,]+,\s*[^,]+,\s*"([^"]+)"/g,
    ]),
  ]),
  serverListens: literalEvents(server, [/\bonEvent\(\s*\w+,\s*"([^"]+)"/g]),
  clientEmits: literalEvents(client, [/\.emit\(\s*"([^"]+)"/g, /\bsend(?:Intent)?\(\s*[\w.?]+,\s*"([^"]+)"/g, /\bdeliver\(\s*"([^"]+)"/g]),
  clientListens: literalEvents(client, [/socket\??\.(?:on|once|off)\(\s*"([^"]+)"/g]),
};

const { toClient, toServer } = eventMaps();

const absent = (found: Map<string, string[]>, names: Set<string>) =>
  [...found].filter(([event]) => !names.has(event) && !RESERVED.has(event)).map(([e, f]) => `${e} (${f.join(", ")})`);

test("neither event map accepts a name it does not list", () => {
  assert.equal(toClient.open, false, "ServerToClientEvents has an index signature, so any event name compiles");
  assert.equal(toServer.open, false, "ClientToServerEvents has an index signature, so any event name compiles");
});

test("every literal event name sent or listened for is in the typed maps", () => {
  assert.deepEqual(absent(sites.serverEmits, toClient.names), [], "server emits missing from ServerToClientEvents");
  assert.deepEqual(absent(sites.clientListens, toClient.names), [], "client listeners missing from ServerToClientEvents");
  assert.deepEqual(absent(sites.clientEmits, toServer.names), [], "client emits missing from ClientToServerEvents");
  assert.deepEqual(absent(sites.serverListens, toServer.names), [], "server listeners missing from ClientToServerEvents");
});

test("every event-shaped literal on either end is in a typed map", () => {
  const named = literalEvents([...server, ...client], [/"((?:room|game|friend|socket):\w+)"/g]);
  assert.deepEqual(absent(named, new Set([...toClient.names, ...toServer.names])), []);
});

const SOCKET_CAST = /\b(?:socket|io|_io)\b[^\n;]*\bas (?:any|unknown|never)\b|\bas (?:any|unknown|never)\b[^\n;]*\.(?:emit|on|once|off)\(/;

test("no socket call is cast past the typed maps", () => {
  assert.ok(SOCKET_CAST.test(`(socket as any).emit("x", 1);`) && SOCKET_CAST.test(`io.to(r).emit(e as never);`));
  const cast = [...server, ...client].flatMap(([file, source]) =>
    source.split("\n").flatMap((line, i) => (SOCKET_CAST.test(line) ? [`${file}:${i + 1}`] : []))
  );
  assert.deepEqual(cast, []);
});

const PROBE_HEADER = [
  `import type { Socket } from "../../lib/socket.ts";`,
  `import type { GameSocket, SocketServer } from "../../server/socket/socketTypes.ts";`,
  `import { send, sendIntent } from "../../lib/sendIntent.ts";`,
  `import { emitToUser } from "../../server/socket/socketRegistry.ts";`,
  `import { onEvent } from "../../server/socket/socketSafety.ts";`,
  `import { OK } from "../../server/shared/refusal.ts";`,
  `import { GamePlaySchema, GameRejoinSchema } from "../../shared/socketSchemas.ts";`,
  `declare const client: Socket, io: SocketServer, socket: GameSocket;`,
  "",
].join("\n");

const ACCEPTED = [
  `client.emit("friend:get_online_list");`,
  `void send(client, "game:play", { cardIds: ["a"], turn: "t" });`,
  `void send(client, "game:rematch_vote");`,
  `void send(client, "room:start", undefined, { retry: false });`,
  `emitToUser("u", "friend:status", { userId: "u", online: true });`,
  `onEvent(socket, "game:play", GamePlaySchema, () => OK);`,
];

const REFUSED = [
  `client.emit("room:unlisted");`,
  `client.on("game:unlisted", () => {});`,
  `void send(client, "room:unlisted");`,
  `void sendIntent(client, "game:play", { cardId: "a" });`,
  `void send(client, "game:play", { cardIds: ["a"] });`,
  `void send(client, "game:pass");`,
  `void sendIntent(client, "game:pass");`,
  `io.to("r").emit("game:unlisted");`,
  `socket.emit("game:vote_state", { votes: 1, total: 2 });`,
  `emitToUser("u", "friend:unlisted", {});`,
  `emitToUser("u", "friend:status", { userId: "u" });`,
  `onEvent(socket, "game:unlisted", GamePlaySchema, () => OK);`,
  `onEvent(socket, "game:play", GameRejoinSchema, () => OK);`,
  `onEvent(socket, "game:play", GamePlaySchema, () => undefined);`,
];

test("every typed send and listen refuses a name or payload the maps do not hold", () => {
  const probe = path.join(root, "tests", "server", "protocolProbe.ts");
  const header = PROBE_HEADER.split("\n").length - 1;
  const text = PROBE_HEADER + [...ACCEPTED, ...REFUSED].join("\n");
  const host = ts.createCompilerHost(options);
  const read = host.getSourceFile;
  host.getSourceFile = (file, ...rest) =>
    path.resolve(file) === probe ? ts.createSourceFile(file, text, ts.ScriptTarget.Latest) : read(file, ...rest);
  const program = ts.createProgram([probe], options, host);
  const file = program.getSourceFile(probe)!;
  const failing = new Set(
    program.getSemanticDiagnostics(file).map((d) => file.getLineAndCharacterOfPosition(d.start!).line - header)
  );
  const lines = [...ACCEPTED, ...REFUSED];
  assert.deepEqual(lines.filter((_, i) => failing.has(i)), REFUSED);
});

test("every event in the maps is sent by one end and heard by the other", () => {
  const unused = (names: Set<string>, sent: Map<string, string[]>, heard: Map<string, string[]>) =>
    [...names].filter((e) => !sent.has(e) || !heard.has(e));
  assert.deepEqual(unused(toClient.names, sites.serverEmits, sites.clientListens), []);
  assert.deepEqual(unused(toServer.names, sites.clientEmits, sites.serverListens), []);
});
