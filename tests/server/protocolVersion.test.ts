import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { MIN_PROTOCOL_VERSION, PROTOCOL_VERSION } from "../../shared/protocol.ts";
import { atMain, rewritten } from "../helpers/appendOnly.ts";
import { PROTOCOL_HASHES as HASHES, protocolHash } from "../helpers/protocolHash.ts";

const root = path.resolve(import.meta.dirname, "..", "..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8").replace(/\r\n/g, "\n");

test("a recorded hash dropped or rewritten is named, and one added is not", () => {
  assert.deepEqual(rewritten({ "1": "a", "2": "b", "3": "c" }, { "1": "a", "3": "x", "4": "d" }), ["2: was b, now missing", "3: was c, now x"]);
});

test("shared/protocol.ts does not change without a PROTOCOL_VERSION bump", () => {
  const source = read("shared/protocol.ts");
  const recorded: Record<string, string> = JSON.parse(read(HASHES));
  assert.notEqual(
    protocolHash(source.replace("handCount", "cardCount")),
    protocolHash(source),
    "a renamed field must move the hash"
  );
  assert.equal(
    protocolHash(source.replaceAll("../lib/game/", "../lib/")),
    protocolHash(source),
    "a moved import must not move the hash"
  );
  assert.notEqual(
    protocolHash(source.replace('"handCount"', '"cardCount"')),
    protocolHash(source),
    "a renamed string literal must move the hash"
  );
  const base = atMain(HASHES) as Record<string, string> | undefined;
  if (base) assert.deepEqual(rewritten(base, recorded), [], `${HASHES} only grows: \`npm run regen\` restores what origin/main records`);
  const hash = protocolHash(source);
  // assert.ok, not equal: equal's report prints the hash, and a hash pasted from a log skips the
  // generator's refusal to replace what origin/main records.
  assert.ok(
    recorded[String(PROTOCOL_VERSION)] === hash,
    recorded[String(PROTOCOL_VERSION)] !== undefined
      ? `shared/protocol.ts changed at PROTOCOL_VERSION ${PROTOCOL_VERSION}. Bump PROTOCOL_VERSION in shared/protocol.ts, then run \`npm run regen\`.`
      : `no protocol hash is recorded for PROTOCOL_VERSION ${PROTOCOL_VERSION}: run \`npm run regen\`. ` +
          `Raise MIN_PROTOCOL_VERSION if bundles already in the field cannot read the change.`
  );
  assert.ok(MIN_PROTOCOL_VERSION >= 1 && MIN_PROTOCOL_VERSION <= PROTOCOL_VERSION);
});

test("the server's sockets are typed with the protocol's event maps", () => {
  const untyped = readdirSync(path.join(root, "server"), { recursive: true, encoding: "utf8" })
    .map((f) => f.split(path.sep).join("/"))
    .filter((f) => f.endsWith(".ts") && f !== "socket/socketTypes.ts")
    .filter((f) => /import\s+(?:type\s+)?\{[^}]*\b(?:Server|Socket)\b[^}]*\}\s+from\s+"socket\.io"/.test(read(`server/${f}`)))
    .filter((f) => !(f === "socket/socket.ts" && /new Server<ClientToServerEvents, ServerToClientEvents>/.test(read("server/socket/socket.ts"))));
  assert.deepEqual(untyped, [], "import SocketServer/GameSocket from server/socket/socketTypes.ts instead");
});
