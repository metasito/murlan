import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { blankCommentsAndStrings, sourcesUnder } from "./helpers/sourceScan.ts";
import { stopSpectatingEverywhere } from "../server/seating.ts";
import type { SocketServer } from "../server/socketTypes.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("a socket takes a seat only through seatSocket", () => {
  const writers = sourcesUnder(repoRoot, ["server"])
    .filter(([, src]) => /\bsocketRoomMap\.set\(/.test(blankCommentsAndStrings(src)))
    .map(([file]) => file);
  assert.deepEqual(writers, ["server/seating.ts"]);
});

test("stopping a player spectating everywhere waits for every other instance", async () => {
  let ack: (() => void) | undefined;
  const io = {
    serverSideEmit: (_event: string, _userId: string, reply: () => void) => {
      ack = reply;
    },
    sockets: { adapter: { rooms: new Map() }, sockets: new Map() },
  } as unknown as SocketServer;
  let settled = false;
  const stopped = stopSpectatingEverywhere(io, "u1").then(() => (settled = true));
  await new Promise((r) => setImmediate(r));
  assert.equal(settled, false);
  ack?.();
  await stopped;
  assert.equal(settled, true);
});
