// server/game/tableHandlers.ts — what the instance that owns a table does when one
// of its players acts.
//
// These run on the owner, which is not necessarily where the player's socket
// is: everything they say goes to `rt.out.user(userId)` rather than to a
// socket object, exactly as `gameRoom.ts` describes. A `socket.emit` here would
// reach the player only when they happened to be connected to the instance
// that dealt.
//
// The socket's own work — joining a room, `socketRoomMap` — stays with the
// socket, in the handler families.
//
// A play or pass reaches six files before it settles: `socketGameplay.ts`
// `registerGameplayHandlers` → `rt.route`, which is `tableRouter.ts`
// `applyOrForward` → `applyTableAction` → `moveAction` here, which asks
// `lib/game/gameEngine.ts` `applyMove` → `gameTurn.ts` `commitMove`, which records
// the play's flags and replay entry, publishes through `gamePersistence.ts`
// `publishState` and arms the next seat. The play that ends the round — the
// engine decides which one — takes a seventh file instead of the arming:
// `roundOver.ts` `handleRoundOver`.
//
// A disconnect runs a different chain: `socketPresence.ts`
// `registerDisconnect` → `tableRouter.ts` `applyOrForward` with a `seatLost`
// intent → `seatLostAction` here. Mid-round, it arms a grace timer and, on
// expiry, calls `gameTurn.ts` `vacateSeat` and `dealIfSeatLeftGateClosed`
// here directly — `vacateSeat` settles the departure itself, through a bot
// takeover, `roundOver.ts` `voidAbandonedMatch`, or `gameTurn.ts`'s own
// `concedeRound` into `roundOver.ts` `handleRoundOver`. Between rounds it instead
// arms `socketTable.ts` `armLobbyGrace`, whose own expiry (`handleSeatRelease`)
// reaches the same `vacateSeat`/`dealIfSeatLeftGateClosed` pair through a
// `vacate` intent routed back through `applyOrForward`, landing on the
// `"vacate"` case here rather than `seatLostAction`. A third timer reaches the
// same pair with nobody disconnected: `roundOver.ts` `armVoteDeadline`, whose
// expiry (`expireVoteDeadline` here) vacates every seat that has not voted.
//
// `roundOver.ts` `handleRoundOver` has more entry points than a play: an
// AFK/bot auto-move (`gameTurn.ts` `runBotTurn`, `handleAutoPass`) and
// `vacateSeat`'s abandonment branch reach it too. Inside, it resolves the round
// through `onlineGameLogic.ts` `resolveRoundEnd`, emits `game:round_over`, then
// writes it through `rt.writers`, which `gamePersistence.ts` implements.
import type { TableRuntime } from "./tableRuntime.ts";
import { emitVoteState, emitEndMatchVoteState } from "../socket/emit.ts";
import { payload } from "../shared/payload.ts";
import { OK, refuse, type Outcome, type Refusal } from "../shared/refusal.ts";
import { logger } from "../http/logger.ts";
import { trackEvent } from "../socket/events.ts";
import { activeGames, isShuttingDown, seatName, voterCount } from "./gameRoom.ts";
import { stopSpectatingEverywhere } from "../socket/seating.ts";
import type { OnlineGameState } from "./gameRoom.ts";
import { publishState, sendGameStateTo } from "./gamePersistence.ts";
import { armVoteDeadline, endMatchByAgreement } from "./roundOver.ts";
import { armTurnIfIdle, commitMove, vacateSeat } from "./gameTurn.ts";
import {
  disconnectGraceMs,
  clearRoomTimers,
  clearDisconnectGrace,
  clearLobbyGrace,
  arm,
  usersInLobbyGrace,
} from "./gameTimers.ts";
import { buildSeatRoster, seatOfUser } from "./onlineGameLogic.ts";
import { castEndMatchVote, reclaim } from "./seatLedger.ts";
import { unpackPersistedState } from "../../shared/persistedEnvelope.ts";
import { fromEnvelope, newTable } from "./tableState.ts";
import {
  announceRejoin,
  armLobbyGrace,
  handleSeatRelease,
  retireRoomInvites,
  roomStatePayload,
  teamsSizeRefusal,
} from "../socket/socketTable.ts";
import { applyMove, dealFirstSeatFor, openingAfter, seatsOf, startRound } from "../../lib/game/gameEngine.ts";
import type { GameState, MoveRefusal } from "../../lib/game/gameEngine.ts";
import { dealRound } from "./dealRound.ts";
import type { TableAction } from "./tableActions.ts";
import { UNKNOWN_ACTION, type RehydrateOutcome } from "./tableRouter.ts";

