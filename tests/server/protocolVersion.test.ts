import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { MIN_PROTOCOL_VERSION, PROTOCOL_VERSION } from "../../shared/protocol.ts";

const root = path.resolve(import.meta.dirname, "..", "..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8").replace(/\r\n/g, "\n");

/** Hashes the tokens, so a comment — which never reaches the wire — needs no bump. */
function protocolHash(source: string): string {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, source);
  const tokens: string[] = [];
  while (scanner.scan() !== ts.SyntaxKind.EndOfFileToken) tokens.push(scanner.getTokenText());
  return createHash("sha256").update(tokens.join(" ")).digest("hex");
}

test("shared/protocol.ts does not change without a PROTOCOL_VERSION bump", () => {
  const source = read("shared/protocol.ts");
  const recorded: Record<string, string> = JSON.parse(read("tests/fixtures/protocolHashes.json"));
  assert.notEqual(
    protocolHash(source.replace("handCount", "cardCount")),
    protocolHash(source),
    "a renamed field must move the hash"
  );
  assert.equal(
    recorded[String(PROTOCOL_VERSION)],
    protocolHash(source),
    `shared/protocol.ts changed at PROTOCOL_VERSION ${PROTOCOL_VERSION}. Bump it, record the new hash ` +
      "under the new version in tests/fixtures/protocolHashes.json, and raise MIN_PROTOCOL_VERSION if " +
      "bundles already in the field cannot read the change."
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
