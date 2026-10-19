// A player connected to this instance is online whatever the cluster says: the cluster query
// rejects when another instance is slow, and the seat grace must not unseat them for that.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { SocketServer } from "../../server/socket/socketTypes.ts";
import { isUserOnline, setSocketServer } from "../../server/socket/socketRegistry.ts";
import { userSocketMap } from "../../server/game/gameRoom.ts";

const USER = "online-here";

function clusterThatFails(): SocketServer {
  return {
    in: () => ({ fetchSockets: () => Promise.reject(new Error("timeout reached")) }),
  } as unknown as SocketServer;
}

test("a user with a socket on this instance is online when the cluster does not answer", async (t) => {
  userSocketMap.set(USER, "local-socket");
  setSocketServer(clusterThatFails());
  t.after(() => {
    userSocketMap.delete(USER);
    setSocketServer(null as unknown as SocketServer);
  });
  assert.equal(await isUserOnline(USER), true);
});

test("a user with no socket here is offline when the cluster does not answer", async (t) => {
  setSocketServer(clusterThatFails());
  t.after(() => setSocketServer(null as unknown as SocketServer));
  assert.equal(await isUserOnline("nobody-here"), false);
});

test("a user with no socket here is online when the cluster has one", async (t) => {
  setSocketServer({
    in: () => ({ fetchSockets: async () => [{ rooms: new Set(), data: {} }] }),
  } as unknown as SocketServer);
  t.after(() => setSocketServer(null as unknown as SocketServer));
  assert.equal(await isUserOnline("elsewhere"), true);
});
