// How an action finds its table: answered from memory, forwarded to the instance holding it, and applied once.
import { test, describe, beforeEach, afterEach, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { Client } from "pg";
import { applyOrForward, forgetAppliedIntents } from "../../server/game/tableRouter.ts";
import { closeOwnership, ownershipKey, ownsRoom, reopenOwnership, type LockHolder } from "../../server/game/gameOwnership.ts";
import { activeGameStore } from "../../server/store/activeGameStore.ts";
import { activeGames } from "../../server/game/gameRoom.ts";
import { installClock } from "../../server/http/clock.ts";
import type { TableActionDraft } from "../../server/game/tableActions.ts";
import { fakeClock } from "../helpers/fakeClock.ts";
import { onlineTable } from "../helpers/onlineTable.ts";
import { forwardedTo, legacyOwner, ownedElsewhere, recordingRuntime } from "../helpers/recordingRuntime.ts";
import type { OnlineGameState } from "../../server/game/gameRoom.ts";

const ROOM = "table-router-room";

beforeEach(() => reopenOwnership({ onRoomLost: () => {}, rows: activeGameStore }));

afterEach(async () => {
  activeGames.delete(ROOM);
  forgetAppliedIntents();
  await closeOwnership();
});

/** Postgres as the ownership connection reads it: who holds the room's lock, and every lock taken. */
function scriptLock(t: TestContext, holder: Exclude<LockHolder, "unreachable"> | "refused" = "free") {
  const lock = { probed: 0, taken: 0, unlocked: 0 };
  t.mock.method(Client.prototype, "connect", async () => {});
  t.mock.method(Client.prototype, "end", async () => {});
  t.mock.method(Client.prototype, "query", async (sql: string, params?: string[]) => {
    if (/pg_locks/.test(sql)) {
      lock.probed++;
      if (holder === "refused") throw new Error("connection refused");
      const [high, low] = params!.map(BigInt);
      assert.equal((high! << 32n) | low!, BigInt.asUintN(64, BigInt(ownershipKey(ROOM))), "the probe read another key");
      return { rows: holder === "free" ? [] : [{ current: holder === "mine", pid: 7, started: "1" }] };
    }
    if (/pg_try_advisory_lock/.test(sql)) {
      lock.taken++;
      return { rows: [{ locked: holder !== "elsewhere" }] };
    }
    if (/pg_advisory_unlock/.test(sql)) lock.unlocked++;
    return { rows: [] };
  });
  return lock;
}

const reaction = (userId: string, intentId?: string): TableActionDraft =>
  ({ kind: "reaction", roomId: ROOM, userId, emoji: "👍", intentId }) as TableActionDraft;

function hold(over: Partial<OnlineGameState> = {}) {
  const game = onlineTable({
    roomId: ROOM,
    playerMap: { 0: "ana", 1: "besi" },
    gameState: { players: [{ name: "Ana" }, { name: "Besi" }] } as never,
    ...over,
  });
  activeGames.set(ROOM, game);
  return game;
}

/** Runs `start` with `setTimeout` frozen, 10 ms of it at a time, and answers how much passed before it settled. */
async function onFrozenClock<T>(t: TestContext, start: () => Promise<T>): Promise<{ value: T; ms: number }> {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let settled: { value: T } | null = null;
  const running = start().then((value) => {
    settled = { value };
  });
  let ms = 0;
  for (;;) {
    for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve));
    if (settled) break;
    assert.ok(ms < 10_000, "never settled");
    t.mock.timers.tick(10);
    ms += 10;
  }
  await running;
  t.mock.timers.reset();
  return { value: (settled as unknown as { value: T }).value, ms };
}

const reactions = (sent: ReturnType<typeof recordingRuntime>["sent"]) =>
  sent.filter((e) => e.event === "game:reaction").length;

