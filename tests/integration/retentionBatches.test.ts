// tests/integration/retentionBatches.test.ts — a backlog larger than one batch is cleared by one
// sweep, a batch per statement.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { startTestServer, hasDatabase, skipMessage, type TestServer } from "../helpers/testServer.ts";

const BACKLOG = 12_001;

describe("retention sweep batches", { skip: hasDatabase() ? false : skipMessage() }, () => {
  let server: TestServer;
  let dbPool: pg.Pool;
  let sweepRetention: () => Promise<void>;
  let retentionDays: number;

  before(async () => {
    server = await startTestServer();
    dbPool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    ({ sweepRetention } = await import("../../server/game/retention.ts"));
    ({ EVENT_RETENTION_DAYS: retentionDays } = await import("../../server/socket/events.ts"));
  });

  after(async () => {
    await dbPool.end();
    await server.stop();
  });

  const count = async (name: string) =>
    Number((await dbPool.query("SELECT count(*) AS n FROM events WHERE name = $1", [name])).rows[0].n);

  test(`${BACKLOG} aged rows are gone after one sweep, and a fresh one stays`, async () => {
    await dbPool.query(
      `INSERT INTO events (name, occurred_at)
       SELECT 'retention.backlog', now() - make_interval(days => $1) FROM generate_series(1, $2)`,
      [retentionDays + 1, BACKLOG]
    );
    await dbPool.query(`INSERT INTO events (name) VALUES ('retention.fresh')`);
    assert.equal(await count("retention.backlog"), BACKLOG);

    await sweepRetention();

    assert.equal(await count("retention.backlog"), 0);
    assert.equal(await count("retention.fresh"), 1);
  });

  test("expired socket-ticket nonces are pruned by the sweep", async () => {
    await dbPool.query(
      `INSERT INTO socket_ticket_nonces (nonce, expires_at) VALUES
       ('retention-expired', now() - interval '1 hour'), ('retention-live', now() + interval '1 hour')`
    );

    await sweepRetention();

    const { rows } = await dbPool.query<{ nonce: string }>(
      "SELECT nonce FROM socket_ticket_nonces WHERE nonce LIKE 'retention-%'"
    );
    assert.deepEqual(rows.map((r) => r.nonce), ["retention-live"]);
  });
});