/**
 * Puts a persisted game back in memory, for an instance that has just claimed
 * the room.
 *
 * `forUserId` is the player whose action triggered the takeover, and they must
 * hold a seat in the persisted roster, or a seat the row records them as having
 * vacated — a reclaim is the one case where the person entitled to the table is
 * absent from `playerMap` (docs/GAME-RULES.md § Decisions), and they may well be the first
 * to come back to it. Without that gate any authenticated account could name any
 * room id and pull that table into whichever instance it is connected to — where
 * `pruneStaleRooms` then skips it for holding a live game, and the sweeper only
 * disposes finished ones. `null` is the deal, which has no persisted roster to
 * check against and does its own host check.
 *
 * The one place besides `startMatch` that writes `activeGames`, and both run
 * under a claim — `tests/server/tableOwnership.test.ts` pins that there is no third.
 */
export async function rehydrateGame(
  rt: TableRuntime,
  roomId: string,
  forUserId: string | null
): Promise<RehydrateOutcome> {
  const row = await rt.store.games.load(roomId);
  if (!row) return "missing";

  const restored = fromEnvelope(row);
  if (!restored.ok && restored.newer) {
    // Mid-deploy, the revision that wrote this row is still serving it.
    logger.warn({ roomId, reason: restored.reason }, "Leaving a newer revision's persisted game alone");
    return "newer";
  }
  if (!restored.ok) {
    // Written under an older persisted shape, or holding a value the restore
    // path would carry straight into the engine. Restoring it deals a silently
    // corrupt round rather than crashing, which is worse than refusing outright.
    logger.warn({ roomId, reason: restored.reason }, "Discarding unrestorable persisted game");
    // The claim stays: a deal may follow on this very room.
    await rt.writers.discardGame(roomId);
    return "unrestorable";
  }

  const { game } = restored;
  const { playerMap } = game;
  if (
    forUserId !== null &&
    !Object.values(playerMap).includes(forUserId) &&
    ![...game.vacatedSeats.values()].some((who) => who.userId === forUserId)
  ) {
    return "not_seated";
  }
  activeGames.set(roomId, game);
  logger.info({ roomId }, "Took over a table from active_games");
  // Not a grace: it vacates connected players too, so it needs no presence.
  if (game.gameState.roundOver && !game.matchOver) armVoteDeadline(rt, roomId);

  // The graces their disconnects armed died with the process that held them.
  const presence = await rt.presence.tablePresence(roomId);
  // A between-hands grace's expiry sees only this process's sockets, so a
  // grace armed on a guess releases players seated through another instance.
  if (!presence) return "restored";
  const back = game.gameState.roundOver ? presence.atTable : presence.online;
  for (const [seat, userId] of Object.entries(playerMap)) {
    if (userId === forUserId || back.has(userId)) continue;
    await armSeatGrace(rt, game, roomId, userId, Number(seat));
  }
  return "restored";
}