describe("a client's retry of an action", () => {
  test("is applied once, as long as it carries the same intent from the same player", async () => {
    const { rt, sent } = recordingRuntime();
    hold();
    assert.deepEqual(await applyOrForward(rt, reaction("ana", "i1")), { ok: true });
    assert.deepEqual(await applyOrForward(rt, reaction("ana", "i1")), { ok: true });
    assert.equal(reactions(sent), 1);
  });

  test("is not mistaken for another player's action that carries the same intent", async () => {
    const { rt, sent } = recordingRuntime();
    hold();
    await applyOrForward(rt, reaction("ana", "i1"));
    await applyOrForward(rt, reaction("besi", "i1"));
    assert.equal(reactions(sent), 2);
  });

  test("an action with no intent is always new", async () => {
    const { rt, sent } = recordingRuntime();
    hold();
    await applyOrForward(rt, reaction("ana"));
    await applyOrForward(rt, reaction("ana"));
    assert.equal(reactions(sent), 2);
  });

  test("applied 100 s earlier is answered from the record", async (t) => {
    const clock = fakeClock();
    t.after(installClock(clock));
    const { rt, sent } = recordingRuntime();
    hold();
    await applyOrForward(rt, reaction("ana", "i1"));
    clock.advance(100_000);
    await applyOrForward(rt, reaction("ana", "i1"));
    assert.equal(reactions(sent), 1);
  });

  test("is answered from the record for two minutes, then applied again", async (t) => {
    const clock = fakeClock();
    t.after(installClock(clock));
    const { rt, sent } = recordingRuntime();
    hold();
    await applyOrForward(rt, reaction("ana", "i1"));
    clock.advance(120_000);
    await applyOrForward(rt, reaction("ana", "i1"));
    assert.equal(reactions(sent), 1, "forgotten at exactly two minutes");
    clock.advance(1);
    await applyOrForward(rt, reaction("ana", "i1"));
    assert.equal(reactions(sent), 2, "still remembered past two minutes");
  });

  test("is still answered from the record at exactly two minutes, though another action lands then", async (t) => {
    const clock = fakeClock();
    t.after(installClock(clock));
    const { rt, sent } = recordingRuntime();
    hold();
    await applyOrForward(rt, reaction("ana", "i1"));
    clock.advance(120_000);
    await applyOrForward(rt, reaction("besi", "i2"));
    await applyOrForward(rt, reaction("ana", "i1"));
    assert.equal(reactions(sent), 2);
  });

  test("applied again after two minutes is remembered afresh, not evicted as the oldest", async (t) => {
    const clock = fakeClock();
    t.after(installClock(clock));
    const { rt, sent } = recordingRuntime();
    hold();
    await applyOrForward(rt, reaction("ana", "i1"));
    await applyOrForward(rt, reaction("besi", "i1"));
    clock.advance(120_001);
    await applyOrForward(rt, reaction("ana", "i1"));
    for (let i = 0; i < 49_999; i++) await applyOrForward(rt, reaction("besi", `fill-${i}`));
    const before = reactions(sent);
    await applyOrForward(rt, reaction("ana", "i1"));
    assert.equal(reactions(sent), before);
  });

  test("whose first attempt failed is applied afresh, not answered with the failure", async () => {
    const { rt, sent } = recordingRuntime();
    const game = hold({ gameState: undefined as never });
    await assert.rejects(applyOrForward(rt, reaction("ana", "i1")));
    game.gameState = { players: [{ name: "Ana" }] } as never;
    assert.deepEqual(await applyOrForward(rt, reaction("ana", "i1")), { ok: true });
    assert.equal(reactions(sent), 1);
  });

  test("40,000 distinct intents inside the window forget none of them", async () => {
    const { rt, sent } = recordingRuntime();
    hold();
    for (let i = 0; i < 40_000; i++) await applyOrForward(rt, reaction("ana", `n${i}`));
    await applyOrForward(rt, reaction("ana", "n0"));
    assert.equal(reactions(sent), 40_000, "the oldest intent was forgotten inside its window");
  });

  test("the record is bounded: past 50,000 the oldest intent is the first forgotten", async () => {
    const { rt, sent } = recordingRuntime();
    hold();
    for (let i = 0; i <= 50_000; i++) await applyOrForward(rt, reaction("ana", `n${i}`));
    assert.equal(reactions(sent), 50_001);
    await applyOrForward(rt, reaction("ana", "n1"));
    assert.equal(reactions(sent), 50_001, "a recent intent was forgotten");
    await applyOrForward(rt, reaction("ana", "n0"));
    assert.equal(reactions(sent), 50_002, "the record grew past its bound");
  });
});

