// tests/server/lostPresence.test.ts — what a sweep's report of lost accounts writes and tells.
import { test } from "node:test";
import assert from "node:assert/strict";
import { lostPresenceHandler } from "../../server/socket/socketPresence.ts";
import { settleInFlight } from "../../server/shared/inFlight.ts";

function harness({ shown = false, stored = null as Date | null } = {}) {
  const told: [string, string[], unknown][] = [];
  const writes: string[] = [];
  const handle = lostPresenceHandler({
    userStore: {
      updateLastSeen: async (userId, at) => void writes.push(`update ${userId} ${at?.toISOString()}`),
      settleLastSeen: async (userId, since, at) => {
        writes.push(`settle ${userId} ${since.toISOString()} ${at.toISOString()}`);
        return stored ?? at;
      },
    },
    friendStore: { getFriends: async () => [{ friend: { id: "bob" } }] as never },
    tellStatus: (userId, friendIds, status) => void told.push([userId, [...friendIds], status]),
    isShownOnline: async () => shown,
  });
  return { handle, told, writes };
}

test("a departure with its leave time writes that time and tells the friends it", async () => {
  const { handle, told, writes } = harness();
  const leftAt = new Date("2026-01-01T10:00:00Z");
  handle(["alice"], leftAt, new Map());
  await settleInFlight(5_000);
  assert.deepEqual(writes, [`update alice ${leftAt.toISOString()}`]);
  assert.deepEqual(told, [["alice", ["bob"], { online: false, lastSeen: leftAt.toISOString() }]]);
});

test("a departure with no leave time keeps a last_seen written since the connect, and tells the friends that", async () => {
  const kept = new Date("2026-01-01T09:30:00Z");
  const { handle, told, writes } = harness({ stored: kept });
  const since = new Date("2026-01-01T09:00:00Z");
  handle(["alice"], null, new Map([["alice", since]]));
  await settleInFlight(5_000);
  assert.equal(writes.length, 1);
  assert.match(writes[0]!, new RegExp(`^settle alice ${since.toISOString()} `), "a departure with no leave time overwrote last_seen outright");
  assert.deepEqual(told, [["alice", ["bob"], { online: false, lastSeen: kept.toISOString() }]]);
});

test("an account that reconnected elsewhere by the time its friends are read is not told to them as offline", async () => {
  const { handle, told } = harness({ shown: true });
  handle(["alice"], new Date(), new Map());
  await settleInFlight(5_000);
  assert.deepEqual(told, []);
});
