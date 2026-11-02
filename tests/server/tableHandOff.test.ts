// A process on its way out handing its tables to a live peer: where each room's intents go after.
// The lock is Postgres' advisory lock, scripted here as tableRouterTakeover.test.ts does.
import { test, describe, beforeEach, afterEach, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { Client } from "pg";
import { applyOrForward, inFlight, TABLE_ANSWER, TABLE_ASK } from "../../server/game/tableRouter.ts";
import { HAND_OFF, HAND_OFF_ANSWER } from "../../server/game/tableHandOff.ts";
import { activeGames } from "../../server/game/gameRoom.ts";
import { clearAllTimersForUser, clearRoomTimers } from "../../server/game/gameTimers.ts";
import { closeOwnership, ownershipKey, ownsRoom, reopenOwnership } from "../../server/game/gameOwnership.ts";
import { activeGameStore } from "../../server/store/activeGameStore.ts";
import { packPersistedState } from "../../shared/persistedEnvelope.ts";
import type { TableAction } from "../../server/game/tableActions.ts";
import type { GameState } from "../../lib/game/gameEngine.ts";
import type { InstanceHandler, InstanceMessage } from "../../server/store/instanceInbox.ts";
import { recordingRuntime } from "../helpers/recordingRuntime.ts";
import { eventually } from "../helpers/client.ts";
import { useMemoryTableStores } from "../helpers/memoryTableStores.ts";
import { aThreePlayed } from "../support/game.ts";

let rooms = 0;
let room = "";

/** Every unlock sent, by key, and how many times the lock was read rather than asked for. */
function scriptLock(t: TestContext) {
  const unlocked: string[] = [];
  const reads = { n: 0 };
  t.mock.method(Client.prototype, "connect", async () => {});
  t.mock.method(Client.prototype, "end", async () => {});
  t.mock.method(Client.prototype, "query", async (sql: string, params?: string[]) => {
    if (/pg_locks/.test(sql)) {
      reads.n++;
      return { rows: [] };
    }
    if (/pg_try_advisory_lock/.test(sql)) return { rows: [{ locked: true }] };
    if (/pg_advisory_unlock/.test(sql)) {
      unlocked.push(params![0]!);
      return { rows: [{ released: true }] };
    }
    return { rows: [] };
  });
  return { unlocked, reads };
}

beforeEach(() => {
  room = `table-hand-off-room-${++rooms}`;
  reopenOwnership({ onRoomLost: () => {}, rows: activeGameStore });
});

afterEach(async () => {
  for (const userId of ["ana", "besi"]) clearAllTimersForUser(userId, room);
  clearRoomTimers(room);
  activeGames.delete(room);
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

const row = () =>
  packPersistedState(
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
  );

/**
 * This instance owning the room, with `live` peers: each claims an offered table as `claims` says
 * (`gone` refuses the offer, `silent` never answers), and answers every intent forwarded to it ok.
 */
async function owningWith(live: string[], claims: (peer: string) => "claims" | "gone" | "silent", claimAfterMs = 0) {
  const handlers = new Map<string, InstanceHandler>();
  const offers: string[] = [];
  const asks: { to: string; action: TableAction }[] = [];
  const reply = (kind: string, message: InstanceMessage) => setImmediate(() => void handlers.get(kind)?.(message));
  const harness = recordingRuntime({
    peers: {
      on: (kind, handler) => void handlers.set(kind, handler),
      live: async () => live,
      offer: async (to, message) => {
        assert.equal(message.kind, HAND_OFF);
        offers.push(to);
        const answer = claims(to);
        if (answer === "gone") return false;
        if (answer === "claims") setTimeout(() => reply(HAND_OFF_ANSWER, { kind: HAND_OFF_ANSWER, ask: message.ask, claimed: true }), claimAfterMs);
        return true;
      },
      send: async (to, message) => {
        if (message.kind !== TABLE_ASK) return;
        asks.push({ to, action: message.action as TableAction });
        reply(TABLE_ANSWER, { kind: TABLE_ANSWER, ask: message.ask, outcome: { ok: true } });
      },
    },
  });
  harness.cluster.online.add("ana");
  harness.cluster.online.add("besi");
  assert.deepEqual(await applyOrForward(harness.rt, { kind: "resume", roomId: room, userId: "ana" }), { ok: true });
  assert.ok(activeGames.has(room) && ownsRoom(room), "the table never came to this instance");
  return { ...harness, offers, asks };
}

describe("a table handed off at shutdown", () => {
  test("goes to the first live peer whose inbox is still kept, and its intents follow it there", async (t) => {
    const { unlocked } = scriptLock(t);
    useMemoryTableStores(t, { rows: [[room, row()]] });
    const { rt, offers, asks, sent } = await owningWith(["gone-peer", "live-peer"], (peer) => (peer === "gone-peer" ? "gone" : "claims"));

    await rt.handOffTables(2_000);
    assert.equal(offers.at(-1), "live-peer");
    assert.equal(activeGames.has(room), false, "the table stayed in memory here");
    assert.equal(ownsRoom(room), false);
    assert.deepEqual(unlocked, [ownershipKey(room)]);

    assert.deepEqual(await applyOrForward(rt, { kind: "reaction", roomId: room, userId: "ana", emoji: "👍" }), { ok: true });
    assert.deepEqual(asks.map((a) => [a.to, a.action.kind]), [["live-peer", "reaction"]]);
    assert.equal(sent.filter((e) => e.event === "game:reaction").length, 0, "the reaction was applied here too");
  });

  test("holds an intent sent while the peer claims, and has the peer answer it", async (t) => {
    scriptLock(t);
    useMemoryTableStores(t, { rows: [[room, row()]] });
    const { rt, asks, offers } = await owningWith(["live-peer"], () => "claims", 100);

    const handing = rt.handOffTables(2_000);
    await eventually(() => offers.length === 1, "the table to be offered");
    const seatLost = applyOrForward(rt, { kind: "seatLost", roomId: room, userId: "besi" });
    assert.deepEqual(await seatLost, { ok: true });
    await handing;
    assert.deepEqual(asks.map((a) => [a.to, a.action.kind]), [["live-peer", "seatLost"]]);
  });

  test("answers TABLE_UNREACHABLE, never NO_LIVE_GAME, when no peer claims within the budget", async (t) => {
    scriptLock(t);
    useMemoryTableStores(t, { rows: [[room, row()]] });
    const { rt, offers } = await owningWith(["slow-peer"], () => "silent");

    await rt.handOffTables(300);
    assert.deepEqual(offers, ["slow-peer"]);
    assert.equal(ownsRoom(room), true, "the lock was left free with nobody behind it");
    assert.equal(activeGames.has(room), false);
    assert.deepEqual(await applyOrForward(rt, { kind: "seatLost", roomId: room, userId: "besi" }), { ok: false, code: "TABLE_UNREACHABLE" });
    assert.deepEqual(await applyOrForward(rt, { kind: "rejoin", roomId: room, userId: "besi" }), { ok: false, code: "TABLE_UNREACHABLE" });
  });

  test("is kept, as before, when no peer is alive", async (t) => {
    const { unlocked } = scriptLock(t);
    useMemoryTableStores(t, { rows: [[room, row()]] });
    const { rt, offers, sent } = await owningWith([], () => "claims");

    await rt.handOffTables(2_000);
    assert.deepEqual(offers, []);
    assert.equal(activeGames.has(room) && ownsRoom(room), true, "a table with nobody to take it was given up");
    assert.deepEqual(unlocked, []);
    assert.deepEqual(await applyOrForward(rt, { kind: "reaction", roomId: room, userId: "ana", emoji: "👍" }), { ok: true });
    assert.equal(sent.filter((e) => e.event === "game:reaction").length, 1);
  });

  test("is held to the end when the store drops between reading the peers and offering", async (t) => {
    scriptLock(t);
    useMemoryTableStores(t, { rows: [[room, row()]] });
    const { rt } = await owningWith(["live-peer"], () => "claims");
    rt.peers.offer = async () => {
      throw new Error("Redis unreachable");
    };

    await rt.handOffTables(2_000);
    assert.equal(ownsRoom(room), true, "the lock was left free with nobody behind it");
    assert.deepEqual(await applyOrForward(rt, { kind: "seatLost", roomId: room, userId: "besi" }), { ok: false, code: "TABLE_UNREACHABLE" });
  });

  test("is kept when the live peers cannot be read", async (t) => {
    scriptLock(t);
    useMemoryTableStores(t, { rows: [[room, row()]] });
    const { rt } = await owningWith([], () => "claims");
    rt.peers.live = async () => {
      throw new Error("Redis unreachable");
    };

    await rt.handOffTables(2_000);
    assert.equal(activeGames.has(room) && ownsRoom(room), true);
  });
});

describe("a peer taken a table at its owner's shutdown", () => {
  test("takes it while an intent of its own waits on that owner, and the owner's forward of it is answered", async (t) => {
    const { reads } = scriptLock(t);
    useMemoryTableStores(t, { rows: [[room, row()]] });
    const handlers = new Map<string, InstanceHandler>();
    const deliver = (message: InstanceMessage) => void handlers.get(message.kind)?.(message);
    const OWNER = "departing-owner";
    let held: InstanceMessage | null = null;
    const claimed: unknown[] = [];
    const harness = recordingRuntime({
      peers: {
        on: (kind, handler) => void handlers.set(kind, handler),
        ownerOf: async () => OWNER,
        heard: () => true,
        stillSubscribed: async () => true,
        // The departing owner: it holds this peer's ask until the claim is answered, then forwards
        // the ask back here, the table's new owner, and relays the answer.
        send: async (to, message) => {
          assert.equal(to, OWNER);
          if (message.kind === TABLE_ASK && message.from === harness.rt.peers.self && !held) {
            held = message;
            return;
          }
          if (message.kind === HAND_OFF_ANSWER) {
            claimed.push(message.claimed);
            const ask = held!;
            setImmediate(() => deliver({ ...ask, from: OWNER, ask: "forwarded" }));
            return;
          }
          if (message.kind === TABLE_ANSWER && message.ask === "forwarded") {
            setImmediate(() => deliver({ kind: TABLE_ANSWER, ask: held!.ask, outcome: message.outcome }));
          }
        },
      },
    });
    harness.cluster.online.add("ana");

    const rejoin = applyOrForward(harness.rt, { kind: "rejoin", roomId: room, userId: "ana" });
    await eventually(() => held, "the peer's own ask to reach the departing owner");
    deliver({ kind: HAND_OFF, from: OWNER, ask: "hand-off", action: { kind: "resume", roomId: room, userId: "ana", id: "resume-1" } });

    assert.deepEqual(await rejoin, { ok: true });
    assert.deepEqual(claimed, [true], "the hand-off was not claimed");
    // A claim that waited for the attempt would wait out the attempt's ask, past the second a
    // departing owner gives each peer (`tableHandOff.ts`), and the attempt would then read the lock.
    assert.equal(reads.n, 0, "the claim waited for an ask only the claim could answer");
    assert.equal(activeGames.has(room) && ownsRoom(room), true);
  });
});
