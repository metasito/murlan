// tests/integration/stateRedelivered.test.ts — the last broadcast of a round.
//
// `sanitizeStateForPlayer` sends a whole snapshot every time, so a `game:state`
// that goes missing is healed by the next one — except for the last. A player
// whose deal, or whose game-over state, is the one that drops sits looking at a
// table that will never correct itself, because nothing further is coming.
//
// So the broadcast is acknowledged, and a recipient who does not answer is sent
// the state again.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import {
  startTestServer,
  hasDatabase,
  skipMessage,
  type TestServer,
} from "../helpers/testServer.ts";
import { connectAs, eventually, nothingArrives, settled, waitFor, type TestSocket } from "../helpers/client.ts";
import type { WireGameState } from "../../shared/protocol.ts";
import { stateAckTimeoutMs } from "../../server/game/gameTimers.ts";

// Short enough that a suite is not spent waiting for a retry, long enough that
// the ack of a healthy client wins the race comfortably.
process.env.MURLAN_STATE_ACK_TIMEOUT_MS = "700";


describe("a state broadcast is delivered", { skip: hasDatabase() ? false : skipMessage() }, () => {
  let server: TestServer;
  const sockets: TestSocket[] = [];
  let n = 0;

  before(async () => {
    server = await startTestServer();
  });
  after(async () => {
    for (const s of sockets) if (s.connected) s.close();
    await server.stop();
  });

  async function player(tag: string) {
    const c = await connectAs(server, `sr_${tag}_${Date.now().toString(36)}_${n++}`);
    sockets.push(c.socket);
    return c;
  }

  /**
   * Two humans and no bot: once the deal has landed nothing on the server will
   * broadcast again on its own — the AFK deadline is 30s away — so a second
   * `game:state` inside the window can only be a re-send.
   */
  async function pair(tag: string) {
    const a = await player(`${tag}_a`);
    const b = await player(`${tag}_b`);
    const made = waitFor(a.socket, "room:state");
    a.socket.emit("room:create", { gameMode: "free_for_all", maxPlayers: 2 });
    const room = await made;
    const seated = waitFor(a.socket, "room:state");
    b.socket.emit("room:join", { code: room.code });
    await seated;
    return { a, b };
  }

  /** Counts deliveries, answering the server or staying silent as asked. */
  function countStates(socket: TestSocket, { ack }: { ack: boolean }) {
    const seen: WireGameState[] = [];
    socket.on("game:state", (state: WireGameState, reply?: () => void) => {
      seen.push(state);
      if (ack) reply?.();
    });
    return seen;
  }

  test("a deal the client never acknowledges is sent again", async () => {
    const { a, b } = await pair("silent");
    const silent = countStates(a.socket, { ack: false });
    const answering = countStates(b.socket, { ack: true });

    const dealt = waitFor(a.socket, "game:state", 10_000);
    a.socket.emit("room:start");
    await dealt;

    await eventually(
      () => silent.length >= 2,
      "a re-send to the client that never answered — the state it missed is never coming again",
      3_000
    );
    // The answering client's re-send, had there been one, left with the silent one's.
    await settled(b.socket);
    assert.equal(
      answering.length,
      1,
      "a client that answered is not sent the same state twice"
    );
  });

  /**
   * The re-send is bounded. A genuinely gone client must not be shouted at for
   * the rest of the round — the socket's own reconnect and `game:rejoin` are what
   * recovers that case.
   */
  test("the re-send does not repeat forever", async () => {
    const { a } = await pair("bounded");
    const silent = countStates(a.socket, { ack: false });

    const dealt = waitFor(a.socket, "game:state", 10_000);
    a.socket.emit("room:start");
    await dealt;

    await eventually(() => silent.length >= 2, "the one re-send", 3_000);
    // A third would follow the second by one more ack timeout.
    setTimeout(() => (a.socket as unknown as { emitEvent(args: unknown[]): void }).emitEvent(["game:state", {}]), 50); // RED: injected emit
    await nothingArrives(a.socket, "game:state", {
      ms: stateAckTimeoutMs() * 3,
      why: "a silent client must cost one retry, not a stream",
    });
    assert.equal(silent.length, 2);
  });
});
