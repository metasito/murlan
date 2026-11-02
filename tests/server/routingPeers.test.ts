// Which instances read a table ask in their inbox: those whose adapter heartbeat names them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { heartbeatPacket, RoutingPeers } from "../../server/socket/socketAdapter.ts";
import { instanceId } from "../../server/store/redis.ts";

const GRACE_MS = 10_000;

test("this instance's heartbeat names it", () => {
  const [event, named] = heartbeatPacket();
  assert.equal(event, "murlan:adapter-heartbeat");
  assert.equal(named, instanceId);
});

test("an instance whose heartbeat named it speaks inbox for the grace, and not after", () => {
  const peers = new RoutingPeers();
  peers.heard("uid-a", ["murlan:adapter-heartbeat", "instance-a"], 0);
  assert.equal(peers.speaksInbox("instance-a", GRACE_MS - 1), true);
  assert.equal(peers.speaksInbox("instance-a", GRACE_MS), false);
  assert.equal(peers.speaksInbox("instance-a", 0), false, "an expired name was kept");
});

test("a heartbeat from a revision before inbox routing names nobody, nor does any other emit", () => {
  const peers = new RoutingPeers();
  peers.heard("uid-old", ["murlan:adapter-heartbeat"], 0);
  peers.heard("uid-b", ["murlan:table", "instance-b"], 0);
  assert.equal(peers.speaksInbox("instance-b", 1), false);
  assert.equal(peers.subscribed("instance-b", new Set(["uid-b"])), false);
});

test("an instance is subscribed while its heartbeat's uid is, and forgotten once that uid is gone", () => {
  const peers = new RoutingPeers();
  peers.heard("uid-a", ["murlan:adapter-heartbeat", "instance-a"], 0);
  peers.heard("uid-c", ["murlan:adapter-heartbeat", "instance-c"], 0);
  assert.equal(peers.subscribed("instance-a", new Set(["uid-a", "uid-c"])), true);
  assert.equal(peers.subscribed("instance-a", new Set(["uid-c"])), false);
  assert.equal(peers.speaksInbox("instance-a", 1), false, "an unsubscribed instance was kept");
  peers.prune(new Set());
  assert.equal(peers.speaksInbox("instance-c", 1), false, "a prune kept an unsubscribed instance");
});

test("an instance that says it is leaving stops speaking inbox at once", () => {
  const peers = new RoutingPeers();
  peers.heard("uid-a", ["murlan:adapter-heartbeat", "instance-a"], 0);
  peers.left(["murlan:adapter-leaving", "instance-a"]);
  assert.equal(peers.speaksInbox("instance-a", 1), false);
});
