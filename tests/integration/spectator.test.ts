// tests/integration/spectator.test.ts — watching someone else's table.
//
// A spectator is a viewer with no seat, and the existing sanitiser blanks the
// hand of every seat that is not the viewer's. That is the whole security
// design, so the tests below assert the *outcome* — no spectator ever receives
// a card — rather than the seat lookup that produces it. If findViewerSeat ever
// gains a "no seat means seat 0" fallback, the seat-lookup assertion would
// still pass and every spectator would see a hand.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import type { Socket } from "socket.io-client";
import {
  startTestServer,
  hasDatabase,
  skipMessage,
  type TestServer,
} from "../helpers/testServer.ts";
import { connectAs, waitFor } from "../helpers/client.ts";

// Comfortably longer than any window a test below waits in, so an AFK
// auto-pass can never advance the table by itself — that would make "a
// spectator cannot play" fail and "a spectator sees updates" pass, both for
// the wrong reason. Every move here is driven explicitly.
//
// Not longer than that, though: an armed timer keeps the event loop alive, so
// a large value here is paid again as a stall at teardown.
process.env.MURLAN_AFK_TIMEOUT_MS = "2500";
process.env.MURLAN_DISCONNECT_GRACE_MS = "500";
// When the suite ends and its sockets close, the AI takes over every abandoned
// table and plays it out. At the production pace that is minutes of teardown
// for tests that finished in seconds.
process.env.MURLAN_BOT_MOVE_DELAY_MS = "1";

interface SanitizedPlayer {
  id: string;
  name: string;
  hand: { id: string }[];
  handCount: number;
}
interface SanitizedState {
  players: SanitizedPlayer[];
  viewerSeatIndex: number | null;
  currentTurnIndex: number;
  firstPlayMade: boolean;
  startCard: { id: string } | null;
}
interface RoomState {
  code: string;
  roomId: string;
}

