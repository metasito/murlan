// Each friendship action against a fake store and a fake emitter: what it
// answers, and who hears about it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createFriendships, type FriendshipDeps } from "../../server/socket/friendships.ts";

type Sent = [to: string, event: string, data: unknown];

const alice = { id: "alice", username: "Alice" };
const bob = { id: "bob", username: "Bob" };
const users = new Map([alice, bob].map((u) => [u.id, u]));

function harness(over: { online?: string[]; store?: Partial<FriendshipDeps["friendStore"]> } = {}) {
  const sent: Sent[] = [];
  const announced: string[] = [];
  const pushed: [string, unknown][] = [];
  const online = new Set(over.online ?? []);
  const deps: FriendshipDeps = {
    friendStore: {
      addFriend: async () => ({ ok: true, request: { id: "req1", userId: "alice", friendUserId: "bob", status: "pending", createdAt: new Date(0) } as never }),
      acceptFriend: async (id, by) => (id === "req1" && by === "bob" ? { requesterId: "alice" } : null),
      declineFriendRequest: async (id) => id === "req1",
      cancelFriendRequest: async (id) => id === "req1",
      declineGameInvite: async () => "room1",
      removeFriend: async () => ["room1", "room2"],
      areFriends: async () => true,
      recordGameInvite: async () => undefined,
      ...over.store,
    },
    userStore: {
      getUser: async (id) => (users.get(id) as never) ?? undefined,
      getUserByUsername: async (name) => ([...users.values()].find((u) => u.username === name) as never) ?? undefined,
    },
    roomStore: {
      getRoomByCode: async (code) => (code === "ABCDEF" ? { id: "room1", status: "waiting" } : undefined) as never,
      getRoomPlayers: async () => [{ userId: "alice" }] as never,
    },
    emitToUser: ((to: string, event: string, data: unknown) => sent.push([to, event, data])) as FriendshipDeps["emitToUser"],
    isUserOnline: async (id) => online.has(id),
    announceRoomChanged: async (roomId) => void announced.push(roomId),
    notifyUser: (async (id: string, push: unknown) => void pushed.push([id, push])) as FriendshipDeps["notifyUser"],
  };
  return { friendships: createFriendships(deps), sent, announced, pushed };
}

test("request tells the recipient, with the row", async () => {
  const { friendships, sent } = harness();
  assert.deepEqual(await friendships.request("alice", "Bob"), { ok: true, username: "Bob" });
  assert.equal(sent.length, 1);
  const [to, event, data] = sent[0]!;
  assert.equal(to, "bob");
  assert.equal(event, "friend:request_incoming");
  assert.equal((data as { from: string }).from, "Alice");
  assert.ok((data as { request?: unknown }).request, "the row travels with the announcement");
});

test("request refuses an unknown name, oneself, and what the store refuses — telling nobody", async () => {
  const { friendships, sent } = harness();
  assert.deepEqual(await friendships.request("alice", "Nobody"), { ok: false, code: "USER_NOT_FOUND" });
  assert.deepEqual(await friendships.request("alice", "Alice"), { ok: false, code: "CANNOT_ADD_SELF" });
  const refused = harness({ store: { addFriend: async () => ({ ok: false, reason: "already_sent" }) } });
  assert.deepEqual(await refused.friendships.request("alice", "Bob"), { ok: false, code: "FRIEND_REQUEST_ALREADY_SENT" });
  assert.deepEqual([...sent, ...refused.sent], []);
});

test("accept tells the requester, and each side whether the other is online", async () => {
  const { friendships, sent } = harness({ online: ["alice", "bob"] });
  assert.deepEqual(await friendships.accept("req1", "bob"), { ok: true });
  assert.deepEqual(
    sent.map(([to, event]) => `${to} ${event}`),
    ["alice friend:request_accepted", "alice friend:status", "bob friend:status"]
  );
  assert.deepEqual(sent[1]![2], { userId: "bob", online: true });
  assert.deepEqual(sent[2]![2], { userId: "alice", online: true });
});

test("accept sends no status for a side that is offline", async () => {
  const { friendships, sent } = harness({ online: ["bob"] });
  await friendships.accept("req1", "bob");
  assert.deepEqual(sent.map(([to, event]) => `${to} ${event}`), ["alice friend:request_accepted", "alice friend:status"]);
});

