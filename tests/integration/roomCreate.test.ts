// tests/integration/roomCreate.test.ts — a room never exists without the host who opened it.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { startTestServer, hasDatabase, skipMessage, type TestServer } from "../helpers/testServer.ts";
import { connectAs } from "../helpers/client.ts";

describe("room:create", { skip: hasDatabase() ? false : skipMessage() }, () => {
  let server: TestServer;

  before(async () => {
    server = await startTestServer();
  });

  after(async () => {
    await server.stop();
  });

  const roomsHostedBy = async (userId: string) =>
    server.query<{ id: string }>("SELECT id FROM rooms WHERE host_user_id = $1", [userId]);

  test("the host is seated at 0 in the room it opens", async () => {
    const host = await connectAs(server, "create_ok");
    try {
      const reply = await host.socket.timeout(5_000).emitWithAck("room:create", {
        gameMode: "free_for_all",
        maxPlayers: 2,
      });
      assert.deepEqual(reply, { ok: true });
      const [room] = await roomsHostedBy(host.user.id);
      assert.ok(room, "the room was written");
      const rows = await server.query(
        "SELECT user_id, seat_index FROM room_players WHERE room_id = $1",
        [room.id]
      );
      assert.deepEqual(rows, [{ user_id: host.user.id, seat_index: 0 }]);
    } finally {
      host.socket.disconnect();
    }
  });

  test("a seat insert that fails leaves no room behind", async () => {
    const host = await connectAs(server, "create_seat_fails");
    assert.match(host.user.id, /^[0-9a-f-]+$/, "the id is spliced into the trigger below");
    await server.query(
      `CREATE FUNCTION refuse_seat_for_test() RETURNS trigger LANGUAGE plpgsql AS $$
       BEGIN
         IF NEW.user_id = '${host.user.id}' THEN RAISE EXCEPTION 'seat refused for the test'; END IF;
         RETURN NEW;
       END $$`
    );
    await server.query(
      `CREATE TRIGGER refuse_seat_for_test BEFORE INSERT ON room_players
       FOR EACH ROW EXECUTE FUNCTION refuse_seat_for_test()`
    );
    try {
      const reply = await host.socket.timeout(5_000).emitWithAck("room:create", {
        gameMode: "free_for_all",
        maxPlayers: 2,
      });
      assert.equal(reply.ok, false, "the create reports its failure");
      assert.deepEqual(await roomsHostedBy(host.user.id), [], "no room outlives its host's seat");
    } finally {
      await server.query("DROP TRIGGER refuse_seat_for_test ON room_players");
      await server.query("DROP FUNCTION refuse_seat_for_test()");
      host.socket.disconnect();
    }
  });
});
