// Who a message reaches, and by which path: a recipient on this instance directly, every other
// one in one inbox message per instance, a state at most one outstanding and one queued.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { register } from "prom-client";
import { stubTransport } from "../helpers/recordingRuntime.ts";
import { onlineTable } from "../helpers/onlineTable.ts";
import { deliveryOutbox } from "../../server/socket/delivery.ts";
import { APP_QUERY_BOUND_MS } from "../../server/store/pool.ts";
import { activeGames, userRoom } from "../../server/game/gameRoom.ts";
import type { InstanceHandler, InstanceMessage } from "../../server/store/instanceInbox.ts";
import type { OrderedGameState } from "../../shared/protocol.ts";

const ROOM = "delivery-room";

afterEach(() => activeGames.delete(ROOM));

type Ack = (err: unknown) => void;

/** Instances on one in-memory bus; presence is `where`, each inbox message is JSON as Redis carries it. */
function cluster() {
  const where = new Map<string, string>();
  const handlers = new Map<string, Map<string, InstanceHandler>>();
  const inboxed: { to: string; message: InstanceMessage }[] = [];
  const located: string[][] = [];

  function instance(name: string, seatsOf: (roomId: string) => Promise<string[]> = async () => []) {
    const rooms = new Map<string, Set<string>>();
    const sockets = new Map<string, unknown>();
    const emitted: { userId: string; event: string; args: unknown[] }[] = [];
    /** Every send to a socket here, `game:state` included, in the order it left. */
    const sent: string[] = [];
    const states = new Map<string, { state: OrderedGameState; ack: Ack }[]>();
    const join = (room: string, id: string) => rooms.set(room, new Set([...(rooms.get(room) ?? []), id]));
    const io = stubTransport({
      sockets: { adapter: { rooms }, sockets },
      local: {
        to: (targets: string[]) => ({
          emit: (event: string, ...args: unknown[]) => {
            for (const target of targets) {
              for (const id of rooms.get(target) ?? []) {
                emitted.push({ userId: (sockets.get(id) as { data: { userId: string } }).data.userId, event, args });
                sent.push(event);
              }
            }
          },
        }),
      },
    });
    handlers.set(name, new Map());
    const out = deliveryOutbox(io, {
      self: name,
      locate: async (userIds) => {
        located.push([...userIds]);
        return new Map(userIds.flatMap((u) => (where.has(u) ? [[u, where.get(u)!] as const] : [])));
      },
      send: async (to, message) => {
        inboxed.push({ to, message });
        const copy = JSON.parse(JSON.stringify(message)) as InstanceMessage;
        queueMicrotask(() => void handlers.get(to)?.get(copy.kind)?.(copy));
      },
      on: (kind, handler) => handlers.get(name)!.set(kind, handler),
      seatsOf,
    });
    return {
      out,
      emitted,
      sent,
      connect(userId: string, id = `${name}:${userId}`) {
        sockets.set(id, {
          id,
          connected: true,
          data: { userId },
          timeout: () => ({
            emit: (_event: string, state: OrderedGameState, ack: Ack) => {
              sent.push("game:state");
              states.set(userId, [...(states.get(userId) ?? []), { state, ack }]);
            },
          }),
        });
        join(userRoom(userId), id);
        where.set(userId, name);
        return id;
      },
      joinRoom: (room: string, userId: string) => join(room, `${name}:${userId}`),
      /** The socket leaves this instance, as a closed connection does. */
      drop(id: string) {
        (sockets.get(id) as { connected: boolean }).connected = false;
        sockets.delete(id);
        for (const members of rooms.values()) members.delete(id);
      },
      /** What `userId`'s socket here was sent, in order, with each one's ack. */
      states: (userId: string) => states.get(userId) ?? [],
    };
  }
  return { instance, inboxed, located, where };
}

const ticks = () => new Promise((resolve) => setImmediate(resolve));

function stateOf(seq: number, label = "", epoch = 1): OrderedGameState {
  return { roomId: ROOM, epoch, seq, label } as unknown as OrderedGameState;
}

const missed = async () => ((await register.getSingleMetric("state_acks_missed_total")?.get())?.values[0]?.value ?? 0);

