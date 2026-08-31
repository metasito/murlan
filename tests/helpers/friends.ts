// tests/helpers/friends.ts — the two accounts an invite needs, and the rows it
// leaves behind. Shared because every invite suite has to build the same
// friendship through the same endpoints before it can say anything at all.
import assert from "node:assert/strict";
import type { TestServer } from "./testServer.ts";

interface Account {
  cookie: string;
  user: { id: string; username: string };
}

/** Makes the two accounts friends through the same endpoints a player uses. */
export async function befriend(server: TestServer, a: Account, b: Account): Promise<void> {
  const add = await fetch(`${server.url}/api/friends/add`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: a.cookie },
    body: JSON.stringify({ username: b.user.username }),
  });
  assert.equal(add.status, 200, await add.text());

  const pending = await fetch(`${server.url}/api/friends/requests`, {
    headers: { cookie: b.cookie },
  });
  const rows = (await pending.json()) as { id: string }[];
  assert.equal(rows.length, 1, "the request reached the other account");

  const accept = await fetch(`${server.url}/api/friends/accept/${rows[0].id}`, {
    method: "POST",
    headers: { cookie: b.cookie },
  });
  assert.equal(accept.status, 200, await accept.text());
}

/**
 * The `game_invites` rows themselves, not what `/api/friends/invites` answers.
 * That endpoint filters on the room still being joinable, so it goes empty the
 * moment the room fills or closes whether or not anything deleted anything —
 * reading it alone passes on a delete that should not have happened.
 *
 * Imported inside the call rather than at module scope: `server/db.ts` builds
 * its pool as it loads, and `startTestServer` sets `DATABASE_URL` first.
 */
export async function inviteRowsFor(roomId: string): Promise<unknown[]> {
  const { db } = await import("../../server/db.ts");
  const { gameInvites } = await import("../../shared/schema.ts");
  const { eq } = await import("drizzle-orm");
  return db.select().from(gameInvites).where(eq(gameInvites.roomId, roomId));
}