/** A refusal with no notice is silent: the ack alone answers it. */
const MOVE_REFUSAL_CODES = {
  roundOver: () => ({ ok: false, code: "NO_LIVE_GAME" }),
  exchangeOpen: () => refuse("EXCHANGE_PENDING"),
  noExchange: () => ({ ok: false, code: "NO_EXCHANGE" }),
  notExchangeWinner: () => ({ ok: false, code: "NOT_YOUR_EXCHANGE" }),
  notYourTurn: () => ({ ok: false, code: "NOT_YOUR_TURN" }),
  notHeld: () => refuse("INVALID_CARD"),
  notACombination: () => refuse("INVALID_COMBINATION"),
  needsStartCard: (state) => refuse("MUST_PLAY_START_CARD", { rank: state.startCard!.rank }),
  royalUnbeatable: () => refuse("INVALID_MOVE"),
  bombOnly: () => refuse("INVALID_MOVE"),
  wrongType: () => refuse("INVALID_MOVE"),
  wrongLength: () => refuse("INVALID_MOVE"),
  tooLow: () => refuse("INVALID_MOVE"),
  mustLead: () => refuse("CANNOT_PASS"),
  notGiveable: () => refuse("INVALID_CARD"),
} satisfies Record<MoveRefusal, (state: GameState) => Refusal>;

function moveAction(
  rt: TableRuntime,
  game: OnlineGameState,
  action: Extract<TableAction, { kind: "move" }>
): Promise<Outcome> | Outcome {
  const { roomId, userId, move } = action;
  const prev = game.gameState;
  const result = applyMove(prev, seatOfUser(game.playerMap, userId) ?? -1, move);
  if (!result.ok) return MOVE_REFUSAL_CODES[result.code](prev);

  if (result.move.kind === "play") {
    // A count and a type, never card identities: enabling debug in production
    // must not be able to expose a hand.
    const { seat, combo } = result.move;
    logger.debug({ roomId, seat, comboType: combo.type, cardCount: combo.cards.length }, "Play accepted");
  }
  if (!prev.firstPlayMade && result.state.firstPlayMade) {
    trackEvent("game.firstMoveMade", userId, {
      playerCount: result.state.players.length,
      gameMode: result.state.gameMode,
    });
  }

  return commitMove(rt, game, result)?.then(() => OK) ?? OK;
}

/**
 * Unanimous among the seats a human currently holds — a bot, or a seat whose
 * player left, has nobody who can answer and abstains. The one shape every
 * vote on this table's roster is counted in, so a second vote reuses this
 * rather than its own arithmetic.
 */
function votesUnanimous(votes: Set<string>, game: OnlineGameState): boolean {
  return votes.size >= voterCount(game);
}

function rematchAnswered(game: OnlineGameState): boolean {
  return votesUnanimous(game.rematchVotes, game);
}

/** A match ended by the vote is never rematched (docs/GAME-RULES.md § Decisions). */
function rematchRefused(game: OnlineGameState): boolean {
  return !!game.endedByVote;
}

/**
 * Deals the round the table has voted for, or says why it cannot and leaves
 * every vote where it was.
 *
 * `notifyUserId` is the vote that closed the gate. It is `null` when a seat
 * *leaving* closed it, and then a refusal is logged rather than shown: nobody
 * pressed anything, and the toast would land on whoever happened to be first
 * in `playerMap`.
 */
async function dealVotedRound(
  rt: TableRuntime,
  game: OnlineGameState,
  roomId: string,
  notifyUserId: string | null
): Promise<Outcome> {
  const decline = (code: "ROOM_NOT_FOUND" | "MIN_PLAYERS_REQUIRED"): Outcome => {
    emitVoteState(rt.out.room(roomId), game);
    if (notifyUserId) return refuse(code);
    logger.warn({ roomId, code }, "The next round could not be dealt");
    return { ok: false, code };
  };

  // The database is read for the room's settings and nothing else: the next
  // round's seats are copied from the running game. `room_players` holds
  // humans only, so a roster rebuilt from it drops every bot seat and
  // renumbers whatever is left.
  const room = await rt.store.rooms.getRoomById(roomId);
  // Every gate-closer reaches the read above, so the first one back deals and
  // the rest find the votes it cleared.
  if (!game.gameState.roundOver || !rematchAnswered(game)) return OK;
  if (!room) return decline("ROOM_NOT_FOUND");

  const seats = game.gameState.players;
  if (seats.length < 2) return decline("MIN_PLAYERS_REQUIRED");

  // Cleared only once the next round is certain to be dealt. A vote discarded
  // on the way out of a bail-out can never be retried: the overlay would sit
  // below its own threshold with nothing left to press.
  game.rematchVotes.clear();

  // `game.matchOver` still holds the just-ended round's own verdict here —
  // `dealRound` below is what flips it back via `rollMatchForward`.
  const nextFirstSeat = dealFirstSeatFor(game.matchOver, game.dealFirstSeat, seats.length);
  const newGameState = startRound(seatsOf(game.gameState), room.gameMode, {
    firstSeat: nextFirstSeat,
    opening: openingAfter(game.gameState),
  });
  game.dealFirstSeat = nextFirstSeat;

  // `game.playerMap` is deliberately left alone: seat i of the new state is
  // seat i of the old one, because `seatsOf` keeps the seat order. playerMap is
  // what sanitizeStateForPlayer reads to decide whose hand each viewer is sent,
  // so renumbering it here is how a player ends up holding someone else's cards.
  game.maxPlayers = room.maxPlayers;

  await dealRound(rt, game, newGameState);
  return OK;
}

