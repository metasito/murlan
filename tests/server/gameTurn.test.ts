// What armTurn, armTurnIfIdle, heldRoundFor and vacateSeat do to a table, seen from the clock, the
// room's broadcasts and the table's state. Fixed `dealt` hands, so no test rests on a shuffle.
import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { recordingRuntime } from "../helpers/recordingRuntime.ts";
import { onlineTable } from "../helpers/onlineTable.ts";
import { fakeClock, type FakeClock } from "../helpers/fakeClock.ts";
import { armTurn, armTurnIfIdle, heldRoundFor, vacateSeat } from "../../server/game/gameTurn.ts";
import { activeGames, type OnlineGameState } from "../../server/game/gameRoom.ts";
import { arm, clearRoomTimers, deadline, pending, seatKey } from "../../server/game/gameTimers.ts";
import { castRematchVote } from "../../server/game/matchLedger.ts";
import { installClock } from "../../server/http/clock.ts";
import { actingSeat, createDeck, startRound, type GameState, type Opening } from "../../lib/game/gameEngine.ts";
import { autoMoveForSeat } from "../../lib/game/autoMove.ts";

const ROOM = "game-turn-room";
const AFK_MS = 45_000;
const THINK_MS = 700;
const NAMES = ["Ana", "Ben", "Cai", "Dee"];

let restoreClock = () => {};
const rooms = new Set<string>([ROOM]);

afterEach(() => {
  for (const room of rooms) {
    clearRoomTimers(room);
    activeGames.delete(room);
  }
  delete process.env.MURLAN_AFK_TIMEOUT_MS;
  delete process.env.MURLAN_BOT_MOVE_DELAY_MS;
  restoreClock();
});

function setup() {
  const clock = fakeClock();
  restoreClock = installClock(clock);
  process.env.MURLAN_AFK_TIMEOUT_MS = String(AFK_MS);
  process.env.MURLAN_BOT_MOVE_DELAY_MS = String(THINK_MS);
  return { clock, ...recordingRuntime() };
}

/** A round dealt from fixed hands: seats in `humans` are people, the rest vacant (a bot's). */
function dealt(humans: readonly number[], opening?: Opening, seatCount = 4): GameState {
  const deck = createDeck();
  const seats = Array.from({ length: seatCount }, (_, i) => ({
    name: NAMES[i]!,
    type: humans.includes(i) ? ("human" as const) : ("bot" as const),
    id: `player_${i}`,
  }));
  return startRound(seats, "free_for_all", {
    dealt: seats.map((_, s) => deck.filter((_, i) => i % seats.length === s)),
    opening,
  });
}

/** Past the opening: someone has played, so no gate holds the seat now on move. */
function afterOpening(state: GameState): GameState {
  const played = autoMoveForSeat(state, actingSeat(state), "floor");
  assert.ok(played, "the opener had no move");
  return played.state;
}

function seat(state: GameState, humans: readonly number[], overrides: Partial<OnlineGameState> = {}, roomId = ROOM) {
  const playerMap = Object.fromEntries(humans.map((s) => [s, NAMES[s]!.toLowerCase()]));
  const game = onlineTable({ roomId, gameState: state, playerMap, ...overrides });
  rooms.add(roomId);
  activeGames.set(roomId, game);
  return game;
}

const deadlines = (events: (name: string) => unknown[]) =>
  events("game:turn_deadline") as { turnDeadlineMs: number | undefined; turnSecondsRemaining: number }[];

