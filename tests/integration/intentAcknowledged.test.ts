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
import { io as ioClient, type Socket } from "socket.io-client";
import {
  startTestServer,
  hasDatabase,
  skipMessage,
  type TestServer,
} from "../helpers/testServer.ts";
import { PROTOCOL_AUTH, connectAs, waitFor } from "../helpers/client.ts";
import { AUTH_UNAVAILABLE } from "../../shared/protocol.ts";
import type { SanitizedState } from "../helpers/table.ts";
import type { IntentReply } from "../../shared/protocol.ts";
import { payload } from "../../server/shared/payload.ts";
import { userStore } from "../../server/store/userStore.ts";
import { db } from "../../server/store/db.ts";
import { activeGames as activeGamesTable } from "../../shared/schema.ts";
import { eq } from "drizzle-orm";
import { restartUnder } from "../helpers/liveGame.ts";
import { turnOf } from "../../lib/game/moves.ts";

/** The token a move at the round's `seq`-th move names, asked of its owner rather than spelled here. */
const turnAt = (seq: number) => turnOf({ lastMove: { seq, kind: "pass", seat: 0, closedTrick: false } });

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

    const leads = sa.currentTurnIndex === sa.viewerSeatIndex;
    const leader = leads ? { c: a, s: sa } : { c: b, s: sb };
    assert.equal(
      leader.s.currentTurnIndex,
      leader.s.viewerSeatIndex,
      "one of the two seats must hold the opening lead"
    );
    return { ...leader, waiting: leads ? b : a, roomId: room.roomId };
  }

  /** A host alone at a two-seat table, with a bot for company, mid-round. */
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
      turn: state.turn,
    });
    assert.notEqual(reply, null, "a play that is never acknowledged is a play the client cannot retry");
  });

  /**
   * The reason a retry is safe to add. The replay names the turn the first play
   * moved the table past, so it is refused as stale. This is asserted rather
   * than assumed, because `CLAUDE.md` makes a card appearing twice a worse
   * defect than the one the retry exists to fix.
   */
  test("a play sent twice is played once", async () => {
    const { c: host, s: state } = await dealtPair("twice");
    const seat = state.players[state.viewerSeatIndex];
    assert.ok(seat, "the leading seat");
    const before = seat.hand.length;

    const lead = seat.hand.find((c) => c.id === state.openingCard?.id);
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

    const first = await ackOf(host.socket, "game:play", { cardIds: [lead.id], turn: state.turn });
    const second = await ackOf(host.socket, "game:play", { cardIds: [lead.id], turn: state.turn });
    assert.deepEqual(first, { ok: true });
    assert.deepEqual(second, { ok: false, code: "NOT_YOUR_TURN" }, "the duplicate is answered as stale, not left hanging");

    const finalState = await settled;
    assert.ok(finalState, "the table reported the round back");
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

  /** The defence behind the stale check: a play named against the current turn still finds its cards gone. */
  test("a play replayed under the current turn is refused because its cards have left the hand", async () => {
    const { c: leader, s: state, waiting, roomId } = await dealtPair("cardsgone");
    const lead = state.players[state.viewerSeatIndex]?.hand.find((c) => c.id === state.openingCard?.id);
    assert.ok(lead);
    assert.deepEqual(await ackOf(leader.socket, "game:play", { cardIds: [lead.id], turn: state.turn }), { ok: true });
    assert.deepEqual(await ackOf(waiting.socket, "game:pass", { turn: turnAt(1) }), { ok: true });

    const current = await stateOf(leader, roomId);
    assert.equal(current.currentTurnIndex, current.viewerSeatIndex, "the trick closed back to the leader");
    const replay = (await ackOf(leader.socket, "game:play", { cardIds: [lead.id], turn: current.turn })) as IntentReply;
    assert.equal(replay.code, "INVALID_CARD", "the turn guard let it through, and the hand refused it");
    const after = await stateOf(leader, roomId);
    assert.equal(after.turn, current.turn, "nothing moved");
    assert.equal(after.players[after.viewerSeatIndex]?.hand.length, current.players[current.viewerSeatIndex]?.hand.length);
  });

  test("a pass retried under one intentId is answered as the pass that landed", async () => {
    const { c: leader, s: state, waiting } = await dealtPair("passretry");
    const lead = state.players[state.viewerSeatIndex]?.hand.find((c) => c.id === state.openingCard?.id);
    assert.ok(lead);
    assert.deepEqual(await ackOf(leader.socket, "game:play", { cardIds: [lead.id], turn: state.turn }), { ok: true });

    const retry = { intentId: "pass-retry-1", turn: turnAt(1) };
    assert.deepEqual(await ackOf(waiting.socket, "game:pass", retry), { ok: true });
    assert.deepEqual(
      await ackOf(waiting.socket, "game:pass", retry),
      { ok: true },
      "the retry is the same intent, not a second pass out of turn"
    );
    const fresh = (await ackOf(waiting.socket, "game:pass", { intentId: "pass-retry-2", turn: turnAt(2) })) as IntentReply;
    assert.equal(fresh.code, "NOT_YOUR_TURN", "a new intent is judged on its own");
  });

  /** What a restart restores from: the persisted round, once it has caught up with `seq`. */
  async function persistedAt(roomId: string, seq: number) {
    for (let attempt = 0; attempt < 100; attempt++) {
      const row = await db().query.activeGames.findFirst({ where: eq(activeGamesTable.roomId, roomId) });
      if (row?.gameState.gameState.lastMove.seq === seq) return;
      await new Promise((resolve) => setTimeout(resolve, 20)); // fixed wait on purpose: the poll interval, bounded at 100 attempts
    }
    assert.fail(`active_games never reached seq ${seq}`);
  }

  async function stateOf(c: { socket: Socket }, roomId: string) {
    const restored = waitFor<SanitizedState>(c.socket, "game:state", 5_000);
    c.socket.emit("game:rejoin", { roomId });
    return restored;
  }

  test("a pass re-sent across a restart is not applied a second time", async () => {
    const { c: leader, s: state, waiting, roomId } = await dealtPair("restartpass");
    const hand = state.players[state.viewerSeatIndex]?.hand ?? [];
    const lead = hand.find((c) => c.id === state.openingCard?.id);
    const next = hand.find((c) => c.id !== lead?.id);
    assert.ok(lead && next);
    assert.deepEqual(await ackOf(leader.socket, "game:play", { cardIds: [lead.id], turn: state.turn }), { ok: true });
    const pass = { intentId: "restart-pass", turn: turnAt(1) };
    assert.deepEqual(await ackOf(waiting.socket, "game:pass", pass), { ok: true });
    assert.deepEqual(await ackOf(leader.socket, "game:play", { cardIds: [next.id], turn: turnAt(2) }), { ok: true });

    await persistedAt(roomId, 3);
    assert.equal(restartUnder(roomId), true);
    const before = await stateOf(waiting, roomId);
    assert.equal(before.lastMove.seq, 3, "the restored round is the one the restart left behind");
    assert.equal(before.currentTurnIndex, before.viewerSeatIndex, "and the turn is back with the seat that passed");

    assert.deepEqual(
      await ackOf(waiting.socket, "game:pass", pass),
      { ok: false, code: "NOT_YOUR_TURN" },
      "the retry was made against the second move's turn, and the table is past the fourth"
    );
    const after = await stateOf(waiting, roomId);
    assert.equal(after.lastMove.seq, 3, "nothing moved");
    assert.equal(after.currentTurnIndex, after.viewerSeatIndex, "the seat still holds the turn it never chose to pass");
  });

  test("a play made against an earlier turn is refused, though its cards are still held", async () => {
    const { c: leader, s: state, waiting, roomId } = await dealtPair("staleplay");
    const hand = state.players[state.viewerSeatIndex]?.hand ?? [];
    const lead = hand.find((c) => c.id === state.openingCard?.id);
    const next = hand.find((c) => c.id !== lead?.id);
    assert.ok(lead && next);
    assert.deepEqual(await ackOf(leader.socket, "game:play", { cardIds: [lead.id], turn: state.turn }), { ok: true });
    assert.deepEqual(await ackOf(waiting.socket, "game:pass", { turn: turnAt(1) }), { ok: true });

    assert.deepEqual(
      await ackOf(leader.socket, "game:play", { cardIds: [next.id], turn: state.turn }),
      { ok: false, code: "NOT_YOUR_TURN" },
      "the leader is on move, but not on the move this play was made against"
    );
    const held = await stateOf(leader, roomId);
    assert.equal(held.lastMove.seq, 2);
    assert.ok(held.players[held.viewerSeatIndex]?.hand.some((c) => c.id === next.id), "the card never left the hand");
    assert.deepEqual(await ackOf(leader.socket, "game:play", { cardIds: [next.id], turn: held.turn }), { ok: true });
  });

  test("two intents from one socket land in the order they were sent", async () => {
    const c = await player("order");
    const created = ackOf(c.socket, "room:create", { gameMode: "free_for_all", maxPlayers: 2 });
    const left = ackOf(c.socket, "room:leave", undefined);
    await Promise.all([created, left]);
    const reply = (await ackOf(c.socket, "room:setVisibility", { visibility: "public" })) as IntentReply;
    assert.equal(reply.code, "NOT_AT_A_TABLE", "the leave ran after the create, not before it");
  });

  test("an event this server has no handler for is answered, not dropped", async () => {
    const c = await player("unknown");
    assert.deepEqual(await ackOf(c.socket, "game:from_the_future", {}), { ok: false, code: "CLIENT_OUTDATED" });
  });

  test("a rejoin refused at the boundary is answered on the rejoin's own channel", async () => {
    const c = await player("badrejoin");
    const failed = waitFor<{ code: string }>(c.socket, "game:rejoin_failed");
    const reply = (await ackOf(c.socket, "game:rejoin", { roomId: 42 })) as IntentReply;
    assert.equal(reply.code, "INVALID_PAYLOAD");
    assert.equal((await failed).code, "INVALID_PAYLOAD");
  });

  test("a handshake the database could not check is refused apart from a spent ticket", async () => {
    const { socket, cookie } = await player("authdown");
    socket.close();
    const res = await fetch(`${server.url}/api/auth/socket-ticket`, { method: "POST", headers: { cookie } });
    const { ticket } = (await res.json()) as { ticket: string };
    const refusal = () =>
      new Promise<string>((resolve) => {
        const s = ioClient(server.url, { auth: { ...PROTOCOL_AUTH, ticket }, transports: ["websocket"], reconnection: false });
        s.once("connect", () => resolve("connected"));
        s.once("connect_error", (e) => resolve(e.message));
      });
    const getUser = userStore.getUser;
    userStore.getUser = async () => {
      throw new Error("database down");
    };
    try {
      assert.equal(await refusal(), AUTH_UNAVAILABLE);
    } finally {
      userStore.getUser = getUser;
    }
    assert.equal(await refusal(), "Not authenticated", "the ticket was spent by the first attempt");
  });

  test("the server answers a pass", async () => {
    const { host, state } = await table("pass");
    assert.notEqual(await ackOf(host.socket, "game:pass", { turn: state.turn }), null);
  });

  /**
   * A refusal is an answer, and it must say it refused. `ok: true` on an intent
   * the server threw away is worse than the silence it replaced: the client
   * stops retrying, shows nothing, and the player is told their move worked.
   */
  test("the server answers even when it refuses the intent", async () => {
    const { host, state } = await table("refuse");
    const reply = (await ackOf(host.socket, "game:play", {
      cardIds: ["definitely-not-a-card"],
      turn: state.turn,
    })) as IntentReply | null;
    assert.notEqual(reply, null, "a rejected intent is still acknowledged");
    assert.equal(reply?.ok, false, "and the answer says it was refused");
    assert.equal(typeof reply?.code, "string", "carrying why, so the client does not retry it");
  });

  /**
   * The sharpest case, because nothing else reports it. A socket that holds no
   * room — a play made on stale UI while a reconnect is still attaching the
   * socket to its table — falls through `if (!roomId) return`, which emits no
   * `game:error` at all. If that answers `ok: true`, the move is discarded with
   * the client believing it landed.
   */
  test("an intent the server silently drops is not answered ok", async () => {
    const c = await player("noroom");
    const reply = (await ackOf(c.socket, "game:play", { cardIds: ["x"], turn: turnAt(0) })) as IntentReply | null;
    assert.notEqual(reply, null, "it is still answered");
    assert.equal(reply?.ok, false, "a play that reached no table did not happen");
    assert.equal(reply?.code, "NOT_AT_A_TABLE");
  });

  /** The ack, and every `room:error` the socket hears while the intent is answered. */
  async function refusedInLobby(socket: Socket, event: string, body: unknown) {
    const told: unknown[] = [];
    const listen = (p: unknown) => told.push(p);
    socket.on("room:error", listen);
    const reply = (await ackOf(socket, event, body)) as IntentReply | null;
    await new Promise((r) => setTimeout(r, 200));
    socket.off("room:error", listen);
    return { reply, told };
  }

  async function lobby(tag: string) {
    const host = await player(`${tag}_host`);
    const made = waitFor<RoomState>(host.socket, "room:state");
    host.socket.emit("room:create", { gameMode: "free_for_all", maxPlayers: 2 });
    return { host, room: await made };
  }

  test("a join to a full room is acked as refused, and told once", async () => {
    const { host, room } = await lobby("full");
    const second = await player("full_second");
    const seated = waitFor<RoomState>(host.socket, "room:state");
    second.socket.emit("room:join", { code: room.code });
    await seated;

    const late = await player("full_late");
    const { reply, told } = await refusedInLobby(late.socket, "room:join", { code: room.code });
    assert.deepEqual(reply, { ok: false, code: "ROOM_FULL" });
    assert.deepEqual(told, [payload("ROOM_FULL")]);
  });

  test("a join to an unknown code is acked as refused, and told once", async () => {
    const c = await player("nocode");
    const { reply, told } = await refusedInLobby(c.socket, "room:join", { code: "ZZZZZZ" });
    assert.deepEqual(reply, { ok: false, code: "ROOM_NOT_FOUND" });
    assert.deepEqual(told, [payload("ROOM_NOT_FOUND")]);
  });

  test("a lobby rejoin from someone never seated is acked as refused, and told once", async () => {
    const { room } = await lobby("stranger");
    const stranger = await player("stranger_c");
    const { reply, told } = await refusedInLobby(stranger.socket, "room:rejoin", { code: room.code });
    assert.deepEqual(reply, { ok: false, code: "NOT_IN_ROOM" });
    assert.deepEqual(told, [payload("NOT_IN_ROOM")]);
  });

  test("a pass out of turn is refused rather than reported as done", async () => {
    const { waiting } = await dealtPair("outofturn");
    const reply = (await ackOf(waiting.socket, "game:pass", { turn: turnAt(0) })) as IntentReply | null;
    assert.equal(reply?.ok, false, "it is not this seat's turn");
    assert.equal(reply?.code, "NOT_YOUR_TURN");
  });
});