async function rematchVoteAction(
  rt: TableRuntime,
  game: OnlineGameState,
  action: Extract<TableAction, { kind: "rematchVote" }>
): Promise<Outcome> {
  const { roomId, userId } = action;
  if (!game.gameState.roundOver) return { ok: false, code: "NO_LIVE_GAME" };
  if (seatOfUser(game.playerMap, userId) === null) return { ok: false, code: "NOT_SEATED" };

  // Nobody gets to restart it from the results screen after that.
  if (rematchRefused(game)) return refuse("REMATCH_DECLINED");

  game.rematchVotes.add(userId);
  emitVoteState(rt.out.room(roomId), game);
  if (!rematchAnswered(game)) return OK;
  return dealVotedRound(rt, game, roomId, userId);
}

/**
 * The unanimous, penalty-free vote to end a match a seat has been vacated
 * from (docs/GAME-RULES.md § Decisions). Offered only once a seat has actually gone —
 * otherwise there is nothing for it to answer — and it carries only when
 * every seat a human still holds has voted; a bot or a vacated seat abstains,
 * the same shape `rematchAnswered` counts.
 */
async function endMatchVoteAction(
  rt: TableRuntime,
  game: OnlineGameState,
  action: Extract<TableAction, { kind: "endMatchVote" }>
): Promise<Outcome> {
  const { roomId, userId, wants } = action;
  if (seatOfUser(game.playerMap, userId) === null) return { ok: false, code: "NOT_SEATED" };
  if (game.vacatedSeats.size === 0) return { ok: false, code: "NO_VACANCY_TO_END" };

  castEndMatchVote(game, userId, wants);
  emitEndMatchVoteState(rt.out.room(roomId), game);
  // A withdrawal can never end a match, and votesUnanimous on a shrinking set
  // must not be asked.
  if (!wants || !votesUnanimous(game.endMatchVotes, game)) return OK;

  rt.out.room(roomId).emit("game:notification", {
    type: "info",
    ...payload("MATCH_ENDED_BY_AGREEMENT"),
  });
  await endMatchByAgreement(rt, roomId, game);
  return OK;
}

/**
 * The gate again, after a seat has gone: it counts votes against the seats
 * still there, and a vote is the only thing that ever evaluates it.
 */
async function dealIfSeatLeftGateClosed(
  rt: TableRuntime,
  roomId: string
): Promise<Outcome> {
  const game = activeGames.get(roomId);
  if (!game || !game.gameState.roundOver || !rematchAnswered(game)) return OK;
  if (rematchRefused(game)) return OK;
  if (Object.keys(game.playerMap).length === 0) return OK;
  return dealVotedRound(rt, game, roomId, null);
}

/**
 * Every seated human who has not voted goes as a disconnect's grace expiry
 * takes a seat — connected or not, which is the ruling — and the rest deal.
 */
