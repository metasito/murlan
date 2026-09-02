// server/tableHandlers.ts — what the instance that owns a table does when one
// of its players acts.
//
// These run on the owner, which is not necessarily where the player's socket
// is: everything they say goes to `io.to(userRoom(userId))` rather than to a
// socket object, exactly as `gameRoom.ts` describes. A `socket.emit` here would
// reach the player only when they happened to be connected to the instance
// that dealt.
//
// The socket's own work — joining a room, `socketRoomMap` — stays with the
// socket, in the handler families.
import type { Server as SocketServer } from "socket.io";
import { eq } from "drizzle-orm";
import { db } from "./db.ts";
import { storage } from "./storage.ts";
import { emitVoteState } from "./emit.ts";
import { logger } from "./logger.ts";
import { trackEvent } from "./events.ts";
import { DEFAULT_LOCALE, translate } from "../shared/i18n.ts";
import { activeGames as activeGamesTable } from "../shared/schema.ts";
import type { EventOutcome } from "./socketSafety.ts";
import { activeGames, seatOfUser, userRoom } from "./gameRoom.ts";
import { isUserOnline } from "./socketRegistry.ts";
import type { OnlineGameState } from "./gameRoom.ts";
import {
  broadcastGameState,
  disposeGame,
  gameOverWriters,
  persistGameState,
  sendGameStateTo,
} from "./gamePersistence.ts";
import {
  broadcastRematchIntents,
  handleGameOver,
  tableWantsRematch,
} from "./gameOver.ts";
import { armTurn, recordPlayFlags, vacateSeat } from "./gameTurn.ts";
import { exchangeAnnounceMs } from "../lib/exchangeCeremony.ts";
import {
  disconnectGraceMs,
  clearRoomTimers,
  clearDisconnectGrace,
  clearLobbyGrace,
  disconnectTimers,
  usersInLobbyGrace,
} from "./gameTimers.ts";
import {
  buildSeatRoster,
  restoredMatchOver,
  teamKeyMap,
  unpackPersistedState,
} from "./onlineGameLogic.ts";
import {
  announceRejoin,
  armLobbyGrace,
  handleSeatRelease,
  retireRoomInvites,
  roomStatePayload,
  teamsSizeRefusal,
} from "./socketTable.ts";
import {
  buildCombination,
  canPlay,
  dealFirstSeatFor,
  initializeGame,
  initializeRematch,
  processExchangeChoice,
  processPass,
  processPlay,
  firstTargetFor,
  teamForSeat,
} from "../lib/gameEngine.ts";
import type { GameState } from "../lib/gameEngine.ts";
import { appendReplayMove, startReplayLog } from "./replayShape.ts";
import { dealManche } from "./dealManche.ts";
import type { TableAction } from "./tableActions.ts";
import {
  applyOrForward,
  registerTableRouting,
  setTableHandlers,
} from "./tableRouter.ts";
import { setRoomLostHandler } from "./gameOwnership.ts";

const OK: EventOutcome = { ok: true };

// Addressed to the account rather than to a socket, and each naming its event
// literally so the outbound scan in `tests/socketEvents.test.ts` can still see
// what this file sends.
function gameError(io: SocketServer, userId: string, payload: unknown): void {
  io.to(userRoom(userId)).emit("game:error", payload);
}
function roomError(io: SocketServer, userId: string, payload: unknown): void {
  io.to(userRoom(userId)).emit("room:error", payload);
}

/**
 * Puts a persisted game back in memory, for an instance that has just claimed
 * the room.
 *
 * `forUserId` is the player whose action triggered the takeover, and they must
 * hold a seat in the persisted roster. Without that gate any authenticated
 * account could name any room id and pull that table into whichever instance it
 * is connected to — where `pruneStaleRooms` then skips it for holding a live
 * game, and the sweeper only disposes finished ones. `null` is the deal, which
 * has no persisted roster to check against and does its own host check.
 *
 * The one place besides `startMatch` that writes `activeGames`, and both run
 * under a claim — `tests/tableOwnership.test.ts` pins that there is no third.
 */
