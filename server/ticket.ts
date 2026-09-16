import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { lt, sql } from "drizzle-orm";
import { db } from "./db.ts";
import { socketTicketNonces } from "../shared/schema.ts";

/**
 * Short-lived, single-use socket handshake tickets.
 *
 * A ticket is minted only by an authenticated REST call, is signed with
 * SESSION_SECRET, expires after 60s and can be redeemed exactly once —
 * trusting a bare `handshake.auth.userId` instead would let any client
 * connect as any user. Native clients frequently do not send the session
 * cookie on the websocket upgrade — the ticket is what makes those clients
 * work.
 *
 * It names the session that minted it, and dies with that session.
 */

const TICKET_TTL_MS = 60_000;
const MAX_TICKET_LENGTH = 768;

export interface SocketTicket {
  userId: string;
  sid: string;
  nonce: string;
  expiresAt: number;
}

function sign(payload: string): string {
  return createHmac("sha256", process.env.SESSION_SECRET!)
    .update(payload)
    .digest("base64url");
}

const encode = (s: string) => Buffer.from(s, "utf8").toString("base64url");
const decode = (s: string) => Buffer.from(s, "base64url").toString("utf8");

export function mintSocketTicket(userId: string, sid: string): {
  ticket: string;
  expiresAt: number;
} {
  const nonce = randomBytes(16).toString("base64url");
  const expiresAt = Date.now() + TICKET_TTL_MS;
  const payload = `${encode(userId)}.${encode(sid)}.${nonce}.${expiresAt}`;
  return { ticket: `${payload}.${sign(payload)}`, expiresAt };
}

/**
 * The signature and expiry check alone. Returns null if the ticket is
 * malformed, forged or expired; `redeemSocketTicket` decides whether it is
 * still unused and its session still live.
 */
export function verifySocketTicket(raw: unknown): SocketTicket | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_TICKET_LENGTH) {
    return null;
  }
  const parts = raw.split(".");
  if (parts.length !== 5) return null;

  const [encodedUserId, encodedSid, nonce, expiresAtRaw, signature] = parts as [
    string,
    string,
    string,
    string,
    string,
  ];
  const expiresAt = Number(expiresAtRaw);
  const now = Date.now();
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return null;
  if (expiresAt > now + TICKET_TTL_MS * 2) return null;

  const expected = sign(`${encodedUserId}.${encodedSid}.${nonce}.${expiresAtRaw}`);
  const given = Buffer.from(signature);
  const want = Buffer.from(expected);
  if (given.length !== want.length || !timingSafeEqual(given, want)) return null;

  const userId = decode(encodedUserId);
  const sid = decode(encodedSid);
  if (userId.length === 0 || userId.length > 128 || sid.length === 0) return null;
  return { userId, sid, nonce, expiresAt };
}

/**
 * Burns a verified ticket's nonce and confirms the session that minted it
 * still exists. False when either fails: a reset or a logout deletes the
 * session, and a ticket minted before it must not open a socket after it.
 */
export async function redeemSocketTicket(ticket: SocketTicket): Promise<boolean> {
  await db.delete(socketTicketNonces).where(lt(socketTicketNonces.expiresAt, new Date()));
  const burned = await db
    .insert(socketTicketNonces)
    .values({ nonce: ticket.nonce, expiresAt: new Date(ticket.expiresAt) })
    .onConflictDoNothing()
    .returning({ nonce: socketTicketNonces.nonce });
  if (burned.length === 0) return false;

  const live = await db.execute(
    sql`SELECT 1 FROM session WHERE sid = ${ticket.sid} AND expire > now()
        AND sess->>'userId' = ${ticket.userId}`
  );
  return live.rows.length > 0;
}
