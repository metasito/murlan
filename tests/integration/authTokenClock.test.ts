// A token's expiry is written and judged on the one server clock: under an
// installed clock that runs ahead of Postgres, a token still redeems inside its
// TTL and stops redeeming once the clock is past it.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { startTestServer, hasDatabase, skipMessage, type TestServer } from "../helpers/testServer.ts";
import { register } from "../helpers/client.ts";
import { skewedClock } from "../helpers/fakeClock.ts";

const TTL_MS = 60_000;

describe("auth tokens on an installed clock", { skip: hasDatabase() ? false : skipMessage() }, () => {
  let server: TestServer;
  const clock = skewedClock();

  before(async () => {
    server = await startTestServer({ clock });
  });
  after(async () => {
    await server.stop();
  });

  test("redeems inside its TTL on the installed clock", async () => {
    const { user } = await register(server, "clock_inside");
    const { mintAuthToken, redeemAuthToken } = await import("../../server/http/authTokens.ts");
    clock.skip(10 * 60 * 60_000);
    const raw = await mintAuthToken(user.id, "password_reset", TTL_MS);
    clock.skip(TTL_MS - 5_000);
    assert.equal(await redeemAuthToken(raw, "password_reset"), user.id);
  });

  test("does not redeem once the installed clock is past its TTL", async () => {
    const { user } = await register(server, "clock_past");
    const { mintAuthToken, redeemAuthToken } = await import("../../server/http/authTokens.ts");
    const raw = await mintAuthToken(user.id, "password_reset", TTL_MS);
    clock.skip(TTL_MS + 1);
    assert.equal(await redeemAuthToken(raw, "password_reset"), null);
  });
});
