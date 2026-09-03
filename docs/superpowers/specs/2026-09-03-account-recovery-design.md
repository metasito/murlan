# Real account recovery: email + password reset

Design for #38. Settles the six open boxes with a recommendation, its reversal cost, and its
place on the cheapest-change ladder (`CLAUDE.md` → *Working agreement*: derive from existing
rows → ride an existing jsonb column → new table → new column). No code lands on this ticket —
no edit to `shared/schema.ts` or `server/schemaDdl.ts`, no `db:push`, no migration.

## Already decided, recorded here rather than reopened

- **Email required at signup.** (#34, 2026-08-31 — the anti-farming side of the same question.)
- **Verified, and an unverified address may not reset a password.** An unverified address that
  can reset is registration-then-takeover of someone else's account.

Both retire the "optional email" branch entirely: every recommendation below assumes new
accounts always carry an email, and that email is not trusted for recovery until confirmed.

## Ground truth this design leans on

| Where | What it establishes |
| --- | --- |
| `shared/schema.ts` `users` table | No jsonb column exists on `users` to ride. `friendCode`-style unique index (`users_username_lower_uq`) is the precedent for a case-insensitive unique email index. |
| `server/schemaDdl.ts` | Additive and idempotent only — it cannot add a `NOT NULL` column against rows that have none, which independently forces "nullable column" below; it is not a friendliness choice. |
| `server/storage.ts:121` | `DELETE FROM session WHERE sess->>'userId' = ${userId}` — already the exact idiom for "clear this user's live sessions," used today by account deletion. The reset design reuses it verbatim rather than inventing a second way to query the `session` table. |
| `server/ticket.ts` | The existing single-use credential (`mintSocketTicket`/`consumeSocketTicket`): HMAC-signed, stateless, 60s TTL, in-memory nonce set. Structurally wrong for a reset token — see Box 2. |
| `server/routes.ts:60-143` | `authLimiter` (per-IP) and `loginUsernameLimiter` (per-username, decoy-bcrypt, generic 401) — the shape #41 landed for exactly this "unauthenticated endpoint, shared network" problem. Reset-request reuses it rather than inventing a third shape. |
| `scripts/reset-password.mjs` | The stopgap. Box "the migration path" and the ground-truth table both ask whether it survives — it does, see below. |
| package.json dependencies | No mail-sending library present today (no `nodemailer`, no vendor SDK) — "the sender" is a real decision, not a rubber stamp. |

## Box 1 — Migration path for existing beta accounts

**Recommendation.** `users.email` and `users.email_verified_at` both land **nullable**. An
existing account keeps every capability it has today — log in, play, everything — with no
deadline and no lockout imposed by this work. What it *cannot* do until it adds and verifies an
address is request a self-serve password reset (there is nothing to send a link to, and an
unverified address is excluded from resetting by the decision above anyway). It is prompted with
a **non-blocking banner** in-app (profile screen, `NotificationBanner`-style, not an `Alert` —
consistent with the existing invite-banner rule in `CLAUDE.md`) inviting it to add an email; doing
so runs the same verification-token flow a new signup runs. `scripts/reset-password.mjs` is that
account's actual recovery path until it does.

**Why not the cheaper rungs.** "Derive from existing rows" is unavailable — there is no source
column holding these players' emails anywhere in the schema. A hard cutover (require it within N
days, then block login) was considered and rejected: #34's anti-farming concern is about *new*
sacrificial accounts, not the already-known beta cohort, so forcing a deadline on existing players
buys no anti-farming value and risks losing real testers to a login wall over a feature (reset)
most of them will never need. That tradeoff is a product-policy call, not an engineering one, so
the design leaves it a soft nudge and flags a hard deadline as a decision the owner can add later
without any schema change.

**Reversal cost.** Cheap. The column stays nullable regardless of whether a deadline is added
later; a deadline is enforced in application code (a login-time check), not the schema, so it can
be introduced or removed without touching a row.

## Box 2 — Token storage, lifetime, single-use

**Recommendation.** One new table, covering both purposes this ticket and its sibling need
(password reset and email verification), rather than two — they are the same shape (prove control
of an email, once, within a window) and would otherwise duplicate the same expiry/redemption code
and the same cleanup query twice:

```
auth_tokens
  id          uuid, pk
  user_id     fk -> users.id, on delete cascade
  purpose     text: "password_reset" | "email_verify"
  token_hash  text  -- sha256 of the raw token; the raw token is never stored
  expires_at  timestamp
  used_at     timestamp, nullable
  created_at  timestamp, default now()
```

The raw token is a `randomBytes(32)` value, sent to the user (in the reset link / verify link)
and never persisted — only its SHA-256 hash is. A row is redeemed by `UPDATE auth_tokens SET
used_at = now() WHERE token_hash = $1 AND purpose = $2 AND used_at IS NULL AND expires_at > now()
RETURNING user_id`: the `used_at IS NULL` guard inside the same statement is what makes single-use
atomic against two near-simultaneous redemptions, rather than a read-then-write race. Expiry:
**30 minutes for `password_reset`** (short, because it grants a credential change), **24 hours
for `email_verify`** (longer is safe — it only confirms mailbox ownership, not account access).
Requesting a new token of the same purpose does not need to invalidate the previous one explicitly
— it is left alone and simply expires or gets redeemed once; the redemption guard already makes
using an old one no more powerful than using the newest one.

**Why not the ticket.ts shape.** `server/ticket.ts`'s signed, stateless, in-memory-nonce ticket is
right for its own job (60-second socket handshake credential, minted and consumed within the same
process's lifetime) and wrong for this one for three independent reasons: a reset link is clicked
minutes to hours later, so it must survive a server restart (an in-memory nonce set cannot); its
lifetime is long enough that "bounded by the mint rate" is no longer a safe memory ceiling; and
single-use here has to be independently auditable and revocable (an owner looking at `auth_tokens`
can see and invalidate a pending token), which a bare signature can't offer. This is also the
answer to the ticket's warning about a fourth handshake credential: this table is read by two new
plain HTTP routes only, and is never consulted by the socket handshake in any form.

**Cheapest rung, and why not cheaper.** "Ride an existing jsonb column" was considered — e.g. a
`pending_token` jsonb column on `users` instead of a side table. Rejected: it would only support
one outstanding token per user at a time (a verify-email token and a password-reset token can
legitimately be pending simultaneously), and every redemption would need a full-row `users`
update instead of a targeted delete/mark, on the same hot table every login touches. A new table
is the correct rung here, ahead of a new column, matching the ladder's stated order.

**Reversal cost.** Moderate — it is a new table, so removing it after data has been written means
dropping it (a `db:push` decision, backed by the standing `pg_dump`-first rule). Cheap in the
sense that nothing else references it: no foreign key points *at* `auth_tokens`, so there is
nothing else to unwind first.

## Box 3 — The sender

**Recommendation.** A single `server/mail.ts` module that calls a transactional-email provider's
HTTP API directly with the platform's built-in `fetch` (Node 22, already the runtime) — no SDK
dependency. This keeps the Replit constraint ("no build step needing local tooling") trivially
true and adds zero new packages. Credentials (an API key, and the verified "from" address) live
in Replit Secrets alongside `DATABASE_URL` and `SESSION_SECRET`, read via `process.env`, exactly
as `CLAUDE.md` requires.

**Vendor:** recommend **Resend** as the default — API-key-plus-`fetch`, a free tier that comfortably
covers a beta's reset/verify volume, and no SMTP port to fight with on Replit. This is a
naming, not a purchase: the owner may prefer Postmark or SendGrid instead, and because sending is
isolated to the one module above, swapping providers later is a rewrite of that module's body,
not a schema or call-site change.

**Reversal cost.** Cheap. `server/mail.ts` exports one function (`sendMail(to, subject, ...)`);
every caller (verification, reset) goes through it, so a vendor swap or removal touches one file.

## Box 4 — Rate limiting

**Recommendation.** Reuse #41's landed shape rather than invent a third one, since the failure
mode is identical: an unauthenticated, per-account-adjacent endpoint on a network beta testers
share.

- **Reset-request** (`POST /api/auth/request-password-reset`, unauthenticated by nature): a
  **per-email limiter**, keyed on the submitted address normalized the same way lookup normalizes
  it, plus the existing **per-IP `authLimiter`** as a broad backstop sized so a shared network
  never reaches it — the same two-tier shape #41 chose for login, for the same reason (one knob
  cannot serve both a household and an office).