export async function rehydrateGame(
  roomId: string,
  forUserId: string | null
): Promise<"restored" | "missing" | "unrestorable" | "not_seated"> {
  const row = await db.query.activeGames.findFirst({
    where: eq(activeGamesTable.roomId, roomId),
  });
  if (!row) return "missing";

  const restored = unpackPersistedState<GameState>(row.gameState);
  if (!restored.ok) {
    // Written under an older persisted shape, or holding a value the restore
    // path would carry straight into the engine. Restoring it deals a silently
    // corrupt hand rather than crashing, which is worse than refusing outright.
    logger.warn({ roomId, reason: restored.reason }, "Discarding unrestorable persisted game");
    disposeGame(roomId);
    return "unrestorable";
  }

  const { playerMap, scores, gameMode, matchLength, matchTarget, maxPlayers, handsPlayed } =
    restored.match;
  if (forUserId !== null && !Object.values(playerMap).includes(forUserId)) return "not_seated";
  const restoredState = restored.gameState;
  const restoredPlayers = restoredState.players;
  activeGames.set(roomId, {
    roomId,
    joinCode: restored.joinCode,
    gameState: restoredState,
    playerMap,
    rematchVotes: new Set(),
    rematchIntents: new Map(),
    cumulativeScores: scores,
    gameMode,
    maxPlayers,
    matchTarget,
    matchLength,
    handsPlayed,
    matchOver: restoredMatchOver({
      matchLength,
      gameMode,
      handOver: restoredState.gameOver,
      scores,
      target: matchTarget,
      teamOfKey: teamKeyMap(playerMap, restoredPlayers),
      playerCount: restoredPlayers.length,
    }),
    handFlags: restored.handFlags,
    // A hand restored after a restart has no record of who walked out of it:
    // the map is memory-only and the restart emptied it.
    abandonedSeats: new Map<number, string>(),
    releasedSeats: new Set<string>(),
    spectators: new Set<string>(),
    // The log is memory-only, so a hand restored after a restart produces no
    // replay. The next hand starts a fresh one.
    moveLog: null,
    dealFirstSeat: restored.dealFirstSeat,
  });
  logger.info({ roomId }, "Took over a table from active_games");
  return "restored";
}

