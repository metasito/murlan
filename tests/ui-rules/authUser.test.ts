import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseCachedUser } from "../../lib/authUser.ts";

describe("parseCachedUser", () => {
  test("a cache written before #861 keeps the user, with email and verification unknown", () => {
    const user = parseCachedUser(JSON.stringify({ id: "u1", username: "Ana", tutorialSeenAt: null }));
    assert.deepEqual(user, { id: "u1", username: "Ana", tutorialSeenAt: null });
    assert.equal("emailVerified" in user!, false);
    assert.equal("email" in user!, false);
  });

  test("a field of the wrong type is dropped as unknown, never coerced to false", () => {
    const user = parseCachedUser(
      JSON.stringify({ id: "u1", username: "Ana", email: 7, emailVerified: "yes", tutorialSeenAt: 0 })
    );
    assert.deepEqual(user, { id: "u1", username: "Ana" });
  });

  test("a current cache round-trips", () => {
    const current = {
      id: "u1",
      username: "Ana",
      tutorialSeenAt: "2026-01-01T00:00:00.000Z",
      email: "ana@example.test",
      emailVerified: false,
    };
    assert.deepEqual(parseCachedUser(JSON.stringify(current)), current);
    assert.deepEqual(parseCachedUser(JSON.stringify({ ...current, email: null })), { ...current, email: null });
  });

  test("no usable identity is no user", () => {
    for (const raw of [null, "", "not json", "null", "[]", "42", '{"username":"Ana"}', '{"id":1,"username":"Ana"}']) {
      assert.equal(parseCachedUser(raw), null, raw ?? "null");
    }
  });
});
