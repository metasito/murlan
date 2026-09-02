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
  /** Manches decided on this match so far. Zero on the one being dealt. */
  handsPlayed: number;
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
   * Seats dealt to a bot when this match's roster was built — a straight duel
   * or a bot-filled table from the start, never a human's seat this match.
   * `foldHandIntoMatch` reads this to tell that seat apart from one a human
   * later walked out of: both score under the same `bot:<seat>` key, but only
   * the latter must be kept from accumulating under a name nobody left behind
   * to claim it. Not in `playerMap`'s own shape (a `Record` can't say "was
   * never a key"), so it travels beside it rather than folding in.
   *
   * Restored from `personality` on a restart (`botSeatsFromPersonality`),
   * which is persisted, rather than left empty like the true memory-only
   * fields below.
   */
  botSeatsAtStart: Set<number>;
  /**
   * Everyone whose seat at this table has been given up. `playerMap` has
   * forgotten them, so without this a rejoin cannot tell someone whose grace
   * ran out from an account that never sat here — and answers both the same.
   *
   * Never cleared while the table lives: the whole point is to still recognise
   * them manches later. Memory only, like `abandonedSeats` — persisting it
   * would need a GAME_SCHEMA_VERSION bump, and a restart losing it costs a
   * courtesy rather than a seat.
   */
  releasedSeats: Set<string>;
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

let shuttingDown = false;

/**
 * Called before `io.close()`. Two things read it: a lobby seat held for a grace
 * period the next process will never honour is a room nobody can join, and a
 * table action routed to another instance is work this process will not be here
 * to finish. It lives here rather than beside either of them because both must
 * see it and neither may import the other.
 */
export function beginShutdown(): void {
  shuttingDown = true;
}

export function isShuttingDown(): boolean {
  return shuttingDown;
}
export const socketRoomMap = new Map<string, string>();
// Spectators are tracked apart from socketRoomMap on purpose: that map drives
// the disconnect and leave paths for *seated* players, and a spectator dropping
// out must not run a single line of them.
export const spectatorRoomMap = new Map<string, string>();
/**
 * The socket *this process* is serving for an account, and deliberately only
 * that. Everything addressed to a person goes to `userRoom(userId)` through the
 * adapter instead, which is what reaches the other instances.
 *
 * What is left needs a local socket object rather than an address: closing a
 * replaced session while carrying its room association over, evicting a deleted
 * account, and asking whether anyone at a finished table is still here before
 * disposing of it. Each is answered with `io.sockets.sockets.get(...)`, which
 * only ever knows about this process — so the map is exactly as wide as its
 * remaining job. The cluster-wide half of the singleton rule is
 * `evictRemoteSessions` in `server/socket.ts`.
 */
export const userSocketMap = new Map<string, string>();

/**
 * The Socket.IO room every one of an account's sockets joins, so a message for
 * a *person* is addressed to the person rather than to a socket id looked up in
 * a map.
 *
 * The map has one failure mode and it is silent: a send that resolves through it
 * skips anyone whose entry is missing at that instant, and the caller cannot
 * tell that from "delivered". A room is right when the account has no socket,
 * one, or two mid-eviction, and it is the same call that reaches another
 * instance once an adapter exists.
 */
export function userRoom(userId: string): string {
  return `user:${userId}`;
}


export function scoreKeyForSeat(game: OnlineGameState, seat: number): string {
  return scoreKeyForMapSeat(game.playerMap, seat);
}

export function seatOfUser(game: OnlineGameState, userId: string): number | null {
  return seatOfUserInMap(game.playerMap, userId);
}