describe("spectator mode", { skip: hasDatabase() ? false : skipMessage() }, () => {
  let server: TestServer;
  const sockets: Socket[] = [];
  /** Seated clients per table, so each table can be closed down explicitly. */
  const tables: Socket[][] = [];

  before(async () => {
    server = await startTestServer();
  });
  after(async () => {
    // Leave each table rather than just dropping the sockets. A match runs to
    // 21 points, so an abandoned one is handed to the AI and plays hand after
    // hand — every exchange resolved by an AFK timeout — long after the tests
    // that created it have finished, holding the event loop open.
    for (const seats of tables) for (const s of seats) s.emit("room:leave");
    await new Promise((r) => setTimeout(r, 200));
    for (const s of sockets) s.close();
    await server.stop();
  });

  async function seatedGame(prefix: string) {
    const alice = await connectAs(server, `${prefix}_alice`);
    const bob = await connectAs(server, `${prefix}_bob`);
    sockets.push(alice.socket, bob.socket);

    const created = waitFor<RoomState>(alice.socket, "room:state");
    alice.socket.emit("room:create", { gameMode: "free_for_all", maxPlayers: 2 });
    const room = await created;
    const joined = waitFor<RoomState>(bob.socket, "room:state");
    bob.socket.emit("room:join", { code: room.code });
    await joined;

    const started = [alice, bob].map((c) => waitFor<SanitizedState>(c.socket, "game:state"));
    alice.socket.emit("room:start");
    const [aliceState, bobState] = await Promise.all(started);
    tables.push([alice.socket, bob.socket]);
    return { alice, bob, room, aliceState, bobState };
  }

  /**
   * Plays the opening single from whichever seat holds it. The 3 of spades must
   * be the first card played (docs/RULES.md), so this is the one move that is
   * legal without inspecting a hand.
   */
  function playOpening(
    seats: { socket: Socket }[],
    states: SanitizedState[]
  ): void {
    const turn = states[0].currentTurnIndex;
    const idx = states.findIndex((st) => st.viewerSeatIndex === turn);
    assert.ok(idx >= 0, "neither client holds the seat on turn");
    const start = states[idx].startCard;
    assert.ok(start, "the opening hand must name a start card");
    seats[idx].socket.emit("game:play", { cardIds: [start!.id] });
  }

  test("a seated player still receives their own hand", async () => {
    // Guards the guard: if this ever went empty, every assertion below would
    // pass for the wrong reason.
    const { aliceState } = await seatedGame("spec_baseline");
    const mine = aliceState.players[aliceState.viewerSeatIndex!];
    assert.ok(mine.hand.length > 0, "the viewer must see their own cards");
  });

  test("a spectator receives the table with every hand hidden", async () => {
    const { room } = await seatedGame("spec_watch");
    const watcher = await connectAs(server, "spec_watch_eve");
    sockets.push(watcher.socket);

    const state = waitFor<SanitizedState>(watcher.socket, "game:state");
    watcher.socket.emit("room:spectate", { code: room.code });
    const seen = await state;

    assert.equal(seen.viewerSeatIndex, null, "a spectator holds no seat");
    assert.ok(seen.players.length >= 2);
    for (const p of seen.players) {
      assert.deepEqual(p.hand, [], `${p.name}'s hand leaked to a spectator`);
      assert.ok(p.handCount > 0, "a spectator still sees how many cards each seat holds");
    }
  });

  test("a spectator keeps receiving updates as the game moves", async () => {
    const { room, alice, bob, aliceState, bobState } = await seatedGame("spec_live");
    const watcher = await connectAs(server, "spec_live_eve");
    sockets.push(watcher.socket);

    const first = waitFor<SanitizedState>(watcher.socket, "game:state");
    watcher.socket.emit("room:spectate", { code: room.code });
    const before = await first;

    const next = waitFor<SanitizedState>(watcher.socket, "game:state", 8000);
    playOpening([alice, bob], [aliceState, bobState]);
    const after = await next;

    assert.notEqual(after.currentTurnIndex, before.currentTurnIndex, "the table did not move");
    for (const p of after.players) {
      assert.deepEqual(p.hand, [], "a hand leaked on a later broadcast");
    }
  });

  test("a spectator cannot play or pass", async () => {
    const { room, aliceState } = await seatedGame("spec_mute");
    const watcher = await connectAs(server, "spec_mute_eve");
    sockets.push(watcher.socket);

    const joined = waitFor<SanitizedState>(watcher.socket, "game:state");
    watcher.socket.emit("room:spectate", { code: room.code });
    const before = await joined;

    // Including the genuinely legal opening card, played from the wrong socket.
    watcher.socket.emit("game:play", { cardIds: [aliceState.startCard!.id] });
    watcher.socket.emit("game:pass");
    await new Promise((r) => setTimeout(r, 250));

    const check = waitFor<SanitizedState>(watcher.socket, "game:state", 4000);
    watcher.socket.emit("room:spectate", { code: room.code });
    const after = await check;
    assert.equal(
      after.currentTurnIndex,
      before.currentTurnIndex,
      "a spectator's play or pass must not advance the table"
    );
    assert.equal(after.firstPlayMade, before.firstPlayMade, "a spectator opened the game");
  });

  test("spectating a room that does not exist is refused", async () => {
    const watcher = await connectAs(server, "spec_ghost");
    sockets.push(watcher.socket);
    const err = waitFor<{ code?: string }>(watcher.socket, "room:error", 4000);
    watcher.socket.emit("room:spectate", { code: "ZZZZZZ" });
    const payload = await err;
    assert.equal(payload.code, "ROOM_NOT_FOUND");
  });

  // The premise the client's spectator flag rests on: a refused spectate
  // registers nothing, so `room:unspectate` has nothing to release and the seat
  // the player later takes is freed only by `room:leave`. A client that latches
  // the flag on a refusal sends the wrong one of the two and leaves the seat
  // occupied — dealt hands and auto-passed — while its own screen shows the
  // lobby.
  test("a refused spectate leaves a later seat to be released by room:leave", async () => {
    const eve = await connectAs(server, "spec_latch_eve");
    sockets.push(eve.socket);
    const refused = waitFor<{ code?: string }>(eve.socket, "room:error", 4000);
    eve.socket.emit("room:spectate", { code: "ZZZZZZ" });
    assert.equal((await refused).code, "ROOM_NOT_FOUND");

    const alice = await connectAs(server, "spec_latch_alice");
    sockets.push(alice.socket);
    const created = waitFor<RoomState>(alice.socket, "room:state");
    alice.socket.emit("room:create", { gameMode: "free_for_all", maxPlayers: 4 });
    const room = await created;
    const joined = waitFor<RoomState>(eve.socket, "room:state");
    eve.socket.emit("room:join", { code: room.code });
    await joined;

    const { storage } = await import("../../server/storage.ts");
    const seated = async () =>
      (await storage.getRoomPlayers(room.roomId)).some((p) => p.userId === eve.user.id);
    assert.ok(await seated(), "the join must have taken a seat for the assertions below to mean anything");

    eve.socket.emit("room:unspectate");
    await new Promise((r) => setTimeout(r, 250));
    assert.ok(await seated(), "room:unspectate must not be mistaken for releasing a seat");

    const roster = waitFor<RoomState>(alice.socket, "room:state");
    eve.socket.emit("room:leave");
    await roster;
    assert.equal(await seated(), false, "room:leave must free the seat");
  });

  test("leaving stops the updates", async () => {
    const { room, alice, bob, aliceState, bobState } = await seatedGame("spec_leave");
    const watcher = await connectAs(server, "spec_leave_eve");
    sockets.push(watcher.socket);

    const joined = waitFor<SanitizedState>(watcher.socket, "game:state");
    watcher.socket.emit("room:spectate", { code: room.code });
    await joined;

    watcher.socket.emit("room:unspectate");
    await new Promise((r) => setTimeout(r, 150));

    let received = false;
    watcher.socket.once("game:state", () => {
      received = true;
    });
    playOpening([alice, bob], [aliceState, bobState]);
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(received, false, "an unspectated socket must stop receiving state");
  });
});
