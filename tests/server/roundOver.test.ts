// tests/server/roundOver.test.ts — what server/game/roundOver.ts does *around* the round
// resolution: the pending entry, the final write, the results commit and the broadcast that
// follows it.
//
// The resolution itself is tests/server/roundEnd.test.ts's: match at target, tie
// escalation, draws, the teams pair total and the `bot:<seat>` exclusion are
// all proved against resolveRoundEnd there, and are deliberately not repeated.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { recordingRuntime } from "../helpers/recordingRuntime.ts";
import {
  handleRoundOver,
  voidAbandonedMatch,
  endMatchByAgreement,
  rollMatchForward,
  roundResultsFailureCount,
  roundResultsPendingAgeSeconds,
  type AppliedResults,
  type RoundOverWriters,
} from "../../server/game/roundOver.ts";
import { arm, pending, clearRoomTimers } from "../../server/game/gameTimers.ts";
import { activeGames } from "../../server/game/gameRoom.ts";
import { firstTargetFor } from "../../lib/game/gameEngine.ts";
import { logger } from "../../server/shared/logger.ts";
import { now } from "../../server/http/clock.ts";
import type { OnlineGameState } from "../../server/game/gameRoom.ts";
import type { GameState, Player } from "../../lib/game/gameEngine.ts";
import type { ReplayMove } from "../../lib/game/replay.ts";
import type { PendingResult } from "../../shared/persistedEnvelope.ts";
import { aThreePlayed } from "../support/game.ts";

const ROOM = "room_1";

type Emitted = { room: string; event: string; payload: unknown };

/**
 * A recording runtime whose sends and writer calls share one journal, so a
 * test can assert what ran before what. A writer given an Error rejects with
 * it instead of resolving; `writers` replaces a writer outright.
 */
function stubServer(
  overrides: Partial<Record<keyof RoundOverWriters, Error>> = {},
  writers: Partial<RoundOverWriters> = {}
) {
  const failing = Object.fromEntries(
    Object.entries(overrides).map(([name, failure]) => [name, () => Promise.reject(failure)])
  ) as Partial<RoundOverWriters>;
  const { rt, journal, sent } = recordingRuntime({ writers: { ...failing, ...writers } });
  const calls = () => journal.filter((e) => e.kind === "write");
  return {
    rt,
    get order(): string[] {
      return journal.map((e) => (e.kind === "send" ? e.event : e.name));
    },
    get emitted(): Emitted[] {
      return sent.map((e) => ({ room: "room" in e.to ? e.to.room : "", event: e.event, payload: e.args[0] }));
    },
    names: () => calls().map((c) => c.name),
    of: (name: keyof RoundOverWriters) => calls().filter((c) => c.name === name),
  };
}

/** A commit that writes these ratings for every pending round, as the production writer reports it. */
const committing =
  (ratings: Pick<AppliedResults["applied"][number], "ratings">["ratings"] = { ratingDeltas: {}, ratingsAfter: {} }) =>
  async (_roomId: string, game: OnlineGameState): Promise<AppliedResults> => ({
    applied: game.pendingResults.splice(0).map((entry) => ({ entry, ratings })),
    held: true,
  });

/** A commit that fails before anything lands. */
const failingWith =
  (failure: unknown) =>
  async (): Promise<AppliedResults> => ({ applied: [], held: true, failure });

const transient = () => new Error("Connection terminated unexpectedly");
const permanent = () => Object.assign(new Error("violates check constraint"), { code: "23514" });

function seat(id: string, name: string, cards: number, finishPosition?: number): Player {
  return {
    id,
    name,
    type: "human",
    finishPosition,
    hand: Array.from({ length: cards }, (_, i) => ({
      id: `${id}_c${i}`,
      suit: "hearts" as const,
      rank: "4" as const,
      isJoker: false,
    })),
  };
}

