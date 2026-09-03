// tests/integration/markEmailVerified.test.ts — #894 review, finding 3:
// storage.markEmailVerified() must not report "verified" when nothing was
// actually verified. Two ways that happened before this fix: the UPDATE
// matched zero rows (the account is gone, or this account's own email claim
// is already gone) and the caller still got `true` back.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { startTestServer, hasDatabase, skipMessage, type TestServer } from "../helpers/testServer.ts";
import { register } from "../helpers/client.ts";

describe("markEmailVerified's three outcomes", { skip: hasDatabase() ? false : skipMessage() }, () => {
  let server: TestServer;
  before(async () => { server = await startTestServer(); });
  after(async () => { if (server) await server.stop(); });

  test("verifies the ordinary case", async () => {
    const { user } = await register(server, "markverify_ok");
    const { storage } = await import("../../server/storage.ts");

    const result = await storage.markEmailVerified(user.id);
    assert.equal(result, "verified");

    const stored = await storage.getUser(user.id);
    assert.ok(stored?.emailVerifiedAt, "emailVerifiedAt must be set");
  });

  test("loses the race to whichever account verifies the shared address first", async () => {
    const { user: first } = await register(server, "markverify_race_a");
    const { user: second } = await register(server, "markverify_race_b");
    const { db } = await import("../../server/db.ts");
    const { users } = await import("../../shared/schema.ts");
    const { eq } = await import("drizzle-orm");
    // Two unverified accounts sharing one address — #897's partial index
    // allows this; only a verified claim is unique.
    await db.update(users).set({ email: "markverify_race@example.test" }).where(eq(users.id, first.id));
    await db.update(users).set({ email: "markverify_race@example.test" }).where(eq(users.id, second.id));
    const { storage } = await import("../../server/storage.ts");

    assert.equal(await storage.markEmailVerified(first.id), "verified");
    assert.equal(await storage.markEmailVerified(second.id), "lost_race");

    const loser = await storage.getUser(second.id);
    assert.equal(loser?.email, null, "the loser's own claim must be cleared, not left colliding");
    assert.equal(loser?.emailVerifiedAt, null);
  });

  test("reports not_found rather than a false verified when the row has no email left to verify", async () => {
    // Reachable today via a second outstanding token: mint two, redeem one
    // (clearing this account's own claim through the lost_race path above),
    // then redeem the other — this is exactly that second redemption,
    // called directly the way the route calls it.
    const { user } = await register(server, "markverify_cleared");
    const { db } = await import("../../server/db.ts");
    const { users } = await import("../../shared/schema.ts");
    const { eq } = await import("drizzle-orm");
    await db.update(users).set({ email: null }).where(eq(users.id, user.id));
    const { storage } = await import("../../server/storage.ts");

    const result = await storage.markEmailVerified(user.id);
    assert.equal(result, "not_found", "an UPDATE matching zero rows must not report success");

    const stored = await storage.getUser(user.id);
    assert.equal(stored?.emailVerifiedAt, null, "nothing was actually verified");
  });

  test("reports not_found for an account that no longer exists", async () => {
    const { user } = await register(server, "markverify_deleted");
    const { storage } = await import("../../server/storage.ts");
    await storage.deleteUser(user.id);

    const result = await storage.markEmailVerified(user.id);
    assert.equal(result, "not_found", "a deleted account must not read back as verified");
  });
});
