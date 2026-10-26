// What the table owner answers when a player acts: the dispatcher's refusals, a rejoin, a seat lost.
import { test, describe, afterEach, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { applyTableAction } from "../../server/game/tableHandlers.ts";
import { activeGames } from "../../server/game/gameRoom.ts";
import {
  clearRoomTimers,
  arm,
  pending,
  seatKey,
  clearAllTimersForUser,
  usersInLobbyGrace,
} from "../../server/game/gameTimers.ts";
import { installClock } from "../../server/http/clock.ts";
import { payload } from "../../server/shared/payload.ts";
import { roomStore } from "../../server/store/roomStore.ts";
import type { TableAction } from "../../server/game/tableActions.ts";
import { fakeClock } from "../helpers/fakeClock.ts";
import { onlineTable } from "../helpers/onlineTable.ts";
import { recordingRuntime } from "../helpers/recordingRuntime.ts";
import { useMemoryTableStores } from "../helpers/memoryTableStores.ts";
import { aThreePlayed, card, seat, state } from "../support/game.ts";
import type { OnlineGameState } from "../../server/game/gameRoom.ts";
import type { GameState } from "../../lib/game/gameEngine.ts";

const ROOM = "table-handlers-room";

afterEach(() => {
  for (const userId of ["ana", "besi", "carl", "drita"]) clearAllTimersForUser(userId, ROOM);
  clearRoomTimers(ROOM);
  activeGames.delete(ROOM);
  delete process.env.MURLAN_DISCONNECT_GRACE_MS;
  delete process.env.MURLAN_LOBBY_GRACE_MS;
});

const act = (action: Record<string, unknown>) => ({ id: "a1", roomId: ROOM, ...action }) as unknown as TableAction;

function round(over: Partial<GameState> = {}): GameState {
  return state({
    players: [
      seat(0, [card("5", "spades")], { name: "Ana" }),
      seat(1, [card("6", "spades")], { name: "Besi" }),
      seat(2, [card("7", "spades")], { name: "Carl" }),
    ],
    currentTurnIndex: 0,
    lastPlayedBy: -1,
    openingCard: null,
    playedRanks: aThreePlayed(),
    ...over,
  });
}

function live(over: Partial<OnlineGameState> = {}, gameState: GameState = round()) {
  const game = onlineTable({
    roomId: ROOM,
    maxPlayers: 3,
    playerMap: { 0: "ana", 1: "besi", 2: "carl" },
    gameState,
    ...over,
  });
  activeGames.set(ROOM, game);
  return game;
}

const between = () => round({ roundOver: true, finishingOrder: ["p0", "p1", "p2"] });

describe("an action for a room with no live game", () => {
  test("is refused, whatever the kind", async () => {
    const { rt, sent } = recordingRuntime();
    for (const kind of ["reaction", "rejoin", "spectate", "unspectate", "seatLost", "resume", "vacate"]) {
      assert.deepEqual(
        await applyTableAction(rt, act({ kind, userId: "ana", emoji: "x" })),
        { ok: false, code: "NO_LIVE_GAME" },
        kind
      );
    }
    assert.deepEqual(sent, []);
  });
});

describe("a reaction", () => {
  test("reaches the room from the seat it was sent from, under that seat's name", async () => {
    const { rt, sent } = recordingRuntime();
    live();
    assert.deepEqual(await applyTableAction(rt, act({ kind: "reaction", userId: "besi", emoji: "👍" })), { ok: true });
    assert.deepEqual(sent.map((e) => [e.to, e.event, e.payload]), [
      [{ room: ROOM }, "game:reaction", { emoji: "👍", fromSeat: 1, username: "Besi" }],
    ]);
  });

  test("from an account with no seat is refused and sent to nobody", async () => {
    const { rt, sent } = recordingRuntime();
    live();
    assert.deepEqual(await applyTableAction(rt, act({ kind: "reaction", userId: "stranger", emoji: "👍" })), {
      ok: false,
      code: "NOT_SEATED",
    });
    assert.deepEqual(sent, []);
  });
});

describe("watching a table", () => {
  test("a stranger is let in and handed the table's state, and only them", async () => {
    const { rt, sent } = recordingRuntime();
    const game = live();
    assert.deepEqual(await applyTableAction(rt, act({ kind: "spectate", userId: "guest" })), { ok: true });
    assert.deepEqual([...game.spectators], ["guest"]);
    assert.deepEqual(sent.map((e) => [e.to, e.event]), [[{ user: "guest" }, "game:state"]]);
  });

  test("is refused between rounds, with no one added", async () => {
    const { rt, sent } = recordingRuntime();
    const game = live({}, between());
    assert.deepEqual(await applyTableAction(rt, act({ kind: "spectate", userId: "guest" })), {
      ok: false,
      code: "GAME_NOT_FOUND",
    });
    assert.equal(game.spectators.size, 0);
    assert.deepEqual(sent, []);
  });

  test("is refused for a player already seated, who stays out of the spectators", async () => {
    const { rt, sent } = recordingRuntime();
    const game = live();
    assert.deepEqual(await applyTableAction(rt, act({ kind: "spectate", userId: "ana" })), {
      ok: false,
      code: "ALREADY_IN_ROOM",
    });
    assert.equal(game.spectators.size, 0);
    assert.deepEqual(sent, []);
  });

  test("stopping removes the viewer and keeps the others", async () => {
    const { rt } = recordingRuntime();
    const game = live({ spectators: new Set(["guest", "other"]) });
    assert.deepEqual(await applyTableAction(rt, act({ kind: "unspectate", userId: "guest" })), { ok: true });
    assert.deepEqual([...game.spectators], ["other"]);
  });
});

describe("a rejoin", () => {
  const upserts = (t: TestContext) => t.mock.method(roomStore, "upsertRoomPlayer", async () => {});

  test("by a seated player re-records the seat, clears both graces and tells the room they are back", async (t) => {
    const clock = fakeClock();
    t.after(installClock(clock));
    useMemoryTableStores(t);
    const upsert = upserts(t);
    const { rt, sent } = recordingRuntime();
    live();
    arm("disconnect", "besi", 60_000, () => {});
    arm("lobbyGrace", seatKey(ROOM, "besi"), 20_000, () => {});

    assert.deepEqual(await applyTableAction(rt, act({ kind: "rejoin", userId: "besi" })), { ok: true });

    assert.deepEqual(upsert.mock.calls.map((c) => c.arguments), [[ROOM, "besi", 1]]);
    assert.equal(pending("disconnect", "besi"), false);
    assert.deepEqual(usersInLobbyGrace(ROOM), []);
    const back = sent.find((e) => e.event === "game:player_reconnected");
    assert.deepEqual(back?.payload, {
      userId: "besi",
      username: "Besi",
      seatIndex: 1,
      ...payload("PLAYER_RECONNECTED", { username: "Besi" }),
    });
    assert.ok(
      !sent.some((e) => e.event === "game:end_match_vote_state" && "room" in e.to),
      "a seat that was never vacated has no tally to correct for the room"
    );
  });

  test("by a player whose seat went to a bot takes it back, publishes the table and corrects the end-match tally for the room", async (t) => {
    useMemoryTableStores(t);
    const upsert = upserts(t);
    const { rt, sent } = recordingRuntime();
    const game = live({
      playerMap: { 0: "ana", 2: "carl" },
      vacatedSeats: new Map([[1, { userId: "besi", username: "Besi" }]]),
      releasedSeats: new Set(["besi"]),
      endMatchVotes: new Set(["ana"]),
    });

    assert.deepEqual(await applyTableAction(rt, act({ kind: "rejoin", userId: "besi" })), { ok: true });

    assert.equal(game.playerMap[1], "besi");
    assert.deepEqual(upsert.mock.calls.map((c) => c.arguments), [[ROOM, "besi", 1]]);
    const states = sent.filter((e) => e.event === "game:state").map((e) => (e.to as { user: string }).user);
    assert.ok(["ana", "besi", "carl"].every((u) => states.includes(u)), `state reached ${states}`);
    assert.deepEqual(
      sent.find((e) => e.event === "game:end_match_vote_state" && "room" in e.to)?.payload,
      { votes: [], total: 3 }
    );
  });

  test("still succeeds when re-recording the seat fails", async (t) => {
    useMemoryTableStores(t);
    t.mock.method(roomStore, "upsertRoomPlayer", async () => {
      throw new Error("db down");
    });
    const { rt, sent } = recordingRuntime();
    live();
    assert.deepEqual(await applyTableAction(rt, act({ kind: "rejoin", userId: "ana" })), { ok: true });
    assert.ok(sent.some((e) => e.event === "game:player_reconnected"));
  });

  test("by an account that left and kept no seat to reclaim is told the seat was released", async () => {
    const { rt, sent } = recordingRuntime();
    live({ releasedSeats: new Set(["drita"]) });
    assert.deepEqual(await applyTableAction(rt, act({ kind: "rejoin", userId: "drita" })), {
      ok: false,
      code: "SEAT_RELEASED",
    });
    assert.deepEqual(sent, []);
  });

  test("by a stranger is unauthorized", async () => {
    const { rt } = recordingRuntime();
    live();
    assert.deepEqual(await applyTableAction(rt, act({ kind: "rejoin", userId: "drita" })), {
      ok: false,
      code: "UNAUTHORIZED",
    });
  });
});

describe("a seat lost", () => {
  const gone = (userId: string) => act({ kind: "seatLost", userId });
  const disconnects = (sent: ReturnType<typeof recordingRuntime>["sent"]) =>
    sent.filter((e) => e.event === "game:player_disconnected");

  test("mid-round tells the room how long the seat is held, rounded to whole seconds", async (t) => {
    t.after(installClock(fakeClock()));
    process.env.MURLAN_DISCONNECT_GRACE_MS = "1500";
    const { rt, sent } = recordingRuntime();
    live();
    assert.deepEqual(await applyTableAction(rt, gone("besi")), { ok: true });
    assert.deepEqual(
      disconnects(sent).map((e) => [e.to, e.payload]),
      [
        [
          { room: ROOM },
          {
            userId: "besi",
            username: "Besi",
            seatIndex: 1,
            ...payload("PLAYER_DISCONNECTED_GRACE", { username: "Besi", seconds: 2 }),
          },
        ],
      ]
    );
    assert.equal(pending("disconnect", "besi"), true);
  });

  test("mid-round keeps the turn moving: a vacant seat's turn is armed while the grace runs", async (t) => {
    t.after(installClock(fakeClock()));
    const { rt, sent } = recordingRuntime();
    live({}, round({ currentTurnIndex: 1 }));
    await applyTableAction(rt, gone("besi"));
    assert.ok(sent.some((e) => e.event === "game:turn_deadline"));
  });

  test("mid-round is a no-op for a player connected anywhere in the cluster", async (t) => {
    t.after(installClock(fakeClock()));
    const { rt, sent, cluster } = recordingRuntime();
    cluster.online.add("besi");
    live();
    assert.deepEqual(await applyTableAction(rt, gone("besi")), { ok: true });
    assert.deepEqual(sent, []);
    assert.equal(pending("disconnect", "besi"), false);
  });

  test("mid-round counts a socket in another room as back, since only being online matters", async (t) => {
    t.after(installClock(fakeClock()));
    const { rt, cluster } = recordingRuntime();
    cluster.online.add("besi");
    cluster.atTable.set("besi", new Set(["elsewhere"]));
    live();
    await applyTableAction(rt, gone("besi"));
    assert.equal(pending("disconnect", "besi"), false);
  });

  test("an account with no seat is refused", async (t) => {
    t.after(installClock(fakeClock()));
    const { rt, sent } = recordingRuntime();
    live();
    assert.deepEqual(await applyTableAction(rt, gone("drita")), { ok: false, code: "NOT_SEATED" });
    assert.deepEqual(sent, []);
  });

  test("between rounds holds the seat under the lobby grace and announces nothing", async (t) => {
    t.after(installClock(fakeClock()));
    const { rt, sent, cluster } = recordingRuntime();
    cluster.online.add("besi");
    live({}, between());
    assert.deepEqual(await applyTableAction(rt, gone("besi")), { ok: true });
    assert.deepEqual(usersInLobbyGrace(ROOM), ["besi"]);
    assert.equal(pending("disconnect", "besi"), false);
    assert.deepEqual(disconnects(sent), []);
  });

  test("between rounds is a no-op for a player back at this table, even if offline elsewhere", async (t) => {
    t.after(installClock(fakeClock()));
    const { rt, cluster } = recordingRuntime();
    cluster.atTable.set("besi", new Set([ROOM]));
    live({}, between());
    assert.deepEqual(await applyTableAction(rt, gone("besi")), { ok: true });
    assert.deepEqual(usersInLobbyGrace(ROOM), []);
  });

  describe("when the grace runs out", () => {
    function useGrace(t: TestContext, over: { online?: boolean; release?: () => Promise<unknown> } = {}) {
      const clock = fakeClock();
      t.after(installClock(clock));
      useMemoryTableStores(t, {
        rooms: [[ROOM, { code: "AAAAAA", gameMode: "free_for_all", maxPlayers: 3, status: "in_progress", hostUserId: "ana" }]],
      });
      const release = t.mock.method(roomStore, "releaseSeat", over.release ?? (async () => null));
      return { clock, release, online: over.online ?? false, harness: recordingRuntime(), game: live() };
    }

    async function expire({ clock, release, online, harness, game }: ReturnType<typeof useGrace>) {
      await applyTableAction(harness.rt, gone("besi"));
      if (online) harness.cluster.online.add("besi");
      harness.sent.length = 0;
      clock.advance(60_000);
      for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
      return { ...harness, game, release };
    }

    test("a player still away loses the seat to a bot and the room is told", async (t) => {
      const { game, release, sent } = await expire(useGrace(t));
      assert.deepEqual(game.playerMap, { 0: "ana", 2: "carl" });
      assert.equal(game.gameState.players[1]?.type, "bot");
      assert.deepEqual(release.mock.calls.map((c) => c.arguments), [[ROOM, "besi"]]);
      assert.ok(sent.some((e) => e.event === "game:seat_bot_takeover"));
    });

    test("the seat is still handed over when releasing its row fails", async (t) => {
      const { game } = await expire(useGrace(t, {
        release: async () => {
          throw new Error("db down");
        },
      }));
      assert.deepEqual(game.playerMap, { 0: "ana", 2: "carl" });
    });

    test("a player who came back keeps it", async (t) => {
      const { game, release, sent } = await expire(useGrace(t, { online: true }));
      assert.deepEqual(game.playerMap, { 0: "ana", 1: "besi", 2: "carl" });
      assert.equal(release.mock.callCount(), 0);
      assert.ok(!sent.some((e) => e.event === "game:seat_bot_takeover"));
    });
  });
});

describe("resume and vacate", () => {
  test("resume arms a turn for the table", async (t) => {
    t.after(installClock(fakeClock()));
    const { rt, sent } = recordingRuntime();
    live();
    assert.deepEqual(await applyTableAction(rt, act({ kind: "resume", userId: "ana" })), { ok: true });
    assert.ok(sent.some((e) => e.event === "game:turn_deadline"));
  });

  test("vacate hands the seat to a bot, and between rounds a gate it closes deals the next round", async (t) => {
    useMemoryTableStores(t, {
      rooms: [[ROOM, { code: "AAAAAA", gameMode: "free_for_all", maxPlayers: 3, status: "finished", hostUserId: "ana" }]],
      seats: [
        [
          ROOM,
          ["ana", "besi", "carl"].map((userId, seatIndex) => ({ userId, seatIndex, user: { id: userId, username: userId } as never })),
        ],
      ],
    });
    const { rt, sent } = recordingRuntime();
    const game = live({ rematchVotes: new Set(["ana", "besi"]) }, between());
    await applyTableAction(rt, act({ kind: "vacate", userId: "carl" }));
    assert.deepEqual(game.playerMap, { 0: "ana", 1: "besi" });
    assert.ok(sent.some((e) => e.event === "game:started"), "the gate carl was holding open was not re-evaluated");
  });
});