function finishedState(overrides: Partial<GameState> = {}): GameState {
  return {
    players: [seat("player_0", "Alice", 0, 1), seat("player_1", "Bob", 3, 2)],
    currentTurnIndex: 0,
    lastPlayedCombination: null,
    lastPlayedBy: 0,
    passCount: 0,
    gameMode: "free_for_all",
    roundOver: true,
    finishingOrder: ["player_0", "player_1"],
    openingCard: null,
    playedRanks: aThreePlayed(),
    lastMove: { seq: 0, kind: "deal" },
    ...overrides,
  };
}

const A_MOVE: ReplayMove = { seat: 0, combo: null, handCounts: [0, 3] };

function makeGame(overrides: Partial<OnlineGameState> = {}): OnlineGameState {
  return {
    gameState: finishedState(),
    playerMap: { 0: "u_alice", 1: "u_bob" },
    roomId: ROOM,
    joinCode: "ABC123",
    rematchVotes: new Set(["u_alice"]),
    cumulativeScores: {},
    maxPlayers: 2,
    matchTarget: 21,
    matchLength: "match",
    roundsPlayed: 0,
    matchOver: false,
    roundFlags: {},
    abandonedSeats: new Map(),
    botSeatsAtStart: new Set<number>(),
    releasedSeats: new Set<string>(),
    vacatedSeats: new Map(),
    weakSeats: new Set<number>(),
    endMatchVotes: new Set<string>(),
    spectators: new Set(),
    moveLog: [A_MOVE],
    replayOpening: { seq: 1, kind: "giveback", seat: 1 },
    dealFirstSeat: 0,
    pendingResults: [],
    landedResults: new Set(),
    ...overrides,
  };
}

describe("handleRoundOver — the broadcast", () => {
  test("the table is told once, after the round's results commit", async () => {
    const s = stubServer();

    await handleRoundOver(s.rt, ROOM, makeGame());

    assert.deepEqual(s.order, ["persistFinalState", "applyPendingResults", "game:round_over", "game:vote_state"]);
    assert.equal(s.emitted[0].room, ROOM);
  });

  test("game:over carries the resolution the game was updated with", async () => {
    const s = stubServer();
    const game = makeGame();

    await handleRoundOver(s.rt, ROOM, game);

    const payload = s.emitted[0].payload as Record<string, unknown>;
    assert.deepEqual(payload.finishingOrder, ["player_0", "player_1"]);
    assert.equal(payload.matchTarget, game.matchTarget);
    assert.equal(payload.matchOver, game.matchOver);
    assert.equal(payload.matchLength, "match");
    assert.equal(payload.isDraw, false);
    assert.equal(payload.recorded, true);
    assert.equal(payload.roundsPlayed, 1, "the round just decided is counted");
    // One row per seat carries every identity: the totals used to ride
    // alongside as a name -> total map, where two seats sharing a name
    // collapsed into one entry.
    assert.deepEqual(payload.scores, [
      {
        seatIndex: 0,
        engineId: "player_0",
        userId: "u_alice",
        username: "Alice",
        points: 1,
        total: game.cumulativeScores.u_alice,
        vacated: false,
      },
      {
        seatIndex: 1,
        engineId: "player_1",
        userId: "u_bob",
        username: "Bob",
        points: 0,
        total: game.cumulativeScores.u_bob,
        vacated: false,
      },
    ]);
    assert.equal(game.lastRoundOverPayload, payload, "a rejoin is handed the same payload");
  });

  test("game:over carries the ratings the commit wrote", async () => {
    const ratings = {
      ratingDeltas: { u_alice: 14, u_bob: -14 },
      ratingsAfter: { u_alice: { rating: 1014, rounds: 3 }, u_bob: { rating: 986, rounds: 7 } },
    };
    const s = stubServer({}, { applyPendingResults: committing(ratings) });

    await handleRoundOver(s.rt, ROOM, makeGame());

    const payload = s.emitted[0].payload as Record<string, unknown>;
    assert.deepEqual(payload.ratingDeltas, ratings.ratingDeltas);
    assert.deepEqual(payload.ratingsAfter, ratings.ratingsAfter);
  });

  test("game:over waits for the commit, however long it takes", async () => {
    let land!: () => void;
    const landed = new Promise<void>((resolve) => (land = resolve));
    const commit = committing();
    const s = stubServer({}, { applyPendingResults: async (roomId, game) => (await landed, commit(roomId, game)) });

    const over = handleRoundOver(s.rt, ROOM, makeGame());
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(s.emitted.map((e) => e.event), [], "nothing is announced ahead of the commit");

    land();
    await over;
    assert.deepEqual(s.emitted.map((e) => e.event), ["game:round_over", "game:vote_state"]);
  });

  test("a single-round game names the round winner as the match winner", async () => {
    const s = stubServer();
    const game = makeGame({ matchLength: "single" });

    await handleRoundOver(s.rt, ROOM, game);

    const payload = s.emitted[0].payload as Record<string, unknown>;
    assert.equal(payload.matchOver, true, "one round is the whole match");
    assert.deepEqual(payload.matchWinnerIds, ["player_0"], "Alice emptied her hand first");
    assert.equal(payload.isDraw, false);
    assert.equal(payload.matchContinues, true, "a new match is offered with nobody asked");
    assert.equal(game.matchOver, true, "the game carries the same verdict");
  });

  test("the ready gate is emptied so the next round starts from no votes", async () => {
    const s = stubServer();
    const game = makeGame();

    await handleRoundOver(s.rt, ROOM, game);

    assert.equal(game.rematchVotes.size, 0);
  });
});

