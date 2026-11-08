// tests/tooling/socketTeardownOwner.test.ts — a client socket is closed only by lib/socket.ts, which waits out a connecting websocket.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { sourcesUnder } from "../helpers/sourceScan.ts";

const root = path.resolve(import.meta.dirname, "..", "..");
const PRODUCTION = ["app", "components", "context", "lib"];
const OWNER = ["lib", "socket.ts"].join("/");
const CLOSE = /\bsocket\w*\??\.(disconnect|close)\s*\(/i;

const offenders = (sources: [string, string][]) =>
  sources.filter(([file, text]) => file !== OWNER && CLOSE.test(text.replace(/\/\/.*$/gm, ""))).map(([file]) => file);

test("no production file closes a client socket except lib/socket.ts", () => {
  const sources = sourcesUnder(root, PRODUCTION);
  assert.deepEqual(offenders(sources), []);
});

test("the scan sees a bypass", () => {
  assert.deepEqual(offenders([["context/X.tsx", "socket?.disconnect().connect();"]]), ["context/X.tsx"]);
  assert.deepEqual(offenders([["context/X.tsx", "socket.disconnect();"]]), ["context/X.tsx"]);
  assert.deepEqual(offenders([["context/X.tsx", "closeSocket(socket);"]]), []);
});