- **Reset-submit** (`POST /api/auth/reset-password`): the primary defense is the token's 256 bits
  of entropy, not rate limiting — brute-forcing it is not a realistic threat at any rate limit.
  A modest per-IP cap (mirroring `ticketLimiter`'s shape, not `authLimiter`'s numbers) is still
  worth adding as defense-in-depth against automated scanning of the endpoint, without needing
  the per-username precision login required.
- Both bounds env-overridable, following `authMaxFromEnv()`'s existing pattern, so
  `tests/helpers/testServer.ts` can drive them the way it already drives `authLimiter`.

**Reversal cost.** Cheap — limiter numbers and keys are config, not schema or data.

## Box 5 — Enumeration

**Recommendation.** No. `POST /api/auth/request-password-reset` returns the same `200 { ok: true
}` whether or not the address belongs to a verified account, and takes roughly the same time
either way (send-or-not both happen after the same lookup + hash-comparison-shaped work, so no
early return short-circuits before the expensive part — mirroring the decoy-bcrypt fix #41 landed
for exactly this reason: a response-shape fix that leaves a timing fix undone reopens the same
hole). This repeats a tradeoff the owner already made once, explicitly, on #41: *"Accepted cost: a
genuinely locked-out user is not told why."* Recommend inheriting it rather than re-litigating,
for consistency across the two flows a beta tester will experience identically.

**Reversal cost.** Cheap — a response-shape change with no stored-data implication.

## Box 6 — Live sessions on a successful reset

**Recommendation.** On a successful `reset-password` submission, run
`DELETE FROM session WHERE sess->>'userId' = $1` for that user — the exact statement
`server/storage.ts:121` already runs on account deletion — immediately after the new password
hash is written, inside the same request. This logs out every device the instant a reset
succeeds, which is the actual point of a reset after a suspected compromise. Never `DROP` or
alter the `session` table itself; this only ever deletes rows, and only that user's.

**Reversal cost.** None — this is a runtime side effect of the reset endpoint, not a schema or
data change. Removing the call is a one-line revert.

## `scripts/reset-password.mjs`

**Survives, as the break-glass tool.** It remains the only recovery path for: an account that has
not yet added a verified email (Box 1), and an account that has but has also lost access to that
mailbox. Its docstring gets one line added, in the implementing ticket, noting that self-serve
reset now exists and this is deliberately the fallback rather than a stale duplicate.

## In-app change-password screen — scoped, not built

Separate from the "forgot password" flow above: this is a logged-in user changing a password they
still remember.

- **Endpoint:** `POST /api/auth/change-password`, `requireAuth`, body `{ currentPassword,
  newPassword }`. Verifies `currentPassword` against the stored hash with `bcrypt.compare` before
  writing the new one — the session alone is not sufficient proof of intent to change a
  credential.
- **Sessions:** clears every *other* session for the user (same `DELETE ... sess->>'userId'`
  idiom, `AND sid != $currentSid`) so a change from a compromised device that is not the current
  one still kicks a lingering attacker out, without logging the user themselves out mid-flow.
- **UI:** a card on the profile screen (`app/profile.tsx`, which `CLAUDE.md` already names as the
  `MenuLayout`/`MenuCard`/`MenuButton` reference screen), using `AppModal` for the two-field form,
  not a new screen route.
- **No email dependency.** Unlike reset, this never touches `auth_tokens` or the mailer — it is
  gated entirely by the existing session, so it ships independent of the email/reset work if the
  owner wants it landed first.

## Implementation tickets filed from this design

Filed as separate `ready-for-agent` issues, each sized and carrying its blocking edge:

1. **Email at signup: column, verification token, verify-email endpoint** — `size:M`. Builds
   `users.email`/`email_verified_at`, the `auth_tokens` table, `server/mail.ts`, and the
   signup-time verification flow. Everything else below depends on this landing first.
2. **Password reset: request + submit endpoints** — `size:M`, blocked by (1). Builds the two
   reset routes, the rate limiting from Box 4, the enumeration-safe response from Box 5, and the
   session-clearing from Box 6.
3. **Existing-account email migration nudge** — `size:S`, blocked by (1). The non-blocking banner
   and add-email flow from Box 1, for accounts that predate the email requirement.
4. **In-app change-password screen** — `size:S`, no blocking edge (does not need email or
   `auth_tokens`). Builds the endpoint and UI scoped above.
