// tests/integration/friendRaces.test.ts — two requests arriving at once must
// not both be believed.
//
// `POST /api/friends/add` decided whether a friendship could exist by reading,
// then wrote; nothing behind the handler caught what the handler missed. Only a
// real database can carry this: the whole property is what two connections do
// to one table at the same moment, which a single-process test can never see.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import {
  startTestServer,
  hasDatabase,
  skipMessage,
  type TestServer,
} from "../helpers/testServer.ts";
import { register } from "../helpers/client.ts";

interface Account {
  cookie: string;
  user: { id: string; username: string };
}

function add(server: TestServer, from: Account, to: Account): Promise<Response> {
  return fetch(`${server.url}/api/friends/add`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: from.cookie },
    body: JSON.stringify({ username: to.user.username }),
  });
}

/**
 * The rows themselves, not what an endpoint answers: every endpoint filters by
 * status and direction, so a duplicate is exactly what they hide.
 *
 * Imported inside the call rather than at module scope — `server/db.ts` builds
 * its pool as it loads, and `startTestServer` sets `DATABASE_URL` first.
 */
async function friendRows(): Promise<{ userId: string; friendUserId: string; status: string }[]> {
  const { db } = await import("../../server/db.ts");
  const { friends } = await import("../../shared/schema.ts");
  return db.select().from(friends);
}

async function codeOf(res: Response): Promise<string> {
  return ((await res.json()) as { code?: string }).code ?? "";
}

describe("simultaneous friend requests", {
  skip: hasDatabase() ? false : skipMessage(),
}, () => {
  let server: TestServer;

  before(async () => {
    server = await startTestServer();
  });

  after(async () => {
    await server.stop();
  });

  test("the same request sent twice at once leaves one row and one refusal", async () => {
    const sender = await register(server, "race_same_sender");
    const recipient = await register(server, "race_same_recipient");

    const [first, second] = await Promise.all([
      add(server, sender, recipient),
      add(server, sender, recipient),
    ]);

    const statuses = [first.status, second.status].sort();
    assert.deepEqual(
      statuses,
      [200, 409],
      "both requests were answered the same way, so the pre-check decided twice " +
        "on the same reads"
    );
    const loser = first.status === 409 ? first : second;
    assert.equal(await codeOf(loser), "FRIEND_REQUEST_ALREADY_SENT");

    const rows = await friendRows();
    assert.equal(rows.length, 1, `expected one pending row, got ${JSON.stringify(rows)}`);
  });

  test("crossed requests leave one row, and the loser is told one is waiting", async () => {
    const alice = await register(server, "race_crossed_alice");
    const bob = await register(server, "race_crossed_bob");
    const before = (await friendRows()).length;

    const [aToB, bToA] = await Promise.all([
      add(server, alice, bob),
      add(server, bob, alice),
    ]);

    const statuses = [aToB.status, bToA.status].sort();
    assert.deepEqual(statuses, [200, 409], "a crossed pair is a state the client cannot render");
    const loser = aToB.status === 409 ? aToB : bToA;
    assert.equal(
      await codeOf(loser),
      "FRIEND_REQUEST_INCOMING_PENDING",
      "the refused half has a request waiting on it — being told 'already sent' " +
        "leaves no way to learn that accepting is the move"
    );

    assert.equal((await friendRows()).length, before + 1);
  });

  test("the same request accepted twice at once makes the pair friends once", async () => {
    const sender = await register(server, "race_accept_sender");
    const recipient = await register(server, "race_accept_recipient");
    assert.equal((await add(server, sender, recipient)).status, 200);

    const pending = await fetch(`${server.url}/api/friends/requests`, {
      headers: { cookie: recipient.cookie },
    });
    const [request] = (await pending.json()) as { id: string }[];
    assert.ok(request, "the request reached the recipient");

    const accept = () =>
      fetch(`${server.url}/api/friends/accept/${request.id}`, {
        method: "POST",
        headers: { cookie: recipient.cookie },
      });
    const [first, second] = await Promise.all([accept(), accept()]);
    assert.ok(
      [first.status, second.status].includes(200),
      "neither accept was honoured"
    );
    assert.ok(
      first.status !== 500 && second.status !== 500,
      "a constraint the handler races into must surface as an answer, not a crash"
    );

    for (const who of [sender, recipient]) {
      const list = await fetch(`${server.url}/api/friends`, { headers: { cookie: who.cookie } });
      const rows = (await list.json()) as { id: string }[];
      assert.equal(
        rows.length,
        1,
        `${who.user.username} sees the same person ${rows.length} times, which is a duplicate React key`
      );
    }
  });
  // Last in the file: it drops the indexes the tests above rely on, and puts
  // them back through the boot path itself.
  test("boot clears duplicates already in the table rather than refusing to start", async () => {
    const alice = await register(server, "dedupe_alice");
    const bob = await register(server, "dedupe_bob");
    const { pool } = await import("../../server/db.ts");
    const { ensureSchema } = await import("../../server/schemaDdl.ts");

    // The state a database upgraded into these indexes is already in: nothing
    // forbade any of it until now.
    await pool.query(`DROP INDEX "friends_accepted_uq", "friends_pending_pair_uq"`);
    const values = [
      [alice.user.id, bob.user.id, "accepted"],
      [bob.user.id, alice.user.id, "accepted"],
      [alice.user.id, bob.user.id, "accepted"],
      [bob.user.id, alice.user.id, "accepted"],
    ];
    for (const [userId, friendUserId, status] of values) {
      await pool.query(
        `INSERT INTO "friends" ("user_id", "friend_user_id", "status") VALUES ($1, $2, $3)`,
        [userId, friendUserId, status]
      );
    }

    const pair = async () =>
      (await friendRows())
        .filter((r) => [alice.user.id, bob.user.id].includes(r.userId))
        .map((r) => `${r.userId}->${r.friendUserId}`)
        .sort();
    const bothWays = [
      `${alice.user.id}->${bob.user.id}`,
      `${bob.user.id}->${alice.user.id}`,
    ].sort();

    await ensureSchema(pool);
    assert.deepEqual(
      await pair(),
      bothWays,
      "both directions must survive and neither twice: an accepted friendship is " +
        "one row each way, and a side missing its row cannot see the friend at all"
    );

    // The second boot is the one that proves nothing here is a migration.
    await ensureSchema(pool);
    assert.deepEqual(await pair(), bothWays);
  });
});