describe("armTurn on a seat a person holds", () => {
  test("gives the person a clock of the AFK window and tells the room how long is left", () => {
    const { rt, clock, events } = setup();
    const state = afterOpening(dealt([0, 1, 2, 3]));
    const mover = actingSeat(state);
    const game = seat(state, [0, 1, 2, 3]);

    armTurn(rt, ROOM);

    assert.equal(game.turnDeadlineMs, clock.now() + AFK_MS);
    assert.deepEqual(deadlines(events), [{ turnDeadlineMs: clock.now() + AFK_MS, turnSecondsRemaining: AFK_MS / 1000 }]);
    assert.equal(pending("afk", seatKey(ROOM, NAMES[mover]!.toLowerCase())), true);
    assert.equal(pending("bot", ROOM), false, "a person's turn was handed to the bot");
  });

  test("lets the AFK window run to its end, then plays the seat at the floor and says so", () => {
    const { rt, clock, events } = setup();
    const state = afterOpening(dealt([0, 1, 2, 3]));
    const mover = actingSeat(state);
    const game = seat(state, [0, 1, 2, 3]);
    const seq = game.gameState.lastMove.seq;
    armTurn(rt, ROOM);

    clock.advance(AFK_MS - 1);
    assert.equal(game.gameState.lastMove.seq, seq, "the seat was played before its window ran out");
    assert.deepEqual(events("game:notification"), []);

    clock.advance(1);
    assert.equal(game.gameState.lastMove.seq, seq + 1);
    const [note] = events("game:notification") as { type: string; code: string; params: unknown }[];
    assert.equal(events("game:notification").length, 1);
    assert.equal(note?.type, "afk");
    assert.equal(note?.code, "PLAYER_AFK_AUTO_PASS");
    assert.deepEqual(note?.params, { username: NAMES[mover] });
  });

  test("an AFK exchange giver is made to give, and the notice says an exchange", () => {
    const { rt, clock, events } = setup();
    const state = dealt([0, 1, 2, 3], { kind: "exchange", winnerSeat: 0, loserSeat: 3 });
    const game = seat(state, [0, 1, 2, 3]);
    assert.equal(game.gameState.exchangePhase?.kind, "open");
    armTurn(rt, ROOM);

    clock.advance(game.turnDeadlineMs! - clock.now());

    assert.equal(game.gameState.exchangePhase?.kind, "settled");
    const [note] = events("game:notification") as { code: string; params: unknown }[];
    assert.equal(note?.code, "PLAYER_AFK_AUTO_EXCHANGE");
    assert.deepEqual(note?.params, { username: NAMES[0] });
  });

  test("a seat that changed hands before the window ended is not played, and nothing is announced", () => {
    const { rt, clock, events } = setup();
    const state = afterOpening(dealt([0, 1, 2, 3]));
    const mover = actingSeat(state);
    const game = seat(state, [0, 1, 2, 3]);
    const seq = game.gameState.lastMove.seq;
    armTurn(rt, ROOM);
    (game.playerMap as Record<number, string>)[mover] = "someone-else";

    clock.advance(AFK_MS);

    assert.equal(game.gameState.lastMove.seq, seq);
    assert.deepEqual(events("game:notification"), []);
  });

  test("an opener who never plays is made to lead, and that is announced as a move, not an exchange", () => {
    const { rt, clock, events } = setup();
    const game = seat(dealt([0, 1, 2, 3]), [0, 1, 2, 3]);
    const opener = actingSeat(game.gameState);
    armTurn(rt, ROOM);

    clock.advance(game.turnDeadlineMs! - clock.now());

    assert.notEqual(game.gameState.lastPlayedCombination, null, "the opener was not made to lead");
    const [note] = events("game:notification") as { code: string; params: unknown }[];
    assert.equal(note?.code, "PLAYER_AFK_AUTO_PASS");
    assert.deepEqual(note?.params, { username: NAMES[opener] });
  });

  test("a round that ended under an AFK window is not played on, and the table stays", () => {
    const { rt, clock, events, writes } = setup();
    const game = seat(afterOpening(dealt([0, 1, 2, 3])), [0, 1, 2, 3]);
    armTurn(rt, ROOM);
    game.gameState = { ...game.gameState, roundOver: true };
    const before = game.gameState;

    clock.advance(AFK_MS);

    assert.equal(game.gameState, before);
    assert.deepEqual(events("game:notification"), []);
    assert.deepEqual(writes("updateRoomStatus"), []);
    assert.equal(activeGames.has(ROOM), true);
  });

  test("a table that is gone when an AFK window ends is left alone", () => {
    const { rt, clock, writes } = setup();
    seat(afterOpening(dealt([0, 1, 2, 3])), [0, 1, 2, 3]);
    armTurn(rt, ROOM);
    activeGames.delete(ROOM);

    clock.advance(AFK_MS);

    assert.deepEqual(writes("updateRoomStatus"), []);
  });

  test("a seat the engine has no move for is not announced as played", () => {
    const { rt, clock, events } = setup();
    const state = afterOpening(dealt([0, 1, 2, 3]));
    const mover = actingSeat(state);
    const game = seat(state, [0, 1, 2, 3]);
    armTurn(rt, ROOM);
    game.gameState.players[mover]!.hand = [];
    const seq = game.gameState.lastMove.seq;

    clock.advance(AFK_MS);

    assert.equal(game.gameState.lastMove.seq, seq);
    assert.deepEqual(events("game:notification"), []);
    assert.equal(activeGames.has(ROOM), true, "the table was closed over a move the AFK window could not make");
  });
});

