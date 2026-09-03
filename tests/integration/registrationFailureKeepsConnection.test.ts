import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { startTestServer, hasDatabase, skipMessage, type TestServer } from "../helpers/testServer.ts";

/**
 * A failed registration must not cost the caller its connection. express-session
 * saves again at `res.end`, so a store that fails during the request fails a
 * second time with the response already sent — and Express answers an error it
 * can no longer respond to by destroying the socket. The client is still
 * pooling that socket, so the failure lands on whatever it sends next, which
 * is a different request in a different test (#424).
 */
describe(
  "a registration the session step fails",
  { skip: hasDatabase() ? false : skipMessage() },
  () => {
    let server: TestServer;
    let closed = 0;

    before(async () => {
      server = await startTestServer();
      server.httpServer.on("connection", (socket) => {
        socket.on("close", () => closed++);
      });
    });

    after(async () => {
      await server.stop();
    });

    async function register(username: string): Promise<number> {
      const res = await fetch(`${server.url}/api/auth/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password: "password123", email: `${username}@example.test` }),
      });
      await res.text();
      return res.status;
    }

    test("leaves the connection open for the next request", async () => {
      assert.equal(await register("keepalive_warm"), 202);

      const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL! });
      const before = closed;
      try {
        await admin.query(
          `ALTER TABLE "${server.schema}".session ADD CONSTRAINT keepalive_fail CHECK (false) NOT VALID`
        );
        assert.notEqual(
          await register("keepalive_doomed"),
          202,
          "registration has to fail while the session cannot be written"
        );
      } finally {
        await admin.query(
          `ALTER TABLE "${server.schema}".session DROP CONSTRAINT keepalive_fail`
        );
        await admin.end();
      }

      assert.equal(
        closed,
        before,
        "the server hung up on a request it had already answered, so the next one this client " +
          "sends down the same connection fails with UND_ERR_SOCKET"
      );
    });
  }
);
