// The process's live in-memory tables. Owned here rather than by
// server/socket.ts so that reading one does not mean importing the socket
// server, and everything it drags in behind it.
import type { GameState, GameMode, MatchLength } from "../lib/gameEngine.ts";
import type { ReplayMove } from "../lib/replay.ts";

export interface OnlineGameState {
  gameState: GameState;
  /** engine seat index -> userId. A missing seat is a vacated (bot) seat. */
  playerMap: Record<number, string>;
  roomId: string;
  /** Ready gate for the next manche of the running match, by userId. */
  rematchVotes: Set<string>;
  /**
   * Answers to the side-panel rematch question, by userId. Asked while the
   * closing manche is still in play and read once the match ends; a seat that
   * never answered counts as a no. Bot seats are not stored — they have no
   * userId to key by, and abstain from the verdict entirely (see
   * countRematchAnswers).
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
   * seat -> combination flags played by that seat during the *current hand*
   * only (reset whenever a new hand deals — game start and rematch). Feeds
   * GameResult.playedBomb/playedJoker at game-over: the engine itself
   * (lib/gameEngine.ts) does not track this, and GameResult has no other
   * honest source for it. Persisted inside the game_state envelope alongside
   * schemaVersion, so a restart mid-hand does not silently cost the seat its
   * bomb/joker achievement eligibility.
   */
  handFlags: Record<number, { bomb: boolean; joker: boolean }>;
  /**
   * seat -> the userId who walked out on the hand being played, for seats
   * vacated while they still held cards. `playerMap` has already forgotten
   * them by then and a seat missing from it scores as `bot:<seat>`, which
   * every stats and ladder write drops, so this is the only thing that still
   * ties the seat to a person. Read at game over to record it as a real
   * last-place finish, and cleared wherever a new hand deals — the forfeit is
   * recorded once, not in every remaining manche of the match.
   *
   * In memory only: putting it in the persisted `game_state` envelope would
   * change a stored shape, and a GAME_SCHEMA_VERSION bump disposes every live
   * game on its next rejoin.
   */
  abandonedSeats: Map<number, string>;
  /**
   * When the acting seat's AFK window runs out, in server time. Undefined
   * whenever nothing is on the clock — a vacated seat waiting on a bot, or a
   * finished hand. Memory only: it is re-armed on the next move and would be
   * meaningless after a restart.
   */
  turnDeadlineMs?: number;
  /**
   * The seat the next manche deals from. The two extra cards of a 54-card
   * deal land on it and its neighbour, so it advances every manche — seat 0 is
   * always the host, and a fixed origin hands the host's half of the table a
   * bigger hand for the whole match.
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
   * In memory only, unlike handFlags: the game_state envelope is rewritten
   * after every move, and carrying a few hundred combinations through each of
   * those writes would buy nothing but a replay of a hand a restart
   * interrupted — a hand that has no replay yet either way. `null` means this
   * hand cannot produce one (rehydrated after a restart, or past
   * MAX_REPLAY_MOVES) and nothing will be written for it.
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
export const publicRoomIds = new Set<string>();

/**
 * Who lost their connection to a waiting lobby, per room id: userId -> whether
 * they held the room at the moment they dropped.
 *
 * A lobby disconnect deletes the `room_players` row immediately, so nothing in
 * the database still says the caller was ever seated. This is that evidence,
 * and `room:rejoin` is its only reader: without an entry (and without a
 * surviving seat row) a caller holding the six-character code is arriving, not
 * returning, and `room:join` is their event. It is also the only thing that may
 * hand the room back — the host role returns to the account that lost it and to
 * nobody else.
 *
 * In memory: a restart drops every socket anyway, so there is no reconnect left
 * to answer.
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
