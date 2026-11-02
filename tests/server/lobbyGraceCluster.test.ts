// The lobby grace expires on the instance that saw the socket go; the player may be back at the
// table through another instance, which only presence can say.
import { test } from "node:test";
import assert from "node:assert/strict";
import { recordingRuntime } from "../helpers/recordingRuntime.ts";
import { storePresence } from "../../server/socket/socketOutbox.ts";
import { armLobbyGrace } from "../../server/socket/socketTable.ts";
import { clearLobbyGrace } from "../../server/game/gameTimers.ts";
import { installClock } from "../../server/http/clock.ts";
import { roomStore } from "../../server/store/roomStore.ts";
import { socketRoomMap, userSocketMap } from "../../server/game/gameRoom.ts";

const ROOM = "lobby-grace-cluster-room";
const USER = "back-elsewhere";

test("a seat is kept for a player back at the table on another instance", async (t) => {
  const expiries: (() => void)[] = [];
  const restoreClock = installClock({ now: () => 0, setTimeout: (fn) => expiries.push(fn), clearTimeout: () => {} });
  t.after(() => {
    restoreClock();
    clearLobbyGrace(ROOM, USER);
  });
  const released = t.mock.method(roomStore, "releaseSeat", async () => null);
  const { rt } = recordingRuntime({
    presence: storePresence(async () => new Map([[USER, { instance: "elsewhere", socket: "s", table: ROOM }]])),
  });

  const asked = t.mock.method(rt.presence, "isAtTable");

  armLobbyGrace(rt, ROOM, USER);
  assert.equal(expiries.length, 1);
  expiries[0]();
  assert.equal(await asked.mock.calls[0]?.result, true, "the expiry did not find the player at the table");

  assert.equal(released.mock.callCount(), 0, "the seat was released from under a player at the table");
});

test("a seat is kept for a player at the table here when presence does not answer", async (t) => {
  const expiries: (() => void)[] = [];
  const restoreClock = installClock({ now: () => 0, setTimeout: (fn) => expiries.push(fn), clearTimeout: () => {} });
  userSocketMap.set(USER, "local-socket");
  socketRoomMap.set("local-socket", ROOM);
  t.after(() => {
    restoreClock();
    clearLobbyGrace(ROOM, USER);
    userSocketMap.delete(USER);
    socketRoomMap.delete("local-socket");
  });
  const released = t.mock.method(roomStore, "releaseSeat", async () => null);
  const { rt } = recordingRuntime({ presence: storePresence(() => Promise.reject(new Error("Redis unreachable"))) });

  const asked = t.mock.method(rt.presence, "isAtTable");

  armLobbyGrace(rt, ROOM, USER);
  expiries[0]();
  assert.equal(await asked.mock.calls[0]?.result, true, "the expiry did not find the player at the table");

  assert.equal(released.mock.callCount(), 0, "a failed presence read released a player sitting on this instance");
});
