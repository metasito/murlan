import type { OnlineGameState } from "./gameRoom.ts";

// Timers. Every entry added here has exactly one matching delete — see
// clearAfkTimer / clearRoomTimers / clearAllTimersForUser / disposeGame.
export const afkTimers = new Map<string, ReturnType<typeof setTimeout>>();
export const disconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
/** Keyed `roomId:userId`, so one account can hold a seat in only one lobby. */
export const lobbyGraceTimers = new Map<string, ReturnType<typeof setTimeout>>();
export const botTimers = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Read per call, never frozen at module scope.
 *
 * A module-scope read is settled by whoever imports this first, and ESM hoists
 * every import above the module body — so a test setting one of these in its own
 * body only reaches the modules that were *not* already in the static graph.
 * Which ones those are is an accident of who imports whom, and it changes
 * silently when anyone adds an import anywhere in `server/`.
 * Pinned by `tests/timerEnvIsLive.test.ts`.
 */
function timeoutFromEnv(name: string, defaultMs: number): number {
  const raw = process.env[name];
  if (!raw) return defaultMs;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultMs;
}

export const afkTimeoutMs = () => timeoutFromEnv("MURLAN_AFK_TIMEOUT_MS", 30_000);
export const disconnectGraceMs = () => timeoutFromEnv("MURLAN_DISCONNECT_GRACE_MS", 60_000);
/**
 * Shorter than the in-game grace on purpose. A player who drops mid-hand is
 * one everyone is already waiting for, and a minute is worth it. A seat in a
 * lobby is one nobody has arrived for yet, so holding it that long blocks the
 * room from filling — this only has to outlast a network hiccup.
 */
export const lobbyGraceMs = () => timeoutFromEnv("MURLAN_LOBBY_GRACE_MS", 20_000);
/**
 * How long a seat invited into a room is held before a stranger may take it.
 *
 * Not derived from any of the graces above: every one of those guards a seat
 * whose occupant was connected and dropped, and this one guards a seat for
 * someone who has never arrived. Two minutes is the decision recorded in
 * `docs/BRIEF.md` §3.3 — a minute is hostile to the friend still on the bus,
 * ten is hostile to the room.
 */
export const seatHoldMs = () => timeoutFromEnv("MURLAN_SEAT_HOLD_MS", 120_000);
/**
 * How long a client has to say it received a state broadcast before the server
 * sends it again. Generous: this must outlast a slow round trip on mobile, or a
 * table on a bad connection pays a duplicate snapshot for every move.
 */
export const stateAckTimeoutMs = () => timeoutFromEnv("MURLAN_STATE_ACK_TIMEOUT_MS", 5_000);
// Paced so a bot seat reads as thinking rather than as an instant reflex.
// Tunable for tests, which otherwise pay it on every move of every table a
// disconnect hands over to the AI.
export const botMoveDelayMs = () => timeoutFromEnv("MURLAN_BOT_MOVE_DELAY_MS", 1_200);
export const SWEEP_INTERVAL_MS = 5 * 60_000;

/** Whole seconds left on a deadline, floored at 0. Zero when nothing is armed. */
export function secondsUntil(deadlineMs: number | undefined): number {
  if (deadlineMs === undefined) return 0;
  return Math.max(0, Math.ceil((deadlineMs - Date.now()) / 1000));
}

export function clearAfkTimer(roomId: string, userId: string) {
  const key = `${roomId}:${userId}`;
  const t = afkTimers.get(key);
  if (t) {
    clearTimeout(t);
    afkTimers.delete(key);
  }
}

function clearRoomAfkTimers(roomId: string) {
  const prefix = `${roomId}:`;
  for (const [key, timer] of afkTimers) {
    if (key.startsWith(prefix)) {
      clearTimeout(timer);
      afkTimers.delete(key);
    }
  }
}

function clearBotTimer(roomId: string) {
  const t = botTimers.get(roomId);
  if (t) {
    clearTimeout(t);
    botTimers.delete(roomId);
  }
}

export function clearRoomTimers(roomId: string) {
  clearRoomAfkTimers(roomId);
  clearBotTimer(roomId);
}

export function lobbyGraceKey(roomId: string, userId: string): string {
  return `${roomId}:${userId}`;
}

/** Who is holding a seat in this room without a connection to it. */
export function usersInLobbyGrace(roomId: string): string[] {
  const prefix = `${roomId}:`;
  return Array.from(lobbyGraceTimers.keys())
    .filter((k) => k.startsWith(prefix))
    .map((k) => k.slice(prefix.length));
}

/**
 * Cancels every pending lobby release in a room.
 *
 * A seat can be held under one of these while its game is still live, so the
 * timer outlives a table that is disposed underneath it — and fires against a
 * room that no longer exists.
 */
export function clearRoomLobbyGraces(roomId: string) {
  for (const userId of usersInLobbyGrace(roomId)) clearLobbyGrace(roomId, userId);
}

/** Cancels a pending lobby release. Returns whether one was armed. */
export function clearLobbyGrace(roomId: string, userId: string): boolean {
  const key = lobbyGraceKey(roomId, userId);
  const t = lobbyGraceTimers.get(key);
  if (!t) return false;
  clearTimeout(t);
  lobbyGraceTimers.delete(key);
  return true;
}

/**
 * Cancels the grace a disconnected seat is held under, and says whether one was
 * armed. Deliberately not the AFK window beside it: a rejoin proves the player
 * is back, not that they have taken their turn, and re-arming the clock on
 * every rejoin lets a client loop hold a table open indefinitely.
 */
export function clearDisconnectGrace(userId: string): boolean {
  const t = disconnectTimers.get(userId);
  if (!t) return false;
  clearTimeout(t);
  disconnectTimers.delete(userId);
  return true;
}

export function clearAllTimersForUser(userId: string, roomId?: string) {
  const dcTimer = disconnectTimers.get(userId);
  if (dcTimer) {
    clearTimeout(dcTimer);
    disconnectTimers.delete(userId);
  }
  if (roomId) {
    clearAfkTimer(roomId, userId);
    clearLobbyGrace(roomId, userId);
  }
}

/** Cancels the grace timers of everyone seated in this room. */
export function clearRoomDisconnectTimers(game: OnlineGameState) {
  for (const uid of Object.values(game.playerMap)) {
    const t = disconnectTimers.get(uid);
    if (t) {
      clearTimeout(t);
      disconnectTimers.delete(uid);
    }
  }
}