export async function expireVoteDeadline(rt: TableRuntime, roomId: string): Promise<void> {
  try {
    const game = activeGames.get(roomId);
    if (!game || !game.gameState.roundOver || game.matchOver || rematchRefused(game)) return;
    const silent = Object.values(game.playerMap).filter((userId) => !game.rematchVotes.has(userId));
    // Votes keep landing through every await below, so each seat is judged
    // again just before it goes, and leaves the map before its row is released.
    for (const userId of silent) {
      if (activeGames.get(roomId) !== game || !game.gameState.roundOver) break;
      if (game.rematchVotes.has(userId)) continue;
      await vacateSeat(rt, roomId, userId);
      const released = await rt.store.rooms.releaseSeat(roomId, userId).catch((err) => {
        logger.warn(
          { err, roomId, userId },
          "Failed to delete the room_players row after the vote deadline — the seat stays counted as taken"
        );
        return null;
      });
      // A rejoin inside the release reclaims the seat and upserts before the delete commits.
      const reclaimed = seatOfUser(game.playerMap, userId);
      if (reclaimed !== null) {
        await rt.store.rooms
          .restoreSeat(roomId, userId, reclaimed, released?.wasHost ?? false)
          .catch((err: unknown) =>
            logger.warn({ err, roomId, userId }, "Failed to restore a seat reclaimed during the vote deadline's release")
          );
      }
    }
    await dealIfSeatLeftGateClosed(rt, roomId);
    logger.info({ roomId, vacated: silent }, "Next-round vote deadline expired");
  } catch (err) {
    logger.error({ err, roomId }, "Vote deadline handler failed");
  }
}

async function rejoinAction(
  rt: TableRuntime,
  game: OnlineGameState,
  action: Extract<TableAction, { kind: "rejoin" }>
): Promise<Outcome> {
  const { roomId, userId } = action;
  let seat = seatOfUser(game.playerMap, userId);
  if (seat === null) {
    seat = reclaim(game, userId);
    if (seat === null) {
      // Reachable only on a restored row that kept `releasedSeats` and lost the
      // seat entry: `seatLedger.ts` writes and clears the two together.
      const code = game.releasedSeats.has(userId) ? "SEAT_RELEASED" : "UNAUTHORIZED";
      return { ok: false, code };
    }
    // Every viewer's own `vacated` flag for this seat must flip false, and
    // the returning player's hand — still theirs; `vacateSeat` never touched
    // it — has to reach them. A normal reconnect skips this: the seat was
    // never vacated on the wire in the first place.
    void publishState(rt, game);
    // reclaim clears the (now-stale) end-match tally; every seat still
    // holding a vote for it has to be told, or its banner keeps counting a
    // vote the server no longer has.
    emitEndMatchVoteState(rt.out.room(roomId), game);
  }

  // The grace timer lives on whichever instance saw the socket go, and the
  // player may well have come back on another one. Clearing it here is what
  // makes the answer independent of that.
  clearDisconnectGrace(userId);
  clearLobbyGrace(roomId, userId);

  // Idempotent — an INSERT on every reconnect would pile up duplicate
  // room_players rows and corrupt the next rematch.
  await rt.store.rooms
    .upsertRoomPlayer(roomId, userId, seat)
    .catch((err: unknown) => logger.warn({ err, roomId, userId }, "upsertRoomPlayer failed"));

  await announceRejoin(rt, userId, roomId, game);
  logger.info({ userId, roomId }, "Player rejoined game");
  return OK;
}


