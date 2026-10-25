import type { OnlineGameState } from "./gameRoom.ts";
import { testOnlyEnv } from "../http/testOnlyEnv.ts";
import { TURN_TIMEOUT_MS } from "../../lib/game/gameEngine.ts";
import { BOT_THINK_MS } from "../../lib/game/turnSchedule.ts";
import { clock, now } from "../http/clock.ts";

/**
 * Keys: `afk` and `lobbyGrace` are `roomId:userId` (`seatKey`), `bot`,
 * `autoStart` and `voteDeadline` are the room id, `disconnect` is the user id.
 */
export const TIMER_KINDS = ["afk", "disconnect", "lobbyGrace", "bot", "autoStart", "voteDeadline"] as const;
export type TimerKind = (typeof TIMER_KINDS)[number];

/**
 * A seat waiting to be given back must not be what keeps the process alive:
 * shutdown disconnects every socket, which arms a lobby grace per lobby, and
 * the row outlives the process either way. A vote deadline is armed at every
 * round's end and a restore re-arms it, so nothing is lost by not waiting.
 */
const UNREF: ReadonlySet<TimerKind> = new Set(["lobbyGrace", "voteDeadline"]);

interface Armed {
  handle: unknown;
  deadline: number;
}

const timers = new Map<TimerKind, Map<string, Armed>>(TIMER_KINDS.map((kind) => [kind, new Map()]));

let stopped = false;

/** Every later `arm` arms nothing: a shutdown has cleared the tables' timers for good. */
export function stopArming(): void {
  stopped = true;
}

/** Replaces whatever this key had armed. The entry is gone before `onExpire` runs. */
export function arm(kind: TimerKind, key: string, ms: number, onExpire: () => void) {
  clear(kind, key);
  if (stopped) return;
  const entries = timers.get(kind)!;
  const handle = clock().setTimeout(() => {
    entries.delete(key);
    onExpire();
  }, ms);
  if (UNREF.has(kind)) (handle as { unref?: () => void }).unref?.();
  entries.set(key, { handle, deadline: now() + ms });
}

/** Returns whether one was armed. */
export function clear(kind: TimerKind, key: string): boolean {
  const entries = timers.get(kind)!;
  const armed = entries.get(key);
  if (!armed) return false;
  clock().clearTimeout(armed.handle);
  entries.delete(key);
  return true;
}

export function pending(kind: TimerKind, key: string): boolean {
  return timers.get(kind)!.has(key);
}

/** When it fires, on `now()`'s clock; undefined when nothing is armed. */
export function deadline(kind: TimerKind, key: string): number | undefined {
  return timers.get(kind)!.get(key)?.deadline;
}

export function pendingKeys(kind: TimerKind): string[] {
  return [...timers.get(kind)!.keys()];
}

function clearByPrefix(kind: TimerKind, prefix: string) {
  for (const key of pendingKeys(kind)) if (key.startsWith(prefix)) clear(kind, key);
}

/**
 * Read per call, never frozen at module scope.
 *
 * A module-scope read is settled by whoever imports this first, and ESM hoists
 * every import above the module body — so a test setting one of these in its own
 * body only reaches the modules that were *not* already in the static graph.
 * Which ones those are is an accident of who imports whom, and it changes
 * silently when anyone adds an import anywhere in `server/`.
 * Pinned by `tests/tooling/timerEnvIsLive.test.ts`.
 */
function timeoutFromEnv(name: string, defaultMs: number): number {
  const raw = testOnlyEnv(name);
  if (!raw) return defaultMs;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultMs;
}

export const afkTimeoutMs = () => timeoutFromEnv("MURLAN_AFK_TIMEOUT_MS", TURN_TIMEOUT_MS);
export const disconnectGraceMs = () => timeoutFromEnv("MURLAN_DISCONNECT_GRACE_MS", 60_000);
/**
 * Shorter than the in-game grace on purpose. A player who drops mid-round is
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
// Tunable for tests, which otherwise pay it on every move of every table a
// disconnect hands over to the bot.
export const botMoveDelayMs = () => timeoutFromEnv("MURLAN_BOT_MOVE_DELAY_MS", BOT_THINK_MS);
export const sweepIntervalMs = () => timeoutFromEnv("MURLAN_SWEEP_INTERVAL_MS", 5 * 60_000);
/**
 * How long a matchmade table waits, once full, before dealing itself.
 *
 * Long enough that the last arrival sees the table they joined rather than a
 * round already in flight, short enough that nobody reads it as a stall.
 */
export const autoStartDelayMs = () => timeoutFromEnv("MURLAN_AUTOSTART_DELAY_MS", 4_000);
/** docs/GAME-RULES.md § Decisions, "The next-round vote deadline". */
export const voteDeadlineMs = () => timeoutFromEnv("MURLAN_VOTE_DEADLINE_MS", 30_000);

export function clearAutoStart(roomId: string) {
  clear("autoStart", roomId);
}

/** Whole seconds left on a deadline, floored at 0. Zero when nothing is armed. */
export function secondsUntil(deadlineMs: number | undefined): number {
  if (deadlineMs === undefined) return 0;
  return Math.max(0, Math.ceil((deadlineMs - now()) / 1000));
}

/** Keyed per room, so one account can hold a seat in only one lobby. */
export function seatKey(roomId: string, userId: string): string {
  return `${roomId}:${userId}`;
}

export function clearAfkTimer(roomId: string, userId: string) {
  clear("afk", seatKey(roomId, userId));
}

export function clearTurnTimers(roomId: string) {
  clearByPrefix("afk", `${roomId}:`);
  clear("bot", roomId);
}

export function clearRoomTimers(roomId: string) {
  clearTurnTimers(roomId);
  clearAutoStart(roomId);
  clear("voteDeadline", roomId);
}

/** Who is holding a seat in this room without a connection to it. */
export function usersInLobbyGrace(roomId: string): string[] {
  const prefix = `${roomId}:`;
  return pendingKeys("lobbyGrace")
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
  return clear("lobbyGrace", seatKey(roomId, userId));
}

/**
 * Cancels the grace a disconnected seat is held under, and says whether one was
 * armed. Deliberately not the AFK window beside it: a rejoin proves the player
 * is back, not that they have taken their turn, and re-arming the clock on
 * every rejoin lets a client loop hold a table open indefinitely.
 */
export function clearDisconnectGrace(userId: string): boolean {
  return clear("disconnect", userId);
}

export function clearAllTimersForUser(userId: string, roomId?: string) {
  clearDisconnectGrace(userId);
  if (roomId) {
    clearAfkTimer(roomId, userId);
    clearLobbyGrace(roomId, userId);
  }
}

/** Cancels the grace timers of everyone seated in this room. */
export function clearRoomDisconnectTimers(game: OnlineGameState) {
  for (const uid of Object.values(game.playerMap)) clearDisconnectGrace(uid);
}