function playAction(
  io: SocketServer,
  game: OnlineGameState,
  action: Extract<TableAction, { kind: "play" }>
): Promise<EventOutcome> | EventOutcome {
  const { roomId, userId, cardIds } = action;
  if (game.gameState.gameOver) return { ok: false, code: "NO_LIVE_GAME" };
  const { gameState, playerMap } = game;

  // The round winner owes a card: nobody may play until it is given, otherwise
  // they keep the card and freeze the table behind the exchange overlay.
  if (gameState.exchangePhase?.active) {
    gameError(io, userId, {
      message: "You must complete the exchange first",
      code: "EXCHANGE_PENDING",
    });
    return { ok: false, code: "EXCHANGE_PENDING" };
  }

  const currentIdx = gameState.currentTurnIndex;
  if (playerMap[currentIdx] !== userId) return { ok: false, code: "NOT_YOUR_TURN" };

  const player = gameState.players[currentIdx];
  if (!player) return { ok: false, code: "NO_LIVE_GAME" };
  const unique = Array.from(new Set(cardIds));
  const cards = player.hand.filter((c) => unique.includes(c.id));
  if (cards.length !== unique.length) {
    gameError(io, userId, { message: "Invalid card", code: "INVALID_CARD" });
    return { ok: false, code: "INVALID_CARD" };
  }

  const combo = buildCombination(cards);
  if (!combo) {
    gameError(io, userId, {
      message: "Invalid combination",
      code: "INVALID_COMBINATION",
    });
    return { ok: false, code: "INVALID_COMBINATION" };
  }

  const isNewRound = gameState.lastPlayedCombination === null;
  // Read before the engine sets it, so the transition is observable once
  // rather than on every play after it.
  const wasFirstPlay = !gameState.firstPlayMade;

  if (!gameState.firstPlayMade && gameState.startCard) {
    const startCardId = gameState.startCard.id;
    if (!combo.cards.some((c) => c.id === startCardId)) {
      const sc = gameState.startCard;
      gameError(io, userId, {
        message: translate(DEFAULT_LOCALE, "server.MUST_PLAY_START_CARD", { rank: sc.rank }),
        code: "MUST_PLAY_START_CARD",
        params: { rank: sc.rank },
      });
      return { ok: false, code: "MUST_PLAY_START_CARD" };
    }
  }

  if (!canPlay(combo, isNewRound ? null : gameState.lastPlayedCombination)) {
    gameError(io, userId, { message: "Invalid move", code: "INVALID_MOVE" });
    return { ok: false, code: "INVALID_MOVE" };
  }

  // Achievement bookkeeping — see recordPlayFlags; this is the human-initiated
  // path, autoMoveForSeat covers bot/AFK-forced plays.
  recordPlayFlags(game, currentIdx, combo);

  const newState = processPlay(gameState, combo);
  appendReplayMove(game, currentIdx, combo, newState);
  game.gameState = newState;

  // A count and a type, never card identities: enabling debug in production
  // must not be able to expose a hand.
  logger.debug(
    { roomId, seat: currentIdx, comboType: combo.type, cardCount: combo.cards.length },
    "Play accepted"
  );

  broadcastGameState(io, game);
  persistGameState(roomId, game);

  if (wasFirstPlay && newState.firstPlayMade) {
    trackEvent("game.firstMoveMade", userId, {
      playerCount: newState.players.length,
      gameMode: newState.gameMode,
    });
  }

  if (newState.gameOver) {
    return handleGameOver(io, roomId, game, gameOverWriters).then(() => OK);
  }
  armTurn(io, roomId);
  return OK;
}

function passAction(
  io: SocketServer,
  game: OnlineGameState,
  action: Extract<TableAction, { kind: "pass" }>
): EventOutcome {
  const { roomId, userId } = action;
  if (game.gameState.gameOver) return { ok: false, code: "NO_LIVE_GAME" };
  const { gameState, playerMap } = game;
  if (gameState.exchangePhase?.active) {
    gameError(io, userId, {
      message: "You must complete the exchange first",
      code: "EXCHANGE_PENDING",
    });
    return { ok: false, code: "EXCHANGE_PENDING" };
  }

  const currentIdx = gameState.currentTurnIndex;
  if (playerMap[currentIdx] !== userId) return { ok: false, code: "NOT_YOUR_TURN" };
  if (gameState.lastPlayedCombination === null) {
    gameError(io, userId, { message: "You cannot pass", code: "CANNOT_PASS" });
    return { ok: false, code: "CANNOT_PASS" };
  }

  const newState = processPass(gameState);
  appendReplayMove(game, currentIdx, null, newState);
  game.gameState = newState;

  broadcastGameState(io, game);
  persistGameState(roomId, game);
  armTurn(io, roomId);
  return OK;
}

function exchangeAction(
  io: SocketServer,
  game: OnlineGameState,
  action: Extract<TableAction, { kind: "exchange" }>
): EventOutcome {
  const { roomId, userId, cardId } = action;
  if (!game.gameState.exchangePhase?.active) return { ok: false, code: "NO_EXCHANGE" };

  const seat = seatOfUser(game, userId);
  if (seat === null || seat !== game.gameState.exchangePhase.winnerIdx) {
    return { ok: false, code: "NOT_YOUR_EXCHANGE" };
  }

  const bothJokersException = game.gameState.exchangePhase.bothJokersException === true;
  const next = processExchangeChoice(game.gameState, cardId);
  if (next === game.gameState) {
    gameError(io, userId, { message: "Invalid card", code: "INVALID_CARD" });
    return { ok: false, code: "INVALID_CARD" };
  }
  game.gameState = next;

  broadcastGameState(io, game);
  persistGameState(roomId, game);
  // Every seat is watching the two cards cross the middle. The next move waits
  // for that to finish, on the same clock the ceremony itself runs on.
  armTurn(io, roomId, exchangeAnnounceMs(bothJokersException));
  return OK;
}