describe("armTurn on a vacant seat", () => {
  test("gives it no clock, tells the room so, and plays it after the bot's think", () => {
    const { rt, clock, events } = setup();
    const state = afterOpening(dealt([]));
    const game = seat(state, []);
    game.turnDeadlineMs = clock.now() + 99_000;
    const seq = game.gameState.lastMove.seq;

    armTurn(rt, ROOM);

    assert.equal(game.turnDeadlineMs, undefined);
    assert.deepEqual(deadlines(events), [{ turnDeadlineMs: undefined, turnSecondsRemaining: 0 }]);
    assert.equal(pending("bot", ROOM), true);
    assert.equal(deadline("bot", ROOM), clock.now() + THINK_MS);

    clock.advance(THINK_MS - 1);
    assert.equal(game.gameState.lastMove.seq, seq, "the bot moved before its think was over");
    clock.advance(1);
    assert.equal(game.gameState.lastMove.seq > seq, true, "the bot never moved");
  });

  test("plays nothing when the round has ended under its timer, and does not close the table", () => {
    const { rt, clock } = setup();
    const game = seat(afterOpening(dealt([])), []);
    armTurn(rt, ROOM);
    game.gameState = { ...game.gameState, roundOver: true };
    const before = game.gameState;

    clock.advance(THINK_MS);

    assert.equal(game.gameState, before);
    assert.equal(activeGames.has(ROOM), true);
  });

  test("does nothing when the table is gone by the time its timer fires", () => {
    const { rt, clock, writes } = setup();
    seat(afterOpening(dealt([])), []);
    armTurn(rt, ROOM);
    activeGames.delete(ROOM);

    clock.advance(THINK_MS);

    assert.deepEqual(writes("updateRoomStatus"), [], "a missing table was closed as if it had failed");
  });

  test("closes the table, saying why, when the vacant seat has no move to make", () => {
    const { rt, clock, events, writes } = setup();
    const game = seat(afterOpening(dealt([])), []);
    armTurn(rt, ROOM);
    game.gameState.players[actingSeat(game.gameState)]!.hand = [];

    clock.advance(THINK_MS);

    assert.equal(activeGames.has(ROOM), false);
    assert.deepEqual(
      writes("updateRoomStatus").map((w) => w.args),
      [[ROOM, "finished"]]
    );
    const [note] = events("game:notification") as { type: string; code: string }[];
    assert.equal(note?.type, "abandoned");
    assert.equal(note?.code, "GAME_INTERRUPTED_EMPTY_SEAT");
  });
});

describe("armTurnIfIdle", () => {
  test("leaves a pending bot timer where it is and only repeats the deadline", () => {
    const { rt, clock, events } = setup();
    seat(afterOpening(dealt([])), []);
    armTurn(rt, ROOM);
    const armedFor = deadline("bot", ROOM);
    clock.advance(300);

    armTurnIfIdle(rt, ROOM);

    assert.equal(deadline("bot", ROOM), armedFor, "a rejoin pushed the bot's move back");
    assert.equal(deadlines(events).length, 2);
  });

  test("never hands the person on move a fresh AFK window while theirs is running", () => {
    const { rt, clock, events } = setup();
    const game = seat(afterOpening(dealt([0, 1, 2, 3])), [0, 1, 2, 3]);
    armTurn(rt, ROOM);
    const armedFor = game.turnDeadlineMs;
    clock.advance(10_000);

    armTurnIfIdle(rt, ROOM);

    assert.equal(game.turnDeadlineMs, armedFor, "a rejoin gave the seat a fresh window");
    const last = deadlines(events).at(-1);
    assert.equal(last?.turnDeadlineMs, armedFor);
    assert.equal(last?.turnSecondsRemaining, (AFK_MS - 10_000) / 1000);
  });

  test("arms a bot's move on a table with nothing pending, as after a restart", () => {
    const { rt, clock } = setup();
    seat(afterOpening(dealt([])), []);

    armTurnIfIdle(rt, ROOM);

    assert.equal(deadline("bot", ROOM), clock.now() + THINK_MS);
  });

  test("arms a person's clock on a table with nothing pending, as after a restart", () => {
    const { rt, clock } = setup();
    const game = seat(afterOpening(dealt([0, 1, 2, 3])), [0, 1, 2, 3]);

    armTurnIfIdle(rt, ROOM);

    assert.equal(game.turnDeadlineMs, clock.now() + AFK_MS);
  });

  test("arms a person's clock when only another seat's AFK timer is pending", () => {
    const { rt, clock } = setup();
    const game = seat(afterOpening(dealt([0, 1, 2, 3])), [0, 1, 2, 3]);
    const mover = actingSeat(game.gameState);
    const other = NAMES[(mover + 1) % 4]!.toLowerCase();
    arm("afk", seatKey(ROOM, other), 1_000, () => {});

    armTurnIfIdle(rt, ROOM);

    assert.equal(game.turnDeadlineMs, clock.now() + AFK_MS);
  });

  test("on a room with no table says and does nothing", () => {
    const { rt, journal, sent } = setup();

    armTurnIfIdle(rt, "game-turn-no-such-room");

    assert.deepEqual([journal, sent], [[], []]);
  });
});