describe("an action for a table this instance holds", () => {
  test("is applied here without asking anyone", async () => {
    const { peers, asks } = ownedElsewhere(() => ({ ok: true }));
    let looked = 0;
    const { rt, sent } = recordingRuntime({ peers: { ...peers, ownerOf: async () => (looked++, "owner-instance") } });
    hold();
    await applyOrForward(rt, reaction("ana"));
    assert.equal(looked, 0);
    assert.deepEqual(asks, []);
    assert.equal(reactions(sent), 1);
  });
});

describe("an action for a table another instance owns", () => {
  test("goes to the instance its owner record names alone, as the player gave it, stamped with an id", async (t) => {
    const lock = scriptLock(t);
    const { peers, asks, sent } = ownedElsewhere(() => ({ ok: false, code: "NOT_SEATED" }));
    const { rt } = recordingRuntime({ peers });
    assert.deepEqual(await applyOrForward(rt, reaction("ana", "i9")), { ok: false, code: "NOT_SEATED" });
    assert.deepEqual(asks, [
      { to: "owner-instance", action: { kind: "reaction", roomId: ROOM, userId: "ana", emoji: "👍", id: "ana:i9" } },
    ]);
    assert.deepEqual(sent, []);
    assert.equal(lock.probed, 0, "an answered forward read the lock");
  });

  test("carries the asker's address and an ask id, and resolves on the answer to that ask alone", async (t) => {
    scriptLock(t);
    const seen: Record<string, unknown>[] = [];
    const { peers } = ownedElsewhere(() => ({ ok: true }));
    const { rt } = recordingRuntime({
      peers: {
        ...peers,
        self: "asker-instance",
        send: async (to, message) => {
          seen.push(message);
          if (seen.length === 1) await peers.send!(to, { ...message, ask: "someone-else" });
          await peers.send!(to, message);
        },
      },
    });
    assert.deepEqual(await applyOrForward(rt, reaction("ana")), { ok: true });
    assert.equal(seen[0]!.from, "asker-instance");
    assert.equal(typeof seen[0]!.ask, "string");
  });

  test("an owner that answers with nothing is an owner that does not know the kind", async (t) => {
    scriptLock(t);
    const { peers } = ownedElsewhere(() => undefined);
    const { rt } = recordingRuntime({ peers });
    assert.deepEqual(await applyOrForward(rt, reaction("ana")), { ok: false, code: "UNKNOWN_ACTION" });
  });

  test("whose owner's inbox is gone is answered unreachable at once, without a second try", async (t) => {
    const lock = scriptLock(t, "elsewhere");
    let sends = 0;
    const { rt } = recordingRuntime({
      peers: {
        ownerOf: async () => "owner-instance",
        speaksInbox: () => true,
        send: async () => {
          sends++;
          throw new Error("that instance is gone");
        },
      },
    });
    const { value, ms } = await onFrozenClock(t, () => applyOrForward(rt, { ...reaction("ana"), kind: "rejoin" } as TableActionDraft));
    assert.deepEqual(value, { ok: false, code: "TABLE_UNREACHABLE" });
    assert.equal(ms, 0, "the router waited on an ask it never handed over");
    assert.equal(sends, 1);
    assert.equal(lock.taken, 0);
  });

  test("whose owner record names an instance no longer heard does not wait on its inbox", async (t) => {
    const lock = scriptLock(t, "free");
    const sent: unknown[] = [];
    const { rt } = recordingRuntime({
      peers: { ownerOf: async () => "gone-instance", send: async (to) => void sent.push(to) },
    });
    const { value, ms } = await onFrozenClock(t, () => applyOrForward(rt, { kind: "seatLost", roomId: ROOM, userId: "ana" } as TableActionDraft));
    assert.deepEqual(value, { ok: false, code: "NO_LIVE_GAME" });
    assert.equal(ms, 0);
    assert.deepEqual(sent, []);
    assert.equal(lock.taken, 0);
  });

  test("whose owner is live but silent through every try is unreachable although its lock reads free", async (t) => {
    const lock = scriptLock(t, "free");
    const { peers } = ownedElsewhere(() => "silent");
    const { rt } = recordingRuntime({ peers });
    const { value } = await onFrozenClock(t, () => applyOrForward(rt, { kind: "seatLost", roomId: ROOM, userId: "ana" } as TableActionDraft));
    assert.deepEqual(value, { ok: false, code: "TABLE_UNREACHABLE" });
    assert.equal(lock.taken, 0);
  });

  test("whose owner is live but slow is waited on although its lock reads free, as in a reclaim", async (t) => {
    const lock = scriptLock(t, "free");
    const { peers } = ownedElsewhere(() => ({ ok: true }), "owner-instance", 600);
    const { rt } = recordingRuntime({ peers });
    assert.deepEqual(await applyOrForward(rt, { kind: "seatLost", roomId: ROOM, userId: "ana" } as TableActionDraft), { ok: true });
    assert.equal(lock.taken, 0);
  });

  test("whose owner is silent is tried twice, 120 ms apart, then answered unreachable inside 3.5 s", async (t) => {
    scriptLock(t, "elsewhere");
    const { peers, asks } = ownedElsewhere(() => "silent");
    const { rt } = recordingRuntime({ peers });
    const { value, ms } = await onFrozenClock(t, () => applyOrForward(rt, { ...reaction("ana"), kind: "rejoin" } as TableActionDraft));
    assert.deepEqual(value, { ok: false, code: "TABLE_UNREACHABLE" });
    assert.equal(asks.length, 2);
    assert.equal(ms, 1_500 + 120 + 1_500, "not two tries of 1.5 s, 120 ms apart");
    assert.ok(ms < 3_500);
  });
});

