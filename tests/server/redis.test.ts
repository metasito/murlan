// tests/server/redis.test.ts — how server/store/redis.ts configures every connection, and the
// keyspace that keeps servers sharing one Redis apart.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "redis";
import { keyspace, reconnectDelay, redisOptions } from "../../server/store/redis.ts";

test("production, with no search_path, uses the plain keyspace", () => {
  assert.equal(keyspace("postgres://u:p@host:5432/murlan"), "murlan");
  assert.equal(keyspace(undefined), "murlan");
});

test("a schema-scoped connection string gets a keyspace of its own", () => {
  const a = keyspace("postgres://u:p@host/murlan?options=-c%20search_path%3Dtest_1_2");
  const b = keyspace("postgres://u:p@host/murlan?options=-c%20search_path%3Dtest_3_4");
  assert.equal(a, "murlan#test_1_2");
  assert.notEqual(a, b, "two schemas must not share a keyspace");
});

test("two instances aimed at one schema share a keyspace", () => {
  const url = "postgres://u:p@host/murlan?options=-c%20search_path%3Dxinst_9";
  assert.equal(keyspace(url), keyspace(url));
  assert.equal(keyspace(url), "murlan#xinst_9");
});

test("an unencoded search_path is read the same way", () => {
  assert.equal(keyspace("postgres://u:p@host/murlan?options=-c search_path=foo"), "murlan#foo");
});

test("a later -c clause is not read as part of the schema", () => {
  const a = keyspace("postgres://u:p@h/db?options=-c%20search_path%3Dmyschema%20-c%20statement_timeout%3D30000");
  const b = keyspace("postgres://u:p@h/db?options=-c%20search_path%3Dmyschema%20-c%20statement_timeout%3D60000");
  assert.equal(a, "murlan#myschema");
  assert.equal(a, b, "the same schema must give the same keyspace whatever else is set");
});

test("a parameter merely ending in search_path is not mistaken for one", () => {
  assert.equal(keyspace("postgres://u:p@h/db?my_search_path=elsewhere"), "murlan");
});

test("every connection is named for its use, pings every 5 s and keeps TCP alive", () => {
  for (const use of ["adapter", "inbox", "presence", "limits"] as const) {
    const o = redisOptions(use, "redis://h:6379/0");
    assert.equal(o.name, `murlan-${use}`);
    assert.equal(o.pingInterval, 5_000);
    assert.equal(o.socket.keepAlive, true);
  }
});

test("only a publisher drops its offline queue", () => {
  assert.equal(redisOptions("adapter", "redis://h").disableOfflineQueue, false);
  assert.equal(redisOptions("adapter", "redis://h", false).disableOfflineQueue, true);
});

test("TLS comes from a rediss:// URL", () => {
  const tlsOf = (url: string) =>
    (createClient(redisOptions("adapter", url)).options?.socket as { tls?: boolean } | undefined)?.tls;
  assert.equal(tlsOf("rediss://h:6380/0"), true);
  assert.equal(tlsOf("redis://h:6379/0"), false);
});

test("reconnects back off and stop growing at the cap", () => {
  assert.ok(reconnectDelay(0) < 200);
  assert.ok(reconnectDelay(3) >= 400);
  for (const n of [10, 20, 50]) assert.ok(reconnectDelay(n) <= 2_100, `retry ${n}`);
});
