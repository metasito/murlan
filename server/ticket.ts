import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Short-lived, single-use socket handshake tickets.
 *
 * A ticket is minted only by an authenticated REST call, is signed with
 * SESSION_SECRET, expires after 60s and can be redeemed exactly once —
 * trusting a bare `handshake.auth.userId` instead would let any client
 * connect as any user. Native clients frequently do not send the session
 * cookie on the websocket upgrade — the ticket is what makes those clients
 * work.
 */

const TICKET_TTL_MS = 60_000;
const MAX_TICKET_LENGTH = 512;

/** nonce -> expiry (ms). Pruned on every consume; bounded by the mint rate. */
const consumedNonces = new Map<string, number>();

function sign(payload: string): string {
  return createHmac("sha256", process.env.SESSION_SECRET!)
    .update(payload)
    .digest("base64url");
}

function pruneConsumed(now: number) {
  for (const [nonce, expiry] of consumedNonces) {
    if (expiry <= now) consumedNonces.delete(nonce);
  }
}

export function mintSocketTicket(userId: string): {
  ticket: string;
  expiresAt: number;
} {
  const nonce = randomBytes(16).toString("base64url");
  const expiresAt = Date.now() + TICKET_TTL_MS;
  const payload = `${Buffer.from(userId, "utf8").toString("base64url")}.${nonce}.${expiresAt}`;
  return { ticket: `${payload}.${sign(payload)}`, expiresAt };
}

/**
 * Verifies and burns a ticket. Returns the userId it was minted for, or null
 * if the ticket is malformed, forged, expired or already used.
 */
export function consumeSocketTicket(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_TICKET_LENGTH) {
    return null;
  }
  const parts = raw.split(".");
  if (parts.length !== 4) return null;

  const [encodedUserId, nonce, expiresAtRaw, signature] = parts;
  const expiresAt = Number(expiresAtRaw);
  const now = Date.now();
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return null;
  if (expiresAt > now + TICKET_TTL_MS * 2) return null;

  const expected = sign(`${encodedUserId}.${nonce}.${expiresAtRaw}`);
  const given = Buffer.from(signature);
  const want = Buffer.from(expected);
  if (given.length !== want.length || !timingSafeEqual(given, want)) return null;

  pruneConsumed(now);
  if (consumedNonces.has(nonce)) return null;
  consumedNonces.set(nonce, expiresAt);

  const userId = Buffer.from(encodedUserId, "base64url").toString("utf8");
  return userId.length > 0 && userId.length <= 128 ? userId : null;
}