function broadcastRematchVotes(io: SocketServer, game: OnlineGameState, roomId: string) {
  emitVoteState(io, roomId, game);
}

function rematchAnswered(game: OnlineGameState): boolean {
  return game.rematchVotes.size >= Object.keys(game.playerMap).length;
}

/** The table was asked during the closing manche and said no. */
function rematchRefused(game: OnlineGameState): boolean {
  return game.matchOver && !tableWantsRematch(game);
}

/**
 * Deals the manche the table has voted for, or says why it cannot and leaves
 * every vote where it was.
 *
 * `notifyUserId` is the vote that closed the gate. It is `null` when a seat
 * *leaving* closed it, and then a refusal is logged rather than shown: nobody
 * pressed anything, and the toast would land on whoever happened to be first
 * in `playerMap`.
 */
async function dealVotedManche(
  io: SocketServer,
  game: OnlineGameState,
  roomId: string,
  notifyUserId: string | null
): Promise<EventOutcome> {
  const refuse = (code: string, message: string): EventOutcome => {
    if (notifyUserId) gameError(io, notifyUserId, { message, code });
    else logger.warn({ roomId, code }, "The next manche could not be dealt");
    broadcastRematchVotes(io, game, roomId);
    return { ok: false, code };
  };

  // The database is read for the room's settings and nothing else: the next
  // manche's seats are copied from the running game. `room_players` holds
  // humans only, so a roster rebuilt from it drops every bot seat and
  // renumbers whatever is left.
  const room = await storage.getRoomById(roomId);
  if (!room) return refuse("ROOM_NOT_FOUND", "Room not found");

  const seats = game.gameState.players;
  if (seats.length < 2) return refuse("MIN_PLAYERS_REQUIRED", "At least 2 players are required");

  // Cleared only once the next manche is certain to be dealt. A vote discarded
  // on the way out of a bail-out can never be retried: the overlay would sit
  // below its own threshold with nothing left to press.
  game.rematchVotes.clear();

  const prevRankings = game.gameState.rankings;
  // Engine ids ride across the manche, so prevRankings resolves to the same
  // seats it named — initializeRematch never has to fall back to a guessed
  // winner, and the exchange runs between the right two players.
  const playerSetup = seats.map((p) => ({
    id: p.id,
    name: p.name,
    type: p.type,
    personality: p.personality,
    team: room.gameMode === "teams" ? p.team : undefined,
  }));

  // `game.matchOver` still holds the just-ended manche's own verdict here —
  // `dealManche` below is what flips it back via `rollMatchForward`. When it
  // is true, this vote is "Rematch" on a table whose match already finished,
  // the same real-world event `startMatchAction`'s `room:start` reaches for
  // the same room, so it must resolve through the same `dealFirstSeatFor`
  // rather than always rotating a seat count that could belong to the match
  // that just ended (#803 — the two paths disagreed here).
  const nextFirstSeat = dealFirstSeatFor(game.matchOver, game.dealFirstSeat, playerSetup.length);
  const newGameState =
    prevRankings.length >= 2
      ? initializeRematch(playerSetup, room.gameMode, prevRankings, nextFirstSeat)
      : initializeGame(playerSetup, room.gameMode, nextFirstSeat);
  game.dealFirstSeat = nextFirstSeat;

  // `game.playerMap` is deliberately left alone: seat i of the new state is
  // seat i of the old one, because playerSetup was built from that same array
  // in order. playerMap is what sanitizeStateForPlayer reads to decide whose
  // hand each viewer is sent, so renumbering it here is how a player ends up
  // holding someone else's cards.
  game.gameMode = room.gameMode;
  game.maxPlayers = room.maxPlayers;

  await dealManche(io, game, newGameState);
  return OK;
}

