// The process's live in-memory tables. Owned here rather than by
// server/socket.ts so that reading one does not mean importing the socket
// server, and everything it drags in behind it.
import type { GameState, GameMode, MatchLength } from "../lib/gameEngine.ts";
import type { ReplayMove } from "../lib/replay.ts";
import {
  scoreKeyForSeat as scoreKeyForMapSeat,
  seatOfUser as seatOfUserInMap,
} from "./onlineGameLogic.ts";

export interface OnlineGameState {
  gameState: GameState;
  /** engine seat index -> userId. A missing seat is a vacated (bot) seat. */
  playerMap: Record<number, string>;
  roomId: string;
  /** The room's six-character join code, as `rooms.code` holds it. */
  joinCode: string;
  /** Ready gate for the next manche of the running match, by userId. */
  rematchVotes: Set<string>;
  /**
   * Answers to the side-panel rematch question, by userId. A seat that never
   * answered counts as a no. Bot seats are absent — no userId to key by — and
   * abstain from the verdict (countRematchAnswers).
   */
  rematchIntents: Map<string, boolean>;
  /** userId (or `bot:<seat>`) -> cumulative match points. */
  cumulativeScores: Record<string, number>;
  gameMode: GameMode;
  maxPlayers: number;
  matchTarget: number;
  matchLength: MatchLength;
  matchOver: boolean;
  /**
   * seat -> combination flags for the *current hand* only, reset whenever one
   * deals. The engine does not track this, and GameResult has no other honest
   * source for playedBomb/playedJoker. Persisted in the game_state envelope so
   * a restart mid-hand does not cost the seat its achievement eligibility.
   */
  handFlags: Record<number, { bomb: boolean; joker: boolean }>;
  /**
   * seat -> the userId who walked out on the hand being played. `playerMap` has
   * forgotten them by then and a seat missing from it scores as `bot:<seat>`,
   * which every stats and ladder write drops — so this is the only thing still
   * tying the seat to a person. Cleared wherever a new hand deals: the forfeit
   * is recorded once, not in every remaining manche.
   *
   * Memory only — persisting it would need a GAME_SCHEMA_VERSION bump, which
   * disposes every live game.
   */
  abandonedSeats: Map<number, string>;
  /**
   * When the acting seat's AFK window runs out, in server time. Undefined when
   * nothing is on the clock. Memory only — re-armed on the next move.
   */
  turnDeadlineMs?: number;
  /**
   * The seat the next manche deals from. The two extra cards of a 54-card deal
   * land on it and its neighbour, so it advances every manche — seat 0 is always
   * the host, and a fixed origin would favour the host's half all match.
   */
  dealFirstSeat: number;
  /**
   * userIds watching without a seat. Deliberately not persisted: a spectator
   * who reconnects spectates again, and a restart dropping them costs nothing.
   */
  spectators: Set<string>;
  /**
   * This hand's move log, written once to `match_replays` at game over.
   *
   * Memory only, unlike handFlags: the envelope is rewritten after every move,
   * and carrying a few hundred combinations through each would buy nothing.
   * `null` means this hand cannot produce a replay — rehydrated after a
   * restart, or past MAX_REPLAY_MOVES — and none will be written.
   */
  moveLog: ReplayMove[] | null;
}

export const activeGames = new Map<string, OnlineGameState>();
export const socketRoomMap = new Map<string, string>();
// Spectators are tracked apart from socketRoomMap on purpose: that map drives
// the disconnect and leave paths for *seated* players, and a spectator dropping
// out must not run a single line of them.
export const spectatorRoomMap = new Map<string, string>();
export const userSocketMap = new Map<string, string>();

/**
 * Who lost their connection to a waiting lobby: room id -> userId -> whether
 * they held the room when they dropped.
 *
 * A lobby disconnect deletes the `room_players` row at once, so this is the
 * only evidence the caller was ever seated, and `room:rejoin` its only reader:
 * with no entry and no seat row, a caller holding the code is arriving. It is
 * also the only thing that hands the room back to the account that lost it.
 */
export const lobbyDropouts = new Map<string, Map<string, boolean>>();

export function rememberLobbyDropout(roomId: string, userId: string, wasHost: boolean) {
  const room = lobbyDropouts.get(roomId) ?? new Map<string, boolean>();
  room.set(userId, wasHost);
  lobbyDropouts.set(roomId, room);
}

export function forgetLobbyDropout(roomId: string, userId: string) {
  const room = lobbyDropouts.get(roomId);
  if (!room) return;
  room.delete(userId);
  if (room.size === 0) lobbyDropouts.delete(roomId);
}

export function scoreKeyForSeat(game: OnlineGameState, seat: number): string {
  return scoreKeyForMapSeat(game.playerMap, seat);
}

export function seatOfUser(game: OnlineGameState, userId: string): number | null {
  return seatOfUserInMap(game.playerMap, userId);
}
