// server/game/tableState.ts — the one place an `OnlineGameState` is built: dealt
// fresh by `newTable`, packed for active_games by `toEnvelope`, and read back
// by `fromEnvelope`. The stored shape is `shared/persistedEnvelope.ts`'s.
import type { OnlineGameState } from "./gameRoom.ts";
import {
  botSeatsFromPersonality,
  seatAssignmentsFromRoster,
  type SeatEntry,
} from "./onlineGameLogic.ts";
import { botSeatKey } from "../../lib/game/botSeat.ts";
import {
  packPersistedState,
  unpackPersistedState,
  type PersistedEnvelope,
} from "../../shared/persistedEnvelope.ts";
import { dealFirstSeatFor, firstTargetFor, startRound } from "../../lib/game/gameEngine.ts";
import type { GameMode, GameState, MatchLength, Opening } from "../../lib/game/gameEngine.ts";

/** The fields no envelope carries, each with the value a table starts it on. */
const MEMORY_ONLY_START = {
  resultWrites: () => undefined,
  rematchVotes: () => new Set<string>(),
  endMatchVotes: () => new Set<string>(),
  turnDeadlineMs: () => undefined,
  spectators: () => new Set<string>(),
  moveLog: () => null,
  lastRoundOverPayload: () => undefined,
} satisfies { [K in keyof OnlineGameState]?: () => OnlineGameState[K] };

type MemoryOnlyField = keyof typeof MEMORY_ONLY_START;
type MemoryOnly = Pick<OnlineGameState, MemoryOnlyField>;

export const MEMORY_ONLY = Object.keys(MEMORY_ONLY_START) as MemoryOnlyField[];

/**
 * Every other field: packed by `toEnvelope`, or derived by `fromEnvelope` from
 * the row. A field missing here or in `MEMORY_ONLY_START` fails to compile.
 */
const PERSISTED_FIELDS: { [K in Exclude<keyof OnlineGameState, MemoryOnlyField>]: true } = {
  gameState: true,
  playerMap: true,
  roomId: true,
  joinCode: true,
  cumulativeScores: true,
  maxPlayers: true,
  matchTarget: true,
  matchLength: true,
  roundsPlayed: true,
  matchOver: true,
  endedByVote: true,
  roundFlags: true,
  abandonedSeats: true,
  botSeatsAtStart: true,
  releasedSeats: true,
  vacatedSeats: true,
  weakSeats: true,
  dealFirstSeat: true,
};

export const PERSISTED = Object.keys(PERSISTED_FIELDS) as Exclude<keyof OnlineGameState, MemoryOnlyField>[];

export function freshMemory(moveLog: OnlineGameState["moveLog"]): MemoryOnly {
  const memory: Record<string, unknown> = {};
  for (const field of MEMORY_ONLY) {
    const value = field === "moveLog" ? moveLog : MEMORY_ONLY_START[field]();
    if (value !== undefined) memory[field] = value;
  }
  return memory as MemoryOnly;
}

export interface TableRoom {
  id: string;
  code: string;
  gameMode: GameMode;
  maxPlayers: number;
}

/**
 * The previous match's winner and loser, as seats of the roster about to be
 * dealt. A table lasts until it breaks up (docs/GAME-RULES.md § Decisions), so
 * a new match at a standing table opens with the exchange rather than the 3♠.
 * Empty when there is nothing to carry: no previous match, a round nobody
 * played out, a match ended by the vote, or either seat no longer at the table
 * — every one of which deals the 3♠ opening instead.
 */
function carriedOpening(previous: OnlineGameState | undefined, roster: { userId: string }[]): Opening {
  const none: Opening = { kind: "startCard" };
  if (!previous || previous.endedByVote) return none;
  const { players, finishingOrder } = previous.gameState;
  if (finishingOrder.length !== players.length) return none;

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

  const winnerSeat = newSeatOf(finishingOrder[0]);
  const loserSeat = newSeatOf(finishingOrder[finishingOrder.length - 1]);
  if (winnerSeat < 0 || loserSeat < 0 || winnerSeat === loserSeat) return none;
  return { kind: "exchange", winnerSeat, loserSeat };
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
  const seats = roster.map((r) => ({
    name: r.username,
    type: (r.isBot ? "bot" : "human") as "human" | "bot",
    personality: r.isBot ? r.personality : undefined,
  }));
  const gameState = startRound(seats, room.gameMode, { opening: carriedOpening(previous, roster) });
  const { playerMap, botSeatsAtStart } = seatAssignmentsFromRoster(roster);

  return {
    gameState,
    playerMap,
    roomId: room.id,
    joinCode: room.code,
    cumulativeScores: previous?.cumulativeScores ?? {},
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
    ...freshMemory([]),
  };
}

export function toEnvelope(game: OnlineGameState): PersistedEnvelope<GameState> {
  return packPersistedState(game.gameState, game.roundFlags, game.dealFirstSeat, game.joinCode, {
    playerMap: game.playerMap,
    scores: game.cumulativeScores,
    gameMode: game.gameState.gameMode,
    matchLength: game.matchLength,
    matchTarget: game.matchTarget,
    maxPlayers: game.maxPlayers,
    roundsPlayed: game.roundsPlayed,
    endedByVote: !!game.endedByVote,
    matchOver: game.matchOver,
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
 * An active_games row as a live table, or why it cannot be one. `botSeatsAtStart`
 * is not stored: it is derived from what is.
 */
export function fromEnvelope(row: { roomId: string; gameState: unknown }): TableRestore {
  const restored = unpackPersistedState<GameState>(row.gameState);
  if (!restored.ok) return restored;

  const { playerMap, scores, matchLength, matchTarget, maxPlayers, roundsPlayed, endedByVote, matchOver } =
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
      maxPlayers,
      matchTarget,
      matchLength,
      roundsPlayed,
      endedByVote,
      matchOver,
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
