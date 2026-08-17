// tests/socketRateLimit.test.ts — the socket rate limiter must be keyed by
// account, not by connection: keying by socket would let one session opening
// N websockets get N times every limit (room:create, friend:invite, …).
// server/socketSafety.ts has no runtime imports beyond the logger, so it
// loads under plain `node --test` (see serverLoadable.test.ts).
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
// @ts-ignore — .ts extension required by Node's type-stripping loader
import { allowSocketAction, __resetRateLimits } from "../server/socketSafety.ts";

/** Minimal stand-in for the only part of Socket the limiter touches. */
const fakeSocket = (userId?: string) =>
  ({ data: userId === undefined ? {} : { userId } }) as any;

describe("allowSocketAction", () => {
  beforeEach(() => __resetRateLimits());

  test("allows up to the limit within a window", () => {
    const s = fakeSocket("u1");
    for (let i = 0; i < 3; i++) {
      assert.equal(allowSocketAction(s, "room:create", 3, 10_000), true);
    }
    assert.equal(allowSocketAction(s, "room:create", 3, 10_000), false);
  });

  test("a second socket for the same user shares the bucket", () => {
    const a = fakeSocket("u1");
    const b = fakeSocket("u1");
    assert.equal(allowSocketAction(a, "room:create", 2, 10_000), true);
    assert.equal(allowSocketAction(b, "room:create", 2, 10_000), true);
    // Third call, second socket: the account is out of allowance either way.
    assert.equal(allowSocketAction(b, "room:create", 2, 10_000), false);
    assert.equal(allowSocketAction(a, "room:create", 2, 10_000), false);
  });

  test("fifty sockets do not buy fifty times the limit", () => {
    const sockets = Array.from({ length: 50 }, () => fakeSocket("flooder"));
    const allowed = sockets.filter((s) =>
      allowSocketAction(s, "friend:invite", 5, 60_000)
    ).length;
    assert.equal(allowed, 5);
  });

  test("different users do not share a bucket", () => {
    assert.equal(allowSocketAction(fakeSocket("u1"), "room:create", 1, 10_000), true);
    assert.equal(allowSocketAction(fakeSocket("u1"), "room:create", 1, 10_000), false);
    assert.equal(allowSocketAction(fakeSocket("u2"), "room:create", 1, 10_000), true);
  });

  test("different events do not share a bucket", () => {
    const s = fakeSocket("u1");
    assert.equal(allowSocketAction(s, "room:create", 1, 10_000), true);
    assert.equal(allowSocketAction(s, "room:create", 1, 10_000), false);
    assert.equal(allowSocketAction(s, "friend:invite", 1, 10_000), true);
  });

  test("the window expires and the allowance comes back", async () => {
    const s = fakeSocket("u1");
    assert.equal(allowSocketAction(s, "room:create", 1, 5), true);
    assert.equal(allowSocketAction(s, "room:create", 1, 5), false);
    await new Promise((r) => setTimeout(r, 15));
    assert.equal(allowSocketAction(s, "room:create", 1, 5), true);
  });

  test("an unauthenticated socket still gets limited (per socket)", () => {
    const s = fakeSocket(undefined);
    assert.equal(allowSocketAction(s, "room:create", 1, 10_000), true);
    assert.equal(allowSocketAction(s, "room:create", 1, 10_000), false);
  });
});
