// tests/server/rejoinFailure.test.ts — what `game:rejoin_failed` carries, without a database:
// the { code, message } a client renders, and the roomId its stale-reply guard matches.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rejoinFailure } from "../../server/socket/rejoinFailure.ts";
import { payload } from "../../server/shared/payload.ts";

const SOCKET_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "server", "socket");

test("a refusal the table gave is sent as its rendered payload, with the roomId", () => {
  assert.deepEqual(rejoinFailure("SEAT_RELEASED", "R1"), { ...payload("SEAT_RELEASED"), roomId: "R1" });
  assert.deepEqual(rejoinFailure("NO_LIVE_GAME", "R1"), { ...payload("GAME_NOT_FOUND"), roomId: "R1" });
});

test("a code the table has no reason for is a server error, and a roomId that is not a string is dropped", () => {
  assert.deepEqual(rejoinFailure("constructor", 42), { ...payload("SERVER_ERROR"), roomId: undefined });
});

test("the rejoin failure is emitted from one place, through rejoinFailure()", () => {
  const sites = ["socket.ts", "socketRooms.ts", "socketGameplay.ts", "rejoinFailure.ts"]
    .flatMap((f) => readFileSync(path.join(SOCKET_DIR, f), "utf8").split("\n"))
    .filter((line) => line.includes('"game:rejoin_failed"'));
  assert.equal(sites.length, 1, "a second emit is a second contract");
  assert.match(sites[0]!, /rejoinFailure\(/, `the emit does not send what rejoinFailure() builds: ${sites[0]!.trim()}`);
});