test("accept by anyone but the recipient is not found, and tells nobody", async () => {
  const { friendships, sent } = harness({ online: ["alice", "bob"] });
  assert.deepEqual(await friendships.accept("req1", "alice"), { ok: false, code: "FRIEND_REQUEST_NOT_FOUND" });
  assert.deepEqual(sent, []);
});

test("declining or cancelling a request answers not-found when the store did nothing", async () => {
  const { friendships, sent } = harness();
  assert.deepEqual(await friendships.declineRequest("req1", "bob"), { ok: true });
  assert.deepEqual(await friendships.declineRequest("nope", "bob"), { ok: false, code: "FRIEND_REQUEST_NOT_FOUND" });
  assert.deepEqual(await friendships.cancelRequest("req1", "alice"), { ok: true });
  assert.deepEqual(await friendships.cancelRequest("nope", "alice"), { ok: false, code: "FRIEND_REQUEST_NOT_FOUND" });
  assert.deepEqual(sent, []);
});

test("decline of a game invite tells its room; with no invite, no room", async () => {
  const { friendships, announced } = harness();
  assert.deepEqual(await friendships.decline("bob", "ABCDEF"), { ok: true });
  assert.deepEqual(announced, ["room1"]);
  const none = harness({ store: { declineGameInvite: async () => null } });
  await none.friendships.decline("bob", "ABCDEF");
  assert.deepEqual(none.announced, []);
});

test("decline of a game invite surfaces a store failure", async () => {
  const { friendships } = harness({ store: { declineGameInvite: async () => { throw new Error("db down"); } } });
  await assert.rejects(friendships.decline("bob", "ABCDEF"), /db down/);
});

test("remove tells every room whose seat the friendship held", async () => {
  const { friendships, announced } = harness();
  assert.deepEqual(await friendships.remove("alice", "bob"), { ok: true });
  assert.deepEqual(announced, ["room1", "room2"]);
});

test("invite to an online friend shows it to them and tells the room", async () => {
  const { friendships, sent, announced, pushed } = harness({ online: ["bob"] });
  assert.deepEqual(await friendships.invite("alice", "bob", "ABCDEF"), { ok: true, code: "INVITE_SHOWN" });
  assert.deepEqual(announced, ["room1"]);
  assert.deepEqual(sent, [["bob", "friend:invite", { from: "Alice", roomCode: "ABCDEF" }]]);
  assert.deepEqual(pushed, []);
});

test("invite to an offline friend is written down and pushed", async () => {
  const recorded: string[] = [];
  const { friendships, sent, pushed } = harness({
    store: { recordGameInvite: async (roomId, from, to) => void recorded.push(`${roomId} ${from} ${to}`) },
  });
  assert.deepEqual(await friendships.invite("alice", "bob", "abcdef"), { ok: true, code: "INVITE_WAITING" });
  assert.deepEqual(recorded, ["room1 alice bob"]);
  assert.deepEqual(sent, []);
  assert.equal(pushed.length, 1);
  assert.equal(pushed[0]![0], "bob");
});

test("invite refuses a stranger, a closed room, and a room the sender is not in — before writing anything", async () => {
  const recorded: string[] = [];
  const store = { recordGameInvite: async () => void recorded.push("x") };
  const strangers = harness({ store: { ...store, areFriends: async () => false } });
  assert.deepEqual(await strangers.friendships.invite("alice", "bob", "ABCDEF"), { ok: false, code: "NOT_FRIENDS" });
  const { friendships, sent, announced } = harness({ store });
  assert.deepEqual(await friendships.invite("alice", "bob", "ZZZZZZ"), { ok: false, code: "ROOM_NOT_FOUND" });
  assert.deepEqual(await friendships.invite("bob", "alice", "ABCDEF"), { ok: false, code: "NOT_IN_ROOM" });
  assert.deepEqual([recorded, sent, announced], [[], [], []]);
});

test("a status change reaches each friend named", async () => {
  const { friendships, sent } = harness();
  friendships.tellStatus("alice", ["bob", "carol"], { online: false, lastSeen: "t" });
  assert.deepEqual(sent, [
    ["bob", "friend:status", { userId: "alice", online: false, lastSeen: "t" }],
    ["carol", "friend:status", { userId: "alice", online: false, lastSeen: "t" }],
  ]);
});