describe("an action for a table an instance on an older revision owns", () => {
  test("is asked over the legacy emit, and nothing is left in that instance's inbox", async (t) => {
    const lock = scriptLock(t, "elsewhere");
    const { peers, emitted, sent } = legacyOwner(() => ({ ok: false, code: "NOT_SEATED" }));
    const { rt } = recordingRuntime({ peers });
    assert.deepEqual(await applyOrForward(rt, reaction("ana", "i3")), { ok: false, code: "NOT_SEATED" });
    assert.deepEqual(emitted, [
      { event: "murlan:table", payload: { kind: "reaction", roomId: ROOM, userId: "ana", emoji: "👍", id: "ana:i3" } },
    ]);
    assert.deepEqual(sent, []);
    assert.equal(lock.probed, 0);
  });

  test("with no owner record but its lock held is asked over the legacy emit", async (t) => {
    scriptLock(t, "elsewhere");
    const { peers } = legacyOwner(() => ({ ok: true }));
    const { rt } = recordingRuntime({ peers: { ...peers, ownerOf: async () => null } });
    assert.deepEqual(await applyOrForward(rt, reaction("ana")), { ok: true });
  });

  test("that does not answer the legacy emit inside a try is answered unreachable", async (t) => {
    scriptLock(t, "elsewhere");
    const { peers } = legacyOwner(() => "silent");
    const { rt } = recordingRuntime({ peers });
    const { value, ms } = await onFrozenClock(t, () => applyOrForward(rt, { ...reaction("ana"), kind: "rejoin" } as TableActionDraft));
    assert.deepEqual(value, { ok: false, code: "TABLE_UNREACHABLE" });
    assert.ok(ms < 3_500);
  });

  test("forwarding to this instance over the legacy emit is answered here as the owner", async () => {
    const { askLegacy, sent } = forwardedTo();
    const wire = { id: "w9", kind: "reaction", roomId: ROOM, userId: "ana", emoji: "👍" };
    assert.deepEqual(await askLegacy("murlan:table", wire), { ok: false, code: "NOT_THIS_INSTANCE" });
    hold();
    assert.deepEqual(await askLegacy("murlan:table", wire), { ok: true });
    assert.equal(reactions(sent), 1);
  });
});

