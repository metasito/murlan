// server/game/tableState.ts — the one place an `OnlineGameState` is built: dealt
// fresh by `newTable`, packed for active_games by `toEnvelope`, and read back
// by `fromEnvelope`. The stored shape is `shared/persistedEnvelope.ts`'s.
import type { OnlineGameState } from "./gameRoom.ts";
import {
  botSeatsFromPersonality,
  restoredMatchOver,
  seatAssignmentsFromRoster,
  teamKeyMap,
  type SeatEntry,
} from "./onlineGameLogic.ts";
import { botSeatKey } from "./botSeat.ts";
import { startReplayLog } from "./replayShape.ts";
import {
  packPersistedState,
  unpackPersistedState,
  type PersistedEnvelope,
} from "../../shared/persistedEnvelope.ts";
import {
  dealFirstSeatFor,
  firstTargetFor,
  initializeGame,
  initializeRematch,
  teamForSeat,
} from "../../lib/game/gameEngine.ts";
import type { GameMode, GameState, MatchLength } from "../../lib/game/gameEngine.ts";

/** The fields no envelope carries: a restored table starts each one empty. */
export const MEMORY_ONLY = [
  "resultWrites",
  "rematchVotes",
  "endMatchVotes",
  "turnDeadlineMs",
  "spectators",
  "moveLog",
  "lastRoundOverPayload",
] as const satisfies readonly (keyof OnlineGameState)[];

type MemoryOnly = Pick<OnlineGameState, (typeof MEMORY_ONLY)[number]>;

export function freshMemory(moveLog: OnlineGameState["moveLog"]): MemoryOnly {
  return { rematchVotes: new Set(), endMatchVotes: new Set(), spectators: new Set(), moveLog };
}

export interface TableRoom {
  id: string;
  code: string;
  gameMode: GameMode;
  maxPlayers: number;
}

/**
 * The previous match's winner and loser, as engine ids of the roster about to
 * be dealt. A table lasts until it breaks up (docs/GAME-RULES.md § Decisions), so
 * a new match at a standing table opens with the exchange rather than the 3♠.
 * Empty when there is nothing to carry: no previous match, a round nobody
 * played out, a match ended by the vote, or either seat no longer at the table
 * — every one of which deals the 3♠ opening instead.
 */
function carriedFinishingOrder(
  previous: OnlineGameState | undefined,
  roster: { userId: string }[]
): string[] {
  if (!previous || previous.endedByVote) return [];
  const { players, finishingOrder } = previous.gameState;
  if (finishingOrder.length !== players.length) return [];

  const seatOfEngineId = new Map(players.map((p, seat) => [p.id, seat]));
  const newSeatOf = (engineId: string | undefined): number => {
    const seat = engineId === undefined ? undefined : seatOfEngineId.get(engineId);
    if (seat === undefined) return -1;
    const userId =
      previous.playerMap[seat] ??
      previous.vacatedSeats.get(seat)?.userId ??
      (previous.botSeatsAtStart.has(seat) ? botSeatKey(seat) : undefined);
    return userId === undefined ? -1 : roster.findIndex((r) => r.userId === userId);
  };

  const winner = newSeatOf(finishingOrder[0]);
  const loser = newSeatOf(finishingOrder[finishingOrder.length - 1]);
  if (winner < 0 || loser < 0 || winner === loser) return [];
  return [`player_${winner}`, `player_${loser}`];
}

/**
 * The table `startMatch` deals, seated from `roster` in engine-seat order.
 * `previous` is the finished match at this room, if one is still in memory.
 */
