import type { Socket } from "./socket.ts";

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

/**
 * Every event the client sends. Anything not listed here has no path to the
 * server: `tests/intentsGoThroughSend.test.ts` refuses a bare emit.
 */
export type IntentEvent =
  | "room:create"
  | "room:join"
  | "room:rejoin"
  | "room:spectate"
  | "room:unspectate"
  | "room:leave"
  | "room:quickmatch"
  | "room:setVisibility"
  | "room:start"
  | "game:play"
  | "game:pass"
  | "game:exchange_give_card"
  | "game:rejoin"
  | "game:reaction"
  | "game:rematch_vote"
  | "game:end_match_vote"
  | "game:rematch_intent";

/**
 * Refusals that mean "not yet" rather than "no": the socket is between a
 * reconnect and its rejoin, or the table's instance was slow to answer.
 */
export const RETRYABLE_CODES: ReadonlySet<string> = new Set(["NOT_AT_A_TABLE", "TABLE_UNREACHABLE"]);

let minted = 0;

/** A dedupe key the server scopes by user, not a secret. */
function mintIntentId(): string {
  minted += 1;
  return `${Date.now().toString(36)}-${minted.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** A table answers `game:rejoin` with its state, a waiting lobby `room:rejoin` with its own. */
const REJOIN_ANSWERS = ["game:state", "room:state"] as const;

/** Resolves once either rejoin is answered, or after `ms`. */
function rejoined(socket: Socket, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      for (const event of REJOIN_ANSWERS) socket.off(event, done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    for (const event of REJOIN_ANSWERS) socket.once(event, done);
  });
}

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
 * Every attempt carries the same `intentId`, and the server answers a repeat
 * of an intent it already applied with the first answer rather than applying it
 * again — asserted in `tests/integration/intentAcknowledged.test.ts`.
 *
 * A refusal ends it, unless it is one of `RETRYABLE_CODES`. Repeating
 * something the server has already rejected only delays telling the player.
 */
export async function sendIntent(
  socket: Socket | null,
  event: IntentEvent,
  payload?: object,
  { attempts = INTENT_ATTEMPTS, timeoutMs = INTENT_ACK_TIMEOUT_MS } = {}
): Promise<IntentOutcome> {
  if (!socket) return { ok: false };
  const message = { ...payload, intentId: mintIntentId() };

  let last: IntentOutcome = { ok: false };
  for (let attempt = 0; attempt < attempts; attempt++) {
    const outcome = await new Promise<IntentOutcome | null>((resolve) => {
      socket
        .timeout(timeoutMs)
        .emit(event, message, (err: unknown, reply: IntentOutcome | undefined) =>
          resolve(err ? null : (reply ?? { ok: true }))
        );
    });
    if (!outcome) continue;
    if (!RETRYABLE_CODES.has(outcome.code ?? "")) return outcome;
    last = outcome;
    if (attempt < attempts - 1) await rejoined(socket, timeoutMs);
  }
  return last;
}

/**
 * The only way the client talks to the server. `retry: false` is for an
 * intent the server does not dedupe, where a second copy is a second room.
 */
export function send(
  socket: Socket | null,
  event: IntentEvent,
  payload?: object,
  { retry = true }: { retry?: boolean } = {}
): Promise<IntentOutcome> {
  return sendIntent(socket, event, payload, { attempts: retry ? INTENT_ATTEMPTS : 1 });
}

/** Whether the player should be told the intent never landed. */
export function undelivered(outcome: IntentOutcome): boolean {
  return !outcome.ok && (!outcome.code || RETRYABLE_CODES.has(outcome.code));
}