async function rematchVoteAction(
  io: SocketServer,
  game: OnlineGameState,
  action: Extract<TableAction, { kind: "rematchVote" }>
): Promise<EventOutcome> {
  const { roomId, userId } = action;
  if (!game.gameState.gameOver) return { ok: false, code: "NO_LIVE_GAME" };
  if (seatOfUser(game, userId) === null) return { ok: false, code: "NOT_SEATED" };

  // Nobody gets to restart it from the results screen after that.
  if (rematchRefused(game)) {
    gameError(io, userId, {
      message: "The table chose not to play again",
      code: "REMATCH_DECLINED",
    });
    return { ok: false, code: "REMATCH_DECLINED" };
  }

  game.rematchVotes.add(userId);
  broadcastRematchVotes(io, game, roomId);
  if (!rematchAnswered(game)) return OK;
  return dealVotedManche(io, game, roomId, userId);
}

/**
 * The gate again, after a seat has gone: it counts votes against the seats
 * still there, and a vote is the only thing that ever evaluates it.
 */
async function dealIfSeatLeftGateClosed(
  io: SocketServer,
  roomId: string
): Promise<EventOutcome> {
  const game = activeGames.get(roomId);
  if (!game || !game.gameState.gameOver || !rematchAnswered(game)) return OK;
  if (rematchRefused(game)) return OK;
  if (Object.keys(game.playerMap).length === 0) return OK;
  return dealVotedManche(io, game, roomId, null);
}

async function rejoinAction(
  io: SocketServer,
  game: OnlineGameState,
  action: Extract<TableAction, { kind: "rejoin" }>
): Promise<EventOutcome> {
  const { roomId, userId, username } = action;
  const seat = seatOfUser(game, userId);
  if (seat === null) {
    const code = game.releasedSeats.has(userId) ? "SEAT_RELEASED" : "UNAUTHORIZED";
    return { ok: false, code };
  }

  // The grace timer lives on whichever instance saw the socket go, and the
  // player may well have come back on another one. Clearing it here is what
  // makes the answer independent of that.
  clearDisconnectGrace(userId);
  clearLobbyGrace(roomId, userId);

  // Idempotent — an INSERT on every reconnect would pile up duplicate
  // room_players rows and corrupt the next rematch.
  await storage
    .upsertRoomPlayer(roomId, userId, seat)
    .catch((err: unknown) => logger.warn({ err, roomId, userId }, "upsertRoomPlayer failed"));

  await announceRejoin(io, userId, username, roomId, game);
  logger.info({ userId, roomId }, "Player rejoined game");
  return OK;
}