describe("heldRoundFor", () => {
  test("finds the live round a person is seated in, and not a finished one or a stranger's", () => {
    setup();
    const live = afterOpening(dealt([0, 1], undefined, 2));
    seat({ ...live, roundOver: true }, [0, 1], {}, "held-finished");
    seat(live, [0, 1], { playerMap: { 0: "ana", 1: "ben" } }, "held-live");
    const other = seat(afterOpening(dealt([0, 1], undefined, 2)), [0, 1], { playerMap: { 0: "cara", 1: "dan" } }, "held-other");

    const found = heldRoundFor("ben");
    assert.equal(found?.roomId, "held-live");
    assert.equal(found?.game, activeGames.get("held-live"));
    assert.equal(heldRoundFor("dan")?.game, other);
    assert.equal(heldRoundFor("nobody"), null);
  });

  test("a person whose only round is finished holds none", () => {
    setup();
    seat({ ...afterOpening(dealt([0, 1], undefined, 2)), roundOver: true }, [0, 1], {}, "held-over");

    assert.equal(heldRoundFor("ana"), null);
  });
});

describe("vacateSeat", () => {
  const takeover = (username: string, seatIndex: number, userId: string) => ({
    userId,
    username,
    seatIndex,
    code: "PLAYER_LEFT_BOT_TAKEOVER",
    params: { username },
  });
  const withoutMessage = (event: unknown) => {
    const { message: _message, ...rest } = event as Record<string, unknown>;
    return rest;
  };

  test("a room with no table, or a user not seated at it, is left alone", async () => {
    const { rt, journal, sent } = setup();
    const game = seat(afterOpening(dealt([0, 1, 2, 3])), [0, 1, 2, 3]);

    await vacateSeat(rt, "game-turn-no-such-room", "ana");
    await vacateSeat(rt, ROOM, "stranger");

    assert.deepEqual([journal, sent], [[], []]);
    assert.deepEqual(Object.keys(game.playerMap), ["0", "1", "2", "3"]);
  });

  test("mid-round, a table that survives hands the seat to a bot and tells the room", async () => {
    const { rt, events } = setup();
    const game = seat(afterOpening(dealt([0, 1, 2, 3])), [0, 1, 2, 3]);

    await vacateSeat(rt, ROOM, "dee");

    assert.deepEqual(events("game:seat_bot_takeover").map(withoutMessage), [takeover("Dee", 3, "dee")]);
    assert.deepEqual(events("game:player_left"), []);
    assert.equal(game.playerMap[3], undefined);
  });

  test("between rounds, a leaver stops counting in the vote, which the room is sent again, and their clock stops", async () => {
    const { rt, events, writes } = setup();
    const game = seat({ ...afterOpening(dealt([0, 1, 2])), roundOver: true }, [0, 1, 2]);
    castRematchVote(game, "cai");
    castRematchVote(game, "ana");
    arm("afk", seatKey(ROOM, "cai"), 10_000, () => {});

    await vacateSeat(rt, ROOM, "cai");

    assert.deepEqual(events("game:seat_bot_takeover").map(withoutMessage), [takeover("Cai", 2, "cai")]);
    assert.deepEqual(events("game:vote_state"), [{ votes: ["ana"], total: 2 }]);
    assert.equal(pending("afk", seatKey(ROOM, "cai")), false);
    assert.equal(writes("persistGameState").length, 1);
    assert.equal(activeGames.has(ROOM), true);
  });

  test("a walkout that leaves one person ends the match unplayed, and says who left and why", async () => {
    const { rt, events } = setup();
    seat(afterOpening(dealt([0, 1], undefined, 2)), [0, 1]);

    await vacateSeat(rt, ROOM, "ben");

    assert.deepEqual(events("game:player_left"), [{ userId: "ben", username: "Ben", seatIndex: 1 }]);
    const [note] = events("game:notification") as { type: string; code: string; params: unknown }[];
    assert.equal(note?.type, "abandoned");
    assert.equal(note?.code, "PLAYER_LEFT_ABANDONED");
    assert.deepEqual(note?.params, { username: "Ben" });
    assert.deepEqual(events("game:seat_bot_takeover"), []);
    assert.equal(activeGames.has(ROOM), false);
  });
});
