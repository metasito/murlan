// tests/integration/spectator.test.ts — watching someone else's table.
//
// A spectator is a viewer with no seat, and the existing sanitiser blanks the
// hand of every seat that is not the viewer's. That is the whole security
// design, so the tests below assert the *outcome* — no spectator ever receives
// a card — rather than the seat lookup that produces it. If the seat lookup ever
// gains a "no seat means seat 0" fallback, the seat-lookup assertion would
// still pass and every spectator would see a hand.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import {
  startTestServer,
  hasDatabase,
  skipMessage,
  type TestServer,
} from "../helpers/testServer.ts";
import { connectAs, intent, leaveRooms, nothingArrives, type TestSocket, waitFor } from "../helpers/client.ts";
import { roomStore } from "../../server/store/roomStore.ts";
import type { WireGameState } from "../../shared/protocol.ts";

// Comfortably longer than any window a test below waits in, so an AFK
// auto-pass can never advance the table by itself — that would make "a
// spectator cannot play" fail and "a spectator sees updates" pass, both for
// the wrong reason. Every move here is driven explicitly.
//
// Not longer than that, though: an armed timer keeps the event loop alive, so
// a large value here is paid again as a stall at teardown.
process.env.MURLAN_AFK_TIMEOUT_MS = "2500";
process.env.MURLAN_DISCONNECT_GRACE_MS = "500";
// When the suite ends and its sockets close, the bot takes over every abandoned
// table and plays it out. At the production pace that is minutes of teardown
// for tests that finished in seconds.
process.env.MURLAN_BOT_MOVE_DELAY_MS = "1";

