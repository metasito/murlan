// A player connected to this instance is online whatever the cluster says: the cluster query
// rejects when another instance is slow, and the seat grace must not unseat them for that.
import { test } from "node:test";
import assert from "node:assert/strict";
import { stubTransport } from "../helpers/recordingRuntime.ts";
import { socketPresence } from "../../server/socket/socketOutbox.ts";
import { userSocketMap } from "../../server/game/gameRoom.ts";

const USER = "online-here";

const clusterThatFails = () =>
  socketPresence(stubTransport({ in: () => ({ fetchSockets: () => Promise.reject(new Error("timeout reached")) }) }));

test("a user with a socket on this instance is online when the cluster does not answer", async (t) => {
  userSocketMap.set(USER, "local-socket");
  t.after(() => userSocketMap.delete(USER));
  assert.equal(await clusterThatFails().isOnline(USER), true);
});

test("a user with no socket here is offline when the cluster does not answer", async () => {
  assert.equal(await clusterThatFails().isOnline("nobody-here"), false);
});

test("a user with no socket here is online when the cluster has one", async () => {
  const presence = socketPresence(
    stubTransport({ in: () => ({ fetchSockets: async () => [{ rooms: new Set(), data: {} }] }) })
  );
  assert.equal(await presence.isOnline("elsewhere"), true);
});

test("a cluster that does not answer is no one's list of who is connected", async () => {
  assert.equal(
    await socketPresence(stubTransport({ fetchSockets: () => Promise.reject(new Error("timeout reached")) })).connectedUserIds(),
    null
  );
});
