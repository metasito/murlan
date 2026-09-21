// tests/integration/refusalCodes.test.ts — the code a refusal carries is what the client
// localises, so each is asserted from the caller it refuses, not by its status alone.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { startTestServer, hasDatabase, skipMessage, type TestServer } from "../helpers/testServer.ts";
import { connectAs, register, waitFor } from "../helpers/client.ts";
import { befriend } from "../helpers/friends.ts";

describe("every refusal answers with its own code", { skip: hasDatabase() ? false : skipMessage() }, () => {
  let server: TestServer;
  before(async () => { server = await startTestServer(); });
  after(async () => { if (server) await server.stop(); });

  async function refused(path: string, init: RequestInit, status: number, code: string) {
    const res = await fetch(`${server.url}${path}`, init);
    const text = await res.text();
    assert.equal(res.status, status, `${path}: ${text}`);
    assert.equal((JSON.parse(text) as { code: string }).code, code, path);
  }

  const addFriend = (cookie: string, username: string): RequestInit => ({
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ username }),
  });

  test("a signed-out caller is not authenticated", async () => {
    await refused("/api/friends", {}, 401, "NOT_AUTHENTICATED");
    await refused("/api/auth/me", {}, 401, "NOT_AUTHENTICATED");
  });

  test("a malformed id, room code or username is refused before any lookup", async () => {
    const { cookie } = await register(server, "rc_malformed");
    await refused(`/api/replays/${"x".repeat(65)}`, { headers: { cookie } }, 400, "INVALID_PARAMETER");
    await refused("/api/friends/invites/abc", { method: "DELETE", headers: { cookie } }, 400, "INVALID_ROOM_CODE");
    await refused(`/api/users/search?username=${"x".repeat(31)}`, { headers: { cookie } }, 400, "INVALID_USERNAME");
  });

  test("a search or a friend request naming nobody, or yourself, finds no one", async () => {
    const { user, cookie } = await register(server, "rc_seeker");
    await refused("/api/users/search?username=rc_nobody", { headers: { cookie } }, 404, "USER_NOT_FOUND");
    await refused(`/api/users/search?username=${user.username}`, { headers: { cookie } }, 404, "USER_NOT_FOUND");
    await refused("/api/friends/add", addFriend(cookie, "rc_nobody"), 404, "USER_NOT_FOUND");
    await refused("/api/friends/add", addFriend(cookie, user.username), 400, "CANNOT_ADD_SELF");
  });

  test("a friend request to an existing friend is refused", async () => {
    const a = await register(server, "rc_pal_a");
    const b = await register(server, "rc_pal_b");
    await befriend(server, a, b);
    await refused("/api/friends/add", addFriend(a.cookie, b.user.username), 409, "ALREADY_FRIENDS");
  });

  test("a game invite to someone who is not a friend is refused", async () => {
    const { socket } = await connectAs(server, "rc_inviter");
    try {
      const stranger = await register(server, "rc_stranger");
      const told = waitFor<{ code: string }>(socket, "friend:error");
      socket.emit("friend:invite", { friendUserId: stranger.user.id, roomCode: "ABCDEF" });
      assert.equal((await told).code, "NOT_FRIENDS");
    } finally {
      socket.close();
    }
  });

  test("a deletion the database refuses reports the failure", async () => {
    const { user, cookie } = await register(server, "rc_undeletable");
    assert.match(user.id, /^[\w-]+$/);
    const { pool } = await import("../../server/db.ts");
    await pool.query(
      "CREATE FUNCTION rc_refuse_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'refused'; END $$"
    );
    await pool.query(
      `CREATE TRIGGER rc_refuse_delete BEFORE DELETE ON users FOR EACH ROW WHEN (OLD.id = '${user.id}') EXECUTE FUNCTION rc_refuse_delete()`
    );
    try {
      await refused("/api/users/me", { method: "DELETE", headers: { cookie } }, 500, "ACCOUNT_DELETE_FAILED");
    } finally {
      await pool.query("DROP TRIGGER rc_refuse_delete ON users");
      await pool.query("DROP FUNCTION rc_refuse_delete()");
    }
  });
});
