import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { blankCommentsAndStrings, sourcesUnder } from "../helpers/sourceScan.ts";
import { stopSpectatingEverywhere } from "../../server/socket/seating.ts";
import { recordingRuntime } from "../helpers/recordingRuntime.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

test("a socket takes a seat only through seatSocket", () => {
  const writers = sourcesUnder(repoRoot, ["server"])
    .filter(([, src]) => /\bsocketRoomMap\.set\(/.test(blankCommentsAndStrings(src)))
    .map(([file]) => file);
  assert.deepEqual(writers, ["server/socket/seating.ts"]);
});

test("stopping a player spectating everywhere waits for every other instance", async () => {
  let ack: (() => void) | undefined;
  const { rt } = recordingRuntime({
    transport: {
      serverSideEmit: (_event: string, _userId: string, reply: () => void) => {
        ack = reply;
      },
    },
  });
  let settled = false;
  const stopped = stopSpectatingEverywhere(rt, "u1").then(() => (settled = true));
  await new Promise((r) => setImmediate(r));
  assert.equal(settled, false);
  ack?.();
  await stopped;
  assert.equal(settled, true);
});
