import { describe, test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { activeGames, seatedVoters, voteStateOf, type OnlineGameState } from "../../server/game/gameRoom.ts";
import { clearAllTimersForUser, clearRoomTimers } from "../../server/game/gameTimers.ts";
import { roomStore } from "../../server/store/roomStore.ts";
import { refuse } from "../../server/shared/refusal.ts";
import type { Room } from "../../shared/schema.ts";
import { clearRematchVotes } from "../../server/game/matchLedger.ts";
import { startRound } from "../../lib/game/gameEngine.ts";
import { useMemoryTableStores } from "../helpers/memoryTableStores.ts";
import { emitEndMatchVoteState } from "../../server/game/tableBroadcasts.ts";
import {
  dealIfSeatLeftGateClosed,
  everySeatedVoted,
  expireVoteDeadline,
  rematchVoteAction,
} from "../../server/game/tableVotes.ts";
import { onlineTable } from "../helpers/onlineTable.ts";
import { recordingRuntime } from "../helpers/recordingRuntime.ts";

type Seat = "human" | "bot" | "vacated";

function* rosters(size: number): Generator<Seat[]> {
  if (size === 0) return yield [];
  for (const rest of rosters(size - 1)) for (const seat of ["human", "bot", "vacated"] as const) yield [...rest, seat];
}

function* subsets<T>(items: T[]): Generator<T[]> {
  for (let mask = 0; mask < 1 << items.length; mask++) yield items.filter((_, i) => mask & (1 << i));
}

test("everySeatedVoted agrees with both counts it replaced, on every table and every tally", () => {
  let cases = 0;
  for (const playerCount of [2, 3, 4]) {
    for (const roster of rosters(playerCount)) {
      const playerMap: Record<number, string> = {};
      roster.forEach((seat, i) => {
        if (seat === "human") playerMap[i] = `u${i}`;
      });
      const vacatedSeats = new Map(
        roster.flatMap((seat, i) => (seat === "vacated" ? [[i, { userId: `gone${i}`, username: "" }] as const] : []))
      );
      const game = onlineTable({ roomId: "votes", playerMap, vacatedSeats });
      for (const voters of subsets(Object.values(playerMap))) {
        const votes = new Set(voters);
        const rematchAndEndMatch = votes.size >= Object.keys(game.playerMap).length;
        const newMatch = Object.values(game.playerMap).every((uid) => votes.has(uid));
        assert.equal(everySeatedVoted(votes, game), rematchAndEndMatch, `${roster.join(",")} / ${voters.join(",")}`);
        assert.equal(everySeatedVoted(votes, game), newMatch, `${roster.join(",")} / ${voters.join(",")}`);
        cases++;
      }
    }
  }
  assert.ok(cases > 100, `only ${cases} tallies checked`);
});

describe("a tally holding an id no seat holds", () => {
  const table = () =>
    onlineTable({
      roomId: "stray-vote",
      playerMap: { 0: "u0", 1: "u1" },
      gameState: { roundOver: true, players: [{ name: "U0" }, { name: "U1" }] } as never,
      rematchVotes: new Set(["stranger"]),
    });

  test("passes the old size count and fails everySeatedVoted", () => {
    const game = table();
    const votes = new Set(["u0", "stranger"]);
    assert.equal(votes.size >= Object.keys(game.playerMap).length, true);
    assert.equal(everySeatedVoted(votes, game), false);
  });

  test("does not close the rematch gate", async () => {
    const game = table();
    let roomReads = 0;
    const { rt } = recordingRuntime({
      store: {
        rooms: {
          getRoomById: async () => {
            roomReads++;
            return undefined;
          },
        } as never,
      },
    });
    const outcome = await rematchVoteAction(rt, game, { id: "v1", kind: "rematchVote", roomId: game.roomId, userId: "u0" });
    assert.deepEqual(outcome, { ok: true });
    assert.equal(roomReads, 0, "a gate the stray vote closed would read the room to deal");
    assert.deepEqual([...game.rematchVotes].sort(), ["stranger", "u0"]);
  });
});

test("every vote payload's total is the seated-voter set the gate counts", () => {
  const game = onlineTable({
    roomId: "totals",
    playerMap: { 0: "u0", 2: "u2" },
    vacatedSeats: new Map([[1, { userId: "gone", username: "" }]]),
  });
  assert.deepEqual([...seatedVoters(game)].sort(), ["u0", "u2"]);
  assert.equal(everySeatedVoted(new Set(seatedVoters(game)), game), true);
  assert.equal(voteStateOf(game).total, seatedVoters(game).length);
  const sent: unknown[] = [];
  emitEndMatchVoteState({ emit: (_event, ...args) => void sent.push(args[0]) }, game);
  assert.deepEqual(sent, [{ votes: [], total: seatedVoters(game).length }]);
});

describe("the next-round vote at a table between rounds", () => {
  const ROOM = "table-votes-room";
  const USERS = ["ana", "besi", "carl"];
  const SEATS = USERS.map((name, i) => ({ name, type: "human" as const, id: `player_${i}` }));

  afterEach(() => {
    for (const userId of USERS) clearAllTimersForUser(userId, ROOM);
    clearRoomTimers(ROOM);
    activeGames.delete(ROOM);
  });

  const roomRow: [string, Partial<Room>] = [
    ROOM,
    { code: "AAAAAA", gameMode: "free_for_all", maxPlayers: 3, status: "finished", hostUserId: "ana" },
  ];
  const seatRows: [string, { userId: string; seatIndex: number; user: never }[]] = [
    ROOM,
    USERS.map((userId, seatIndex) => ({ userId, seatIndex, user: { id: userId, username: userId } as never })),
  ];

  function overTable(overrides: Partial<OnlineGameState> = {}) {
    const game = onlineTable({
      roomId: ROOM,
      maxPlayers: 3,
      roundsPlayed: 1,
      playerMap: { 0: "ana", 1: "besi", 2: "carl" },
      gameState: {
        ...startRound(SEATS, "free_for_all"),
        roundOver: true,
        finishingOrder: ["player_0", "player_1", "player_2"],
      },
      ...overrides,
    });
    activeGames.set(ROOM, game);
    return game;
  }

  const ballot = (userId: string) => ({ id: `v-${userId}`, kind: "rematchVote" as const, roomId: ROOM, userId });
  const started = (sent: { event: string }[]) => sent.filter((e) => e.event === "game:started");
  const voteStates = (sent: { event: string; payload: unknown }[]) =>
    sent.filter((e) => e.event === "game:vote_state").map((e) => e.payload);

  test("a vote before any round has finished is refused and recorded nowhere", async (t) => {
    useMemoryTableStores(t, { rooms: [roomRow], seats: [seatRows] });
    const { rt, sent } = recordingRuntime();
    const game = overTable({ gameState: { ...startRound(SEATS, "free_for_all"), roundOver: false } });
    assert.deepEqual(await rematchVoteAction(rt, game, ballot("ana")), { ok: false, code: "NO_LIVE_GAME" });
    assert.equal(game.rematchVotes.size, 0);
    assert.deepEqual(sent, []);
  });

  test("a vote from a user holding no seat is refused and recorded nowhere", async (t) => {
    useMemoryTableStores(t, { rooms: [roomRow], seats: [seatRows] });
    const { rt, sent } = recordingRuntime();
    const game = overTable();
    assert.deepEqual(await rematchVoteAction(rt, game, ballot("stranger")), { ok: false, code: "NOT_SEATED" });
    assert.equal(game.rematchVotes.size, 0);
    assert.deepEqual(sent, []);
  });

  test("every vote tells the room who has voted, out of the seats that can answer", async (t) => {
    useMemoryTableStores(t, { rooms: [roomRow], seats: [seatRows] });
    const { rt, sent } = recordingRuntime();
    const game = overTable();
    await rematchVoteAction(rt, game, ballot("ana"));
    await rematchVoteAction(rt, game, ballot("besi"));
    assert.deepEqual(voteStates(sent), [
      { votes: ["ana"], total: 3 },
      { votes: ["ana", "besi"], total: 3 },
    ]);
    assert.ok(sent.every((e) => "room" in e.to && e.to.room === ROOM));
    assert.equal(started(sent).length, 0, "two of three must not deal");
  });

  test("the last vote deals the next round once, clears the votes and keeps every seat", async (t) => {
    useMemoryTableStores(t, { rooms: [roomRow], seats: [seatRows] });
    const { rt, sent } = recordingRuntime();
    const game = overTable();
    await rematchVoteAction(rt, game, ballot("ana"));
    await rematchVoteAction(rt, game, ballot("besi"));
    assert.deepEqual(await rematchVoteAction(rt, game, ballot("carl")), { ok: true });
    assert.equal(started(sent).length, 1);
    assert.equal(game.gameState.roundOver, false);
    assert.equal(game.rematchVotes.size, 0);
    assert.deepEqual(game.playerMap, { 0: "ana", 1: "besi", 2: "carl" });
  });

  test("a table whose room row is gone refuses the deal, shows the voter why, and keeps the votes", async (t) => {
    useMemoryTableStores(t, { seats: [seatRows] });
    const { rt, sent } = recordingRuntime();
    const game = overTable({ rematchVotes: new Set(["ana", "besi"]) });
    assert.deepEqual(await rematchVoteAction(rt, game, ballot("carl")), refuse("ROOM_NOT_FOUND"));
    assert.equal(started(sent).length, 0);
    assert.equal(game.gameState.roundOver, true);
    assert.deepEqual([...game.rematchVotes].sort(), ["ana", "besi", "carl"]);
    assert.deepEqual(voteStates(sent).at(-1), { votes: ["ana", "besi", "carl"], total: 3 });
  });

  test("a round with fewer than two seats refuses the deal and keeps the votes", async (t) => {
    useMemoryTableStores(t, { rooms: [roomRow], seats: [seatRows] });
    const { rt, sent } = recordingRuntime();
    const game = overTable({
      playerMap: { 0: "ana" },
      gameState: { ...startRound(SEATS.slice(0, 1), "free_for_all"), roundOver: true, finishingOrder: ["player_0"] },
    });
    assert.deepEqual(await rematchVoteAction(rt, game, ballot("ana")), refuse("MIN_PLAYERS_REQUIRED"));
    assert.equal(started(sent).length, 0);
    assert.equal(game.gameState.roundOver, true);
    assert.deepEqual([...game.rematchVotes], ["ana"]);
  });

  test("a gate closed by a seat leaving that cannot deal answers without a notice for anyone", async (t) => {
    useMemoryTableStores(t, { seats: [seatRows] });
    const { rt, sent } = recordingRuntime();
    overTable({
      playerMap: { 0: "ana", 1: "besi" },
      vacatedSeats: new Map([[2, { userId: "carl", username: "carl" }]]),
      rematchVotes: new Set(["ana", "besi"]),
    });
    assert.deepEqual(await dealIfSeatLeftGateClosed(rt, ROOM), { ok: false, code: "ROOM_NOT_FOUND" });
    assert.deepEqual(voteStates(sent), [{ votes: ["ana", "besi"], total: 2 }]);
  });

  test("a seat leaving after the others voted deals the next round", async (t) => {
    useMemoryTableStores(t, { rooms: [roomRow], seats: [seatRows] });
    const { rt, sent } = recordingRuntime();
    const game = overTable({
      playerMap: { 0: "ana", 1: "besi" },
      vacatedSeats: new Map([[2, { userId: "carl", username: "carl" }]]),
      rematchVotes: new Set(["ana", "besi"]),
    });
    assert.deepEqual(await dealIfSeatLeftGateClosed(rt, ROOM), { ok: true });
    assert.equal(started(sent).length, 1);
    assert.equal(game.gameState.roundOver, false);
  });

  describe("a gate that must stay shut", () => {
    const cases: [string, () => OnlineGameState | undefined][] = [
      ["no table at the room", () => undefined],
      ["the round is still being played", () => overTable({
        gameState: { ...startRound(SEATS, "free_for_all"), roundOver: false },
        rematchVotes: new Set(USERS),
      })],
      ["a seated human has not voted", () => overTable({ rematchVotes: new Set(["ana", "besi"]) })],
      ["the match was ended by the vote", () => overTable({ rematchVotes: new Set(USERS), endedByVote: true })],
      ["nobody holds a seat", () => overTable({ playerMap: {}, vacatedSeats: new Map(), rematchVotes: new Set() })],
    ];
    for (const [name, build] of cases) {
      test(name, async (t) => {
        useMemoryTableStores(t, { rooms: [roomRow], seats: [seatRows] });
        const { rt, sent } = recordingRuntime();
        const game = build();
        assert.deepEqual(await dealIfSeatLeftGateClosed(rt, ROOM), { ok: true });
        assert.equal(started(sent).length, 0);
        assert.deepEqual(sent, []);
        if (game) assert.equal(game.gameState.roundOver, !name.includes("still being played"));
      });
    }
  });

  describe("two gate-closers racing for one deal", () => {
    test("the second finds the votes already cleared and deals nothing", async (t) => {
      useMemoryTableStores(t, { rooms: [roomRow], seats: [seatRows] });
      const { rt, sent } = recordingRuntime();
      const game = overTable({ rematchVotes: new Set(["ana", "besi"]) });
      const read = roomStore.getRoomById;
      t.mock.method(roomStore, "getRoomById", async (...args: Parameters<typeof read>) => {
        const room = await read(...args);
        clearRematchVotes(game);
        return room;
      });
      assert.deepEqual(await rematchVoteAction(rt, game, ballot("carl")), { ok: true });
      assert.equal(started(sent).length, 0);
      assert.equal(game.gameState.roundOver, true);
    });

    test("a round restarted while the room was read is not dealt over", async (t) => {
      useMemoryTableStores(t, { rooms: [roomRow], seats: [seatRows] });
      const { rt, sent } = recordingRuntime();
      const game = overTable({ rematchVotes: new Set(["ana", "besi"]) });
      const restarted = { ...startRound(SEATS, "free_for_all"), roundOver: false };
      const read = roomStore.getRoomById;
      t.mock.method(roomStore, "getRoomById", async (...args: Parameters<typeof read>) => {
        const room = await read(...args);
        game.gameState = restarted;
        return room;
      });
      assert.deepEqual(await rematchVoteAction(rt, game, ballot("carl")), { ok: true });
      assert.equal(started(sent).length, 0);
      assert.equal(game.gameState, restarted);
      assert.deepEqual([...game.rematchVotes].sort(), ["ana", "besi", "carl"]);
    });
  });

  describe("the vote deadline", () => {
    test("takes the seats that did not vote and deals for the rest", async (t) => {
      const { seats } = useMemoryTableStores(t, { rooms: [roomRow], seats: [seatRows] });
      const { rt, sent } = recordingRuntime();
      const restore = t.mock.method(roomStore, "restoreSeat", roomStore.restoreSeat);
      const game = overTable({ rematchVotes: new Set(["ana"]) });
      await expireVoteDeadline(rt, ROOM);
      assert.deepEqual(game.playerMap, { 0: "ana" });
      assert.deepEqual([...game.vacatedSeats.keys()].sort(), [1, 2]);
      assert.deepEqual(seats.get(ROOM)?.map((s) => s.userId), ["ana"]);
      assert.equal(restore.mock.callCount(), 0, "a seat nobody reclaimed is not put back");
      assert.equal(started(sent).length, 1);
      assert.equal(game.gameState.roundOver, false);
    });

    const idle: [string, Partial<OnlineGameState>][] = [
      ["the round is still being played", { gameState: { ...startRound(SEATS, "free_for_all"), roundOver: false } }],
      ["the match is over", { matchOver: true }],
      ["the match was ended by the vote", { endedByVote: true }],
    ];
    for (const [name, overrides] of idle) {
      test(`takes nobody's seat when ${name}`, async (t) => {
        useMemoryTableStores(t, { rooms: [roomRow], seats: [seatRows] });
        const { rt, sent } = recordingRuntime();
        const game = overTable({ rematchVotes: new Set(["ana"]), ...overrides });
        await expireVoteDeadline(rt, ROOM);
        assert.deepEqual(game.playerMap, { 0: "ana", 1: "besi", 2: "carl" });
        assert.equal(game.vacatedSeats.size, 0);
        assert.deepEqual(sent, []);
      });
    }

    test("spares a seat whose vote lands while an earlier seat is being released", async (t) => {
      useMemoryTableStores(t, { rooms: [roomRow], seats: [seatRows] });
      const { rt, sent } = recordingRuntime();
      const game = overTable();
      const release = roomStore.releaseSeat;
      let first = true;
      t.mock.method(roomStore, "releaseSeat", async (...args: Parameters<typeof release>) => {
        if (first) {
          first = false;
          await rematchVoteAction(rt, game, ballot("carl"));
        }
        return release(...args);
      });
      await expireVoteDeadline(rt, ROOM);
      assert.deepEqual(game.playerMap, { 2: "carl" });
      assert.equal(started(sent).length, 1, "carl alone is a unanimous table");
    });

    test("stops when the round restarts under it, leaving the late voter seated", async (t) => {
      useMemoryTableStores(t, { rooms: [roomRow], seats: [seatRows] });
      const { rt, sent } = recordingRuntime();
      const game = overTable({ rematchVotes: new Set(["ana"]) });
      const release = roomStore.releaseSeat;
      let first = true;
      t.mock.method(roomStore, "releaseSeat", async (...args: Parameters<typeof release>) => {
        if (first) {
          first = false;
          await rematchVoteAction(rt, game, ballot("carl"));
        }
        return release(...args);
      });
      await expireVoteDeadline(rt, ROOM);
      assert.deepEqual(game.playerMap, { 0: "ana", 2: "carl" });
      assert.equal(started(sent).length, 1, "dealt once, by the vote that closed the gate");
    });

    test("stops when another table has taken the room under it", async (t) => {
      useMemoryTableStores(t, { rooms: [roomRow], seats: [seatRows] });
      const { rt } = recordingRuntime();
      const game = overTable({ rematchVotes: new Set(["ana"]) });
      const successor = overTable();
      activeGames.set(ROOM, game);
      const release = roomStore.releaseSeat;
      t.mock.method(roomStore, "releaseSeat", async (...args: Parameters<typeof release>) => {
        activeGames.set(ROOM, successor);
        return release(...args);
      });
      await expireVoteDeadline(rt, ROOM);
      assert.deepEqual(successor.playerMap, { 0: "ana", 1: "besi", 2: "carl" });
      assert.deepEqual(game.playerMap, { 0: "ana", 2: "carl" });
    });

    test("puts a reclaimed seat back as non-host when its release failed", async (t) => {
      const { rooms } = useMemoryTableStores(t, { rooms: [roomRow], seats: [seatRows] });
      const { rt } = recordingRuntime();
      const restore = t.mock.method(roomStore, "restoreSeat", roomStore.restoreSeat);
      const game = overTable({ rematchVotes: new Set(["ana", "carl"]) });
      t.mock.method(roomStore, "releaseSeat", async () => {
        await rt.route({ kind: "rejoin", roomId: ROOM, userId: "besi" });
        throw new Error("pool down");
      });
      await expireVoteDeadline(rt, ROOM);
      assert.deepEqual(game.playerMap, { 0: "ana", 1: "besi", 2: "carl" });
      assert.deepEqual(restore.mock.calls.map((c) => c.arguments), [[ROOM, "besi", 1, false]]);
      assert.equal(rooms.get(ROOM)?.hostUserId, "ana");
    });

    test("puts a reclaimed host seat back as host", async (t) => {
      const { rooms } = useMemoryTableStores(t, { rooms: [roomRow], seats: [seatRows] });
      const { rt } = recordingRuntime();
      const restore = t.mock.method(roomStore, "restoreSeat", roomStore.restoreSeat);
      const game = overTable({ rematchVotes: new Set(["besi", "carl"]) });
      const release = roomStore.releaseSeat;
      t.mock.method(roomStore, "releaseSeat", async (...args: Parameters<typeof release>) => {
        await rt.route({ kind: "rejoin", roomId: ROOM, userId: "ana" });
        return release(...args);
      });
      await expireVoteDeadline(rt, ROOM);
      assert.deepEqual(game.playerMap, { 0: "ana", 1: "besi", 2: "carl" });
      assert.deepEqual(restore.mock.calls.map((c) => c.arguments), [[ROOM, "ana", 0, true]]);
      assert.equal(rooms.get(ROOM)?.hostUserId, "ana");
    });
  });
});