async function startMatchAction(
  rt: TableRuntime,
  action: Extract<TableAction, { kind: "startMatch" }>
): Promise<Outcome> {
  const { roomId, userId, fillWithBots, botPersonality, matchLength } = action;

  const room = await rt.store.rooms.getRoomById(roomId);
  if (!room || room.hostUserId !== userId) return { ok: false, code: "NOT_THE_HOST" };

  // A live in-memory game is the authority on whether this room may deal:
  // `rooms.status` reads "finished" between the rounds of a running match as
  // well as after the last one, and it is written a moment *after* game:over
  // reaches the clients, so it is stale exactly when a between-rounds start
  // arrives.
  const previous = activeGames.get(roomId);

  if (previous) {
    if (!previous.matchOver) {
      // The next round of a running match is game:rematch_vote's job. Dealing
      // it here would deal without an exchange phase, and would let the
      // payload's matchLength rewrite the format of a match that is already
      // being scored.
      return refuse("MATCH_IN_PROGRESS");
    }

    // A finished match releases every player's commitment, so the next one is
    // a new agreement: it needs the whole table ready, not the host alone.
    // Same ready set as game:rematch_vote, and the same abstention — a seat
    // with no playerMap entry (a bot, or a human who left) has nobody who can
    // answer and is not counted.
    if (seatOfUser(previous.playerMap, userId) !== null) previous.rematchVotes.add(userId);
    const seatedIds = Object.values(previous.playerMap);
    emitVoteState(rt.out.room(roomId), previous);
    if (!seatedIds.every((uid) => previous.rematchVotes.has(uid))) return refuse("NEW_MATCH_NOT_READY");
  } else if (room.status !== "waiting" && room.status !== "finished") {
    // No game in memory or on disk: the room row is all there is, and a room
    // mid-game there is one a restart stranded, not one to deal into.
    return { ok: false, code: "ROOM_NOT_WAITING" };
  }

  // A seat inside its grace is held for someone who is not here. Dealing them
  // a hand gives the table a player who cannot play it and whom no disconnect
  // can ever hand to a bot, because their disconnect already happened. Release
  // the seat instead; they can rejoin the next lobby.
  const absent = new Set(usersInLobbyGrace(roomId));
  // The finished match's tally, discarded before any seat leaves: releasing one
  // lowers the rematch gate, and a stale full count would deal that match one
  // more round underneath the new one being dealt here.
  previous?.rematchVotes.clear();
  if (absent.size > 0) {
    const seated = await rt.store.rooms.getRoomPlayers(room.id);
    for (const p of seated.filter((p) => absent.has(p.userId))) {
      clearLobbyGrace(roomId, p.userId);
      await handleSeatRelease(rt, roomId, p.userId, { source: "disconnect" });
    }
  }

  // Engine seat index is the position in this roster, sorted by seat, and
  // playerMap is keyed the same way. Bot seats are left out of playerMap,
  // which armTurn already reads as "drive this seat with the bot".
  const rosterOf = (seated: { seatIndex: number; userId: string; user: { username: string } }[]) =>
    buildSeatRoster(
      seated.map((p) => ({ seatIndex: p.seatIndex, userId: p.userId, username: p.user.username })),
      room.maxPlayers,
      { fillWithBots, botPersonality }
    );
  const refusal = (seated: Parameters<typeof rosterOf>[0]): Refusal | null => {
    // With bots filling every empty seat, one seated human is enough — the
    // min-2 guard only matters for an all-human table.
    if (!fillWithBots && seated.length < 2) return refuse("MIN_PLAYERS_REQUIRED");
    if (seated.length < 1) return { ok: false, code: "MIN_PLAYERS_REQUIRED" };
    return teamsSizeRefusal(room.gameMode, rosterOf(seated).length);
  };

  const closed = await rt.store.rooms.closeForStart(roomId, userId, {
    liveMatch: previous !== undefined,
    renumber: !fillWithBots,
    admits: (seated) => refusal(seated) === null,
  });
  if (!closed.ok) {
    if (closed.reason === "refused") {
      return refusal(closed.roster) ?? { ok: false, code: "MIN_PLAYERS_REQUIRED" };
    }
    return { ok: false, code: closed.reason === "not_waiting" ? "ROOM_NOT_WAITING" : "NOT_THE_HOST" };
  }
  const players = closed.roster;

  clearRoomTimers(roomId);

  const roster = rosterOf(players);

  const newGame = newTable(room, roster, previous, matchLength);
  const { playerMap } = newGame;
  // `closeForStart` read this roster and closed the room in one transaction
  // under the rooms row lock, which every claim and release also takes: nobody
  // can be seated or unseated between the roster and this deal.
  // Not awaited: nothing below reads the rows, and the deal must not wait on it.
  void retireRoomInvites(rt, roomId, room.code).catch((err: unknown) =>
    logger.warn({ err, roomId }, "Failed to retire the invites of a room that started")
  );
  activeGames.set(roomId, newGame);
  // Awaited: until a dealt-in player has left `spectators` on every instance,
  // the table they watched keeps sending its state to their user room.
  await Promise.all(Object.values(playerMap).map((uid) => stopSpectatingEverywhere(rt, uid))).catch(
    (err: unknown) => logger.warn({ err, roomId }, "Failed to stop a dealt-in player spectating")
  );

  // The room hears that it started, before anyone is sent their cards.
  // `game:state` is addressed to one player and carries both facts at once —
  // here is your hand, and the lobby is over — so a player who misses theirs is
  // left on the room screen with no way back: the room id is only remembered
  // once a `room:state` says `in_progress`, and without it `game:rejoin` has
  // nothing to ask about. This is a room broadcast, so it does not depend on
  // resolving any one player.
  rt.out.room(roomId).emit("room:state", await roomStatePayload(closed.room, players));

  await dealRound(rt, newGame, newGame.gameState);
  logger.info(
    { roomId, playerCount: players.length, botCount: roster.length - players.length },
    "Game started"
  );
  return OK;
}