test("50 states to one slow socket leave one outstanding and one queued, and the last wins", async () => {
  const { instance } = cluster();
  const a = instance("a");
  a.connect("ana");
  for (let seq = 1; seq <= 50; seq++) a.out.state("ana", () => stateOf(seq));

  assert.deepEqual(a.states("ana").map((s) => s.state.seq), [1], "more than one state went out before the first was answered");
  a.states("ana")[0].ack(null);
  assert.deepEqual(a.states("ana").map((s) => s.state.seq), [1, 50], "the queued state was not the newest");
  a.states("ana")[1].ack(null);
  await ticks();
  assert.equal(a.states("ana").length, 2, "a state was sent after the queue emptied");
});

test("an old owner's late state never displaces a new owner's in the queue", async () => {
  const { instance } = cluster();
  const a = instance("a");
  a.connect("ana");
  a.out.state("ana", () => stateOf(40, "", 1));
  a.out.state("ana", () => stateOf(1, "", 2));
  a.out.state("ana", () => stateOf(41, "", 1));
  a.states("ana")[0].ack(null);
  assert.deepEqual(a.states("ana").map((s) => [s.state.epoch, s.state.seq]), [[1, 40], [2, 1]]);
});

test("a reconnected socket is sent the table at once, not after the old socket's unanswered state", async () => {
  const { instance } = cluster();
  const a = instance("a");
  const old = a.connect("ana", "old");
  a.out.state("ana", () => stateOf(1));
  a.drop(old);
  a.connect("ana", "new");
  a.out.state("ana", () => stateOf(2));
  assert.deepEqual(a.states("ana").map((s) => s.state.seq), [1, 2]);
});

test("a local state that goes unacknowledged is re-derived once, and counted", async () => {
  const { instance } = cluster();
  const a = instance("a");
  a.connect("ana");
  const renders: boolean[] = [];
  const before = await missed();
  a.out.state("ana", (retrying) => {
    renders.push(retrying);
    return stateOf(renders.length);
  });
  a.states("ana")[0].ack(new Error("operation has timed out"));
  a.states("ana")[1].ack(new Error("operation has timed out"));

  assert.deepEqual(renders, [false, true]);
  assert.equal(a.states("ana").length, 2, "the retry was retried");
  assert.equal((await missed()) - before, 2);
});

test("one publish reaching both instances puts one message in the other's inbox and none in this one's", async () => {
  const { instance, inboxed } = cluster();
  const a = instance("a");
  const b = instance("b");
  a.connect("ana");
  a.connect("cara");
  b.connect("besi");
  b.connect("dani");
  activeGames.set(ROOM, onlineTable({ roomId: ROOM, playerMap: { 0: "ana", 1: "besi", 2: "cara", 3: "dani" } }));

  a.out.room(ROOM).emit("game:reaction", { emoji: "x", fromSeat: 0, username: "Ana" });
  for (const user of ["ana", "besi", "cara", "dani"]) a.out.state(user, () => stateOf(1, user));
  await ticks();

  assert.deepEqual(inboxed.map((m) => m.to), ["b"], "the other instance did not get exactly one message");
  assert.deepEqual(
    a.emitted.map((e) => e.userId).sort(),
    ["ana", "cara"],
    "a recipient here was not reached directly"
  );
  assert.deepEqual(b.emitted.map((e) => e.userId).sort(), ["besi", "dani"]);
  assert.deepEqual(b.states("besi").map((s) => (s.state as unknown as { label: string }).label), ["besi"], "a payload went to the wrong recipient");
  assert.deepEqual(b.states("dani").map((s) => (s.state as unknown as { label: string }).label), ["dani"]);
});

test("an account with no presence entry costs no message at all", async () => {
  const { instance, inboxed } = cluster();
  const a = instance("a");
  a.out.user("offline").emit("friend:status", { userId: "ana", online: true });
  await ticks();
  assert.deepEqual(inboxed, []);
});

test("nobody on this instance means no presence read either", async () => {
  const { instance, located } = cluster();
  const a = instance("a");
  a.connect("ana");
  activeGames.set(ROOM, onlineTable({ roomId: ROOM, playerMap: { 0: "ana" } }));
  a.out.room(ROOM).emit("game:reaction", { emoji: "x", fromSeat: 0, username: "Ana" });
  a.out.state("ana", () => stateOf(1));
  await ticks();
  assert.deepEqual(located, []);
});

