# 0007. Account recovery: email verification and password reset

**Status:** Accepted
**Date:** 2026-09-03

## Context

Design for #38, settling six open questions ("boxes") a real recovery flow forces, each with a
recommendation, its reversal cost, and its place on the cheapest-change ladder (derive from
existing rows → ride an existing jsonb column → new table → new column). Shipped across #861–#864.
`server/http/routes.ts`, `shared/schema.ts`, `server/http/mail.ts` and `lib/emailNudge.ts` cite
these by box number; the numbering below is that citation's target.

## Decision

- **Box 1 — Migration path for existing beta accounts.** `users.email` and
  `users.email_verified_at` land nullable, under a case-insensitive unique index
  (`users_email_lower_uq`). An account with no email keeps every capability it has today and is
  invited by a non-blocking in-app banner to add one; it cannot self-serve a password reset until
  it does, and `scripts/reset-password.mjs` is its recovery path until then. No hard deadline —
  that is a product-policy call the owner can add later without a schema change.
- **Box 2 — Token storage, lifetime, single-use.** One `auth_tokens` table (`user_id`, `purpose`:
  `password_reset` | `email_verify`, `token_hash`, `expires_at`, `used_at`) serves both purposes
  rather than duplicating the expiry/redemption code twice. The raw token is `randomBytes(32)`,
  never stored — only its SHA-256 hash is, redeemed with an atomic `used_at IS NULL AND expires_at
  > now()` guard. Expiry: 30 minutes for `password_reset`, 24 hours for `email_verify`. Redeeming a
  `password_reset` token invalidates every other outstanding one for that user, in the same
  statement, paired with Box 6's session clear.
- **Box 3 — The sender.** One `server/http/mail.ts` module calling a transactional-email
  provider's HTTP API via `fetch`, no SDK dependency; credentials read via `process.env`.
- **Box 4 — Rate limiting.** Reset-request: a per-email limiter plus the existing per-IP
  `authLimiter` backstop, mirroring #41's two-tier login shape. Reset-submit: a modest per-IP cap
  as defense-in-depth — the token's 256 bits of entropy, not the limiter, is the real defense.
- **Box 5 — Enumeration.** `POST /api/auth/request-password-reset` returns the same `200 { ok:
  true }` in the same time whether or not the address exists: the handler replies before
  dispatching the send, so the outbound mail call (the actual timing oracle) never gates the
  response.
- **Box 6 — Live sessions on a successful reset.** A successful reset deletes every session row
  for that user (`server/http/deleteAccount.ts`'s existing account-deletion idiom), in the same
  request as the password write, paired with Box 2's sibling-token invalidation — clearing one
  live credential while leaving the other standing would still evict an attacker for only about a
  minute.

## Consequences

`scripts/reset-password.mjs` survives as the break-glass tool for an account with no verified
email, or one that has lost access to its mailbox. A future review reading only the box number in
a source comment should read this record, not re-derive the reasoning behind it — the reversal
cost of each box is documented in the original design thread on #861–#864, cheapest for Boxes 3–6,
moderate for Box 2 (dropping `auth_tokens` after data exists is a `db:push` decision), and the
column additions in Box 1 are permanent but harmless (nullable, unique, satisfied by every existing
row on the day it lands).
