// tests/integration/readProjections.test.ts — each store read fetches only the
// columns its callers use, checked on the SQL it actually sends.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { startTestServer, hasDatabase, skipMessage, type TestServer } from "../helpers/testServer.ts";
import { pool } from "../../server/store/db.ts";
import { friendStore } from "../../server/store/friendStore.ts";

describe("store reads select only what their callers use", { skip: hasDatabase() ? false : skipMessage() }, () => {
  let server: TestServer;
  let restoreQuery: () => void;
  let captured: string[] | null = null;

  before(async () => {
    server = await startTestServer();
    const p = pool();
    const real = p.query.bind(p) as (...args: unknown[]) => Promise<unknown>;
    const patched = p as unknown as { query: (...args: unknown[]) => Promise<unknown> };
    patched.query = (...args: unknown[]) => {
      const q = args[0] as string | { text: string };
      captured?.push(typeof q === "string" ? q : q.text);
      return real(...args);
    };
    restoreQuery = () => {
      patched.query = real;
    };
  });
  after(async () => {
    restoreQuery?.();
    await server?.stop();
  });

  async function sqlOf<T>(read: () => Promise<T>): Promise<{ sql: string; result: T }> {
    captured = [];
    try {
      const result = await read();
      assert.ok(captured.length > 0, "the read sent no SQL through the pool: the capture is not looking");
      return { sql: captured.join(" ;; "), result };
    } finally {
      captured = null;
    }
  }

  async function user(name: string): Promise<string> {
    const [row] = await server.query<{ id: string }>(
      `INSERT INTO users (username, password, friend_code, email, last_seen)
       VALUES ($1, '$2b$10$aHashThatMustNeverLeaveTheDatabase', upper(substr(md5($1), 1, 6)), $1 || '@example.com', now())
       RETURNING id`,
      [name]
    );
    return row!.id;
  }

  test("friend lists and requests never select the password hash or the email", async () => {
    const [me, friend, asker, asked] = await Promise.all(["rp_me", "rp_friend", "rp_asker", "rp_asked"].map(user));
    await server.query(
      `INSERT INTO friends (user_id, friend_user_id, status) VALUES
        ($1, $2, 'accepted'), ($2, $1, 'accepted'), ($3, $1, 'pending'), ($1, $4, 'pending')`,
      [me, friend, asker, asked]
    );

    const reads: Record<string, [() => Promise<unknown[]>, string, string]> = {
      getFriends: [() => friendStore.getFriends(me!), "friend", friend!],
      getPendingFriendRequests: [() => friendStore.getPendingFriendRequests(me!), "requester", asker!],
      getSentFriendRequests: [() => friendStore.getSentFriendRequests(me!), "recipient", asked!],
    };
    for (const [name, [read, side, otherId]] of Object.entries(reads)) {
      const { sql, result } = await sqlOf(read);
      assert.doesNotMatch(sql, /"password"/, `${name} selects the password hash: ${sql}`);
      assert.doesNotMatch(sql, /"email"/, `${name} selects the email: ${sql}`);
      assert.equal(result.length, 1, `${name} lost its row`);
      const row = result[0] as unknown as Record<string, Record<string, unknown>>;
      assert.deepEqual(Object.keys(row[side]!).sort(), ["id", "lastSeen", "username"], `${name}'s ${side}`);
      assert.equal(row[side]!.id, otherId);
      assert.ok(row[side]!.lastSeen instanceof Date, `${name}'s ${side} lost lastSeen`);
      assert.deepEqual(
        Object.keys(row).filter((k) => k !== side).sort(),
        ["createdAt", "friendUserId", "id", "status", "userId"],
        `${name}'s request columns`
      );
    }
  });
});