describe("handleRoundOver — the pending round", () => {
  test("the final write carries the round's entry, and the commit is handed it", async () => {
    const seen: PendingResult[][] = [];
    const s = stubServer({}, {
      persistFinalState: async (_roomId, game) => void seen.push([...game.pendingResults]),
    });
    const game = makeGame();
    const before = now();

    await handleRoundOver(s.rt, ROOM, game);

    assert.deepEqual(s.names(), ["persistFinalState", "applyPendingResults"]);
    const [entry] = seen[0]!;
    assert.equal(seen[0]!.length, 1);
    assert.ok(entry!.finishedAt >= before, "stamped when the round ended");
    assert.equal(entry!.round, entry!.finishedAt, "a round is named by its own end");
    assert.equal(entry!.gameMode, "free_for_all");
    assert.deepEqual(
      entry!.results.map((r) => [r.userId, r.placement]),
      [
        ["u_alice", 1],
        ["u_bob", 2],
      ]
    );
    assert.deepEqual(entry!.seats, [
      { seatIndex: 0, userId: "u_alice", vacatedBy: null, name: "Alice" },
      { seatIndex: 1, userId: "u_bob", vacatedBy: null, name: "Bob" },
    ]);
    assert.deepEqual(entry!.moveLog, [A_MOVE]);
    assert.deepEqual(entry!.opening, { seq: 1, kind: "giveback", seat: 1 });
    assert.deepEqual(entry!.outcome.finishingOrder, ["player_0", "player_1"]);
    assert.equal("ratingDeltas" in entry!.outcome, false, "the ratings are the commit's to name");
    assert.deepEqual(game.pendingResults, [], "the commit took it");
  });

  test("a bot-majority table records nothing, and is told at once", async () => {
    const s = stubServer();
    // One human, three bots — a seat with no playerMap entry is a bot.
    const game = makeGame({
      gameState: finishedState({
        players: [
          seat("player_0", "Alice", 0, 1),
          seat("player_1", "Bot 1", 2, 2),
          seat("player_2", "Bot 2", 3, 3),
          seat("player_3", "Bot 3", 4, 4),
        ],
        finishingOrder: ["player_0", "player_1", "player_2", "player_3"],
      }),
      playerMap: { 0: "u_alice" },
      maxPlayers: 4,
    });

    await handleRoundOver(s.rt, ROOM, game);

    assert.deepEqual(s.order, ["game:round_over", "game:vote_state", "updateRoomStatus", "persistGameState"]);
    assert.deepEqual(game.pendingResults, []);
    assert.equal((s.emitted[0].payload as { recorded: boolean }).recorded, false);
  });

  test("a round with no move log carries none, so it writes no replay", async () => {
    for (const moveLog of [null, []]) {
      const seen: (PendingResult["moveLog"])[] = [];
      const s = stubServer({}, { persistFinalState: async (_r, game) => void seen.push(game.pendingResults[0]!.moveLog) });
      await handleRoundOver(s.rt, ROOM, makeGame({ moveLog }));
      assert.deepEqual(seen, [null]);
    }
  });

  test("two rounds ending in one millisecond are still two rounds", async (t) => {
    t.mock.method(logger, "error", () => undefined);
    const s = stubServer({}, { applyPendingResults: failingWith(permanent()) });
    const game = makeGame();
    await handleRoundOver(s.rt, ROOM, game);
    game.gameState = finishedState();
    await handleRoundOver(s.rt, ROOM, game);
    clearRoomTimers(ROOM);
    const [a, b] = game.pendingResults;
    assert.ok(a && b && b.round > a.round);
  });
});