/**
 * A seated player's socket went away, on whichever instance was holding it.
 *
 * The decision needs the game, so it is made here rather than where the socket
 * dropped: on the instance that held no copy of the table, the same code read
 * a round in progress as a waiting lobby and released the seat outright.
 */
async function seatLostAction(
  rt: TableRuntime,
  game: OnlineGameState,
  action: Extract<TableAction, { kind: "seatLost" }>
): Promise<Outcome> {
  const { roomId, userId } = action;
  // Every socket drops at a shutdown, and the next process restores this table
  // from active_games and arms the graces itself.
  if (isShuttingDown()) return OK;
  // Forwarded from another instance, this can land after the player's rejoin
  // has already cleared the graces it would arm. Between hands the seat holds
  // the rematch gate, so only a socket back in this room counts.
  const back = game.gameState.roundOver
    ? await rt.presence.isAtTable(userId, roomId)
    : await rt.presence.isOnline(userId);
  if (back) return OK;
  const seat = seatOfUser(game.playerMap, userId);
  if (seat === null) return { ok: false, code: "NOT_SEATED" };

  if (!game.gameState.roundOver) {
    // Distinct from losing: the hand was still running when they went.
    trackEvent("game.abandoned", userId, {
      playerCount: game.gameState.players.length,
      gameMode: game.gameState.gameMode,
    });
  }
  const releasing = armSeatGrace(rt, game, roomId, userId, seat);
  return releasing ? releasing.then(() => OK) : OK;
}

/** Holds an absent player's seat for its grace, and hands it on when that runs out. */
function armSeatGrace(
  rt: TableRuntime,
  game: OnlineGameState,
  roomId: string,
  userId: string,
  seat: number
): Promise<void> | void {
  const username = seatName(game, seat);

  if (game.gameState.roundOver) {
    // The lobby grace, not the disconnect one: a seat between rounds counts
    // towards the rematch gate, so the table cannot wait a full minute on it.
    // Its expiry also asks the right question — back in *this* room, not
    // merely back online.
    return armLobbyGrace(rt, roomId, userId);
  }

  const graceSeconds = Math.round(disconnectGraceMs() / 1000);
  rt.out.room(roomId).emit("game:player_disconnected", {
    userId,
    username,
    seatIndex: seat,
    ...payload("PLAYER_DISCONNECTED_GRACE", { username, seconds: graceSeconds }),
  });

  // A vacant seat must keep playing while we wait, or the table stalls for a
  // full minute on this player's turn.
  armTurnIfIdle(rt, roomId);

  arm("disconnect", userId, disconnectGraceMs(), () => {
    void (async () => {
      try {
        // Asked of the cluster, not of this process: the instance that owns a
        // table need not be the one holding the player's socket, and reading
        // the local map alone hands a connected player's seat to a bot.
        if (await rt.presence.isOnline(userId)) return;

        await rt.store.rooms
          .releaseSeat(roomId, userId)
          .catch((err) =>
            logger.warn(
              { err, roomId, userId },
              "Failed to delete the room_players row after the disconnect grace expired — the seat stays counted as taken"
            )
          );
        await vacateSeat(rt, roomId, userId);
        // The round may well have ended inside the grace, which puts this seat
        // in the rematch tally it is now leaving.
        await dealIfSeatLeftGateClosed(rt, roomId);
        logger.info({ userId, username, roomId }, "Disconnect grace expired — seat handed to a bot");
      } catch (err) {
        logger.error({ err, userId, roomId }, "Disconnect timeout handler failed");
      }
    })();
  });
}

