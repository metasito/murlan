# #893 — the account-recovery screens

The server side of account recovery is complete and correct. Nothing in `app/` calls any of it,
so `emailVerifiedAt` can never be set, so `request-password-reset` can never mint anything, so
no reset mail can ever be sent — and every endpoint still answers `200 { ok: true }`. This
builds the client half, plus the two server gaps that make the client half reachable.

## The shape of the answer

**A typed/pasted code, not a deep link.** The mails already carry a bare token and the ticket
leaves the choice open. A deep link needs a universal-link/app-scheme configuration, an
`APP_BASE_URL` the server does not have, and a `+native-intent` path — three moving parts, none
of which is what makes the feature inert today. The code is copied from the mail and pasted
into a field. Deep links stay a later, separable ticket.

## Client

### `app/verify-email.tsx` (new)

One field (the code) and a submit. `POST /api/auth/verify-email { token }`. On 200 it refreshes
the signed-in user and returns whence it came. `INVALID_TOKEN` and `EMAIL_VERIFIED_ELSEWHERE`
render through `serverErrorMessage` like every other screen.

Reachable from three places, because there are three ways to end up with an unverified address:

- the "check your email" interstitial `app/auth.tsx` already shows after registration,
- `AddEmailCard` in `app/profile.tsx`, after the address is accepted,
- a profile card that appears whenever `user.email && !user.emailVerified` — the state a player
  returns to the app in, having read the mail on another device.

### `app/recover.tsx` (new)

Two steps in one screen, because they are one errand:

1. **request** — an email field. `POST /api/auth/request-password-reset`. The reply is
   deliberately identical whether or not the address has a verified account (#897), so the
   screen says so in those terms — "if that address has a verified account, a code is on its
   way" — and advances. It must not claim a mail was sent.
2. **reset** — the code and a new password. `POST /api/auth/reset-password`. On 200 it returns
   to `app/auth.tsx` on the login tab with a success notice; it does not sign the player in,
   because `reset-password` returns no session and the password they just chose is the thing
   to prove.

A player who already has a code (they closed the app, read the mail, came back) skips to step 2
directly from step 1.

### `app/auth.tsx`

A "forgot password" control under the login tab's submit. On the register interstitial, a
secondary control into `/verify-email` for the player who has the mail open right now.

### `context/AuthContext.tsx`

Add `refreshUser()`, which is `fetchMe()` applied with the same contract the boot path already
uses — `undefined` means the question went unanswered and the cached user stands. Verification
changes a field of the signed-in user (`emailVerified`) with no other side effect, so this is
the whole of what the verify screen needs.

## Server — two gaps

### `POST /api/auth/resend-verification` (new)

Without it, a code that expires (24h) leaves an account permanently unverifiable: `add-email`
refuses once an address is set (`EMAIL_ALREADY_SET`), and nothing else mints an `email_verify`
token. That is the same class of dead end this ticket exists to remove.

`requireAuth`; refuses unless the account has an address and `emailVerifiedAt` is null; invalidates
pending siblings then mints and sends, exactly as `add-email` does. Rate-limited per account —
it is a way to make the server send mail, so it is limited the way `addEmailLimiter` is.

### The mail sink, so the flow can be tested end to end

An e2e test cannot get a raw token: only its hash is stored, and the mail goes to Resend.
`server/mail.ts` grows one branch — when `MURLAN_MAIL_SINK` names a file **and**
`NODE_ENV !== "production"`, `sendMail` appends `{to, subject, text}` as a JSON line to that
file and returns true without contacting the provider. It is not a route, so it adds no HTTP
surface; it needs filesystem access to the server's own host to read.

`tests/e2e/playwright.config.ts` computes the path once (like `E2E_PORT`), hands it to the
`webServer` env and re-exports it so workers see the same file.

## Verification

- `tests/e2e/accountRecovery.spec.ts` — register → read the verification code from the sink →
  verify → sign out → forgot password → read the reset code → set a new password → sign in with
  it. This is the acceptance criterion, and the only check that can see the wiring at all: a
  source scan cannot tell a rendered control from a string that happens to exist.
- A `tests/native/` rendering test for both screens, since only a rendering test proves the
  control is reached rather than merely present.
- An integration test for `resend-verification`: refused when there is no address, refused when
  already verified, and the previous pending token dead after a resend.
- `add-email → verify` stays covered at the integration level: registration takes an address, so
  `add-email` is the legacy-account path only.

## Not in scope

Deep links. Localising the mail bodies themselves (`verificationEmailBody` is English outside
`t()` — a standing follow-up, unchanged here). Configuring the production mail secrets (#875).
