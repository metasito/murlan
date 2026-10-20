import type { TableRuntime } from "./tableRuntime.ts";
import { emitVoteState } from "./tableBroadcasts.ts";
import { OK, refuse, type Outcome, type Refusal } from "../shared/refusal.ts";
import { logger } from "../shared/logger.ts";
import { activeGames, isShuttingDown } from "./gameRoom.ts";
import { stopSpectatingEverywhere } from "../socket/seating.ts";
import { armVoteDeadline } from "./roundOver.ts";
import { clearRoomTimers, clearLobbyGrace, usersInLobbyGrace } from "./gameTimers.ts";
import { buildSeatRoster, seatOfUser } from "./onlineGameLogic.ts";
import { unpackPersistedState } from "../../shared/persistedEnvelope.ts";
import { fromEnvelope, newTable } from "./tableState.ts";
import { handleSeatRelease, retireRoomInvites, roomStatePayload, teamsSizeRefusal } from "../socket/socketTable.ts";
import type { GameState } from "../../lib/game/gameEngine.ts";
import { dealRound } from "./dealRound.ts";
import type { TableAction } from "./tableActions.ts";
import type { RehydrateOutcome } from "./tableRouter.ts";
import { everySeatedVoted } from "./tableVotes.ts";
import { castRematchVote, clearRematchVotes } from "./matchLedger.ts";
import { armSeatGrace } from "./tableHandlers.ts";

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

export async function startMatchAction(
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
    if (seatOfUser(previous.playerMap, userId) !== null) castRematchVote(previous, userId);
    emitVoteState(rt.out.room(roomId), previous);
    if (!everySeatedVoted(previous.rematchVotes, previous)) return refuse("NEW_MATCH_NOT_READY");
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
  if (previous) clearRematchVotes(previous);
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
