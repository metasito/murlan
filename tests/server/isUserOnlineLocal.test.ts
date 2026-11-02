// A player connected to this instance is online whatever the store says: a read rejects while
// Redis is unreachable, and the seat grace must not unseat them for that.
import { test } from "node:test";
import assert from "node:assert/strict";
import { storePresence } from "../../server/socket/socketOutbox.ts";
import { userSocketMap } from "../../server/game/gameRoom.ts";

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
