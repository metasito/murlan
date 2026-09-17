// A replay seat's stored `name` is a copy taken when the hand ended. Two things
// have to reach it anyway: a rename, and the erasure a deleted account is owed —
// including for a seat its owner left mid-match, which carries no user id in
// `player_ids` and so is invisible to the ownership filter deleteUser uses.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { startTestServer, hasDatabase, skipMessage, type TestServer } from "../helpers/testServer.ts";
import { register } from "../helpers/client.ts";

describe("what a replay seat names", { skip: hasDatabase() ? false : skipMessage() }, () => {
  let server: TestServer;
  before(async () => { server = await startTestServer(); });
  after(async () => { if (server) await server.stop(); });

  async function replayWithLeaver(tag: string) {
    const { user: stayer, cookie } = await register(server, `${tag}_stayer`);
    const { user: leaver, cookie: leaverCookie } = await register(server, `${tag}_leaver`);
    const { saveReplay } = await import("../../server/replays.ts");
    await saveReplay({
      roomId: `room-${tag}`,
      finishedAt: new Date(),
      gameMode: "free_for_all",
      seats: [
        { seatIndex: 0, userId: stayer.id, vacatedBy: null, name: stayer.username },
        { seatIndex: 1, userId: null, vacatedBy: leaver.id, name: leaver.username },
      ],
      moves: [],
      rankings: [],
    });
    return { stayer, leaver, cookie, leaverCookie };
  }

  async function rename(cookie: string, username: string) {
    const res = await fetch(`${server.url}/api/users/me`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ username }),
    });
    assert.equal(res.status, 200, await res.text());
  }

  test("a departed player's account deletion reaches the seat they left", async () => {
    const { stayer, leaver } = await replayWithLeaver("vacated");
    const { deleteUser } = await import("../../server/deleteAccount.ts");
    const { listReplaysForUser } = await import("../../server/replays.ts");

    await deleteUser(leaver.id);

    const [replay] = await listReplaysForUser(stayer.id);
    assert.ok(replay, "the stayer keeps the replay");
    const seat = replay.seats.find((s) => s.seatIndex === 1)!;
    assert.equal(seat.name, "", `the leaver's name survived deletion: ${JSON.stringify(seat)}`);
    assert.equal(seat.vacatedBy, null);
  });

  test("a rename reaches a replay already written", async () => {
    const { stayer, leaver, cookie } = await replayWithLeaver("renamed");
    const { listReplaysForUser } = await import("../../server/replays.ts");

    await rename(cookie, "renamed_after");

    const [replay] = await listReplaysForUser(stayer.id);
    assert.equal(replay.seats.find((s) => s.seatIndex === 0)!.name, "renamed_after");
    assert.equal(
      replay.seats.find((s) => s.seatIndex === 1)!.name,
      leaver.username,
      "the seat nobody renamed is untouched"
    );
  });

  // #1087 settled on keeping the stored name whenever `userId` is null, before
  // `vacatedBy` existed to tell a bot from an account that is merely absent.
  // A leaver's stale name is the same finding 156 as a stayer's, so the seat
  // follows the account it still names.
  test("a rename reaches the seat its owner left", async () => {
    const { stayer, leaverCookie } = await replayWithLeaver("leaver_renamed");
    const { listReplaysForUser } = await import("../../server/replays.ts");

    await rename(leaverCookie, "leaver_renamed_after");

    const [replay] = await listReplaysForUser(stayer.id);
    assert.equal(replay.seats.find((s) => s.seatIndex === 1)!.name, "leaver_renamed_after");
  });
});
