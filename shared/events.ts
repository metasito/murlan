// The funnel's steps, as a closed set.
//
// A table that accepts any string becomes unqueryable within a month — one
// typo, or one well-meant extra name, and the funnel silently stops adding up.
// Adding a step here is deliberate, reviewable, and type-checked at every
// call site.
//
// Two steps a funnel would normally want are deliberately absent because they
// are already derivable, and a second source of truth drifts from the first:
// account creation is `users.created_at`, and a finished game is a
// `match_history` row.

export const EVENT_NAMES = [
  /** The tutorial was offered and opened — see the note in server/events.ts. */
  "tutorial.started",
  /** The player reached the online area, which is what opens their socket. */
  "lobby.entered",
  /** They got a seat, rather than only looking at the lobby. */
  "room.joined",
  /** They actually played, rather than sitting down and leaving. */
  "game.firstMoveMade",
  /** They left mid-manche — distinct from losing one. */
  "game.abandoned",
  /** Any socket closed, server side — see server/socketPresence.ts. */
  "socket.closed",
] as const;

export type EventName = (typeof EVENT_NAMES)[number];

/**
 * Socket.IO's own server-side disconnect reason, verbatim —
 * https://socket.io/docs/v4/server-socket-instance/#disconnect. A fixed union
 * rather than the string the library hands the handler, so a reason this type
 * doesn't name is a compile error rather than a silent new bucket in `events`.
 */
export const SOCKET_CLOSE_REASONS = [
  "transport error",
  "transport close",
  "forced close",
  "ping timeout",
  "parse error",
  "server shutting down",
  "forced server close",
  "client namespace disconnect",
  "server namespace disconnect",
] as const;

export type SocketCloseReason = (typeof SOCKET_CLOSE_REASONS)[number];

/**
 * What may travel with an event. Small and non-identifying on purpose: player
 * count, game mode, manche number, close reason. No usernames, no game state
 * — this table exists to count steps, not to describe people.
 */
export interface EventContext {
  playerCount?: number;
  gameMode?: string;
  manche?: number;
  reason?: SocketCloseReason;
}
