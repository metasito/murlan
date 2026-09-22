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
 * Imported inside the call rather than at module scope — `server/store/db.ts` builds
 * its pool as it loads, and `startTestServer` sets `DATABASE_URL` first.
 */
async function friendRows(): Promise<
  { id: string; userId: string; friendUserId: string; status: string }[]
> {
  const { db } = await import("../../server/store/db.ts");
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

    const pair = [sender.user.id, recipient.user.id];
    const rows = (await friendRows()).filter((r) => pair.includes(r.userId));
    assert.equal(rows.length, 1, `expected one pending row, got ${JSON.stringify(rows)}`);
  });

  test("crossed requests leave one row, and the loser is told one is waiting", async () => {
    const alice = await register(server, "race_crossed_alice");
    const bob = await register(server, "race_crossed_bob");
    const pair = [alice.user.id, bob.user.id];

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

    const rows = (await friendRows()).filter((r) => pair.includes(r.userId));
    assert.equal(rows.length, 1, `expected one pending row, got ${JSON.stringify(rows)}`);
  });

  // The issue asks for two *crossed* requests accepted at once. The pending
  // index makes a crossed pair unconstructible — the second request never
  // becomes a row — so the same race is reached from the one request both
  // halves of the UI can act on.
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
    assert.deepEqual(
      [first.status, second.status].sort(),
      [200, 404],
      "a constraint the handler races into must surface as an answer, not a crash " +
        "and not a second acceptance"
    );
    assert.equal(await codeOf(first.status === 404 ? first : second), "FRIEND_REQUEST_NOT_FOUND");

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
  test("a request left over beside the friendship it asked for is cleared, not refused forever", async () => {
    const alice = await register(server, "stale_alice");
    const bob = await register(server, "stale_bob");
    const { pool } = await import("../../server/store/db.ts");

    // What an add and an accept crossing leaves behind: neither partial index
    // forbids a pending row beside an accepted one in the same direction, and
    // accepting it is an update onto a key the accepted index already holds.
    for (const [userId, friendUserId, status] of [
      [alice.user.id, bob.user.id, "accepted"],
      [bob.user.id, alice.user.id, "accepted"],
      [alice.user.id, bob.user.id, "pending"],
    ]) {
      await pool.query(
        `INSERT INTO "friends" ("user_id", "friend_user_id", "status") VALUES ($1, $2, $3)`,
        [userId, friendUserId, status]
      );
    }
    const [request] = (await friendRows()).filter(
      (r) => r.userId === alice.user.id && r.status === "pending"
    );
    assert.ok(request, "the leftover request was seeded");

    const res = await fetch(`${server.url}/api/friends/accept/${request.id}`, {
      method: "POST",
      headers: { cookie: bob.cookie },
    });
    assert.equal(
      res.status,
      200,
      "the update can never move that row, so retrying it answers 404 to a " +
        "request that stays in the list forever"
    );
    assert.deepEqual(
      (await friendRows())
        .filter((r) => [alice.user.id, bob.user.id].includes(r.userId))
        .map((r) => r.status)
        .sort(),
      ["accepted", "accepted"]
    );
  });

  // Last in the file: it drops the indexes the tests above rely on, and puts
  // them back through the boot path itself.
  test("boot clears duplicates already in the table rather than refusing to start", async () => {
    const alice = await register(server, "dedupe_alice");
    const bob = await register(server, "dedupe_bob");
    const carol = await register(server, "dedupe_carol");
    const dave = await register(server, "dedupe_dave");
    const { pool } = await import("../../server/store/db.ts");
    const { ensureSchema } = await import("../../server/store/schemaDdl.ts");

    // The state a database upgraded into these indexes is already in: nothing
    // forbade any of it until now. Every shape each index forbids is seeded —
    // a duplicate accepted row per direction, a repeated request and a crossed
    // pair — because a dedupe that never meets a row it must delete is a
    // CREATE UNIQUE INDEX that fails in production and nowhere else.
    await pool.query(`DROP INDEX "friends_accepted_uq", "friends_pending_pair_uq"`);
    const values = [
      [alice.user.id, bob.user.id, "accepted"],
      [bob.user.id, alice.user.id, "accepted"],
      [alice.user.id, bob.user.id, "accepted"],
      [bob.user.id, alice.user.id, "accepted"],
      [carol.user.id, dave.user.id, "pending"],
      [carol.user.id, dave.user.id, "pending"],
      [dave.user.id, carol.user.id, "pending"],
    ];
    // Written in descending age, so the oldest pending row is the last one in
    // the table rather than the first: an order that only agrees with the heap
    // is one a dedupe keeping an arbitrary row would also satisfy.
    for (const [i, [userId, friendUserId, status]] of values.entries()) {
      await pool.query(
        `INSERT INTO "friends" ("user_id", "friend_user_id", "status", "created_at")
         VALUES ($1, $2, $3, now() - ($4 || ' seconds')::interval)`,
        [userId, friendUserId, status, String(i)]
      );
    }

    const rowsFor = async (ids: string[]) =>
      (await friendRows())
        .filter((r) => ids.includes(r.userId))
        .map((r) => `${r.userId}->${r.friendUserId}`)
        .sort();
    const accepted = () => rowsFor([alice.user.id, bob.user.id]);
    const pending = () => rowsFor([carol.user.id, dave.user.id]);
    const bothWays = [
      `${alice.user.id}->${bob.user.id}`,
      `${bob.user.id}->${alice.user.id}`,
    ].sort();

    await ensureSchema(pool);
    assert.deepEqual(
      await accepted(),
      bothWays,
      "both directions must survive and neither twice: an accepted friendship is " +
        "one row each way, and a side missing its row cannot see the friend at all"
    );
    assert.deepEqual(
      await pending(),
      [`${dave.user.id}->${carol.user.id}`],
      "a request is one row whoever asked, and the one that survives is the " +
        "oldest — which is the direction the pair actually asked in first"
    );

    // The second boot is the one that proves nothing here is a migration.
    const survivors = await pending();
    await ensureSchema(pool);
    assert.deepEqual(await accepted(), bothWays);
    assert.deepEqual(await pending(), survivors);
  });
});
