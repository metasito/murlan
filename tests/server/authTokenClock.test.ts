// An auth token's expiry is written on the server clock (server/http/clock.ts), so
// every query that judges it compares against that clock too, never against
// Postgres' own now(): under an installed clock the two disagree, and a token
// would be born expired or never expire.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { db } from "../../server/store/db.ts";
import { installClock } from "../../server/http/clock.ts";
import { redeemAuthCode, redeemAuthToken } from "../../server/http/authTokens.ts";
import { sweepRetention } from "../../server/game/retention.ts";
import { userStore } from "../../server/store/userStore.ts";
import { skewedClock } from "../helpers/fakeClock.ts";

const dialect = new PgDialect();
const AHEAD_MS = 10 * 60 * 60_000;

function onSkewedClock(t: { after: (fn: () => void) => void }) {
  const clock = skewedClock();
  clock.skip(AHEAD_MS);
  t.after(installClock(clock));
  return clock;
}

function judgesOnTheClock(query: SQL, at: number, label: string) {
  const { sql: text, params } = dialect.sqlToQuery(query);
  assert.doesNotMatch(text, /expires_at"?\s*[<>]=?\s*now\(\)/i, `${label} judges expiry on Postgres' clock`);
  assert.ok(
    params.some((p) => Math.abs((p instanceof Date ? p.getTime() : Date.parse(String(p))) - at) < 1_000),
    `${label} does not pass the server clock's time`
  );
}

describe("auth token expiry is judged on the server clock", () => {
  test("a redeem compares expires_at with the installed clock's now", async (t) => {
    const clock = onSkewedClock(t);
    const seen: SQL[] = [];
    t.mock.method(db, "execute", async (q: SQL) => {
      seen.push(q);
      return { rows: [] };
    });
    await redeemAuthToken("raw", "password_reset");
    assert.equal(seen.length, 1);
    judgesOnTheClock(seen[0]!, clock.now(), "claimCredential");
  });

  test("a wrong code's attempt charge only counts codes live on the installed clock", async (t) => {
    const clock = onSkewedClock(t);
    const seen: SQL[] = [];
    t.mock.method(db, "execute", async (q: SQL) => {
      seen.push(q);
      return { rows: [] };
    });
    t.mock.method(userStore, "getUserIdsByEmail", async () => ["u1"]);
    await redeemAuthCode({ email: "a@b.c", purpose: "email_verify", code: "123456" });
    assert.equal(seen.length, 2);
    for (const q of seen) judgesOnTheClock(q, clock.now(), "redeemAuthCode");
  });

  test("the retention sweep drops tokens expired on the installed clock", async (t) => {
    const clock = onSkewedClock(t);
    const conditions = new Map<unknown, SQL>();
    t.mock.method(db, "delete", (table: unknown) => ({
      where: async (cond: SQL) => {
        conditions.set(table, cond);
      },
    }));
    await sweepRetention();
    const { authTokens } = await import("../../shared/schema.ts");
    const cond = conditions.get(authTokens);
    assert.ok(cond, "the sweep no longer prunes auth_tokens");
    judgesOnTheClock(cond, clock.now(), "the auth_tokens sweep");
  });
});
