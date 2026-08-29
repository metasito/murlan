// tests/integration/intentAcknowledged.test.ts — a play told the player it arrived.
//
// Every intent was fire-and-forget. A play emitted on a connection that was
// failing went nowhere, the client had no way to know, and the turn ran out and
// auto-passed — which reads to the player as the game taking their turn away.
//
// Socket.IO's own delivery guarantees say why nothing else covers this: "there
// is no guarantee that the other side has received it and there will be no
// retry upon reconnection". The acknowledgement is the guarantee.
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
import type { SanitizedState } from "../helpers/table.ts";

interface RoomState {
  code: string;
  roomId: string;
  status: string;
  players: { userId: string; seatIndex: number }[];
}

/** Resolves with the ack payload, or null if the server never answers. */
function ackOf(socket: Socket, event: string, payload: unknown, ms = 4_000) {
  return new Promise<unknown>((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    socket.emit(event, payload, (reply: unknown) => {
      clearTimeout(timer);
      resolve(reply ?? "acked");
    });
  });
}

describe("an intent is acknowledged", { skip: hasDatabase() ? false : skipMessage() }, () => {
  let server: TestServer;
  const sockets: Socket[] = [];
  let n = 0;

  before(async () => {
    server = await startTestServer();
  });
  after(async () => {
    for (const s of sockets) if (s.connected) s.close();
    await server.stop();
  });

  async function player(tag: string) {
    const c = await connectAs(server, `ia_${tag}_${Date.now().toString(36)}_${n++}`);
    sockets.push(c.socket);
    return c;
  }

  /**
   * Two humans, dealt. The opening lead is the only move that is legal without
   * reading the pile — the seat holding the start card must play it — so the
   * player whose turn it is at the deal is the one this suite can act as.
   */
  async function dealtPair(tag: string) {
    const a = await player(`${tag}_a`);
    const b = await player(`${tag}_b`);
    const made = waitFor<RoomState>(a.socket, "room:state");
    a.socket.emit("room:create", { gameMode: "free_for_all", maxPlayers: 2 });
    const room = await made;
    const seated = waitFor<RoomState>(a.socket, "room:state");
    b.socket.emit("room:join", { code: room.code });
    await seated;

    const deals = [
      waitFor<SanitizedState>(a.socket, "game:state", 10_000),
      waitFor<SanitizedState>(b.socket, "game:state", 10_000),
    ];
    a.socket.emit("room:start");
    const [sa, sb] = await Promise.all(deals);

    const leader = sa.currentTurnIndex === sa.viewerSeatIndex ? { c: a, s: sa } : { c: b, s: sb };
    assert.equal(
      leader.s.currentTurnIndex,
      leader.s.viewerSeatIndex,
      "one of the two seats must hold the opening lead"
    );
    return leader;
  }

  /** A host alone at a two-seat table, with a bot for company, mid-hand. */
  async function table(tag: string) {
    const host = await player(tag);
    const made = waitFor<RoomState>(host.socket, "room:state");
    host.socket.emit("room:create", { gameMode: "free_for_all", maxPlayers: 2 });
    await made;

    const dealt = waitFor<SanitizedState>(host.socket, "game:state", 10_000);
    host.socket.emit("room:start", { fillWithBots: true, botDifficulty: "easy" });
    return { host, state: await dealt };
  }

  /**
   * The claim under test is only that the server answers. What it answers with
   * — accepted, or refused because it is not your turn — is the handler's
   * business; silence is the defect.
   */
  test("the server answers a play, so the client can tell it arrived", async () => {
    const { host, state } = await table("play");
    const seat = state.players[state.viewerSeatIndex];
    assert.ok(seat, "the host holds a seat");

    const reply = await ackOf(host.socket, "game:play", {
      cardIds: [seat.hand[0]?.id ?? "no-such-card"],
    });
    assert.notEqual(reply, null, "a play that is never acknowledged is a play the client cannot retry");
  });

  /**
   * The reason a retry is safe to add. `processPlay` takes the cards out of the
   * hand, and the handler resolves the ids against the hand it finds — so the
   * replay of a play that already landed matches nothing and is refused. This
   * is asserted rather than assumed, because `CLAUDE.md` makes a card appearing
   * twice a worse defect than the one the retry exists to fix.
   */
  test("a play sent twice is played once", async () => {
    const { c: host, s: state } = await dealtPair("twice");
    const seat = state.players[state.viewerSeatIndex];
    assert.ok(seat, "the leading seat");
    const before = seat.hand.length;

    const lead = seat.hand.find((c) => c.id === state.startCard?.id);
    assert.ok(lead, "the opening seat holds the start card and must lead it");

    // Armed before the first emit: the broadcast lands while `ackOf` is still
    // awaiting the server, so a listener attached afterwards has already
    // missed it.
    const settled = new Promise<SanitizedState | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), 5_000);
      const onState = (st: SanitizedState) => {
        if (st.players[st.viewerSeatIndex]?.hand.length === before) return;
        clearTimeout(timer);
        host.socket.off("game:state", onState);
        resolve(st);
      };
      host.socket.on("game:state", onState);
    });

    const first = await ackOf(host.socket, "game:play", { cardIds: [lead.id] });
    const second = await ackOf(host.socket, "game:play", { cardIds: [lead.id] });
    assert.notEqual(first, null);
    assert.notEqual(second, null, "the duplicate is answered too, not left hanging");

    const finalState = await settled;
    assert.ok(finalState, "the table reported the hand back");
    const after = finalState.players[finalState.viewerSeatIndex];
    assert.ok(after);
    assert.equal(
      after.hand.length,
      before - 1,
      "one card left the hand, not two — the replay found nothing to play"
    );
    assert.equal(
      after.hand.some((c) => c.id === lead.id),
      false,
      "and the card it did play is gone exactly once"
    );
  });

  test("the server answers a pass", async () => {
    const { host } = await table("pass");
    assert.notEqual(await ackOf(host.socket, "game:pass", undefined), null);
  });

  /**
   * A refusal is an answer. An intent the server rejects must still come back,
   * or a client retrying on silence would retry a thing that will never work.
   */
  test("the server answers even when it refuses the intent", async () => {
    const { host } = await table("refuse");
    const reply = await ackOf(host.socket, "game:play", { cardIds: ["definitely-not-a-card"] });
    assert.notEqual(reply, null, "a rejected intent is still acknowledged");
  });
});