export async function applyTableAction(rt: TableRuntime, action: TableAction): Promise<Outcome> {
  if (action.kind === "startMatch") return startMatchAction(rt, action);

  const game = activeGames.get(action.roomId);
  if (!game) return { ok: false, code: "NO_LIVE_GAME" };

  switch (action.kind) {
    case "move":
      return moveAction(rt, game, action);
    case "reaction": {
      const seat = seatOfUser(game.playerMap, action.userId);
      if (seat === null) return { ok: false, code: "NOT_SEATED" };
      rt.out.room(action.roomId).emit("game:reaction", {
        emoji: action.emoji,
        fromSeat: seat,
        username: seatName(game, seat),
      });
      return OK;
    }
    case "rematchVote":
      return rematchVoteAction(rt, game, action);
    case "endMatchVote":
      return endMatchVoteAction(rt, game, action);
    case "rejoin":
      return rejoinAction(rt, game, action);
    case "spectate": {
      if (game.gameState.roundOver) return { ok: false, code: "GAME_NOT_FOUND" };
      // A seated player watching their own table would be handed the seatless
      // view and lose sight of their own hand.
      if (seatOfUser(game.playerMap, action.userId) !== null) {
        return { ok: false, code: "ALREADY_IN_ROOM" };
      }
      game.spectators.add(action.userId);
      sendGameStateTo(rt, action.userId, game);
      logger.info({ roomId: action.roomId, userId: action.userId }, "Spectator joined");
      return OK;
    }
    case "unspectate":
      game.spectators.delete(action.userId);
      return OK;
    case "seatLost":
      return seatLostAction(rt, game, action);
    case "resume":
      armTurnIfIdle(rt, action.roomId);
      return OK;
    case "vacate":
      // `rooms.status` reads "finished" between rounds too, so only the live
      // game knows whether the seat is still held. Removing the DB row alone
      // leaves it live — auto-playing the leaver's hand, or blocking the
      // rematch gate.
      return vacateSeat(rt, action.roomId, action.userId).then(
        () => dealIfSeatLeftGateClosed(rt, action.roomId)
      );
    default:
      action satisfies never;
      // A newer revision forwards kinds this one has never heard of.
      return UNKNOWN_ACTION;
  }
}

/**
 * Takes over every persisted table no instance holds while one of its seats is
 * online. Nothing else wakes a table whose owner died on a turn no connected
 * player takes; a table nobody is watching stays asleep.
 */
export async function resumeOrphanedTables(rt: TableRuntime): Promise<void> {
  if (isShuttingDown()) return;
  const rows = await rt.store.games.list();
  const online = await rt.presence.connectedUserIds();
  if (!online) return;
  for (const row of rows) {
    if (activeGames.has(row.roomId) || isShuttingDown()) continue;
    const restored = unpackPersistedState<GameState>(row.gameState);
    if (!restored.ok || restored.gameState.roundOver) continue;
    const userId = Object.values(restored.match.playerMap).find((id) => online.has(id));
    if (userId === undefined) continue;
    await rt.route({ kind: "resume", roomId: row.roomId, userId });
  }
}