export function newTable(
  room: TableRoom,
  roster: SeatEntry[],
  previous?: OnlineGameState,
  matchLength?: MatchLength
): OnlineGameState {
  const playerSetup = roster.map((r, idx) => ({
    name: r.username,
    type: (r.isBot ? "bot" : "human") as "human" | "bot",
    personality: r.isBot ? r.personality : undefined,
    team: teamForSeat(idx, roster.length, room.gameMode),
  }));
  const carried = carriedFinishingOrder(previous, roster);
  const gameState =
    carried.length > 0
      ? initializeRematch(playerSetup, room.gameMode, carried)
      : initializeGame(playerSetup, room.gameMode);
  const { playerMap, botSeatsAtStart } = seatAssignmentsFromRoster(roster);

  return {
    gameState,
    playerMap,
    roomId: room.id,
    joinCode: room.code,
    cumulativeScores: previous?.cumulativeScores ?? {},
    gameMode: room.gameMode,
    maxPlayers: room.maxPlayers,
    matchTarget: previous?.matchTarget ?? firstTargetFor(roster.length),
    matchLength: matchLength ?? previous?.matchLength ?? "match",
    roundsPlayed: previous?.roundsPlayed ?? 0,
    matchOver: previous?.matchOver ?? false,
    roundFlags: {},
    abandonedSeats: new Map(),
    botSeatsAtStart,
    releasedSeats: new Set(),
    vacatedSeats: new Map(),
    weakSeats: new Set(),
    // Reached only when a match is genuinely starting fresh (no `previous`,
    // or `previous.matchOver`), so `matchOver` is unconditionally `true`.
    dealFirstSeat: dealFirstSeatFor(true, 0, roster.length),
    ...freshMemory(startReplayLog()),
  };
}

export function toEnvelope(game: OnlineGameState): PersistedEnvelope<GameState> {
  return packPersistedState(game.gameState, game.roundFlags, game.dealFirstSeat, game.joinCode, {
    playerMap: game.playerMap,
    scores: game.cumulativeScores,
    gameMode: game.gameMode,
    matchLength: game.matchLength,
    matchTarget: game.matchTarget,
    maxPlayers: game.maxPlayers,
    roundsPlayed: game.roundsPlayed,
    endedByVote: !!game.endedByVote,
  }, {
    vacatedSeats: [...game.vacatedSeats],
    releasedSeats: [...game.releasedSeats],
    weakSeats: [...game.weakSeats],
    abandonedSeats: [...game.abandonedSeats],
  });
}

export type TableRestore =
  | { ok: true; game: OnlineGameState }
  | { ok: false; reason: string; newer?: true };

/**
 * An active_games row as a live table, or why it cannot be one. `matchOver`
 * and `botSeatsAtStart` are not stored: they are derived from what is.
 */
export function fromEnvelope(row: { roomId: string; gameState: unknown }): TableRestore {
  const restored = unpackPersistedState<GameState>(row.gameState);
  if (!restored.ok) return restored;

  const { playerMap, scores, gameMode, matchLength, matchTarget, maxPlayers, roundsPlayed, endedByVote } =
    restored.match;
  const gameState = restored.gameState;
  const vacatedSeats = new Map(restored.seats.vacatedSeats);
  return {
    ok: true,
    game: {
      roomId: row.roomId,
      joinCode: restored.joinCode,
      gameState,
      playerMap,
      cumulativeScores: scores,
      gameMode,
      maxPlayers,
      matchTarget,
      matchLength,
      roundsPlayed,
      endedByVote,
      matchOver: endedByVote || restoredMatchOver({
        matchLength,
        gameMode,
        roundOver: gameState.roundOver,
        scores,
        target: matchTarget,
        teamOfKey: teamKeyMap(playerMap, gameState.players, vacatedSeats),
        playerCount: gameState.players.length,
      }),
      roundFlags: restored.roundFlags,
      abandonedSeats: new Map(restored.seats.abandonedSeats),
      botSeatsAtStart: botSeatsFromPersonality(gameState.players),
      releasedSeats: new Set(restored.seats.releasedSeats),
      vacatedSeats,
      weakSeats: new Set(restored.seats.weakSeats),
      dealFirstSeat: restored.dealFirstSeat,
      // A round restored after a restart produces no replay; the next one starts a fresh log.
      ...freshMemory(null),
    },
  };
}
