// The game layer reaches Socket.IO through the table runtime alone, and tests
// reach it through the recording runtime alone.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { sourcesUnder } from "../helpers/sourceScan.ts";

const ROOT = path.resolve(import.meta.dirname, "..", "..");

/** The runtime holds `transport`; the router is the one module that drives it. */
const NAMES_SOCKET_IO = ["tableRuntime.ts", "tableRouter.ts"].map((f) => path.posix.join("server", "game", f));

test("no module in the game layer names the Socket.IO server but the runtime and the router", () => {
  const offenders = sourcesUnder(ROOT, [path.posix.join("server", "game")])
    .filter(([file]) => !NAMES_SOCKET_IO.includes(file))
    .filter(([, src]) => /\bSocketServer\b|from "socket\.io"/.test(src))
    .map(([file]) => file);
  assert.deepEqual(offenders, []);
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
  const hits = sourcesUnder(ROOT, ["tests"]).flatMap(([file, src]) =>
    (src.match(cast) ?? []).map(() => file)
  );
  assert.deepEqual(hits, [path.posix.join("tests", "helpers", "recordingRuntime.ts")]);
});
