// An instance picking up a table nobody holds: what it keeps, what it hands back, and what it tells the caller.
// The lock is Postgres' advisory lock; its answers are scripted here the way ownershipReclaim.test.ts does.
import { test, describe, beforeEach, afterEach, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { Client } from "pg";
import { applyOrForward, inFlight, TABLE_ACTION_EVENT } from "../../server/game/tableRouter.ts";
import { activeGames } from "../../server/game/gameRoom.ts";
import { clearAllTimersForUser, clearRoomTimers } from "../../server/game/gameTimers.ts";
import { claimRoom, closeOwnership, ownershipKey, ownsRoom, reopenOwnership } from "../../server/game/gameOwnership.ts";
import { friendStore } from "../../server/store/friendStore.ts";
import { packPersistedState } from "../../shared/persistedEnvelope.ts";
import type { TableActionDraft } from "../../server/game/tableActions.ts";
import type { GameState } from "../../lib/game/gameEngine.ts";
import { onlineTable } from "../helpers/onlineTable.ts";
import { recordingRuntime } from "../helpers/recordingRuntime.ts";
import { useMemoryTableStores } from "../helpers/memoryTableStores.ts";
import { aThreePlayed } from "../support/game.ts";

const ROOM = "table-takeover-room";
const keyOf = ownershipKey(ROOM);

/** The lock as Postgres answers it: `elsewhere` rooms are held by another instance; every ask is counted. */
function scriptLock(t: TestContext) {
  const lock = { elsewhere: new Set<string>(), asked: 0, unlocked: [] as string[] };
  t.mock.method(Client.prototype, "connect", async () => {});
  t.mock.method(Client.prototype, "end", async () => {});
  t.mock.method(Client.prototype, "query", async (sql: string, params?: string[]) => {
    if (/pg_try_advisory_lock/.test(sql)) {
      lock.asked++;
      return { rows: [{ locked: !lock.elsewhere.has(params![0]!) }] };
    }
    if (/pg_advisory_unlock/.test(sql)) lock.unlocked.push(params![0]!);
    return { rows: [] };
  });
  return lock;
}

beforeEach(() => reopenOwnership({ onRoomLost: () => {} }));

afterEach(async () => {
  for (const userId of ["ana", "besi"]) clearAllTimersForUser(userId, ROOM);
  clearRoomTimers(ROOM);
  activeGames.delete(ROOM);
  inFlight.clear();
  await closeOwnership();
});

const state = (): GameState => ({
  players: [
    { id: "player_0", name: "Ana", hand: [], type: "human" },
    { id: "player_1", name: "Besi", hand: [], type: "human" },
  ],
  currentTurnIndex: 0,
  lastPlayedCombination: null,
  lastPlayedBy: -1,
  passCount: 0,
  gameMode: "free_for_all",
  roundOver: false,
  finishingOrder: [],
  openingCard: null,
  playedRanks: aThreePlayed(),
  lastMove: { seq: 0, kind: "deal" },
});

const row = (over: Record<string, unknown> = {}) => ({
  ...packPersistedState(
    state(),
    {},
    0,
    "AAAAAA",
    {
      playerMap: { 0: "ana", 1: "besi" },
      scores: {},
      gameMode: "free_for_all",
      matchLength: "match",
      matchTarget: 21,
      maxPlayers: 2,
      roundsPlayed: 0,
      endedByVote: false,
      matchOver: false,
    },
    { vacatedSeats: [], releasedSeats: [], weakSeats: [], abandonedSeats: [] }
  ),
  ...over,
});

const resume = (userId = "ana"): TableActionDraft => ({ kind: "resume", roomId: ROOM, userId });
const turnDeadlines = (sent: ReturnType<typeof recordingRuntime>["sent"]) =>
  sent.filter((e) => e.event === "game:turn_deadline").length;

function useInstance(t: TestContext, rows: [string, unknown][] = [[ROOM, row()]]) {
  const stores = useMemoryTableStores(t, { rows });
  const harness = recordingRuntime();
  harness.cluster.online.add("ana");
  harness.cluster.online.add("besi");
  return { ...harness, ...stores };
}

describe("an action for a table no instance holds, from a player who sat at it", () => {
  test("is applied here, and the instance keeps the table and its claim", async (t) => {
    const lock = scriptLock(t);
    const { rt, sent } = useInstance(t);
    assert.deepEqual(await applyOrForward(rt, resume()), { ok: true });
    assert.equal(activeGames.get(ROOM)?.roomId, ROOM);
    assert.equal(ownsRoom(ROOM), true);
    assert.deepEqual(lock.unlocked, []);
    assert.equal(turnDeadlines(sent), 1);
  });

  test("two at once restore it once and are both answered", async (t) => {
    scriptLock(t);
    const { rt, sent } = useInstance(t);
    const [a, b] = await Promise.all([applyOrForward(rt, resume("ana")), applyOrForward(rt, resume("besi"))]);
    assert.deepEqual([a, b], [{ ok: true }, { ok: true }]);
    assert.equal(turnDeadlines(sent), 2);
  });

  test("finds nothing when no row is stored, and hands the claim back", async (t) => {
    const lock = scriptLock(t);
    const { rt } = useInstance(t, []);
    assert.deepEqual(await applyOrForward(rt, resume()), { ok: false, code: "NO_LIVE_GAME" });
    assert.equal(ownsRoom(ROOM), false);
    assert.deepEqual(lock.unlocked, [keyOf]);
    assert.equal(activeGames.has(ROOM), false);
  });

  test("is refused for an account that never sat there, and the claim goes back", async (t) => {
    const lock = scriptLock(t);
    const { rt } = useInstance(t);
    assert.deepEqual(await applyOrForward(rt, resume("stranger")), { ok: false, code: "UNAUTHORIZED" });
    assert.equal(ownsRoom(ROOM), false);
    assert.deepEqual(lock.unlocked, [keyOf]);
    assert.equal(activeGames.has(ROOM), false);
  });

  test("is told the game is no longer valid when its row is of an old shape, and the claim goes back", async (t) => {
    const lock = scriptLock(t);
    const { rt, rows } = useInstance(t, [[ROOM, row({ schemaVersion: 1 })]]);
    assert.deepEqual(await applyOrForward(rt, resume()), { ok: false, code: "GAME_NO_LONGER_VALID" });
    assert.equal(ownsRoom(ROOM), false);
    assert.deepEqual(lock.unlocked, [keyOf]);
    assert.equal(rows.has(ROOM), false);
  });

  test("is left to a newer revision, which keeps the row and is answered as unreachable", async (t) => {
    const lock = scriptLock(t);
    const { rt, rows } = useInstance(t, [[ROOM, row({ schemaVersion: 999 })]]);
    assert.deepEqual(await applyOrForward(rt, resume()), { ok: false, code: "TABLE_UNREACHABLE" });
    assert.equal(ownsRoom(ROOM), false);
    assert.deepEqual(lock.unlocked, [keyOf]);
    assert.equal(rows.has(ROOM), true);
  });
});

describe("a start at a room no instance holds", () => {
  const roomRow: [string, Record<string, unknown>] = [ROOM, { code: "AAAAAA", gameMode: "free_for_all", maxPlayers: 2, status: "waiting", hostUserId: "ana" }];
  const seats: [string, { userId: string; seatIndex: number; user: never }[]] = [
    ROOM,
    ["ana", "besi"].map((userId, seatIndex) => ({ userId, seatIndex, user: { id: userId, username: userId } as never })),
  ];
  const start: TableActionDraft = { kind: "startMatch", roomId: ROOM, userId: "ana", fillWithBots: false };

  test("claims the room and deals, keeping the claim", async (t) => {
    const lock = scriptLock(t);
    useMemoryTableStores(t, { rooms: [roomRow], seats: [seats] });
    t.mock.method(friendStore, "clearGameInvites", async () => [] as string[]);
    const { rt } = recordingRuntime();
    assert.deepEqual(await applyOrForward(rt, start), { ok: true });
    assert.equal(activeGames.has(ROOM), true);
    assert.equal(ownsRoom(ROOM), true);
    assert.deepEqual(lock.unlocked, []);
  });

  test("that is refused deals nothing and hands the claim back", async (t) => {
    const lock = scriptLock(t);
    useMemoryTableStores(t, { rooms: [roomRow], seats: [seats] });
    const { rt } = recordingRuntime();
    assert.deepEqual(await applyOrForward(rt, { ...start, userId: "besi" }), { ok: false, code: "NOT_THE_HOST" });
    assert.equal(activeGames.has(ROOM), false);
    assert.equal(ownsRoom(ROOM), false);
    assert.deepEqual(lock.unlocked, [keyOf]);
  });

  test("over a row a newer revision wrote is refused as unreachable, not dealt over", async (t) => {
    scriptLock(t);
    useMemoryTableStores(t, { rooms: [roomRow], seats: [seats], rows: [[ROOM, row({ schemaVersion: 999 })]] });
    t.mock.method(friendStore, "clearGameInvites", async () => [] as string[]);
    const { rt } = recordingRuntime();
    assert.deepEqual(await applyOrForward(rt, start), { ok: false, code: "TABLE_UNREACHABLE" });
  });
});

describe("a forwarded action nobody answers for", () => {
  const unanswered = (replies: unknown[], err: unknown) => ({
    serverSideEmit: (_e: string, _a: unknown, ack: (e: unknown, r: unknown[]) => void) => {
      ack(err, replies);
      return true;
    },
  });
  const reaction: TableActionDraft = { kind: "reaction", roomId: ROOM, userId: "ana", emoji: "👍" };

  test("with every instance answering that none holds it asks Postgres for nothing", async (t) => {
    const lock = scriptLock(t);
    const { rt } = recordingRuntime({ transport: unanswered([{ ok: false, code: "NOT_THIS_INSTANCE" }], null) });
    assert.deepEqual(await applyOrForward(rt, reaction), { ok: false, code: "NO_LIVE_GAME" });
    assert.equal(lock.asked, 0);
  });

  test("with an instance that did not answer takes the lock, and gives it straight back: nothing is revived", async (t) => {
    const lock = scriptLock(t);
    const { rt } = recordingRuntime({ transport: unanswered([], new Error("timeout")) });
    assert.deepEqual(await applyOrForward(rt, reaction), { ok: false, code: "NO_LIVE_GAME" });
    assert.equal(lock.asked, 1);
    assert.deepEqual(lock.unlocked, [keyOf]);
    assert.equal(ownsRoom(ROOM), false);
  });

  test("with the room held by an instance that cannot be reached is asked again three times, with growing pauses, then reported unreachable", async (t) => {
    const lock = scriptLock(t);
    lock.elsewhere.add(keyOf);
    let asks = 0;
    const { rt } = recordingRuntime({
      transport: {
        serverSideEmit: (_e: string, _a: unknown, ack: (e: unknown, r: unknown[]) => void) => {
          asks++;
          ack(new Error("timeout"), []);
          return true;
        },
      },
    });
    const pauses: unknown[] = [];
    const real = globalThis.setTimeout;
    t.mock.method(globalThis, "setTimeout", (fn: () => void, ms?: number, ...rest: unknown[]) => {
      if (ms === 120 || ms === 240 || ms === 360) {
        pauses.push(ms);
        fn();
        return 0 as unknown as NodeJS.Timeout;
      }
      return real(fn, ms, ...rest);
    });
    assert.deepEqual(await applyOrForward(rt, { ...reaction, kind: "resume" } as TableActionDraft), {
      ok: false,
      code: "TABLE_UNREACHABLE",
    });
    assert.equal(asks, 3);
    assert.deepEqual(pauses, [120, 240, 360]);
  });
});

describe("several actions for a room whose holder cannot be reached", () => {
  test("take turns asking: one question about the room is in flight at a time", async (t) => {
    const lock = scriptLock(t);
    lock.elsewhere.add(keyOf);
    let outstanding = 0;
    let widest = 0;
    const { rt } = recordingRuntime({
      transport: {
        serverSideEmit: (_e: string, _a: unknown, ack: (e: unknown, r: unknown[]) => void) => {
          widest = Math.max(widest, ++outstanding);
          setImmediate(() => {
            outstanding--;
            ack(new Error("timeout"), []);
          });
          return true;
        },
      },
    });
    const real = globalThis.setTimeout;
    t.mock.method(globalThis, "setTimeout", (fn: () => void, ms?: number, ...rest: unknown[]) =>
      ms === 120 || ms === 240 || ms === 360 ? (fn(), 0 as unknown as NodeJS.Timeout) : real(fn, ms, ...rest)
    );
    const results = await Promise.all(["ana", "besi", "ana"].map((userId) => applyOrForward(rt, resume(userId))));
    assert.equal(widest, 1, "two actions asked about the room at once");
    for (const result of results) assert.deepEqual(result, { ok: false, code: "TABLE_UNREACHABLE" });
  });
});

describe("the listener for actions other instances forward, at a room this instance is taking over", () => {
  function listener() {
    let receive!: (action: unknown, reply: (r: unknown) => void) => void;
    const { rt, sent } = recordingRuntime({
      transport: {
        on: (event: string, fn: typeof receive) => {
          if (event === TABLE_ACTION_EVENT) receive = fn;
        },
      },
    });
    const ask = (action: unknown) => new Promise((resolve) => receive(action, resolve));
    return { rt, sent, ask };
  }
  const wire = { id: "w1", kind: "reaction", roomId: ROOM, userId: "ana", emoji: "👍" };

  test("answers once the takeover has put the table in memory", async (t) => {
    scriptLock(t);
    const { ask, sent } = listener();
    assert.equal(await claimRoom(ROOM), true);
    inFlight.set(
      ROOM,
      Promise.resolve().then(() => {
        activeGames.set(
          ROOM,
          onlineTable({ roomId: ROOM, playerMap: { 0: "ana" }, gameState: { players: [{ name: "Ana" }] } as never })
        );
      })
    );
    assert.deepEqual(await ask(wire), { ok: true });
    assert.equal(sent.filter((e) => e.event === "game:reaction").length, 1);
  });

  test("answers that it does not hold the room when the takeover came to nothing", async (t) => {
    scriptLock(t);
    const { ask } = listener();
    assert.equal(await claimRoom(ROOM), true);
    inFlight.set(ROOM, Promise.reject(new Error("restore failed")));
    assert.deepEqual(await ask(wire), { ok: false, code: "NOT_THIS_INSTANCE" });
  });

  test("answers that it does not hold a room it claimed and is not loading", async (t) => {
    scriptLock(t);
    const { ask } = listener();
    assert.equal(await claimRoom(ROOM), true);
    assert.deepEqual(await ask(wire), { ok: false, code: "NOT_THIS_INSTANCE" });
  });

  test("answers that it does not hold a room it has not claimed", async (t) => {
    scriptLock(t);
    const { ask } = listener();
    inFlight.set(ROOM, new Promise(() => {}));
    assert.deepEqual(await ask(wire), { ok: false, code: "NOT_THIS_INSTANCE" });
  });
});