describe("handleRoundOver — a commit that fails", () => {
  test("one no retry can fix is logged with its entry, counted, and the table is still told", async (t) => {
    const error = t.mock.method(logger, "error", () => undefined);
    const s = stubServer({}, { applyPendingResults: failingWith(permanent()) });
    const game = makeGame();
    const before = roundResultsFailureCount();

    await handleRoundOver(s.rt, ROOM, game);
    clearRoomTimers(ROOM);

    assert.equal(roundResultsFailureCount(), before + 1);
    const logged = error.mock.calls.find((c) => String(c.arguments[1]).includes("failed to commit"));
    assert.ok(logged, "the failure is logged");
    assert.equal((logged!.arguments[0] as { entry: PendingResult }).entry, game.pendingResults[0], "with its payload");
    assert.deepEqual(
      s.emitted.map((e) => e.event),
      ["game:round_over", "game:vote_state"],
      "the table moves on to its next deal"
    );
    const payload = s.emitted[0].payload as Record<string, unknown>;
    assert.deepEqual(payload.ratingDeltas, {});
    assert.deepEqual(payload.ratingsAfter, {});
    assert.equal(game.pendingResults.length, 1, "the round stays pending");
    assert.deepEqual(s.of("updateRoomStatus")[0]?.args, [ROOM, "finished"]);
  });

  test("a transient one retries at 0.5 s, doubling to 5 s, until it commits", async (t) => {
    t.mock.method(logger, "warn", () => undefined);
    t.mock.timers.enable({ apis: ["setTimeout"] });
    let failures = 7;
    const attempts: number[] = [];
    let clock = 0;
    const commit = committing({ ratingDeltas: { u_alice: 5 }, ratingsAfter: {} });
    const s = stubServer({}, {
      applyPendingResults: async (roomId, game) => {
        attempts.push(clock);
        return failures-- > 0 ? failingWith(transient())() : commit(roomId, game);
      },
    });
    const game = makeGame();
    activeGames.set(ROOM, game);
    try {
      await handleRoundOver(s.rt, ROOM, game);
      assert.deepEqual(s.emitted.map((e) => e.event), ["game:round_over", "game:vote_state"], "told at the first failure");
      for (const step of [500, 1_000, 2_000, 4_000, 5_000, 5_000, 5_000]) {
        clock += step;
        t.mock.timers.tick(step);
        for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
      }
      assert.deepEqual(attempts, [0, 500, 1_500, 3_500, 7_500, 12_500, 17_500, 22_500]);
      assert.deepEqual(game.pendingResults, []);
      assert.equal(s.emitted.filter((e) => e.event === "game:round_over").length, 1, "the table is told once");
      t.mock.timers.tick(60_000);
      await new Promise((r) => setImmediate(r));
      assert.equal(attempts.length, 8, "nothing is retried once it committed");
    } finally {
      activeGames.delete(ROOM);
      clearRoomTimers(ROOM);
    }
  });

  test("the next round ending with this one pending keeps both, and commits them oldest first", async (t) => {
    t.mock.method(logger, "error", () => undefined);
    const order: number[] = [];
    let fail = true;
    const commit = committing();
    const s = stubServer({}, {
      applyPendingResults: async (roomId, game) => {
        if (fail) return failingWith(permanent())();
        order.push(...game.pendingResults.map((e) => e.round));
        return commit(roomId, game);
      },
    });
    const game = makeGame();

    await handleRoundOver(s.rt, ROOM, game);
    const first = game.pendingResults[0]!.round;
    game.gameState = finishedState();
    await handleRoundOver(s.rt, ROOM, game);
    assert.equal(game.pendingResults.length, 2, "round N+1 does not replace round N");
    assert.equal(game.pendingResults[0]!.round, first);

    fail = false;
    game.gameState = finishedState();
    await handleRoundOver(s.rt, ROOM, game);
    clearRoomTimers(ROOM);
    assert.equal(order.length, 3);
    assert.deepEqual([...order].sort((a, b) => a - b), order, "applied in the order the rounds ended");
    assert.equal(order[0], first);
  });

  test("the oldest round this process holds reports its age", () => {
    const game = makeGame();
    const finishedAt = now() - 30_000;
    game.pendingResults.push({ ...({} as PendingResult), round: finishedAt, finishedAt });
    activeGames.set(ROOM, game);
    try {
      assert.ok(Math.abs(roundResultsPendingAgeSeconds() - 30) < 1);
    } finally {
      activeGames.delete(ROOM);
    }
    assert.equal(roundResultsPendingAgeSeconds(), 0);
  });
});

