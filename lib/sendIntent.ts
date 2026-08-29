import type { Socket } from "socket.io-client";

/**
 * How long to wait for the server to say it heard an intent, and how many times
 * to say it again before giving up.
 *
 * Not `Motion`: nothing animates for this long and nothing should. The budget
 * is a round trip on a bad mobile connection plus the server's own work, and
 * three attempts spans a reconnect without letting a doomed play sit on screen.
 */
export const INTENT_ACK_TIMEOUT_MS = 4000;
export const INTENT_ATTEMPTS = 3;

export interface IntentOutcome {
  ok: boolean;
  /** Set when the server answered and refused. Absent when it never answered. */
  code?: string;
}

/**
 * Sends an intent and waits to be told it arrived, retrying while the server
 * stays silent.
 *
 * Socket.IO is at-most-once by its own account — "there is no guarantee that
 * the other side has received it and there will be no retry upon reconnection"
 * — so a play emitted into a failing connection simply vanished, and the only
 * thing the player saw was their turn running out and passing itself.
 *
 * Retrying is safe here because the server resolves card ids against the hand
 * it holds: a replay of a play that already landed matches nothing and is
 * refused, so the second copy cannot play the same card twice. That is asserted
 * in `tests/integration/intentAcknowledged.test.ts`, not assumed.
 *
 * A refusal ends it. Repeating something the server has already rejected only
 * delays telling the player.
 */
export async function sendIntent(
  socket: Socket | null,
  event: string,
  payload?: unknown,
  { attempts = INTENT_ATTEMPTS, timeoutMs = INTENT_ACK_TIMEOUT_MS } = {}
): Promise<IntentOutcome> {
  if (!socket) return { ok: false };

  for (let attempt = 0; attempt < attempts; attempt++) {
    const outcome = await new Promise<IntentOutcome | null>((resolve) => {
      const done = (reply: IntentOutcome | null) => resolve(reply);
      const args: unknown[] = payload === undefined ? [] : [payload];
      socket
        .timeout(timeoutMs)
        .emit(event, ...args, (err: unknown, reply: IntentOutcome | undefined) =>
          done(err ? null : (reply ?? { ok: true }))
        );
    });
    if (outcome) return outcome;
  }
  return { ok: false };
}
