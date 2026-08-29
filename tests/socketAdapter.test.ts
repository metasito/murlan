// tests/socketAdapter.test.ts — the adapter's channel is per-database.
//
// `pg_notify` channels are scoped to the database, not to the schema, so two
// servers pointed at one database hear each other whatever their `search_path`
// is. That is the point in production and a hazard in the integration suites,
// which give every file its own schema inside one shared database: on a common
// channel each file would receive the others' broadcasts, and — worse — count
// their servers when sizing a broadcast acknowledgement, so #554's acked
// `game:state` would wait for replies that were never owed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { channelPrefix, listenPattern } from "../server/socketAdapter.ts";

test("production, with no search_path, keeps the adapter's own default", () => {
  assert.equal(channelPrefix("postgres://u:p@host:5432/murlan"), "socket.io");
  assert.equal(channelPrefix(undefined), "socket.io");
});

test("a schema-scoped connection string gets a channel of its own", () => {
  const a = channelPrefix(
    "postgres://u:p@host/murlan?options=-c%20search_path%3Dtest_1_2"
  );
  const b = channelPrefix(
    "postgres://u:p@host/murlan?options=-c%20search_path%3Dtest_3_4"
  );
  assert.equal(a, "socket.io#test_1_2");
  assert.notEqual(a, b, "two schemas must not share a notification channel");
});

test("two instances aimed at one schema share a channel", () => {
  // The other half of the same rule: the cross-instance test and the #544
  // repro both point two servers at one schema, and they are only testing
  // anything if those two talk to each other.
  const url = "postgres://u:p@host/murlan?options=-c%20search_path%3Dxinst_9";
  assert.equal(channelPrefix(url), channelPrefix(url));
  assert.equal(channelPrefix(url), "socket.io#xinst_9");
});

test("an unencoded search_path is read the same way", () => {
  // `?options=-c search_path=foo` reaches here unencoded when a connection
  // string is assembled by hand rather than by the test harness.
  assert.equal(
    channelPrefix("postgres://u:p@host/murlan?options=-c search_path=foo"),
    "socket.io#foo"
  );
});

test("the readiness pattern keeps its wildcard and escapes the rest", () => {
  // Silent in both directions: a pattern that cannot match makes the readiness
  // check wait out its whole timeout and report nothing, and a schema name's
  // own `_` left unescaped makes it match a sibling schema's subscription
  // instead of this server's.
  const p = listenPattern("postgres://u:p@h/db?options=-c%20search_path%3Dtest_1_2");
  assert.equal(p, 'LISTEN "socket.io#test\\_1\\_2%');
  assert.ok(p.endsWith("%"), "the trailing wildcard must survive escaping");
  assert.ok(!p.endsWith("\\%"), "escaping the wildcard makes the pattern match nothing");
});

test("the readiness pattern matches the LISTEN the adapter actually issues", () => {
  // `PubSubClient.addNamespace` runs `LISTEN "<channelPrefix>#<namespace>"`,
  // and the default namespace is "/".
  const url = "postgres://u:p@h/db?options=-c%20search_path%3Dtest_1_2";
  const issued = `LISTEN "${channelPrefix(url)}#/"`;
  const pattern = listenPattern(url);
  assert.ok(pattern.endsWith("%"));
  // Everything before the trailing wildcard matches literally; the backslashes
  // are LIKE's escaping rather than part of the text.
  const literal = pattern.slice(0, -1).replaceAll("\\", "");
  assert.ok(
    issued.startsWith(literal),
    `the adapter listens on ${issued}, which ${pattern} cannot match`
  );
});