/** Arms what a live table holds: both seats' AFK clocks, the bot's turn and both seats' disconnect graces. */
function armLiveTable() {
  arm("afk", `${ROOM}:u_alice`, 600_000, () => {});
  arm("afk", `${ROOM}:u_bob`, 600_000, () => {});
  arm("bot", ROOM, 600_000, () => {});
  arm("disconnect", "u_alice", 600_000, () => {});
  arm("disconnect", "u_bob", 600_000, () => {});
}

function liveTimers() {
  return {
    afk: pending("afk", `${ROOM}:u_alice`) || pending("afk", `${ROOM}:u_bob`),
    bot: pending("bot", ROOM),
    disconnect: pending("disconnect", "u_alice") || pending("disconnect", "u_bob"),
  };
}

describe("handleRoundOver — what a finished round stops and starts", () => {
  test("turn clocks and disconnect graces are cancelled, and the next-round vote gets its deadline", async () => {
    const s = stubServer();
    armLiveTable();
    try {
      await handleRoundOver(s.rt, ROOM, makeGame());

      assert.deepEqual(liveTimers(), { afk: false, bot: false, disconnect: false });
      assert.equal(pending("voteDeadline", ROOM), true, "an unfinished match waits on a vote that expires");
    } finally {
      clearRoomTimers(ROOM);
    }
  });

  test("a round that ends the match offers no next-round vote and arms no deadline", async () => {
    const s = stubServer();
    try {
      await handleRoundOver(s.rt, ROOM, makeGame({ matchLength: "single" }));

      assert.deepEqual(
        s.emitted.map((e) => e.event),
        ["game:round_over"]
      );
      assert.equal(pending("voteDeadline", ROOM), false);
    } finally {
      clearRoomTimers(ROOM);
    }
  });

});