describe("an action whose owner did not answer for it reads the room's lock", () => {
  const unanswered = {
    "no owner record": { ownerOf: async () => null },
    "an owner record Redis could not read": {
      ownerOf: async () => {
        throw new Error("Redis is down");
      },
    },
    "an owner that disowns it": ownedElsewhere(() => ({ ok: false, code: "NOT_THIS_INSTANCE" })).peers,
  };
  const forwards = ["seatLost", "vacate"] as const;

  for (const [why, peers] of Object.entries(unanswered)) {
    test(`with ${why} and the lock held by a peer: unreachable, not no game`, async (t) => {
      const lock = scriptLock(t, "elsewhere");
      const { rt } = recordingRuntime({ peers });
      for (const kind of forwards) {
        assert.deepEqual(await applyOrForward(rt, { kind, roomId: ROOM, userId: "ana" } as TableActionDraft), {
          ok: false,
          code: "TABLE_UNREACHABLE",
        });
      }
      assert.ok(lock.probed > 0);
    });
  }

  for (const kind of forwards) {
    test(`with no owner record and the lock free: ${kind} finds no game, and takes no lock`, async (t) => {
      const lock = scriptLock(t, "free");
      const { rt } = recordingRuntime();
      assert.deepEqual(await applyOrForward(rt, { kind, roomId: ROOM, userId: "ana" } as TableActionDraft), {
        ok: false,
        code: "NO_LIVE_GAME",
      });
      assert.equal(lock.probed, 1);
      assert.equal(lock.taken, 0);
    });
  }

  test("with the lock held by this process: served here, and the lock handed back when there is no game", async (t) => {
    const lock = scriptLock(t, "mine");
    const { rt } = recordingRuntime();
    assert.deepEqual(await applyOrForward(rt, { kind: "vacate", roomId: ROOM, userId: "ana" } as TableActionDraft), {
      ok: false,
      code: "NO_LIVE_GAME",
    });
    assert.equal(lock.taken, 1);
    assert.equal(lock.unlocked, 1);
    assert.equal(ownsRoom(ROOM), false);
  });

  test("that cannot be read: unreachable, not no game", async (t) => {
    scriptLock(t, "refused");
    const { rt } = recordingRuntime();
    assert.deepEqual(await applyOrForward(rt, { kind: "seatLost", roomId: ROOM, userId: "ana" } as TableActionDraft), {
      ok: false,
      code: "TABLE_UNREACHABLE",
    });
  });
});

describe("the listener for actions other instances forward", () => {
  const wire = { id: "w1", kind: "reaction", roomId: ROOM, userId: "ana", emoji: "👍" };

  test("answers with the table's own outcome for a room it holds, to the asker's inbox", async () => {
    const { ask, sent } = forwardedTo();
    hold();
    assert.deepEqual(await ask(wire), { ok: true });
    assert.equal(reactions(sent), 1);
    assert.deepEqual(await ask({ ...wire, id: "w2", userId: "stranger" }), { ok: false, code: "NOT_SEATED" });
  });

  test("answers a server error when applying throws, so the asker is not left waiting", async () => {
    const { ask } = forwardedTo();
    hold({ gameState: undefined as never });
    assert.deepEqual(await ask(wire), { ok: false, code: "SERVER_ERROR" });
  });

  test("hands the inbox back before the action settles", async () => {
    const { handlers } = forwardedTo();
    hold();
    const handled = handlers.get("table-ask")?.({ kind: "table-ask", from: "asker-instance", ask: "a1", action: wire });
    assert.equal(handled, undefined, "the handler holds the inbox until the action is applied");
  });
});
