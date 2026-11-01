// tests/integration/retentionBatches.test.ts — a backlog larger than one batch is cleared by one
// sweep, a batch per statement.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { startTestServer, hasDatabase, skipMessage, type TestServer } from "../helpers/testServer.ts";
import { sweepRetention, deleteInBatches } from "../../server/game/retention.ts";
import { EVENT_RETENTION_DAYS as retentionDays } from "../../server/shared/events.ts";
import { CLIENT_ERROR_RETENTION_DAYS } from "../../server/http/clientErrors.ts";
import { SERVER_ERROR_RETENTION_DAYS } from "../../server/http/serverErrors.ts";
import { BUG_REPORT_RETENTION_DAYS } from "../../server/http/bugReports.ts";
import { events } from "../../shared/schema.ts";
import { eq } from "drizzle-orm";

const BACKLOG = 12_001;

describe("retention sweep batches", { skip: hasDatabase() ? false : skipMessage() }, () => {
  let server: TestServer;

  before(async () => {
    server = await startTestServer();
  });

  after(async () => {
    await server.stop();
  });

  const count = async (name: string) =>
    Number((await server.query("SELECT count(*) AS n FROM events WHERE name = $1", [name]))[0].n);

  test(`${BACKLOG} aged rows are gone after one sweep, and a fresh one stays`, async () => {
    await server.query(
      `INSERT INTO events (name, occurred_at)
       SELECT 'retention.backlog', now() - make_interval(days => $1) FROM generate_series(1, $2)`,
      [retentionDays + 1, BACKLOG]
    );
    await server.query(`INSERT INTO events (name) VALUES ('retention.fresh')`);
    assert.equal(await count("retention.backlog"), BACKLOG);

    await sweepRetention();

    assert.equal(await count("retention.backlog"), 0);
    assert.equal(await count("retention.fresh"), 1);
  });

  test("one call deletes at most batch × maxBatches rows, and the next call takes the rest", async () => {
    await server.query(
      `INSERT INTO events (name) SELECT 'retention.capped' FROM generate_series(1, 350)`
    );
    const capped = eq(events.name, "retention.capped");

    assert.equal(await deleteInBatches(events, capped, 100, 3), 300, "three batches of 100, then the cap");
    assert.equal(await count("retention.capped"), 50, "what the cap left is still there");
    assert.equal(await deleteInBatches(events, capped, 100, 3), 50, "a short batch ends the loop");
    assert.equal(await count("retention.capped"), 0);
  });

  test("aged client errors, server errors and bug reports are pruned by the sweep, and fresh ones stay", async () => {
    const [{ id: reporter }] = await server.query<{ id: string }>(
      `INSERT INTO users (username, password, friend_code) VALUES ('retention_reporter', 'x', 'RETBUG') RETURNING id`
    );
    const aged = (days: number) => `now() - make_interval(days => ${days + 1})`;
    await server.query(
      `INSERT INTO client_errors (message, occurred_at) VALUES ('retention-aged', ${aged(CLIENT_ERROR_RETENTION_DAYS)}), ('retention-fresh', now())`
    );
    await server.query(
      `INSERT INTO server_errors (level, message, occurred_at) VALUES (50, 'retention-aged', ${aged(SERVER_ERROR_RETENTION_DAYS)}), (50, 'retention-fresh', now())`
    );
    await server.query(
      `INSERT INTO bug_reports (user_id, description, created_at) VALUES ($1, 'retention-aged', ${aged(BUG_REPORT_RETENTION_DAYS)}), ($1, 'retention-fresh', now())`,
      [reporter]
    );

    await sweepRetention();

    const left = async (table: string, column: string) =>
      (await server.query<{ v: string }>(`SELECT ${column} AS v FROM ${table} WHERE ${column} LIKE 'retention-%'`)).map((r) => r.v);
    assert.deepEqual(await left("client_errors", "message"), ["retention-fresh"]);
    assert.deepEqual(await left("server_errors", "message"), ["retention-fresh"]);
    assert.deepEqual(await left("bug_reports", "description"), ["retention-fresh"]);
  });

  test("expired socket-ticket nonces are pruned by the sweep", async () => {
    await server.query(
      `INSERT INTO socket_ticket_nonces (nonce, expires_at) VALUES
       ('retention-expired', now() - interval '1 hour'), ('retention-live', now() + interval '1 hour'),
       ('retention-just-expired', now() - interval '1 second')`
    );

    await sweepRetention();

    const rows = await server.query<{ nonce: string }>(
      "SELECT nonce FROM socket_ticket_nonces WHERE nonce LIKE 'retention-%'"
    );
    assert.deepEqual(
      rows.map((r) => r.nonce).sort(),
      ["retention-just-expired", "retention-live"],
      "a nonce is kept a ticket's lifetime past its expiry"
    );
  });
});