async function startMatchAction(
  io: SocketServer,
  action: Extract<TableAction, { kind: "startMatch" }>
): Promise<EventOutcome> {
  const { roomId, userId, fillWithBots, botPersonality, matchLength } = action;

  const room = await storage.getRoomById(roomId);
  if (!room || room.hostUserId !== userId) return { ok: false, code: "NOT_THE_HOST" };

  // A live in-memory game is the authority on whether this room may deal:
  // `rooms.status` reads "finished" between the manches of a running match as
  // well as after the last one, and it is written a moment *after* game:over
  // reaches the clients, so it is stale exactly when a between-hands start
  // arrives.
  const previous = activeGames.get(roomId);

  if (previous) {
    if (!previous.matchOver) {
      // The next manche of a running match is game:rematch_vote's job. Dealing
      // it here would deal without an exchange phase, and would let the
      // payload's matchLength rewrite the format of a match that is already
      // being scored.
      roomError(io, userId, { message: "A match is already in progress", code: "MATCH_IN_PROGRESS" });
      return { ok: false, code: "MATCH_IN_PROGRESS" };
    }

    // A finished match releases every player's commitment, so the next one is
    // a new agreement: it needs the whole table ready, not the host alone.
    // Same ready set as game:rematch_vote, and the same abstention — a seat
    // with no playerMap entry (a bot, or a human who left) has nobody who can
    // answer and is not counted.
    if (seatOfUser(previous, userId) !== null) previous.rematchVotes.add(userId);
    const seatedIds = Object.values(previous.playerMap);
    emitVoteState(io, roomId, previous);
    if (!seatedIds.every((uid) => previous.rematchVotes.has(uid))) {
      roomError(io, userId, {
        message: "Every player must be ready before a new match starts",
        code: "NEW_MATCH_NOT_READY",
      });
      return { ok: false, code: "NEW_MATCH_NOT_READY" };
    }
  } else if (room.status !== "waiting" && room.status !== "finished") {
    // No game in memory or on disk: the room row is all there is, and a room
    // mid-game there is one a restart stranded, not one to deal into.
    return { ok: false, code: "ROOM_NOT_WAITING" };
  }

  // A seat inside its grace is held for someone who is not here. Dealing them
  // a hand gives the table a player who cannot play it and whom no disconnect
  // can ever hand to a bot, because their disconnect already happened. Release
  // the seat instead; they can rejoin the next lobby.
  const seated = await storage.getRoomPlayers(room.id);
  const absent = new Set(usersInLobbyGrace(roomId));
  // The finished match's tally, discarded before any seat leaves: releasing one
  // lowers the rematch gate, and a stale full count would deal that match one
  // more manche underneath the new one being dealt here.
  previous?.rematchVotes.clear();
  for (const p of seated.filter((p) => absent.has(p.userId))) {
    clearLobbyGrace(roomId, p.userId);
    await handleSeatRelease(io, roomId, p.userId, p.user.username, { source: "disconnect" });
  }
  const players = seated.filter((p) => !absent.has(p.userId));
  // With bots filling every empty seat, one seated human is enough — the min-2
  // guard only matters for an all-human table.
  if (!fillWithBots && players.length < 2) {
    roomError(io, userId, { message: "At least 2 players are required", code: "MIN_PLAYERS_REQUIRED" });
    return { ok: false, code: "MIN_PLAYERS_REQUIRED" };
  }
  if (players.length < 1) return { ok: false, code: "MIN_PLAYERS_REQUIRED" };

  clearRoomTimers(roomId);

  const humans = players.map((p) => ({
    seatIndex: p.seatIndex,
    userId: p.userId,
    username: p.user.username,
  }));
  // Engine seat index is the position in this roster, sorted by seat, and
  // playerMap is keyed the same way — so a gap in the DB seat numbering cannot
  // shift a hand onto the wrong player. Bot seats are left out of playerMap,
  // which armTurn already reads as "drive this seat with the AI".
  const roster = buildSeatRoster(humans, room.maxPlayers, { fillWithBots, botPersonality });
  const wrongSize = teamsSizeRefusal(
    (p) => roomError(io, userId, p),
    room.gameMode,
    roster.length
  );
  if (wrongSize) return wrongSize;

  const playerSetup = roster.map((r, idx) => ({
    name: r.username,
    type: (r.isBot ? "ai" : "human") as "human" | "ai",
    personality: r.isBot ? r.personality : undefined,
    team: teamForSeat(idx, roster.length, room.gameMode),
  }));

  const gameState = initializeGame(playerSetup, room.gameMode);
  const playerMap: Record<number, string> = {};
  roster.forEach((r, idx) => {
    if (!r.isBot) playerMap[idx] = r.userId;
  });

  const firstTarget = firstTargetFor(roster.length);

  const newGame: OnlineGameState = {
    gameState,
    playerMap,
    roomId,
    joinCode: room.code,
    rematchVotes: new Set(),
    rematchIntents: new Map(),
    cumulativeScores: previous?.cumulativeScores ?? {},
    gameMode: room.gameMode,
    maxPlayers: room.maxPlayers,
    matchTarget: previous?.matchTarget ?? firstTarget,
    matchLength: matchLength ?? previous?.matchLength ?? "match",
    handsPlayed: previous?.handsPlayed ?? 0,
    matchOver: previous?.matchOver ?? false,
    handFlags: {},
    abandonedSeats: new Map<number, string>(),
    releasedSeats: new Set<string>(),
    spectators: new Set<string>(),
    moveLog: startReplayLog(),
    // This branch is reached only when a match is genuinely starting fresh
    // (no `previous`, or `previous.matchOver`), so `dealFirstSeatFor`'s
    // `matchOver` argument is unconditionally `true` here — routed through it
    // anyway, rather than a bare `0`, so every site that decides this reads
    // off the one function `dealVotedManche` (below) also calls (#803).
    // `context/GameContext.tsx`'s `setupGame` resets to the same 0 for an
    // offline match, so a fresh table is identical either way.
    dealFirstSeat: dealFirstSeatFor(true, 0, roster.length),
  };
  // Before the game exists, not after: `claimRoomSeat` re-reads the status
  // under its own row lock, so a room that is no longer `waiting` cannot take a
  // straggler. Leaving it to dealManche would open a window the width of one
  // round-trip in which quick-match can seat someone into a hand whose roster
  // is already frozen.
  await storage.updateRoomStatus(roomId, "in_progress");
  // Not awaited: nothing below reads the rows, and the deal must not wait on it.
  void retireRoomInvites(io, roomId, room.code).catch((err: unknown) =>
    logger.warn({ err, roomId }, "Failed to retire the invites of a room that started")
  );
  activeGames.set(roomId, newGame);

  // The room hears that it started, before anyone is sent their cards.
  // `game:state` is addressed to one player and carries both facts at once —
  // here is your hand, and the lobby is over — so a player who misses theirs is
  // left on the room screen with no way back: the room id is only remembered
  // once a `room:state` says `in_progress`, and without it `game:rejoin` has
  // nothing to ask about. This is a room broadcast, so it does not depend on
  // resolving any one player.
  io.to(roomId).emit(
    "room:state",
    roomStatePayload({ ...room, status: "in_progress" }, players)
  );

  await dealManche(io, newGame, gameState);
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
 * a hand in progress as a waiting lobby and released the seat outright.
 */
function seatLostAction(
  io: SocketServer,
  game: OnlineGameState,
  action: Extract<TableAction, { kind: "seatLost" }>
): Promise<EventOutcome> | EventOutcome {
  const { roomId, userId, username } = action;
  if (seatOfUser(game, userId) === null) return { ok: false, code: "NOT_SEATED" };

  if (game.gameState.gameOver) {
    // The lobby grace, not the disconnect one: a seat between hands counts
    // towards the rematch gate, so the table cannot wait a full minute on it.
    // Its expiry also asks the right question — back in *this* room, not
    // merely back online.
    const releasing = armLobbyGrace(io, roomId, userId, username);
    return releasing ? releasing.then(() => OK) : OK;
  }

  // Distinct from losing: the hand was still running when they went.
  trackEvent("game.abandoned", userId, {
    playerCount: game.gameState.players.length,
    gameMode: game.gameState.gameMode,
  });

  const graceSeconds = Math.round(disconnectGraceMs() / 1000);
  io.to(roomId).emit("game:player_disconnected", {
    userId,
    username,
    code: "PLAYER_DISCONNECTED_GRACE",
    // The grace period is configurable, so the number has to come from the same
    // constant the timer below is armed with — a hardcoded "60 seconds" in the
    // text is a promise the server may not keep.
    message: `${username} disconnected. They have ${graceSeconds} seconds to rejoin.`,
    params: { username, seconds: graceSeconds },
  });

  // A vacant seat must keep playing while we wait, or the table stalls for a
  // full minute on this player's turn.
  armTurn(io, roomId);

  const prevTimer = disconnectTimers.get(userId);
  if (prevTimer) clearTimeout(prevTimer);

  const dcTimer = setTimeout(() => {
    void (async () => {
      try {
        disconnectTimers.delete(userId);
        // Asked of the cluster, not of this process: the instance that owns a
        // table need not be the one holding the player's socket, and reading
        // the local map alone hands a connected player's seat to a bot.
        if (await isUserOnline(userId)) return;

        await storage
          .removeRoomPlayer(roomId, userId)
          .catch((err) =>
            logger.warn(
              { err, roomId, userId },
              "Failed to delete the room_players row after the disconnect grace expired — the seat stays counted as taken"
            )
          );
        await vacateSeat(io, roomId, userId, username);
        // The hand may well have ended inside the grace, which puts this seat
        // in the rematch tally it is now leaving.
        await dealIfSeatLeftGateClosed(io, roomId);
        logger.info({ userId, username, roomId }, "Disconnect grace expired — seat handed to a bot");
      } catch (err) {
        logger.error({ err, userId, roomId }, "Disconnect timeout handler failed");
      }
    })();
  }, disconnectGraceMs());
  disconnectTimers.set(userId, dcTimer);
  return OK;
}

async function applyTableAction(
  io: SocketServer,
  action: TableAction
): Promise<EventOutcome> {
  if (action.kind === "startMatch") return startMatchAction(io, action);

  const game = activeGames.get(action.roomId);
  if (!game) return { ok: false, code: "NO_LIVE_GAME" };

  switch (action.kind) {
    case "play":
      return playAction(io, game, action);
    case "pass":
      return passAction(io, game, action);
    case "exchange":
      return exchangeAction(io, game, action);
    case "reaction": {
      const seat = seatOfUser(game, action.userId);
      if (seat === null) return { ok: false, code: "NOT_SEATED" };
      io.to(action.roomId).emit("game:reaction", {
        emoji: action.emoji,
        fromSeat: seat,
        username: action.username,
      });
      return OK;
    }
    case "rematchIntent": {
      if (seatOfUser(game, action.userId) === null) return { ok: false, code: "NOT_SEATED" };
      game.rematchIntents.set(action.userId, action.wants);
      broadcastRematchIntents(io, game);
      return OK;
    }
    case "rematchVote":
      return rematchVoteAction(io, game, action);
    case "rejoin":
      return rejoinAction(io, game, action);
    case "spectate": {
      if (game.gameState.gameOver) return { ok: false, code: "GAME_NOT_FOUND" };
      // A seated player watching their own table would be handed the seatless
      // view and lose sight of their own hand.
      if (seatOfUser(game, action.userId) !== null) {
        return { ok: false, code: "ALREADY_IN_ROOM" };
      }
      game.spectators.add(action.userId);
      sendGameStateTo(io, action.userId, game);
      logger.info({ roomId: action.roomId, userId: action.userId }, "Spectator joined");
      return OK;
    }
    case "unspectate":
      game.spectators.delete(action.userId);
      return OK;
    case "seatLost":
      return seatLostAction(io, game, action);
    case "vacate":
      // `rooms.status` reads "finished" between manches too, so only the live
      // game knows whether the seat is still held. Removing the DB row alone
      // leaves it live — auto-playing the leaver's hand, or blocking the
      // rematch gate.
      return vacateSeat(io, action.roomId, action.userId, action.username).then(() =>
        dealIfSeatLeftGateClosed(io, action.roomId)
      );
  }
}

/**
 * Wires the owner-side handlers to the router. Called once, from
 * `setupSocket` — the routing listener is an `io` listener, not a per-socket
 * one.
 */
export function installTableHandlers(io: SocketServer): void {
  setTableHandlers(applyTableAction, rehydrateGame);
  setRoomLostHandler((roomId) => disposeGame(roomId, false));
  registerTableRouting(io);
}

export { applyOrForward };