test("a state the other instance could not get acknowledged is re-derived by the owner, not re-sent", async () => {
  const { instance, inboxed } = cluster();
  const owner = instance("owner");
  const holder = instance("holder");
  holder.connect("besi");
  let live = "dealt";
  owner.out.state("besi", (retrying) => stateOf(retrying ? 2 : 1, retrying ? live : "dealt"));
  await ticks();
  live = "played";
  holder.states("besi")[0].ack(new Error("operation has timed out"));
  await ticks();
  await ticks();

  assert.deepEqual(
    holder.states("besi").map((s) => (s.state as unknown as { label: string }).label),
    ["dealt", "played"],
    "the owner did not answer the nack with the live table"
  );
  assert.deepEqual(inboxed.map((m) => [m.to, m.message.kind]), [["holder", "deliver"], ["owner", "state-nack"], ["holder", "deliver"]]);

  holder.states("besi")[1].ack(new Error("operation has timed out"));
  await ticks();
  await ticks();
  assert.equal(inboxed.length, 3, "a missed retry was nacked again");
});

test("a lobby's emits read its seats and leave in the order they were made", async () => {
  let release: (ids: string[]) => void = () => {};
  const slow = new Promise<string[]>((resolve) => (release = resolve));
  const reads = [slow, Promise.resolve(["ana"])];
  const { instance } = cluster();
  const a = instance("a", () => reads.shift()!);
  a.connect("ana");

  a.out.room(ROOM).emit("room:state", { first: true } as never);
  a.out.room(ROOM).emit("room:state", { first: false } as never);
  await ticks();
  assert.equal(a.emitted.length, 0, "a later emit overtook one still reading its seats");
  release(["ana"]);
  await ticks();
  assert.deepEqual(a.emitted.map((e) => (e.args[0] as { first: boolean }).first), [true, false]);
});

test("a table's first state waits behind the room emits still reading their seats", async () => {
  let release: (ids: string[]) => void = () => {};
  const slow = new Promise<string[]>((resolve) => (release = resolve));
  const { instance } = cluster();
  const a = instance("a", () => slow);
  a.connect("ana");

  a.out.room(ROOM).emit("room:state", { status: "waiting" } as never);
  activeGames.set(ROOM, onlineTable({ roomId: ROOM, playerMap: { 0: "ana" } }));
  a.out.room(ROOM).emit("room:state", { status: "in_progress" } as never);
  a.out.state("ana", () => stateOf(1));
  await ticks();
  assert.deepEqual(a.sent, [], "the deal overtook the room's own emits");
  release(["ana"]);
  await ticks();
  assert.deepEqual(a.sent, ["room:state", "room:state", "game:state"]);
});

test("a stalled seats read holds the deal's state back only until the app pool would have given up", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { instance } = cluster();
  const a = instance("a", () => new Promise<string[]>(() => {}));
  a.connect("ana");
  a.joinRoom(ROOM, "ana");

  a.out.room(ROOM).emit("room:state", { status: "waiting" } as never);
  activeGames.set(ROOM, onlineTable({ roomId: ROOM, playerMap: { 0: "ana" } }));
  a.out.state("ana", () => stateOf(1));
  t.mock.timers.tick(APP_QUERY_BOUND_MS - 1);
  await ticks();
  assert.deepEqual(a.sent, [], "the deal left before the seats read was given up on");
  t.mock.timers.tick(1);
  await ticks();
  assert.deepEqual(a.sent, ["room:state", "game:state"], "a stalled seats read held the table's state back for good");
});

test("a member of the room on this instance is reached even when the seats cannot be read", async () => {
  const { instance } = cluster();
  const a = instance("a", () => Promise.reject(new Error("pool exhausted")));
  a.connect("ana");
  a.joinRoom(ROOM, "ana");
  a.out.room(ROOM).emit("room:state", {} as never);
  await ticks();
  assert.deepEqual(a.emitted.map((e) => e.userId), ["ana"]);
});
