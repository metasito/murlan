import { test, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { mintSocketTicket, verifySocketTicket } from "../../server/socket/ticket.ts";

const SECRET = "socket-ticket-test-secret";
let savedSecret: string | undefined;

beforeEach(() => {
  savedSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = SECRET;
});
afterEach(() => {
  process.env.SESSION_SECRET = savedSecret;
  mock.restoreAll();
});

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");

function withSegment(ticket: string, index: number, value: string): string {
  const parts = ticket.split(".");
  parts[index] = value;
  return parts.join(".");
}

test("a freshly minted ticket verifies to the user and session that minted it", () => {
  const { ticket } = mintSocketTicket("user-1", "sid-1");
  const verified = verifySocketTicket(ticket);
  assert.equal(verified?.userId, "user-1");
  assert.equal(verified?.sid, "sid-1");
});

test("a ticket with one signature character changed is refused", () => {
  const { ticket } = mintSocketTicket("user-1", "sid-1");
  const signature = ticket.split(".")[4]!;
  const flipped = (signature[0] === "A" ? "B" : "A") + signature.slice(1);
  assert.equal(verifySocketTicket(withSegment(ticket, 4, flipped)), null);
});

test("a ticket signed under a different SESSION_SECRET is refused", () => {
  process.env.SESSION_SECRET = "some-other-secret";
  const { ticket } = mintSocketTicket("user-1", "sid-1");
  process.env.SESSION_SECRET = SECRET;
  assert.equal(verifySocketTicket(ticket), null);
});

test("a ticket whose userId is swapped under the original signature is refused", () => {
  const { ticket } = mintSocketTicket("attacker", "sid-1");
  assert.equal(verifySocketTicket(withSegment(ticket, 0, b64("victim"))), null);
});

test("a well-formed ticket past its expiry is refused", () => {
  const { ticket, expiresAt } = mintSocketTicket("user-1", "sid-1");
  mock.method(Date, "now", () => expiresAt + 1);
  assert.equal(verifySocketTicket(ticket), null);
});
