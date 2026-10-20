import { payload } from "../shared/payload.ts";

type RejoinCode =
  | "UNAUTHORIZED"
  | "SEAT_RELEASED"
  | "NO_LIVE_GAME"
  | "GAME_NO_LONGER_VALID"
  | "INVALID_PAYLOAD"
  | "SERVER_ERROR";

/**
 * What the client is told when a rejoin fails, keyed by the refusal the owning
 * instance gave. `game:rejoin_failed` is the only failure the client's rejoin
 * handling listens for, and `roomId` stays top-level because its stale-reply
 * guard matches on it.
 */
const REJOIN_FAILURE: Record<RejoinCode, ReturnType<typeof payload>> = {
  UNAUTHORIZED: payload("UNAUTHORIZED"),
  SEAT_RELEASED: payload("SEAT_RELEASED"),
  NO_LIVE_GAME: payload("GAME_NOT_FOUND"),
  GAME_NO_LONGER_VALID: payload("GAME_NO_LONGER_VALID"),
  INVALID_PAYLOAD: payload("INVALID_PAYLOAD"),
  SERVER_ERROR: payload("SERVER_ERROR"),
};

// Own keys only: `in` would also accept "constructor" and every other prototype name.
const isRejoinCode = (code: string): code is RejoinCode => Object.hasOwn(REJOIN_FAILURE, code);

export function rejoinFailure(code: string, roomId: unknown): ReturnType<typeof payload> & { roomId?: string } {
  const failure = isRejoinCode(code) ? REJOIN_FAILURE[code] : REJOIN_FAILURE.SERVER_ERROR;
  return { ...failure, roomId: typeof roomId === "string" ? roomId : undefined };
}
