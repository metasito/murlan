// A player connected to this instance is online whatever the store says: a read rejects while
// Redis is unreachable, and the seat grace must not unseat them for that.
import { test } from "node:test";
import assert from "node:assert/strict";
import { storePresence } from "../../server/socket/socketOutbox.ts";
import { socketRoomMap, userSocketMap } from "../../server/game/gameRoom.ts";
import { isShownOnline, shownOnlineAmong } from "../../server/socket/socketRegistry.ts";

const USER = "online-here";

const storeThatFails = () => storePresence(() => Promise.reject(new Error("Redis unreachable")));

test("a user with a socket on this instance is online when the store does not answer", async (t) => {
  userSocketMap.set(USER, "local-socket");
  t.after(() => userSocketMap.delete(USER));
  assert.equal(await storeThatFails().isOnline(USER), true);
});

test("a user with no socket here is offline when the store does not answer", async () => {
  assert.equal(await storeThatFails().isOnline("nobody-here"), false);
});

test("a user with no socket here is online when the store has an entry for them", async () => {
  const presence = storePresence(async (ids) => new Map(ids.map((id) => [id, { instance: "b", socket: "s" }])));
  assert.equal(await presence.isOnline("elsewhere"), true);
});

test("a store that does not answer is no one's list of who is connected", async () => {
  assert.equal(await storeThatFails().onlineAmong(["a", "b"]), null);
  assert.equal(await storeThatFails().tablePresence("room", ["a"]), null);
});

test("an account connected here is online and at its table here before the store has its entry", async (t) => {
  userSocketMap.set(USER, "local-socket");
  socketRoomMap.set("local-socket", "room-here");
  t.after(() => {
    userSocketMap.delete(USER);
    socketRoomMap.delete("local-socket");
  });
  const presence = storePresence(async () => new Map());
  assert.deepEqual([...(await presence.onlineAmong([USER, "elsewhere"]))!], [USER]);
  assert.deepEqual(await presence.tablePresence("room-here", [USER]), { online: new Set([USER]), atTable: new Set([USER]) });
});

test("with presence not open, a friend is shown online only from this instance's sockets, and the read never rejects", async (t) => {
  userSocketMap.set(USER, "local-socket");
  t.after(() => userSocketMap.delete(USER));
  assert.deepEqual([...(await shownOnlineAmong([USER, "elsewhere"]))], [USER]);
  assert.equal(await isShownOnline("elsewhere"), false);
});
