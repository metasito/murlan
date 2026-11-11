import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { MIN_PROTOCOL_VERSION, PROTOCOL_VERSION } from "../../shared/protocol.ts";
import { atMain, rewritten } from "../helpers/appendOnly.ts";

const root = path.resolve(import.meta.dirname, "..", "..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8").replace(/\r\n/g, "\n");
const HASHES = "tests/fixtures/protocolHashes.json";

test("a recorded hash dropped or rewritten is named, and one added is not", () => {
  assert.deepEqual(rewritten({ "1": "a", "2": "b", "3": "c" }, { "1": "a", "3": "x", "4": "d" }), ["2: was b, now missing", "3: was c, now x"]);
});

/** Hashes the tokens bar module paths, so a comment or a moved import — neither reaches the wire — needs no bump. */
function protocolHash(source: string): string {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, source);
  const tokens: string[] = [];
  while (scanner.scan() !== ts.SyntaxKind.EndOfFileToken) {
    const modulePath = scanner.getToken() === ts.SyntaxKind.StringLiteral && ["from", "import"].includes(tokens.at(-1) ?? "");
    tokens.push(modulePath ? "<module>" : scanner.getTokenText());
  }
  return createHash("sha256").update(tokens.join(" ")).digest("hex");
}

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
  if (base) assert.deepEqual(rewritten(base, recorded), [], `${HASHES} only grows: restore what origin/main records`);
  const hash = protocolHash(source);
  const missing = recorded[String(PROTOCOL_VERSION)] === undefined;
  // assert.ok, not equal: equal's report prints the hash, and a hash handed out where the base
  // cannot be read is one pasted over the entry it replaces.
  const rerun = "Rerun `node --test tests/server/protocolVersion.test.ts` in a clone that holds origin/main: it prints the entry to add.";
  assert.ok(
    recorded[String(PROTOCOL_VERSION)] === hash,
    !missing
      ? `shared/protocol.ts changed at PROTOCOL_VERSION ${PROTOCOL_VERSION}. Bump PROTOCOL_VERSION in shared/protocol.ts. ${rerun}`
      : base
        ? `no protocol hash is recorded for PROTOCOL_VERSION ${PROTOCOL_VERSION}: add "${PROTOCOL_VERSION}": "${hash}" ` +
          `to ${HASHES}. Raise MIN_PROTOCOL_VERSION if bundles already in the field cannot read the change.`
        : `no protocol hash is recorded for PROTOCOL_VERSION ${PROTOCOL_VERSION}. ${rerun}`
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