describe("closing a match without scoring", () => {
  const closedPayload = (voided: boolean) => ({
    finishingOrder: [],
    scores: [],
    matchTarget: 21,
    matchLength: "match",
    roundsPlayed: 2,
    matchOver: true,
    matchWinnerIds: [],
    matchContinues: false,
    isDraw: false,
    ratingDeltas: {},
    ratingsAfter: {},
    recorded: false,
    voided,
  });
  const midMatch = () =>
    makeGame({
      roundsPlayed: 2,
      cumulativeScores: { u_alice: 5, u_bob: 3 },
      gameState: finishedState({ roundOver: false, finishingOrder: [] }),
    });

  test("an abandoned match is voided: told to the table, scored for nobody, kept as voided", async () => {
    const s = stubServer();
    const game = midMatch();
    armLiveTable();
    try {
      await voidAbandonedMatch(s.rt, ROOM, game);

      assert.deepEqual(s.emitted.map((e) => e.event), ["game:round_over"]);
      assert.deepEqual(s.emitted[0].payload, closedPayload(true));
      assert.equal(game.lastRoundOverPayload, s.emitted[0].payload, "a rejoin is handed the same payload");
      assert.equal(game.matchOver, true);
      assert.equal(game.endedByVote, undefined, "a void is not an agreement");
      assert.equal(game.gameState.roundOver, true);
      assert.equal(game.roundsPlayed, 2, "the round in progress is not counted");
      assert.deepEqual(game.cumulativeScores, { u_alice: 5, u_bob: 3 });
      assert.deepEqual(liveTimers(), { afk: false, bot: false, disconnect: false });
      assert.deepEqual(s.names(), ["updateRoomStatus", "persistGameState"]);
      assert.deepEqual(s.of("updateRoomStatus")[0].args, [ROOM, "finished"]);
      assert.equal(s.of("persistGameState")[0].args[1], game);
    } finally {
      clearRoomTimers(ROOM);
    }
  });

  test("a match ended by agreement says so, and nothing in progress is scored", async () => {
    const s = stubServer();
    const game = midMatch();
    armLiveTable();
    try {
      await endMatchByAgreement(s.rt, ROOM, game);

      assert.deepEqual(s.emitted[0].payload, closedPayload(false));
      assert.equal(game.endedByVote, true);
      assert.equal(game.matchOver, true);
      assert.equal(game.roundsPlayed, 2);
      assert.deepEqual(liveTimers(), { afk: false, bot: false, disconnect: false });
      assert.deepEqual(s.names(), ["updateRoomStatus", "persistGameState"]);
    } finally {
      clearRoomTimers(ROOM);
    }
  });

  test("a failing room-status write does not stop the row being written", async (t) => {
    t.mock.method(logger, "warn", () => undefined);
    const s = stubServer({ updateRoomStatus: new Error("no rooms row") });

    await endMatchByAgreement(s.rt, ROOM, midMatch());

    assert.equal(s.of("persistGameState").length, 1);
  });
});

describe("rollMatchForward", () => {
  test("a finished match starts over from nothing at the opening target", () => {
    const game = makeGame({
      matchOver: true,
      matchTarget: 51,
      roundsPlayed: 4,
      cumulativeScores: { u_alice: 52, u_bob: 10 },
    });

    rollMatchForward(game);

    assert.equal(game.matchOver, false);
    assert.equal(game.roundsPlayed, 0);
    assert.deepEqual(game.cumulativeScores, {});
    assert.equal(game.matchTarget, firstTargetFor(2));
  });

  test("an unfinished match carries on untouched", () => {
    const game = makeGame({ matchOver: false, matchTarget: 51, roundsPlayed: 4, cumulativeScores: { u_alice: 20 } });

    rollMatchForward(game);

    assert.equal(game.matchOver, false);
    assert.equal(game.roundsPlayed, 4);
    assert.deepEqual(game.cumulativeScores, { u_alice: 20 });
    assert.equal(game.matchTarget, 51);
  });
});
