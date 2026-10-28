// How a table enters memory: the host's start, a restore from active_games, and the sweep for orphans.
import { test, describe, afterEach, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { startMatchAction, rehydrateGame, resumeOrphanedTables } from "../../server/game/tableLifecycle.ts";
import { activeGames } from "../../server/game/gameRoom.ts";
import { arm, clearAllTimersForUser, clearRoomTimers, pending, seatKey, usersInLobbyGrace } from "../../server/game/gameTimers.ts";
import { installClock } from "../../server/http/clock.ts";
import { refuse } from "../../server/shared/refusal.ts";
import { roomStore } from "../../server/store/roomStore.ts";
import { friendStore } from "../../server/store/friendStore.ts";
import { packPersistedState } from "../../shared/persistedEnvelope.ts";
import type { TableAction } from "../../server/game/tableActions.ts";
import type { OnlineGameState } from "../../server/game/gameRoom.ts";
import type { GameState, Player } from "../../lib/game/gameEngine.ts";
import { fakeClock } from "../helpers/fakeClock.ts";
import { useMemoryTableStores } from "../helpers/memoryTableStores.ts";
import { onlineTable } from "../helpers/onlineTable.ts";
import { recordingRuntime } from "../helpers/recordingRuntime.ts";
import { aThreePlayed } from "../support/game.ts";

const ROOM = "table-lifecycle-room";
const USERS = ["ana", "besi", "carl", "drita"];

afterEach(() => {
  for (const userId of USERS) clearAllTimersForUser(userId, ROOM);
  clearRoomTimers(ROOM);
  activeGames.delete(ROOM);
});

type Status = "waiting" | "finished" | "in_progress";

const roomRow = (over: Record<string, unknown> = {}): [string, Record<string, unknown>] => [
  ROOM,
  { code: "AAAAAA", gameMode: "free_for_all", maxPlayers: 4, status: "waiting" as Status, hostUserId: "ana", visibility: "private", ...over },
];

const seatRows = (...users: [string, number][]): [string, { userId: string; seatIndex: number; user: never }[]] => [
  ROOM,
  users.map(([userId, seatIndex]) => ({ userId, seatIndex, user: { id: userId, username: userId.toUpperCase() } as never })),
];

const start = (over: Record<string, unknown> = {}) =>
  ({ id: "s1", kind: "startMatch", roomId: ROOM, userId: "ana", fillWithBots: true, ...over }) as unknown as Extract<
    TableAction,
    { kind: "startMatch" }
  >;

function useSetup(t: TestContext, seed: Parameters<typeof useMemoryTableStores>[1]) {
  const stores = useMemoryTableStores(t, seed);
  const cleared = t.mock.method(friendStore, "clearGameInvites", async () => [] as string[]);
  return { ...stores, cleared, ...recordingRuntime() };
}

function human(id: string, name: string, type: Player["type"] = "human"): Player {
  return { id, name, hand: [], type };
}

function overHand(players: Player[], finishingOrder: string[]): GameState {
  return {
    players,
    currentTurnIndex: 0,
    lastPlayedCombination: null,
    lastPlayedBy: -1,
    passCount: 0,
    gameMode: "free_for_all",
    roundOver: true,
    finishingOrder,
    openingCard: null,
    playedRanks: aThreePlayed(),
    lastMove: { seq: 0, kind: "deal" },
  };
}

describe("the host starting a match", () => {
  test("deals a table of the seated humans and bots in the empty seats, and tells the room before anyone's cards", async (t) => {
    const { rt, sent, cleared } = useSetup(t, {
      rooms: [roomRow({ maxPlayers: 4 })],
      seats: [seatRows(["ana", 0], ["besi", 1])],
    });
    assert.deepEqual(await startMatchAction(rt, start({ matchLength: "single" })), { ok: true });

    const game = activeGames.get(ROOM)!;
    assert.deepEqual(game.playerMap, { 0: "ana", 1: "besi" });
    assert.deepEqual(game.gameState.players.map((p) => p.type), ["human", "human", "bot", "bot"]);
    assert.equal(game.matchLength, "single");
    assert.deepEqual(cleared.mock.calls.map((c) => c.arguments), [[ROOM]]);

    const events = sent.map((e) => e.event);
    assert.ok(events.indexOf("room:state") < events.indexOf("game:started"), "the room heard late");
    const roomState = sent.find((e) => e.event === "room:state")!;
    assert.deepEqual(roomState.to, { room: ROOM });
    assert.equal((roomState.payload as { status: string }).status, "in_progress");
    assert.ok(events.includes("game:state"));
  });

  test("tells whoever held an invite that it is no longer good", async (t) => {
    const { rt, sent, cleared } = useSetup(t, { rooms: [roomRow()], seats: [seatRows(["ana", 0])] });
    cleared.mock.mockImplementation(async () => ["guest"]);
    await startMatchAction(rt, start());
    assert.ok(
      sent.some((e) => e.event === "friend:invite_retired" && "user" in e.to && e.to.user === "guest"),
      "the invitee was not told"
    );
  });

  test("a table of humans only seats just them, renumbered from the first seat", async (t) => {
    const { rt } = useSetup(t, {
      rooms: [roomRow({ maxPlayers: 4 })],
      seats: [seatRows(["ana", 1], ["besi", 3])],
    });
    assert.deepEqual(await startMatchAction(rt, start({ fillWithBots: false })), { ok: true });
    const game = activeGames.get(ROOM)!;
    assert.deepEqual(game.playerMap, { 0: "ana", 1: "besi" });
    assert.equal(game.gameState.players.length, 2);
  });

  test("by anyone but the host is refused", async (t) => {
    const { rt, sent } = useSetup(t, { rooms: [roomRow()], seats: [seatRows(["ana", 0], ["besi", 1])] });
    assert.deepEqual(await startMatchAction(rt, start({ userId: "besi" })), { ok: false, code: "NOT_THE_HOST" });
    assert.equal(activeGames.has(ROOM), false);
    assert.deepEqual(sent, []);
  });

  test("in a room that does not exist is refused", async (t) => {
    const { rt } = useSetup(t, {});
    assert.deepEqual(await startMatchAction(rt, start()), { ok: false, code: "NOT_THE_HOST" });
  });

  test("in a room whose round was left in progress by a restart is refused, not dealt into", async (t) => {
    const { rt } = useSetup(t, { rooms: [roomRow({ status: "in_progress" })], seats: [seatRows(["ana", 0])] });
    assert.deepEqual(await startMatchAction(rt, start()), { ok: false, code: "ROOM_NOT_WAITING" });
    assert.equal(activeGames.has(ROOM), false);
  });

  test("in a finished room is dealt", async (t) => {
    const { rt } = useSetup(t, { rooms: [roomRow({ status: "finished" })], seats: [seatRows(["ana", 0])] });
    assert.deepEqual(await startMatchAction(rt, start()), { ok: true });
  });

  test("alone, with no bots to fill the table, is refused with the notice a client shows", async (t) => {
    const { rt } = useSetup(t, { rooms: [roomRow()], seats: [seatRows(["ana", 0])] });
    assert.deepEqual(await startMatchAction(rt, start({ fillWithBots: false })), refuse("MIN_PLAYERS_REQUIRED"));
    assert.equal(activeGames.has(ROOM), false);
  });

  test("with nobody seated is refused even when bots would fill every seat", async (t) => {
    const { rt } = useSetup(t, { rooms: [roomRow()], seats: [seatRows()] });
    assert.deepEqual(await startMatchAction(rt, start()), { ok: false, code: "MIN_PLAYERS_REQUIRED" });
  });

  test("a teams table that does not make two pairs is refused", async (t) => {
    const { rt } = useSetup(t, {
      rooms: [roomRow({ gameMode: "teams" })],
      seats: [seatRows(["ana", 0], ["besi", 1], ["carl", 2])],
    });
    assert.deepEqual(await startMatchAction(rt, start({ fillWithBots: false })), refuse("TEAMS_REQUIRE_FOUR"));
  });

  test("a teams table of one human and bots makes two pairs", async (t) => {
    const { rt } = useSetup(t, { rooms: [roomRow({ gameMode: "teams" })], seats: [seatRows(["ana", 0])] });
    assert.deepEqual(await startMatchAction(rt, start()), { ok: true });
    assert.equal(activeGames.get(ROOM)!.gameState.players.length, 4);
  });

  test("closed by someone else while it was being read is refused as the room's state says", async (t) => {
    const { rt } = useSetup(t, { rooms: [roomRow()], seats: [seatRows(["ana", 0])] });
    t.mock.method(roomStore, "closeForStart", async () => ({ ok: false, reason: "not_waiting" }));
    assert.deepEqual(await startMatchAction(rt, start()), { ok: false, code: "ROOM_NOT_WAITING" });
    t.mock.method(roomStore, "closeForStart", async () => ({ ok: false, reason: "no_room" }));
    assert.deepEqual(await startMatchAction(rt, start()), { ok: false, code: "NOT_THE_HOST" });
    const seated = [
      { seatIndex: 0, userId: "ana", user: { username: "ANA" } },
      { seatIndex: 1, userId: "besi", user: { username: "BESI" } },
    ];
    t.mock.method(roomStore, "closeForStart", async () => ({ ok: false, reason: "refused", roster: seated }));
    assert.deepEqual(await startMatchAction(rt, start()), { ok: false, code: "MIN_PLAYERS_REQUIRED" });
  });

  test("calls for every dealt-in player to stop watching, wherever their socket is", async (t) => {
    const asked: unknown[] = [];
    const { rt } = useSetup(t, { rooms: [roomRow()], seats: [seatRows(["ana", 0], ["besi", 1])] });
    t.mock.method(rt.transport, "serverSideEmit", (event: string, userId: string, ack: () => void) => {
      asked.push([event, userId]);
      ack();
      return true;
    });
    assert.deepEqual(await startMatchAction(rt, start()), { ok: true });
    assert.deepEqual(asked, [
      ["murlan:stop-spectating", "ana"],
      ["murlan:stop-spectating", "besi"],
    ]);
  });

  test("in a room that is not waiting leaves seats held for absent players where they are", async (t) => {
    t.after(installClock(fakeClock()));
    const { rt, seats } = useSetup(t, {
      rooms: [roomRow({ status: "in_progress" })],
      seats: [seatRows(["ana", 0], ["besi", 1])],
    });
    arm("lobbyGrace", seatKey(ROOM, "besi"), 20_000, () => {});
    assert.deepEqual(await startMatchAction(rt, start()), { ok: false, code: "ROOM_NOT_WAITING" });
    assert.deepEqual(usersInLobbyGrace(ROOM), ["besi"]);
    assert.equal(seats.get(ROOM)?.length, 2);
  });

  test("in a room another start closed after it was read is refused, not dealt twice", async (t) => {
    const { rt, rooms } = useSetup(t, { rooms: [roomRow()], seats: [seatRows(["ana", 0])] });
    const waiting = rooms.get(ROOM)!;
    rooms.set(ROOM, { ...waiting, status: "in_progress" });
    t.mock.method(roomStore, "getRoomById", async () => waiting);
    assert.deepEqual(await startMatchAction(rt, start()), { ok: false, code: "ROOM_NOT_WAITING" });
    assert.equal(activeGames.has(ROOM), false);
  });

  test("lets go of seats held for players who are not there, and deals the rest", async (t) => {
    t.after(installClock(fakeClock()));
    const { rt, seats } = useSetup(t, {
      rooms: [roomRow({ maxPlayers: 4 })],
      seats: [seatRows(["ana", 0], ["besi", 1], ["carl", 2])],
    });
    arm("lobbyGrace", seatKey(ROOM, "besi"), 20_000, () => {});
    assert.deepEqual(await startMatchAction(rt, start()), { ok: true });

    assert.deepEqual(activeGames.get(ROOM)!.playerMap, { 0: "ana", 2: "carl" });
    assert.deepEqual(seats.get(ROOM)?.map((s) => s.userId).sort(), ["ana", "carl"]);
    assert.deepEqual(usersInLobbyGrace(ROOM), []);
  });
});

describe("the host starting another match at a table whose match is over", () => {
  const finished = (over: Partial<OnlineGameState> = {}) => {
    const game = onlineTable({
      roomId: ROOM,
      maxPlayers: 4,
      matchOver: true,
      roundsPlayed: 3,
      cumulativeScores: { ana: 9, besi: 4 },
      playerMap: { 0: "ana", 1: "besi" },
      gameState: overHand(
        [human("player_0", "Ana"), human("player_1", "Besi"), human("player_2", "Bot", "bot"), human("player_3", "Bot", "bot")],
        ["player_0", "player_1", "player_2", "player_3"]
      ),
      botSeatsAtStart: new Set([2, 3]),
      ...over,
    });
    activeGames.set(ROOM, game);
    return game;
  };
  const useTable = (t: TestContext) =>
    useSetup(t, { rooms: [roomRow({ status: "finished" })], seats: [seatRows(["ana", 0], ["besi", 1])] });

  test("needs every seated player ready: the host's own start is a yes, and the others are asked", async (t) => {
    const { rt, sent } = useTable(t);
    const old = finished();
    assert.deepEqual(await startMatchAction(rt, start()), refuse("NEW_MATCH_NOT_READY"));
    assert.deepEqual([...old.rematchVotes], ["ana"]);
    assert.equal(activeGames.get(ROOM), old, "nothing was dealt");
    const state = sent.find((e) => e.event === "game:vote_state");
    assert.deepEqual((state?.payload as { votes: string[]; total: number }).votes, ["ana"]);
    assert.equal((state?.payload as { total: number }).total, 2);
  });

  test("deals the new match once the others have said yes, and starts its tally afresh", async (t) => {
    const { rt } = useTable(t);
    const old = finished({ rematchVotes: new Set(["besi"]) });
    assert.deepEqual(await startMatchAction(rt, start()), { ok: true });
    const next = activeGames.get(ROOM)!;
    assert.notEqual(next, old);
    assert.equal(old.rematchVotes.size, 0, "the finished match's tally outlived it");
    assert.equal(next.gameState.roundOver, false);
  });

  test("a host who no longer holds a seat does not vote for anyone", async (t) => {
    const { rt } = useTable(t);
    const old = finished({ playerMap: { 1: "besi" } });
    assert.deepEqual(await startMatchAction(rt, start()), refuse("NEW_MATCH_NOT_READY"));
    assert.deepEqual([...old.rematchVotes], []);
  });

  test("by a seated player who is not the host is refused, and counts as no one's vote", async (t) => {
    const { rt, sent } = useTable(t);
    const old = finished();
    assert.deepEqual(await startMatchAction(rt, start({ userId: "besi" })), { ok: false, code: "NOT_THE_HOST" });
    assert.equal(old.rematchVotes.size, 0);
    assert.deepEqual(sent, []);
  });

  test("is dealt although the room row still says the last round is in progress", async (t) => {
    const { rt } = useSetup(t, { rooms: [roomRow({ status: "in_progress" })], seats: [seatRows(["ana", 0], ["besi", 1])] });
    const old = finished({ rematchVotes: new Set(["besi"]) });
    assert.deepEqual(await startMatchAction(rt, start()), { ok: true });
    assert.notEqual(activeGames.get(ROOM), old);
  });

  test("while its match is still running is refused, and the format is not rewritten", async (t) => {
    const { rt } = useTable(t);
    const live = finished({ matchOver: false });
    assert.deepEqual(await startMatchAction(rt, start({ matchLength: "single" })), refuse("MATCH_IN_PROGRESS"));
    assert.equal(activeGames.get(ROOM), live);
    assert.equal(live.matchLength, "match");
  });
});

describe("restoring a table from active_games", () => {
  const match = (over: Record<string, unknown> = {}) => ({
    playerMap: { 0: "ana", 1: "besi", 2: "carl" } as Record<number, string>,
    scores: { ana: 0, besi: 0, carl: 0 },
    gameMode: "free_for_all" as const,
    matchLength: "match" as const,
    matchTarget: 21,
    maxPlayers: 3,
    roundsPlayed: 1,
    endedByVote: false,
    matchOver: false,
    ...over,
  });
  const seats = (vacated: [number, { userId: string; username: string }][] = []) => ({
    vacatedSeats: vacated,
    releasedSeats: [],
    weakSeats: [],
    abandonedSeats: [],
  });
  const players = () => [human("player_0", "Ana"), human("player_1", "Besi"), human("player_2", "Carl")];
  const row = (state: GameState, m = match(), s = seats()) => packPersistedState(state, {}, 0, "AAAAAA", m, s);
  const midRound = () => ({ ...overHand(players(), []), roundOver: false });

  test("says nothing was there when no row is", async (t) => {
    useMemoryTableStores(t);
    assert.equal(await rehydrateGame(recordingRuntime().rt, ROOM, "ana"), "missing");
    assert.equal(activeGames.has(ROOM), false);
  });

  test("puts the table back for a player who sat at it, or sat at it once", async (t) => {
    useMemoryTableStores(t, {
      rows: [[ROOM, row(midRound(), match({ playerMap: { 0: "ana", 2: "carl" } }), seats([[1, { userId: "besi", username: "Besi" }]]))]],
    });
    const { rt } = recordingRuntime({ presence: { tablePresence: async () => null } });
    assert.equal(await rehydrateGame(rt, ROOM, "besi"), "restored");
    assert.equal(activeGames.get(ROOM)?.roomId, ROOM);
    activeGames.delete(ROOM);
    assert.equal(await rehydrateGame(rt, ROOM, "ana"), "restored");
    activeGames.delete(ROOM);
    assert.equal(await rehydrateGame(rt, ROOM, null), "restored");
  });

  test("keeps it out of memory for an account that never sat there", async (t) => {
    useMemoryTableStores(t, { rows: [[ROOM, row(midRound())]] });
    const { rt } = recordingRuntime();
    assert.equal(await rehydrateGame(rt, ROOM, "stranger"), "not_seated");
    assert.equal(activeGames.has(ROOM), false);
  });

  test("keeps it out of memory for an account that never sat there, even when others left seats", async (t) => {
    useMemoryTableStores(t, {
      rows: [[ROOM, row(midRound(), match({ playerMap: { 0: "ana", 2: "carl" } }), seats([[1, { userId: "besi", username: "Besi" }]]))]],
    });
    assert.equal(await rehydrateGame(recordingRuntime().rt, ROOM, "stranger"), "not_seated");
    assert.equal(activeGames.has(ROOM), false);
  });

  test("a table between rounds gets its vote deadline back, a finished match does not", async (t) => {
    useMemoryTableStores(t, {
      rows: [
        [ROOM, row(overHand(players(), ["player_0", "player_1", "player_2"]))],
        ["done-room", row(overHand(players(), ["player_0", "player_1", "player_2"]), match({ matchOver: true }))],
      ],
    });
    const { rt } = recordingRuntime({ presence: { tablePresence: async () => null } });
    t.after(() => clearRoomTimers("done-room"));
    await rehydrateGame(rt, ROOM, "ana");
    assert.equal(pending("voteDeadline", ROOM), true);
    await rehydrateGame(rt, "done-room", "ana");
    activeGames.delete("done-room");
    assert.equal(pending("voteDeadline", "done-room"), false);
  });

  test("a mid-round table holds the seat of everyone not connected, but not the player whose action brought it back", async (t) => {
    t.after(installClock(fakeClock()));
    useMemoryTableStores(t, { rows: [[ROOM, row(midRound())]] });
    const { rt, sent, cluster } = recordingRuntime();
    cluster.online.add("besi");
    assert.equal(await rehydrateGame(rt, ROOM, "ana"), "restored");

    const held = sent.filter((e) => e.event === "game:player_disconnected").map((e) => (e.payload as { userId: string }).userId);
    assert.deepEqual(held, ["carl"], "ana is acting, besi is online");
    assert.equal(pending("disconnect", "carl"), true);
    assert.equal(pending("disconnect", "ana"), false);
    assert.equal(pending("disconnect", "besi"), false);
  });

  test("a table between rounds counts presence at that table: a player online elsewhere is still holding a lobby grace", async (t) => {
    t.after(installClock(fakeClock()));
    useMemoryTableStores(t, { rows: [[ROOM, row(overHand(players(), ["player_0", "player_1", "player_2"]))]] });
    const { rt, cluster } = recordingRuntime();
    cluster.online.add("besi");
    cluster.online.add("carl");
    cluster.atTable.set("carl", new Set([ROOM]));
    await rehydrateGame(rt, ROOM, "ana");
    assert.deepEqual(usersInLobbyGrace(ROOM), ["besi"]);
  });

  test("when the cluster cannot say who is here, no seat is held on a guess", async (t) => {
    useMemoryTableStores(t, { rows: [[ROOM, row(midRound())]] });
    const { rt, cluster, sent } = recordingRuntime();
    cluster.down = true;
    assert.equal(await rehydrateGame(rt, ROOM, "ana"), "restored");
    assert.deepEqual(sent, []);
    assert.equal(pending("disconnect", "besi"), false);
  });

  test("a row that cannot be restored is deleted, and the claim on it is left alone", async (t) => {
    const { rows } = useMemoryTableStores(t, { rows: [[ROOM, { ...row(midRound()), schemaVersion: 1 }]] });
    const { rt } = recordingRuntime();
    assert.equal(await rehydrateGame(rt, ROOM, "ana"), "unrestorable");
    assert.equal(rows.has(ROOM), false);
  });

});

describe("the sweep for tables nobody holds", () => {
  const live = (_roomId: string, over: Partial<GameState> = {}) =>
    packPersistedState(
      { ...overHand([human("player_0", "Ana"), human("player_1", "Besi")], []), roundOver: false, ...over },
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

  function useCluster(t: TestContext, rows: [string, unknown][], online: string[] | null) {
    useMemoryTableStores(t, { rows });
    const { rt, cluster } = recordingRuntime();
    if (online === null) cluster.down = true;
    else for (const u of online) cluster.online.add(u);
    return { rt, routed: t.mock.method(rt, "route", async () => ({ ok: true as const })) };
  }

  async function sweep({ rt, routed }: ReturnType<typeof useCluster>) {
    await resumeOrphanedTables(rt);
    return routed.mock.calls.map((c) => c.arguments[0]);
  }

  test("wakes a table whose seat is online, as that player", async (t) => {
    assert.deepEqual(await sweep(useCluster(t, [["r1", live("r1")]], ["besi"])), [{ kind: "resume", roomId: "r1", userId: "besi" }]);
  });

  test("leaves a table alone when nobody sitting at it is online", async (t) => {
    assert.deepEqual(await sweep(useCluster(t, [["r1", live("r1")]], ["stranger"])), []);
  });

  test("leaves a table between rounds alone: the vote deadline wakes it", async (t) => {
    assert.deepEqual(await sweep(useCluster(t, [["r1", live("r1", { roundOver: true })]], ["besi"])), []);
  });

  test("leaves a row it cannot restore alone", async (t) => {
    assert.deepEqual(await sweep(useCluster(t, [["r1", { schemaVersion: 1 }]], ["besi"])), []);
  });

  test("leaves a table this process already holds alone", async (t) => {
    activeGames.set("r1", onlineTable({ roomId: "r1" }));
    t.after(() => activeGames.delete("r1"));
    assert.deepEqual(await sweep(useCluster(t, [["r1", live("r1")]], ["besi"])), []);
  });

  test("does nothing when the cluster cannot say who is online", async (t) => {
    assert.deepEqual(await sweep(useCluster(t, [["r1", live("r1")]], null)), []);
  });

  test("goes through every table, not only the first", async (t) => {
    const routed = await sweep(
      useCluster(
        t,
        [
          ["r0", { schemaVersion: 1 }],
          ["r1", live("r1")],
          ["r2", live("r2")],
        ],
        ["ana"]
      )
    );
    assert.deepEqual(routed, [
      { kind: "resume", roomId: "r1", userId: "ana" },
      { kind: "resume", roomId: "r2", userId: "ana" },
    ]);
  });
});
