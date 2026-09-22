import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

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

function sourcesUnder(dirs: string[]): [string, string][] {
  return dirs.flatMap((dir) =>
    readdirSync(path.join(root, dir), { recursive: true, encoding: "utf8" })
      .filter((f) => /\.tsx?$/.test(f))
      .map((f): [string, string] => [
        `${dir}/${f.split(path.sep).join("/")}`,
        readFileSync(path.join(root, dir, f), "utf8").replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, ""),
      ])
  );
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

const server = sourcesUnder(["server"]);
const client = sourcesUnder(["app", "components", "context", "lib"]);

const sites = {
  serverEmits: literalEvents(server, [
    /\.emit\(\s*"([^"]+)"/g,
    /\bemitToUser\(\s*[^,]+,\s*"([^"]+)"/g,
    /\btellInvitees\(\s*[^,]+,\s*[^,]+,\s*"([^"]+)"/g,
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

const PROBE_HEADER = [
  `import type { Socket } from "../../lib/socket.ts";`,
  `import type { GameSocket, SocketServer } from "../../server/socket/socketTypes.ts";`,
  `import { send, sendIntent } from "../../lib/sendIntent.ts";`,
  `import { emitToUser } from "../../server/socket/socketRegistry.ts";`,
  `import { onEvent } from "../../server/socket/socketSafety.ts";`,
  `import { GamePlaySchema, GameRejoinSchema } from "../../shared/socketSchemas.ts";`,
  `declare const client: Socket, io: SocketServer, socket: GameSocket;`,
  "",
].join("\n");

const ACCEPTED = [
  `client.emit("friend:get_online_list");`,
  `void send(client, "game:play", { cardIds: ["a"] });`,
  `emitToUser("u", "friend:status", { userId: "u", online: true });`,
  `onEvent(socket, "game:play", GamePlaySchema, () => undefined);`,
];

const REFUSED = [
  `client.emit("room:unlisted");`,
  `client.on("game:unlisted", () => {});`,
  `void send(client, "room:unlisted");`,
  `void sendIntent(client, "game:play", { cardId: "a" });`,
  `io.to("r").emit("game:unlisted");`,
  `socket.emit("game:vote_state", { votes: 1, total: 2 });`,
  `emitToUser("u", "friend:unlisted", {});`,
  `emitToUser("u", "friend:status", { userId: "u" });`,
  `onEvent(socket, "game:unlisted", GamePlaySchema, () => undefined);`,
  `onEvent(socket, "game:play", GameRejoinSchema, () => undefined);`,
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