describe("spectator mode", { skip: hasDatabase() ? false : skipMessage() }, () => {
  let server: TestServer;
  const sockets: TestSocket[] = [];
  /** Seated clients per table, so each table can be closed down explicitly. */
  const tables: TestSocket[][] = [];

  before(async () => {
    server = await startTestServer();
  });
  after(async () => {
    // Leave each table rather than just dropping the sockets. A match runs to
    // 21 points, so an abandoned one is handed to the bot and plays round after
    // round — every exchange resolved by an AFK timeout — long after the tests
    // that created it have finished, holding the event loop open.
    await leaveRooms(tables.flat());
    for (const s of sockets) s.close();
    await server.stop();
  });

  async function seatedGame(prefix: string) {
    const alice = await connectAs(server, `${prefix}_alice`);
    const bob = await connectAs(server, `${prefix}_bob`);
    sockets.push(alice.socket, bob.socket);

    const created = waitFor(alice.socket, "room:state");
    alice.socket.emit("room:create", { gameMode: "free_for_all", maxPlayers: 2 });
    const room = await created;
    const joined = waitFor(bob.socket, "room:state");
    bob.socket.emit("room:join", { code: room.code });
    await joined;

    const started = [alice, bob].map((c) => waitFor(c.socket, "game:state"));
    alice.socket.emit("room:start");
    const [aliceState, bobState] = await Promise.all(started);
    tables.push([alice.socket, bob.socket]);
    return { alice, bob, room, aliceState, bobState };
  }

  /**
   * Plays the opening single from whichever seat holds it. The 3 of spades must
   * be the first card played (docs/GAME-RULES.md), so this is the one move that is
   * legal without inspecting a hand.
   */
  function playOpening(
    seats: { socket: TestSocket }[],
    states: WireGameState[]
  ): void {
    const turn = states[0].currentTurnIndex;
    const idx = states.findIndex((st) => st.viewerSeatIndex === turn);
    assert.ok(idx >= 0, "neither client holds the seat on turn");
    const start = states[idx].openingCard;
    assert.ok(start, "the opening round must name a start card");
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

    const state = waitFor(watcher.socket, "game:state");
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

    const first = waitFor(watcher.socket, "game:state");
    watcher.socket.emit("room:spectate", { code: room.code });
    const before = await first;

    const next = waitFor(watcher.socket, "game:state", 8000);
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

    const joined = waitFor(watcher.socket, "game:state");
    watcher.socket.emit("room:spectate", { code: room.code });
    const before = await joined;

    // Including the genuinely legal opening card, played from the wrong socket.
    await intent(watcher.socket, "game:play", { cardIds: [aliceState.openingCard!.id] });
    await intent(watcher.socket, "game:pass");

    const check = waitFor(watcher.socket, "game:state", 4000);
    watcher.socket.emit("room:spectate", { code: room.code });
    const after = await check;
    assert.equal(
      after.currentTurnIndex,
      before.currentTurnIndex,
      "a spectator's play or pass must not advance the table"
    );
    assert.deepEqual(after.openingCard, before.openingCard, "a spectator opened the game");
  });

  test("spectating a room that does not exist is refused", async () => {
    const watcher = await connectAs(server, "spec_ghost");
    sockets.push(watcher.socket);
    const err = waitFor(watcher.socket, "room:error", 4000);
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
    const refused = waitFor(eve.socket, "room:error", 4000);
    eve.socket.emit("room:spectate", { code: "ZZZZZZ" });
    assert.equal((await refused).code, "ROOM_NOT_FOUND");

    const alice = await connectAs(server, "spec_latch_alice");
    sockets.push(alice.socket);
    const created = waitFor(alice.socket, "room:state");
    alice.socket.emit("room:create", { gameMode: "free_for_all", maxPlayers: 4 });
    const room = await created;
    const joined = waitFor(eve.socket, "room:state");
    eve.socket.emit("room:join", { code: room.code });
    await joined;
    const seated = async () =>
      (await roomStore.getRoomPlayers(room.roomId)).some((p) => p.userId === eve.user.id);
    assert.ok(await seated(), "the join must have taken a seat for the assertions below to mean anything");

    await intent(eve.socket, "room:unspectate");
    assert.ok(await seated(), "room:unspectate must not be mistaken for releasing a seat");

    const roster = waitFor(alice.socket, "room:state");
    eve.socket.emit("room:leave");
    await roster;
    assert.equal(await seated(), false, "room:leave must free the seat");
  });

  test("leaving stops the updates", async () => {
    const { room, alice, bob, aliceState, bobState } = await seatedGame("spec_leave");
    const watcher = await connectAs(server, "spec_leave_eve");
    sockets.push(watcher.socket);

    const joined = waitFor(watcher.socket, "game:state");
    watcher.socket.emit("room:spectate", { code: room.code });
    await joined;

    await intent(watcher.socket, "room:unspectate");

    await noStateWhileOpening(watcher.socket, { alice, bob, aliceState, bobState }, "an unspectated socket must stop receiving state");
  });

  /** The watched table moves — its seats are sent the move — and `socket` is sent none of it. */
  async function noStateWhileOpening(
    socket: TestSocket,
    table: { alice: { socket: TestSocket }; bob: { socket: TestSocket }; aliceState: WireGameState; bobState: WireGameState },
    why: string
  ): Promise<void> {
    setTimeout(() => (socket as unknown as { emitEvent(args: unknown[]): void }).emitEvent(["game:state", {}]), 50); // RED: injected emit
    const quiet = nothingArrives(socket, "game:state", { why });
    const moved = Promise.all([table.alice, table.bob].map((c) => waitFor(c.socket, "game:state")));
    playOpening([table.alice, table.bob], [table.aliceState, table.bobState]);
    await moved;
    await quiet;
  }

  test("taking a seat elsewhere stops the watched table's updates", async () => {
    const watched = await seatedGame("spec_seat_b");
    const watcher = await connectAs(server, "spec_seat_eve");
    sockets.push(watcher.socket);

    const joined = waitFor(watcher.socket, "game:state");
    watcher.socket.emit("room:spectate", { code: watched.room.code });
    await joined;

    const created = waitFor(watcher.socket, "room:state");
    watcher.socket.emit("room:create", { gameMode: "free_for_all", maxPlayers: 2 });
    await created;
    tables.push([watcher.socket]);

    await noStateWhileOpening(watcher.socket, watched, "a seated socket must not still be watching another table");
  });

  test("starting the table a watcher is seated at stops the watched table's updates", async () => {
    const watched = await seatedGame("spec_start_b");
    const host = await connectAs(server, "spec_start_eve");
    const guest = await connectAs(server, "spec_start_guest");
    sockets.push(host.socket, guest.socket);

    const created = waitFor(host.socket, "room:state");
    host.socket.emit("room:create", { gameMode: "free_for_all", maxPlayers: 2 });
    const own = await created;
    const filled = waitFor(guest.socket, "room:state");
    guest.socket.emit("room:join", { code: own.code });
    await filled;
    tables.push([host.socket, guest.socket]);

    const watching = waitFor(host.socket, "game:state");
    host.socket.emit("room:spectate", { code: watched.room.code });
    await watching;

    const dealt = [host, guest].map((c) => waitFor(c.socket, "game:state"));
    assert.equal((await intent(host.socket, "room:start")).ok, true);
    await Promise.all(dealt);

    await noStateWhileOpening(host.socket, watched, "a dealt-in socket must not still be watching another table");
  });
});
