// presenceCluster.test.ts timed out on main waiting for the friend list a connect pushes: on a loaded
// runner the ack and the push arrive in one read, and the push dispatched before `await connectSocket`
// resumed, to no listener. Every test that waits for a connect-time push depends on this.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { connectSocket, waitFor } from "../helpers/client.ts";

test("a push read in the same burst as the connect ack reaches a waiter attached once the connect resolves", async () => {
  const http = createServer();
  const io = new Server(http);
  io.on("connection", (socket) => {
    socket.emit("before-busy", 1);
    // The ack is already written; this holds the shared loop so the client reads it with the push.
    const until = Date.now() + 30;
    while (Date.now() < until);
    socket.emit("pushed", 2);
  });
  await new Promise<void>((resolve) => http.listen(0, resolve));
  const url = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
  try {
    for (let i = 0; i < 5; i++) {
      const socket = await connectSocket(url, {});
      try {
        const got = await Promise.all([waitFor(socket, "before-busy", 2_000), waitFor(socket, "pushed", 2_000)]);
        assert.deepEqual(got, [1, 2]);
      } finally {
        socket.close();
      }
    }
  } finally {
    io.close();
  }
});
