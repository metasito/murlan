// Which instance a heartbeat came from, and whether it is still connected to the cluster.
import { test } from "node:test";
import assert from "node:assert/strict";
import { heartbeatPacket, RoutingPeers } from "../../server/socket/socketAdapter.ts";
import { instanceId } from "../../server/store/redis.ts";

const GRACE_MS = 10_000;
const beat = (instance: string) => ["murlan:adapter-heartbeat", instance];

test("this instance's heartbeat names it", () => {
  assert.deepEqual(heartbeatPacket(), beat(instanceId));
});

test("an instance whose heartbeat named it is heard for the grace, and not after", () => {
  const peers = new RoutingPeers();
  peers.heard("uid-a", beat("instance-a"), 0);
  assert.equal(peers.heardFrom("instance-a", GRACE_MS - 1), true);
  assert.equal(peers.heardFrom("instance-a", GRACE_MS), false);
  assert.equal(peers.heardFrom("instance-a", 0), false, "an expired name was kept");
});

test("no other emit names an instance", () => {
  const peers = new RoutingPeers();
  peers.heard("uid-b", ["murlan:table", "instance-b"], 0);
  peers.heard("uid-c", ["murlan:adapter-heartbeat"], 0);
  assert.equal(peers.heardFrom("instance-b", 1), false);
  assert.equal(peers.subscribed("instance-b", new Set(["uid-b"])), false);
});

test("an instance is subscribed while its heartbeat's uid is, and forgotten once that uid is gone", () => {
  const peers = new RoutingPeers();
  peers.heard("uid-a", beat("instance-a"), 0);
  peers.heard("uid-c", beat("instance-c"), 0);
  assert.equal(peers.subscribed("instance-a", new Set(["uid-a", "uid-c"])), true);
  assert.equal(peers.subscribed("instance-a", new Set(["uid-c"])), false);
  assert.equal(peers.heardFrom("instance-a", 1), false, "an unsubscribed instance was kept");
  assert.equal(peers.heardFrom("instance-c", 1), true);
});

test("an instance that says it is leaving is forgotten at once", () => {
  const peers = new RoutingPeers();
  peers.heard("uid-a", beat("instance-a"), 0);
  peers.left(["murlan:adapter-leaving", "instance-a"]);
  assert.equal(peers.heardFrom("instance-a", 1), false);
});
